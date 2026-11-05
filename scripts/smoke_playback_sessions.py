"""Exercise independent preview, time-shift playback, and recording with local HLS sources."""
from __future__ import annotations

import json
import os
import tempfile
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def call(base: str, path: str, method: str = "GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(base + path, data=body, method=method,
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{method} {path}: {exc.code} {exc.read().decode()}") from exc


def get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=8) as response:
        return response.read()


def start_backend(app, port: int):
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started and time.monotonic() < deadline:
        time.sleep(.1)
    assert server.started, "Backend did not start"
    return server, thread, f"http://127.0.0.1:{port}"


def stop_backend(server, thread):
    server.should_exit = True
    thread.join(timeout=15)
    assert not thread.is_alive(), "Backend did not shut down cleanly"


def wait_until(predicate, seconds: int, message: str):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.25)
    raise AssertionError(message)


def playlist_info(base: str, path: str):
    text = get_bytes(base + path).decode("utf-8", "replace")
    segments = [line for line in text.splitlines() if line and not line.startswith("#")]
    sequence = next((int(line.split(":", 1)[1]) for line in text.splitlines() if line.startswith("#EXT-X-MEDIA-SEQUENCE:")), 0)
    return text, sequence, segments


def verify_segment(base: str, playlist_path: str):
    _, _, segments = playlist_info(base, playlist_path)
    assert segments, f"No complete segments in {playlist_path}"
    segment_url = urllib.parse.urljoin(base + playlist_path, segments[-1])
    payload = get_bytes(segment_url)
    assert len(payload) > 1000, f"Segment was unexpectedly small: {len(payload)} bytes"
    descriptor, temp_name = tempfile.mkstemp(suffix=".ts")
    os.close(descriptor)
    temp = Path(temp_name)
    try:
        temp.write_bytes(payload)
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height",
                                "-of", "json", str(temp)], capture_output=True, text=True, check=True)
        media = json.loads(probe.stdout)
        assert any(item.get("codec_type") == "video" for item in media["streams"]), "HLS segment has no video"
        assert any(item.get("codec_type") == "audio" for item in media["streams"]), "HLS segment has no audio"
        return len(payload)
    finally:
        temp.unlink(missing_ok=True)


