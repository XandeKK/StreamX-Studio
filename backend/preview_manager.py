from __future__ import annotations

import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from .database import data_dir, log, settings
from .streamlink_engine import open_stream


class Preview:
    def __init__(self, stream: dict):
        self.stream = stream
        self.key = str(stream["id"])
        self.folder = data_dir() / "media" / "previews" / self.key
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name=f"preview-{self.key}")
        self.state = "starting"
        self.error: str | None = None
        self.url = f"/media/previews/{self.key}/index.m3u8?v={uuid.uuid4().hex}"
        self.proc: subprocess.Popen | None = None
        self.source = None
        self.stderr_tail: deque[str] = deque(maxlen=12)
        self.started_at = time.time()

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.source is not None:
            try:
                self.source.close()
            except Exception:
                pass

    def snapshot(self) -> dict:
        return {"state": self.state, "url": self.url, "error": self.error, "started_at": self.started_at}

    def _drain_stderr(self):
        if self.proc and self.proc.stderr:
            for line in iter(self.proc.stderr.readline, b""):
                text = line.decode("utf-8", "replace").strip()
                if text:
                    self.stderr_tail.append(text)

    def _command(self, playlist: Path, target: str) -> list[str]:
        command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin", "-y", "-i", "pipe:0",
                   "-map", "0:v:0?", "-map", "0:a:0?"]
        if str(settings().get("preview_transcode", "true")).lower() not in ("0", "false", "no"):
            command += ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                        "-pix_fmt", "yuv420p", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
                        "-force_key_frames", "expr:gte(t,n_forced*2)",
                        "-c:a", "aac", "-b:a", "128k", "-ac", "2"]
        else:
            command += ["-c", "copy"]
        command += ["-f", "hls", "-hls_time", "2", "-hls_list_size", "8", "-hls_delete_threshold", "2",
                    "-hls_flags", "delete_segments+append_list+omit_endlist+independent_segments+temp_file",
                    "-hls_segment_filename", target, str(playlist)]
        return command

    def _ready(self, playlist: Path) -> bool:
        if not playlist.is_file():
            return False
        try:
            for line in playlist.read_text(errors="replace").splitlines():
                if line and not line.startswith("#"):
                    segment = (playlist.parent / line).resolve()
                    if segment.parent == playlist.parent.resolve() and segment.is_file() and segment.stat().st_size > 0:
                        return True
        except OSError:
            return False
        return False

    def _run_attempt(self, playlist: Path):
        self.proc = subprocess.Popen(self._command(playlist, str(self.folder / "segment_%08d.ts")),
                                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE, bufsize=0)
        threading.Thread(target=self._drain_stderr, daemon=True, name=f"preview-stderr-{self.key}").start()
        self.source = open_stream(self.stream["url"], self.stream["quality"])
        deadline = time.monotonic() + 30
        while not self.stop_event.is_set():
            if self.proc.poll() is not None:
                raise RuntimeError("FFmpeg exited before preview completed a segment.")
            chunk = self.source.read(256 * 256)
            if not chunk:
                raise RuntimeError("The source ended before a preview segment was produced.")
            written = 0
            while written < len(chunk):
                count = self.proc.stdin.write(chunk[written:])
                if not count:
                    raise BrokenPipeError("FFmpeg preview input pipe closed")
                written += count
            if self._ready(playlist):
                self.state = "playing"
                self.error = None
            elif self.state == "starting" and time.monotonic() > deadline:
                raise TimeoutError("FFmpeg did not produce a playable HLS segment within 30 seconds.")

    def _close_attempt(self):
        if self.source:
            try:
                self.source.close()
            except Exception:
                pass
            self.source = None
        if self.proc:
            try:
                if self.proc.stdin and not self.proc.stdin.closed:
                    self.proc.stdin.close()
                self.proc.wait(timeout=8)
            except Exception:
                self.proc.kill()
                self.proc.wait()
            self.proc = None

    def _run(self):
        self.folder.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            if self.stop_event.is_set():
                break
            if attempt:
                self.state = "reconnecting"
                self.folder.mkdir(parents=True, exist_ok=True)
                shutil.rmtree(self.folder, ignore_errors=True)
            self.folder.mkdir(parents=True, exist_ok=True)
            playlist = self.folder / "index.m3u8"
            self.stderr_tail.clear()
            try:
                self.state = "starting" if attempt == 0 else "reconnecting"
                self._run_attempt(playlist)
                if not self.stop_event.is_set():
                    raise RuntimeError("The preview source ended.")
            except FileNotFoundError:
                self.state = "error"
                self.error = "FFmpeg was not found. Install FFmpeg and ensure it is on PATH."
                break
            except Exception as exc:
                if self.stop_event.is_set():
                    break
                detail = "\n".join(self.stderr_tail)
                self.error = (f"{exc}: {detail}" if detail else str(exc))[:700]
                self.state = "error" if attempt == 3 else "reconnecting"
                log("warning", f"Preview {self.stream['name']}: {self.error}")
            finally:
                self._close_attempt()
            if self.state == "error" or self.stop_event.is_set():
                break
            if attempt < 3:
                self.stop_event.wait(2)
        if self.stop_event.is_set() and self.error is None:
            self.state = "stopped"


class PreviewManager:
    def __init__(self):
        self.items: dict[str, Preview] = {}
        self.lock = threading.RLock()

    def start(self, stream: dict) -> Preview:
        key = str(stream["id"])
        with self.lock:
            old = self.items.get(key)
            if old and old.thread.is_alive():
                return old
            item = Preview(stream)
            self.items[key] = item
            item.start()
            return item

    def stop(self, key: str):
        with self.lock:
            item = self.items.get(str(key))
            if item:
                item.stop()

    def snapshot(self):
        with self.lock:
            return {key: item.snapshot() for key, item in self.items.items()}

    def shutdown(self):
        with self.lock:
            for item in self.items.values():
                item.stop()
