from __future__ import annotations

import json
import re
import signal
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from .database import log, settings
from .streamlink_engine import StreamAccessError, open_stream


def safe_name(value: str) -> str:
    name = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("_.")
    return (name or "stream")[:100]


def ffmpeg_command(path: Path, container: str, segment_minutes: int = 0) -> list[str]:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", "pipe:0",
               "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero"]
    if segment_minutes > 0:
        command += ["-f", "segment", "-segment_time", str(segment_minutes * 60), "-reset_timestamps", "1", "-segment_format", container]
    return command + [str(path)]


class Recorder:
    def __init__(self, stream: dict, recording_id: int, emit: Callable):
        self.stream = stream
        self.recording_id = recording_id
        self.emit = emit
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"recording-{recording_id}", daemon=True)
        self.path: Path | None = None
        self.proc: subprocess.Popen | None = None
        self.started = time.monotonic()
        self.retry_count = 0
        self.state = "starting"
        self.error: str | None = None
        self.source = None
        self.partial: Path | None = None
        self.media_info = {"resolution": None, "bitrate": None}
        self.probe_thread: threading.Thread | None = None

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.source is not None:
            try: self.source.close()
            except Exception: pass

    def snapshot(self) -> dict:
        if self.partial and self.partial.name.endswith("%03d." + self.stream["container"]):
            prefix = self.partial.name.split("%03d", 1)[0]
            size = sum(p.stat().st_size for p in self.partial.parent.glob(prefix + "*" + self.partial.suffix))
        elif self.partial and self.partial.exists():
            size = self.partial.stat().st_size
        elif self.path and self.path.exists():
            if "_000." in self.path.name:
                size = sum(p.stat().st_size for p in self.path.parent.glob(self.path.stem.rsplit('_', 1)[0] + "_*" + self.path.suffix))
            else: size = self.path.stat().st_size
        else: size = 0
        return {"recording_id": self.recording_id, "stream_id": self.stream["id"], "state": self.state,
                "duration": int(time.monotonic() - self.started), "file_size": size,
                "path": str(self.path) if self.path else None, "error": self.error,
                "retry_count": self.retry_count, "name": self.stream["name"], "url": self.stream["url"],
                "resolution": self.media_info["resolution"], "bitrate": self.media_info["bitrate"]}

    def _run(self):
        prefs = settings()
        output_dir = Path(prefs.get("recording_dir", str(Path.home() / "Videos" / "StreamX"))).expanduser()
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
        base = f"{safe_name(self.stream['name'])}_{timestamp}"
        segment_minutes = max(0, int(prefs.get("segment_minutes", "0")))
        if segment_minutes:
            self.path = output_dir / f"{base}_000.{self.stream['container']}"
            partial = output_dir / f".{base}.partial_%03d.{self.stream['container']}"
        else:
            self.path = output_dir / f"{base}.{self.stream['container']}"
            partial = output_dir / f".{base}.partial.{self.stream['container']}"
        self.partial = partial
        command = ffmpeg_command(partial, self.stream['container'], segment_minutes)
        try:
            self.proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, bufsize=0)
        except FileNotFoundError:
            self.state = "error"
            self.error = "FFmpeg was not found. Install FFmpeg and ensure it is on PATH."
            self.emit("recording", self.snapshot())
            return
        self.probe_thread = threading.Thread(target=self._probe_loop, daemon=True, name=f"ffprobe-{self.recording_id}")
        self.probe_thread.start()
        self.state = "connecting"
        self.emit("recording", self.snapshot())
        try:
            while not self.stop_event.is_set():
                source = None
                try:
                    source = open_stream(self.stream["url"], self.stream["quality"])
                    self.source = source
                    self.state = "recording"
                    self.error = None
                    self.emit("recording", self.snapshot())
                    while not self.stop_event.is_set():
                        chunk = source.read(256 * 1024)
                        if not chunk:
                            raise StreamAccessError("Stream ended or connection was interrupted.")
                        try:
                            written = 0
                            while written < len(chunk):
                                count = self.proc.stdin.write(chunk[written:])
                                if not count: raise BrokenPipeError("FFmpeg input pipe closed")
                                written += count
                        except (BrokenPipeError, OSError) as exc:
                            detail = self.proc.stderr.read(1200).decode("utf-8", "replace") if self.proc.stderr else ""
                            raise StreamAccessError(f"FFmpeg stopped: {detail or exc}") from exc
                except Exception as exc:
                    if self.stop_event.is_set():
                        break
                    self.error = str(exc)[:700]
                    self.retry_count += 1
                    self.state = "reconnecting"
                    log("warning", f"{self.stream['name']}: {self.error}; reconnect attempt {self.retry_count}")
                    self.emit("recording", self.snapshot())
                    delay = max(2, min(int(prefs.get("retry_seconds", 10)), 3600))
                    self.stop_event.wait(delay)
                finally:
                    if source is not None:
                        try: source.close()
                        except Exception: pass
                    self.source = None
        finally:
            self.state = "finalizing"
            self.emit("recording", self.snapshot())
            if self.proc:
                try:
                    if self.proc.stdin:
                        self.proc.stdin.close()
                    self.proc.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    self.proc.send_signal(signal.SIGINT)
                    try: self.proc.wait(timeout=10)
                    except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()
                except (BrokenPipeError, OSError):
                    try: self.proc.wait(timeout=5)
                    except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()
            if segment_minutes:
                files = sorted(output_dir.glob(f".{base}.partial_*{self.path.suffix}"))
                for part in files:
                    suffix = part.name.rsplit("_", 1)[-1].split(".", 1)[0]
                    part.replace(output_dir / f"{base}_{suffix}{self.path.suffix}")
            elif partial.exists() and partial.stat().st_size:
                partial.replace(self.path)
            if self.path.exists() and self.path.stat().st_size:
                if self.proc and self.proc.returncode == 0:
                    self.state = "completed"
                    self.error = None
                else:
                    self.state = "error"
                    self.error = f"FFmpeg exited with code {self.proc.returncode if self.proc else 'unknown'}; partial output was saved."
                self.partial = None
            else:
                self.state = "error"
                if not self.error: self.error = "No media data was received; no recording file was created."
                for part in output_dir.glob(f".{base}.partial_*{self.path.suffix}"):
                    try: part.unlink(missing_ok=True)
                    except OSError: pass
                if not segment_minutes:
                    try: partial.unlink(missing_ok=True)
                    except OSError: pass
            self.emit("recording", self.snapshot())

    def _probe_loop(self):
        while not self.stop_event.wait(8):
            source = self.partial
            if source and "%03d" in source.name:
                prefix = source.name.split("%03d", 1)[0]
                parts = sorted(source.parent.glob(prefix + "*" + source.suffix))
                source = parts[-1] if parts else None
            if not source or not source.exists() or not source.stat().st_size:
                continue
            try:
                result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,bit_rate:format=bit_rate", "-of", "json", str(source)], capture_output=True, text=True, timeout=4)
                if result.returncode != 0: continue
                data = json.loads(result.stdout)
                video = next((item for item in data.get("streams", []) if item.get("codec_type") == "video"), {})
                fmt = data.get("format", {})
                self.media_info["resolution"] = f"{video['width']}×{video['height']}" if video.get("width") and video.get("height") else self.media_info["resolution"]
                bitrate = video.get("bit_rate") or fmt.get("bit_rate")
                self.media_info["bitrate"] = int(bitrate) if bitrate and str(bitrate).isdigit() else self.media_info["bitrate"]
            except (OSError, subprocess.TimeoutExpired, ValueError, KeyError):
                continue
