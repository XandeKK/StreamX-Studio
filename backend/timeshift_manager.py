from __future__ import annotations

import math
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque
from pathlib import Path

from .database import data_dir, log, settings
from .streamlink_engine import open_stream


class TimeShiftCapture:
    def __init__(self, stream: dict):
        prefs = settings()
        self.stream = stream
        self.key = str(stream["id"])
        self.session_id = uuid.uuid4().hex
        self.folder = data_dir() / "media" / "timeshift" / self.session_id
        self.buffer_minutes = max(5, min(int(prefs.get("timeshift_buffer_minutes", "60")), 1440))
        self.max_storage_gb = max(1, int(prefs.get("timeshift_max_storage_gb", "4")))
        self.min_free_gb = max(0, int(prefs.get("timeshift_min_free_gb", "5")))
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True, name=f"timeshift-{self.key}")
        self.state = "starting"
        self.error: str | None = None
        self.started_at = time.time()
        self.source = None
        self.proc: subprocess.Popen | None = None
        self.stderr_tail: deque[str] = deque(maxlen=12)
        self.delete_after_stop = False
        self.url = f"/media/timeshift/{self.session_id}/index.m3u8?v={uuid.uuid4().hex}"

    def start(self):
        self.thread.start()

    def snapshot(self) -> dict:
        return {"session_id": self.session_id, "stream_id": self.stream["id"], "state": self.state,
                "error": self.error, "url": self.url, "started_at": self.started_at,
                "buffer_minutes": self.buffer_minutes, "buffer_seconds": self._buffer_seconds(),
                "storage_bytes": self._folder_size()}

    def _folder_size(self) -> int:
        total = 0
        try:
            for path in self.folder.iterdir():
                if path.is_file():
                    total += path.stat().st_size
        except OSError:
            pass
        return total

    def _buffer_seconds(self) -> float:
        playlist = self.folder / "index.m3u8"
        try:
            return sum(float(line[8:].split(",", 1)[0]) for line in playlist.read_text(errors="replace").splitlines()
                       if line.startswith("#EXTINF:"))
        except (OSError, ValueError):
            return 0.0

    def _command(self, playlist: Path) -> list[str]:
        segment_count = max(10, math.ceil(self.buffer_minutes * 60 / 2))
        segment = str(self.folder / "segment_%08d.ts")
        return ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-nostdin", "-y", "-i", "pipe:0",
                "-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast",
                "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-g", "48", "-keyint_min", "48",
                "-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*2)",
                "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-f", "hls",
                "-hls_time", "2", "-hls_list_size", str(segment_count), "-hls_delete_threshold", "2",
                "-hls_flags", "delete_segments+append_list+omit_endlist+independent_segments+temp_file",
                "-hls_segment_filename", segment, str(playlist)]

    def _drain_stderr(self):
        if self.proc and self.proc.stderr:
            for line in iter(self.proc.stderr.readline, b""):
                text = line.decode("utf-8", "replace").strip()
                if text:
                    self.stderr_tail.append(text)

    def _ready(self, playlist: Path) -> bool:
        try:
            for line in playlist.read_text(errors="replace").splitlines():
                if line and not line.startswith("#"):
                    segment = (playlist.parent / line).resolve()
                    if segment.parent == playlist.parent.resolve() and segment.is_file() and segment.stat().st_size > 0:
                        return True
        except OSError:
            return False
        return False

    def stop(self, reason: str | None = None, delete: bool = True):
        if reason:
            self.error = reason
            self.state = "error"
        elif self.state not in ("error", "stopped"):
            self.state = "stopping"
        self.delete_after_stop = self.delete_after_stop or delete
        self.stop_event.set()
        if self.source is not None:
            try:
                self.source.close()
            except Exception:
                pass

    def _run(self):
        self.folder.mkdir(parents=True, exist_ok=True)
        playlist = self.folder / "index.m3u8"
        try:
            self.proc = subprocess.Popen(self._command(playlist), stdin=subprocess.PIPE,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, bufsize=0)
        except FileNotFoundError:
            self.state = "error"
            self.error = "FFmpeg was not found. Install FFmpeg and ensure it is on PATH."
            return
        threading.Thread(target=self._drain_stderr, daemon=True, name=f"timeshift-stderr-{self.key}").start()
        try:
            self.source = open_stream(self.stream["url"], self.stream["quality"])
            deadline = time.monotonic() + 40
            while not self.stop_event.is_set():
                if self.proc.poll() is not None:
                    raise RuntimeError("FFmpeg exited while creating the time-shift buffer.")
                chunk = self.source.read(256 * 256)
                if not chunk:
                    raise RuntimeError("The source ended while creating the time-shift buffer.")
                written = 0
                while written < len(chunk):
                    count = self.proc.stdin.write(chunk[written:])
                    if not count:
                        raise BrokenPipeError("FFmpeg time-shift input pipe closed")
                    written += count
                if self._ready(playlist):
                    self.state = "playing"
                    self.error = None
                elif self.state == "starting" and time.monotonic() > deadline:
                    raise TimeoutError("No playable HLS segment was produced within 40 seconds.")
        except Exception as exc:
            if not self.stop_event.is_set():
                detail = "\n".join(self.stderr_tail)
                self.state = "error"
                self.error = (f"{exc}: {detail}" if detail else str(exc))[:700]
                log("warning", f"Time-shift {self.stream['name']}: {self.error}")
        finally:
            if self.source:
                try:
                    self.source.close()
                except Exception:
                    pass
            if self.proc:
                try:
                    if self.proc.stdin and not self.proc.stdin.closed:
                        self.proc.stdin.close()
                    self.proc.wait(timeout=8)
                except Exception:
                    self.proc.kill()
                    self.proc.wait()
            if self.stop_event.is_set() and self.error is None:
                self.state = "stopped"
            if self.delete_after_stop:
                shutil.rmtree(self.folder, ignore_errors=True)


