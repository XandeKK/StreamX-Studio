from __future__ import annotations

import subprocess
import threading
import uuid
from pathlib import Path

from .database import data_dir, log
from .streamlink_engine import open_stream


class Preview:
    def __init__(self, stream: dict):
        self.stream = stream
        self.key = str(stream["id"])
        self.folder = data_dir() / "previews" / self.key
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name=f"preview-{self.key}")
        self.state = "starting"
        self.error = None
        self.url = f"/media/{self.key}/index.m3u8?v={uuid.uuid4().hex}"

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()

    def _run(self):
        self.folder.mkdir(parents=True, exist_ok=True)
        playlist = self.folder / "index.m3u8"
        target = str(self.folder / "segment_%05d.ts")
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", "pipe:0", "-map", "0", "-c", "copy", "-f", "hls", "-hls_time", "2", "-hls_list_size", "6", "-hls_flags", "delete_segments+append_list+omit_endlist", "-hls_segment_filename", target, str(playlist)]
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, bufsize=0)
        except FileNotFoundError:
            self.state = "error"; self.error = "FFmpeg was not found."; return
        source = None
        try:
            source = open_stream(self.stream["url"], self.stream["quality"])
            self.state = "playing"
            while not self.stop_event.is_set():
                chunk = source.read(256 * 1024)
                if not chunk: break
                written = 0
                while written < len(chunk):
                    count = proc.stdin.write(chunk[written:])
                    if not count: raise BrokenPipeError("FFmpeg preview input pipe closed")
                    written += count
        except Exception as exc:
            if not self.stop_event.is_set():
                self.state = "error"; self.error = str(exc)[:500]
                log("warning", f"Preview {self.stream['name']}: {self.error}")
        finally:
            if source:
                try: source.close()
                except Exception: pass
            try:
                if proc.stdin: proc.stdin.close()
                proc.wait(timeout=8)
            except Exception:
                proc.kill(); proc.wait()
            if self.state != "error": self.state = "stopped"


class PreviewManager:
    def __init__(self): self.items: dict[str, Preview] = {}
    def start(self, stream: dict) -> Preview:
        key = str(stream["id"])
        old = self.items.get(key)
        if old and old.state in ("starting", "playing"): return old
        item = Preview(stream)
        self.items[key] = item
        item.start()
        return item
    def stop(self, key: str):
        item = self.items.get(str(key))
        if item: item.stop()
    def snapshot(self):
        for key, item in list(self.items.items()):
            if item.state in ("stopped", "error") and not item.thread.is_alive():
                # Keep errors visible for API reads; the next start replaces it.
                continue
        return {key: {"state": item.state, "url": item.url, "error": item.error} for key, item in self.items.items()}
    def shutdown(self):
        for item in self.items.values(): item.stop()
