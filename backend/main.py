from __future__ import annotations

import asyncio
import hmac
import os
import shutil
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .database import data_dir, execute, init_db, log, row, rows, settings
from .ffmpeg_recorder import Recorder
from .models import SettingsInput, StreamInput
from .preview_manager import PreviewManager
from .streamlink_engine import StreamAccessError, inspect
from .system_monitor import snapshot as system_snapshot


class Hub:
    def __init__(self): self.clients: set[WebSocket] = set()
    async def publish(self, event: str, payload):
        message = {"event": event, "data": payload}
        gone = []
        for client in list(self.clients):
            try: await client.send_json(message)
            except Exception: gone.append(client)
        for client in gone: self.clients.discard(client)
    def publish_threadsafe(self, event: str, payload):
        if app.state.loop and not app.state.loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.publish(event, payload), app.state.loop)


hub = Hub()
recorders: dict[int, Recorder] = {}
previews = PreviewManager()
monitor_status: dict[int, dict] = {}


async def background_updates():
    last_monitor = 0.0
    while True:
        now = time.monotonic()
        for rid, recorder in list(recorders.items()):
            state = recorder.snapshot()
            await hub.publish("recording", state)
            execute("UPDATE recordings SET status=?,path=?,error=? WHERE id=?",
                    (state["state"], state["path"] or "", state["error"], rid))
            if not recorder.thread.is_alive() and state["state"] in ("completed", "error"):
                ended = datetime.now(timezone.utc).isoformat()
                execute("UPDATE recordings SET ended_at=?,status=?,path=?,error=? WHERE id=?",
                        (ended, state["state"], state["path"] or "", state["error"], rid))
                del recorders[rid]
                with manager_lock:
                    if stream_sessions.get(state["stream_id"]) == rid:
                        stream_sessions.pop(state["stream_id"], None)
                await hub.publish("recording-finished", state)
        await hub.publish("system", system_snapshot())
        if now - last_monitor >= max(10, int(settings().get("monitor_seconds", "30"))):
            last_monitor = now
            for stream in rows("SELECT * FROM streams WHERE monitor=1"):
                sid = stream["id"]
                if active_for(sid):
                    continue
                try:
                    info = await asyncio.to_thread(inspect, stream["url"])
                    current = {"state": "live", "qualities": info["qualities"], "error": None}
                    if stream["auto_record"]:
                        try: start_recording(sid)
                        except HTTPException as exc: current["error"] = exc.detail
                except Exception as exc:
                    current = {"state": "offline", "qualities": [], "error": str(exc)[:500]}
                if monitor_status.get(sid) != current:
                    monitor_status[sid] = current
                    await hub.publish("stream-status", {"stream_id": sid, **current})
        await asyncio.sleep(1)


def recover_interrupted_recordings():
    unfinished = rows("SELECT * FROM recordings WHERE status IN ('starting','connecting','recording','reconnecting','finalizing')")
    recovered = 0
    for item in unfinished:
        target = Path(item["path"]) if item["path"] else None
        candidates: list[Path] = []
        if target:
            if target.name.endswith("_000." + item["format"]):
                base = target.stem.rsplit("_", 1)[0]
                candidates = sorted(target.parent.glob(f".{base}.partial_*{target.suffix}"))
                for part in candidates:
                    suffix = part.name.rsplit("_", 1)[-1].split(".", 1)[0]
                    final = target.parent / f"{base}_{suffix}{target.suffix}"
                    if not final.exists(): part.replace(final)
            else:
                partial = target.parent / f".{target.stem}.partial{target.suffix}"
                if partial.is_file() and partial.stat().st_size:
                    partial.replace(target)
        existing = target and target.exists()
        if existing:
            recovered += 1
            message = "Application closed unexpectedly; the partial media file was recovered."
            status = "interrupted"
        else:
            message = "Application closed before media data could be finalized."
            status = "error"
        execute("UPDATE recordings SET status=?,ended_at=?,error=? WHERE id=?",
                (status, datetime.now(timezone.utc).isoformat(), message, item["id"]))
        log("warning", f"{item['stream_name']}: {message}")
    return recovered