class TimeShiftManager:
    def __init__(self):
        self.items: dict[str, TimeShiftCapture] = {}
        self.lock = threading.RLock()
        self.root = data_dir() / "media" / "timeshift"
        self.root.mkdir(parents=True, exist_ok=True)

    def _total_bytes(self) -> int:
        total = 0
        try:
            for path in self.root.rglob("*"):
                if path.is_file():
                    total += path.stat().st_size
        except OSError:
            pass
        return total

    def start(self, stream: dict) -> TimeShiftCapture:
        key = str(stream["id"])
        with self.lock:
            old = self.items.get(key)
            if old and old.thread.is_alive():
                return old
            if old:
                shutil.rmtree(old.folder, ignore_errors=True)
            prefs = settings()
            max_bytes = max(1, int(prefs.get("timeshift_max_storage_gb", "4"))) * 1024 ** 3
            min_free = max(0, int(prefs.get("timeshift_min_free_gb", "5"))) * 1024 ** 3
            usage = shutil.disk_usage(self.root)
            if usage.free < min_free:
                raise OSError(f"Time-shift playback requires at least {min_free // 1024**3} GB of free space.")
            if self._total_bytes() >= max_bytes:
                raise OSError("The configured time-shift storage limit has been reached. Close another playback session or increase the limit in Settings.")
            item = TimeShiftCapture(stream)
            self.items[key] = item
            item.start()
            return item

    def stop(self, key: str):
        with self.lock:
            item = self.items.pop(str(key), None)
            if item:
                item.stop(delete=True)

    def snapshot(self):
        with self.lock:
            return {key: item.snapshot() for key, item in self.items.items()}

    def get(self, key: str):
        with self.lock:
            item = self.items.get(str(key))
            return item.snapshot() if item else None

    def enforce_limits(self):
        prefs = settings()
        max_bytes = max(1, int(prefs.get("timeshift_max_storage_gb", "4"))) * 1024 ** 3
        min_free = max(0, int(prefs.get("timeshift_min_free_gb", "5"))) * 1024 ** 3
        try:
            low_space = shutil.disk_usage(self.root).free < min_free
        except OSError:
            low_space = True
        if not low_space and self._total_bytes() <= max_bytes:
            return
        with self.lock:
            sessions = list(self.items.values())
            if any(item.thread.is_alive() and item.stop_event.is_set() for item in sessions):
                return
            active = sorted((item for item in sessions if item.thread.is_alive() and not item.stop_event.is_set()),
                            key=lambda item: item.started_at)
            if active:
                reason = "Time-shift playback stopped because its storage limit was reached." if not low_space else "Time-shift playback stopped to preserve the configured minimum free disk space."
                active[0].stop(reason, delete=True)
                return
            inactive = sorted((item for item in sessions if not item.thread.is_alive()), key=lambda item: item.started_at)
            if inactive:
                item = inactive[0]
                shutil.rmtree(item.folder, ignore_errors=True)
                item.url = ""
                item.state = "error"
                item.error = "The temporary time-shift buffer was removed to enforce the configured storage limit."

    def shutdown(self):
        with self.lock:
            for item in self.items.values():
                item.stop(delete=True)
        for item in list(self.items.values()):
            if item.thread.is_alive():
                item.thread.join(timeout=3)
