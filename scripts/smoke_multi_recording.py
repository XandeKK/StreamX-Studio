"""End-to-end smoke test with two locally generated, authorized HLS feeds."""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
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


def main():
    root = Path(tempfile.mkdtemp(prefix="streamx-multi-smoke-"))
    os.environ["STREAMX_HOME"] = str(root / "appdata")
    feeds = root / "feeds"
    generators = []
    server = None
    web = None
    try:
        for index, frequency in (("one", 440), ("two", 880)):
            folder = feeds / index
            folder.mkdir(parents=True)
            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re",
                       "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15",
                       "-f", "lavfi", "-i", f"sine=frequency={frequency}:sample_rate=44100",
                       "-t", "90", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
                       "-g", "30", "-sc_threshold", "0", "-c:a", "aac", "-f", "hls", "-hls_time", "1",
                       "-hls_list_size", "0", "-hls_flags", "append_list+omit_endlist",
                       "-hls_segment_filename", str(folder / "segment_%03d.ts"), str(folder / "index.m3u8")]
            generators.append(subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and not all((feeds / name / "index.m3u8").exists() for name in ("one", "two")):
            if any(process.poll() is not None for process in generators):
                raise RuntimeError("FFmpeg could not create the synthetic HLS feeds")
            time.sleep(.1)
        assert all((feeds / name / "index.m3u8").exists() for name in ("one", "two")), "Timed out waiting for synthetic HLS feeds"

        feed_port = free_port()
        class QuietHandler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs): super().__init__(*args, directory=str(feeds), **kwargs)
            def log_message(self, fmt, *args): pass
        handler = QuietHandler
        web = ThreadingHTTPServer(("127.0.0.1", feed_port), handler)
        threading.Thread(target=web.serve_forever, daemon=True).start()

        from backend.streamlink_engine import inspect
        urls = [f"http://127.0.0.1:{feed_port}/{name}/index.m3u8" for name in ("one", "two")]
        for url in urls:
            result = inspect(url)
            assert result["qualities"], f"Streamlink found no qualities for {url}"
            print(f"Streamlink source OK: {url} ({', '.join(result['qualities'])})")

        import backend.main as backend
        api_port = free_port()
        config = uvicorn.Config(backend.app, host="127.0.0.1", port=api_port, log_level="warning")
        server = uvicorn.Server(config)
        threading.Thread(target=server.run, daemon=True).start()
        deadline = time.monotonic() + 15
        base = f"http://127.0.0.1:{api_port}"
        while not server.started and time.monotonic() < deadline:
            time.sleep(.1)
        assert server.started, "Backend did not start"

        output_dir = root / "recordings"
        call(base, "/api/settings", "PUT", {"recording_dir": str(output_dir), "max_recordings": 2,
             "retry_seconds": 2, "monitor_seconds": 3600, "low_disk_gb": 0, "segment_minutes": 0})
        ids = []
        for name, url in zip(("Test Feed One", "Test Feed Two"), urls):
            source = call(base, "/api/streams", "POST", {"name": name, "url": url, "group_name": "Smoke Test",
                         "quality": "best", "container": "mkv", "auto_record": False, "monitor": False})
            checked = call(base, "/api/streams/" + str(source["id"]) + "/probe", "POST")
            assert checked["qualities"], "Saved source probe returned no qualities"
            ids.append(source["id"])
        for sid in ids:
            call(base, f"/api/streams/{sid}/record", "POST")
        print("Started two independent recording sessions")

        deadline = time.monotonic() + 20
        active = []
        while time.monotonic() < deadline:
            active = call(base, "/api/streams")
            selected = [item for item in active if item["id"] in ids]
            if len(selected) == 2 and all(item["session"] and item["session"]["file_size"] > 100_000 for item in selected):
                break
            time.sleep(.5)
        assert len(selected) == 2 and all(item["session"] and item["session"]["file_size"] > 100_000 for item in selected), \
            f"Both independent FFmpeg outputs did not receive data: {selected}"
        print("Both FFmpeg outputs are growing concurrently")
        for sid in ids:
            call(base, f"/api/streams/{sid}/stop", "POST")

        deadline = time.monotonic() + 45
        history = []
        while time.monotonic() < deadline:
            history = [r for r in call(base, "/api/recordings") if r["stream_id"] in ids]
            if len(history) == 2 and all(r["status"] == "completed" and r["exists"] for r in history):
                break
            time.sleep(.5)
        assert len(history) == 2 and all(r["status"] == "completed" and r["exists"] for r in history), \
            f"Recordings did not finalize cleanly: {history}"
        for item in history:
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", item["path"]],
                                   capture_output=True, text=True, check=True)
            media = json.loads(probe.stdout)
            assert any(s.get("codec_type") == "video" for s in media["streams"]), item["path"]
            assert any(s.get("codec_type") == "audio" for s in media["streams"]), item["path"]
            print(f"Finalized {Path(item['path']).name}: {item['file_size']} bytes; audio/video verified by FFprobe")
        print("PASS: two simultaneous Streamlink-to-FFmpeg sessions recorded and finalized independently")
    finally:
        if server:
            server.should_exit = True
        if web:
            web.shutdown(); web.server_close()
        for process in generators:
            process.terminate()
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired: process.kill()
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