@asynccontextmanager
async def lifespan(application: FastAPI):
    init_db()
    recover_interrupted_recordings()
    preview_dir = data_dir() / "previews"
    for temporary in preview_dir.iterdir():
        if temporary.is_dir(): shutil.rmtree(temporary, ignore_errors=True)
        else: temporary.unlink(missing_ok=True)
    application.state.loop = asyncio.get_running_loop()
    updater = asyncio.create_task(background_updates())
    log("info", "StreamX backend started")
    yield
    updater.cancel()
    for item in recorders.values(): item.stop()
    previews.shutdown()
    await asyncio.gather(updater, return_exceptions=True)
    # Give FFmpeg time to close containers and write their final indexes.
    await asyncio.to_thread(lambda: [r.thread.join(timeout=35) for r in list(recorders.values())])


app = FastAPI(title="StreamX Studio API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "file://", "null"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def authenticate_local_client(request, call_next):
    expected = os.environ.get("STREAMX_TOKEN")
    media_file = request.url.path.startswith("/api/recordings/") and request.url.path.endswith("/file")
    public_local_media = request.url.path.startswith("/media/")
    public_docs = request.url.path in ("/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc")
    if expected and request.url.path != "/health" and not public_docs and not public_local_media and request.method != "OPTIONS":
        supplied = request.headers.get("x-streamx-token", "") or (request.query_params.get("token", "") if media_file else "")
        if not hmac.compare_digest(supplied, expected):
            return JSONResponse(status_code=401, content={"detail": "Desktop client authentication failed."})
    return await call_next(request)
(data_dir() / "previews").mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=data_dir() / "previews"), name="media")


def active_for(stream_id: int) -> Recorder | None:
    with manager_lock:
        rid = stream_sessions.get(stream_id)
        rec = recorders.get(rid) if rid else None
        return rec if rec and rec.thread.is_alive() else None


def stream_details(stream: dict) -> dict:
    rec = active_for(stream["id"])
    data = dict(stream)
    data["auto_record"] = bool(data["auto_record"])
    data["monitor"] = bool(data["monitor"])
    data["session"] = rec.snapshot() if rec else None
    data["availability"] = monitor_status.get(stream["id"], {"state": "unknown", "qualities": [], "error": None})
    data["preview"] = previews.snapshot().get(str(stream["id"]))
    return data


@app.get("/health")
def health(): return {"ok": True, "streamlink": _streamlink_status(), "ffmpeg": shutil.which("ffmpeg") is not None, "ffprobe": shutil.which("ffprobe") is not None}


def _streamlink_status():
    try:
        import streamlink
        return {"installed": True, "version": getattr(streamlink, "__version__", "unknown")}
    except ImportError: return {"installed": False, "version": None}


@app.get("/api/streams")
def get_streams(): return [stream_details(x) for x in rows("SELECT * FROM streams ORDER BY id DESC")]


@app.post("/api/streams")
def add_stream(payload: StreamInput):
    if payload.container not in ("mkv", "mp4", "ts"): raise HTTPException(400, "Choose MKV, MP4, or TS format.")
    if not payload.url.startswith(("http://", "https://")): raise HTTPException(400, "Stream URLs must use HTTP or HTTPS.")
    try:
        sid = execute("INSERT INTO streams(name,url,group_name,quality,container,auto_record,monitor) VALUES(?,?,?,?,?,?,?)",
                      (payload.name.strip(), payload.url.strip(), payload.group_name.strip() or "General", payload.quality,
                       payload.container, int(payload.auto_record), int(payload.monitor)))
    except Exception as exc: raise HTTPException(409, "That URL is already configured.") from exc
    log("info", f"Added stream {payload.name}")
    return stream_details(row("SELECT * FROM streams WHERE id=?", (sid,)))