def main():
    root = Path(tempfile.mkdtemp(prefix="streamx-playback-smoke-"))
    os.environ["STREAMX_HOME"] = str(root / "appdata")
    feeds = root / "feeds"
    generators = []
    web = None
    server = None
    server_thread = None
    server2 = None
    server_thread2 = None
    try:
        for name, frequency in (("one", 440), ("two", 880)):
            folder = feeds / name
            folder.mkdir(parents=True)
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i",
                       "testsrc2=size=320x180:rate=15", "-f", "lavfi", "-i",
                       f"sine=frequency={frequency}:sample_rate=44100", "-t", "120", "-c:v", "libx264",
                       "-preset", "ultrafast", "-tune", "zerolatency", "-g", "30", "-sc_threshold", "0",
                       "-c:a", "aac", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
                       "-hls_flags", "append_list+omit_endlist", "-hls_segment_filename",
                       str(folder / "segment_%03d.ts"), str(folder / "index.m3u8")]
            generators.append(subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        wait_until(lambda: all((feeds / name / "index.m3u8").exists() for name in ("one", "two")), 15,
                   "Timed out while creating local HLS feeds")

        feed_port = free_port()
        class QuietHandler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(feeds), **kwargs)
            def log_message(self, fmt, *args): pass
        web = ThreadingHTTPServer(("127.0.0.1", feed_port), QuietHandler)
        threading.Thread(target=web.serve_forever, daemon=True).start()

        import backend.main as backend
        api_port = free_port()
        server, server_thread, base = start_backend(backend.app, api_port)
        recording_dir = root / "recordings"
        call(base, "/api/settings", "PUT", {"recording_dir": str(recording_dir), "max_recordings": 2,
             "retry_seconds": 2, "monitor_seconds": 3600, "low_disk_gb": 0, "segment_minutes": 0,
             "timeshift_buffer_minutes": 5, "timeshift_max_storage_gb": 2, "timeshift_min_free_gb": 0,
             "preview_transcode": True})
        sources = []
        for name in ("one", "two"):
            url = f"http://127.0.0.1:{feed_port}/{name}/index.m3u8"
            stream = call(base, "/api/streams", "POST", {"name": f"Playback {name}", "url": url,
                           "group_name": "Playback smoke", "quality": "best", "container": "mkv",
                           "auto_record": False, "monitor": False})
            sources.append(stream)

        for stream in sources:
            call(base, f"/api/streams/{stream['id']}/record", "POST")
        print("Started two recordings")
        first_id, second_id = [stream["id"] for stream in sources]
        call(base, f"/api/streams/{first_id}/preview", "POST")
        playback_one = call(base, f"/api/streams/{first_id}/timeshift", "POST")
        playback_two = call(base, f"/api/streams/{second_id}/timeshift", "POST")
        assert playback_one["session_id"] != playback_two["session_id"], "Playback sessions are not independent"

        def sessions_ready():
            current = {item["id"]: item for item in call(base, "/api/streams")}
            return (current[first_id].get("preview", {}).get("state") == "playing"
                    and current[first_id].get("timeshift", {}).get("state") == "playing"
                    and current[second_id].get("timeshift", {}).get("state") == "playing"
                    and current[first_id].get("session", {}).get("file_size", 0) > 100_000
                    and current[second_id].get("session", {}).get("file_size", 0) > 100_000)
        wait_until(sessions_ready, 45, "Preview, playback, or recording did not produce media")
        current = {item["id"]: item for item in call(base, "/api/streams")}
        preview_path = current[first_id]["preview"]["url"]
        shift_one_path = current[first_id]["timeshift"]["url"]
        shift_two_path = current[second_id]["timeshift"]["url"]
        print(f"Preview segment verified: {verify_segment(base, preview_path)} bytes with audio/video")
        print(f"Time-shift A segment verified: {verify_segment(base, shift_one_path)} bytes with audio/video")
        print(f"Time-shift B segment verified: {verify_segment(base, shift_two_path)} bytes with audio/video")

        before = {item["id"]: item["session"]["file_size"] for item in call(base, "/api/streams") if item["id"] in (first_id, second_id)}
        _, sequence_before, segments_before = playlist_info(base, shift_one_path)
        time.sleep(4)
        after = {item["id"]: item["session"]["file_size"] for item in call(base, "/api/streams") if item["id"] in (first_id, second_id)}
        _, sequence_after, segments_after = playlist_info(base, shift_one_path)
        assert all(after[sid] > before[sid] for sid in (first_id, second_id)), "Recording stopped growing during playback idle/pause interval"
        assert sequence_after > sequence_before or segments_after[-1] != segments_before[-1], "Time-shift live edge did not advance"
        print("Time-shift buffer advanced while playback was idle; both recording files kept growing")

        call(base, f"/api/streams/{first_id}/timeshift", "DELETE")
        call(base, f"/api/streams/{first_id}/preview", "DELETE")
        wait_until(lambda: all(item["id"] != first_id or not item.get("timeshift") for item in call(base, "/api/streams")), 10,
                   "Closing the first playback session did not clear it")
        wait_until(lambda: next(item for item in call(base, "/api/streams") if item["id"] == first_id)["session"]["file_size"] > after[first_id], 10,
                   "Closing preview/playback interrupted recording A")
        still_active = {item["id"]: item for item in call(base, "/api/streams")}
        assert still_active[second_id].get("timeshift", {}).get("state") == "playing", "Closing player A affected player B"
        print("Closed preview and player A; recording A and player B continued independently")

        call(base, f"/api/streams/{second_id}/timeshift", "DELETE")
        for stream in sources:
            call(base, f"/api/streams/{stream['id']}/stop", "POST")
        wait_until(lambda: len(call(base, "/api/recordings")) == 2 and all(item.get("status") == "completed" and item.get("exists") for item in call(base, "/api/recordings")), 45,
                   "Recordings did not finalize")
        history = call(base, "/api/recordings")
        for item in history:
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height",
                                    "-of", "json", item["path"]], capture_output=True, text=True, check=True)
            streams = json.loads(probe.stdout)["streams"]
            assert any(media.get("codec_type") == "video" for media in streams)
            assert any(media.get("codec_type") == "audio" for media in streams)
        print("Both original recording files finalized with audio/video intact")

        stop_backend(server, server_thread)
        server = server_thread = None
        server2, server_thread2, base2 = start_backend(backend.app, api_port)
        restored = call(base2, "/api/recordings")
        assert len(restored) == 2 and all(item["exists"] for item in restored), "Recording history did not survive a backend restart"
        print("Recording history and playback library survived a backend restart")
        stop_backend(server2, server_thread2)
        server2 = server_thread2 = None
        print("PASS: independent preview, two time-shift sessions, ongoing recordings, cleanup, and restart history")
    finally:
        for active_server, active_thread in ((server, server_thread), (server2, server_thread2)):
            if active_server and active_thread:
                active_server.should_exit = True
                active_thread.join(timeout=5)
        if web:
            web.shutdown()
            web.server_close()
        for process in generators:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill()
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