@app.put("/api/streams/{stream_id}")
def update_stream(stream_id: int, payload: StreamInput):
    if payload.container not in ("mkv", "mp4", "ts"): raise HTTPException(400, "Choose MKV, MP4, or TS format.")
    if not row("SELECT id FROM streams WHERE id=?", (stream_id,)): raise HTTPException(404, "Stream not found.")
    try:
        execute("UPDATE streams SET name=?,url=?,group_name=?,quality=?,container=?,auto_record=?,monitor=? WHERE id=?",
                (payload.name.strip(), payload.url.strip(), payload.group_name.strip() or "General", payload.quality,
                 payload.container, int(payload.auto_record), int(payload.monitor), stream_id))
    except Exception as exc: raise HTTPException(409, "Another stream already uses that URL.") from exc
    return stream_details(row("SELECT * FROM streams WHERE id=?", (stream_id,)))


@app.delete("/api/streams/{stream_id}")
def delete_stream(stream_id: int):
    if active_for(stream_id): raise HTTPException(409, "Stop the active recording before removing this stream.")
    previews.stop(str(stream_id))
    execute("DELETE FROM streams WHERE id=?", (stream_id,))
    return {"ok": True}


@app.post("/api/streams/{stream_id}/probe")
async def probe_stream(stream_id: int):
    stream = row("SELECT * FROM streams WHERE id=?", (stream_id,))
    if not stream: raise HTTPException(404, "Stream not found.")
    try:
        result = await asyncio.to_thread(inspect, stream["url"])
        monitor_status[stream_id] = {"state": "live", "qualities": result["qualities"], "error": None}
        return {"ok": True, **result}
    except StreamAccessError as exc:
        monitor_status[stream_id] = {"state": "offline", "qualities": [], "error": str(exc)}
        raise HTTPException(422, str(exc))


@app.post("/api/probe")
async def probe_url(payload: dict):
    url = str(payload.get("url", "")).strip()
    if not url.startswith(("http://", "https://")): raise HTTPException(400, "Enter an HTTP or HTTPS URL.")
    try: return {"ok": True, **(await asyncio.to_thread(inspect, url))}
    except StreamAccessError as exc: raise HTTPException(422, str(exc))


def start_recording(stream_id: int) -> dict:
    with manager_lock:
        stream = row("SELECT * FROM streams WHERE id=?", (stream_id,))
        if not stream: raise HTTPException(404, "Stream not found.")
        current = active_for(stream_id)
        if current: raise HTTPException(409, "This stream already has an active recording.")
        limit = max(1, int(settings().get("max_recordings", "4")))
        count = sum(1 for rec in recorders.values() if rec.thread.is_alive())
        if count >= limit: raise HTTPException(409, f"Recording limit reached ({limit}). Change it in Settings to allow more sessions.")
        stamp = datetime.now(timezone.utc).isoformat()
        rid = execute("INSERT INTO recordings(stream_id,stream_name,path,format,started_at,status) VALUES(?,?,?,?,?,?)",
                      (stream_id, stream["name"], "", stream["container"], stamp, "starting"))
        rec = Recorder(stream, rid, hub.publish_threadsafe)
        rec.stream["recording_id"] = rid
        recorders[rid] = rec
        stream_sessions[stream_id] = rid
        rec.start()
        log("info", f"Recording started: {stream['name']}")
        return rec.snapshot()


stream_sessions: dict[int, int] = {}
manager_lock = threading.RLock()


@app.post("/api/streams/{stream_id}/record")
def record_start(stream_id: int):
    try: return start_recording(stream_id)
    except HTTPException: raise


@app.post("/api/streams/{stream_id}/stop")
def record_stop(stream_id: int):
    rid = stream_sessions.get(stream_id)
    rec = recorders.get(rid) if rid else None
    if not rec: raise HTTPException(404, "No recording is active for this stream.")
    rec.stop()
    return {"ok": True, "state": "finalizing"}


@app.post("/api/streams/{stream_id}/preview")
def preview_start(stream_id: int):
    stream = row("SELECT * FROM streams WHERE id=?", (stream_id,))
    if not stream: raise HTTPException(404, "Stream not found.")
    item = previews.start(stream)
    return {"state": item.state, "url": item.url, "error": item.error}


@app.delete("/api/streams/{stream_id}/preview")
def preview_stop(stream_id: int):
    previews.stop(str(stream_id)); return {"ok": True}


@app.get("/api/recordings")
def get_recordings():
    items = rows("SELECT * FROM recordings ORDER BY started_at DESC")
    for item in items:
        path = Path(item["path"]) if item["path"] else None
        if path and path.name.endswith("_000." + item["format"]):
            item["file_size"] = sum(p.stat().st_size for p in path.parent.glob(path.stem.rsplit('_', 1)[0] + "_*" + path.suffix))
        else: item["file_size"] = path.stat().st_size if path and path.exists() else 0
        item["exists"] = bool(path and path.exists())
        if item["stream_id"] in stream_sessions:
            rec = recorders.get(stream_sessions[item["stream_id"]])
            item["progress"] = rec.snapshot() if rec else None
    return items


@app.delete("/api/recordings/{recording_id}")
def delete_recording(recording_id: int):
    item = row("SELECT * FROM recordings WHERE id=?", (recording_id,))
    if not item: raise HTTPException(404, "Recording not found.")
    if item["status"] in ("starting", "recording", "connecting", "reconnecting", "finalizing"):
        raise HTTPException(409, "Stop the recording before deleting it.")
    if item["path"]:
        try:
            target = Path(item["path"])
            if target.name.endswith("_000." + item["format"]):
                for part in target.parent.glob(target.stem.rsplit('_', 1)[0] + "_*" + target.suffix): part.unlink(missing_ok=True)
            else: target.unlink(missing_ok=True)
        except OSError as exc: raise HTTPException(500, f"Could not delete file: {exc}") from exc
    execute("DELETE FROM recordings WHERE id=?", (recording_id,))
    return {"ok": True}


@app.get("/api/recordings/{recording_id}/file")
def recording_file(recording_id: int):
    item = row("SELECT * FROM recordings WHERE id=?", (recording_id,))
    if not item or not item["path"] or not Path(item["path"]).is_file(): raise HTTPException(404, "Recording file is not available.")
    return FileResponse(item["path"], media_type="video/mp4" if item["format"] == "mp4" else "video/x-matroska" if item["format"] == "mkv" else "video/mp2t", filename=Path(item["path"]).name, content_disposition_type="inline")


@app.get("/api/settings")
def get_settings(): return settings()


@app.put("/api/settings")
def put_settings(payload: SettingsInput):
    for key, value in payload.model_dump(exclude_none=True).items():
        if key == "recording_dir":
            path = Path(value).expanduser()
            try: path.mkdir(parents=True, exist_ok=True)
            except OSError as exc: raise HTTPException(400, f"Recording directory cannot be created: {exc}") from exc
            value = str(path.resolve())
        execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))
    log("info", "Settings updated")
    return settings()


@app.get("/api/system")
def get_system(): return system_snapshot()


@app.get("/api/logs")
def get_logs(): return rows("SELECT * FROM logs ORDER BY id DESC LIMIT 500")


@app.get("/api/diagnostics")
def diagnostics():
    return {"python": __import__('sys').version.split()[0], "streamlink": _streamlink_status(),
            "ffmpeg": shutil.which("ffmpeg"), "ffprobe": shutil.which("ffprobe"),
            "database": str(data_dir() / "streamx.sqlite3"), "recording_dir": settings().get("recording_dir"),
            "psutil": __import__('importlib').util.find_spec("psutil") is not None}


@app.websocket("/ws")
async def websocket(websocket: WebSocket):
    expected = os.environ.get("STREAMX_TOKEN")
    if expected and not hmac.compare_digest(websocket.query_params.get("token", ""), expected):
        await websocket.close(code=4401)
        return
    await websocket.accept(); hub.clients.add(websocket)
    try:
        await websocket.send_json({"event": "snapshot", "data": {"streams": get_streams(), "system": system_snapshot(), "recordings": get_recordings()}})
        while True: await websocket.receive_text()
    except WebSocketDisconnect: pass
    finally: hub.clients.discard(websocket)
