# Backend architecture

## Composition

`backend/main.py` creates the FastAPI application. It owns module-level `Hub`, `PreviewManager`, `TimeShiftManager`, recorder/session dictionaries, and monitor status. HTTP routes, authentication middleware, static `/media` mounting, WebSocket handling, startup recovery, and the background update coroutine are in this module.

Responsibilities are split into small service modules:

- `database.py`: SQLite schema and query helpers.
- `models.py`: Pydantic validation for source and settings writes.
- `streamlink_engine.py`: constructs Streamlink sessions and opens selected streams.
- `ffmpeg_recorder.py`: recording worker lifecycle.
- `preview_manager.py` and `timeshift_manager.py`: independent HLS media workers.
- `system_monitor.py`: local resource snapshot.

## Lifecycle and concurrency

The FastAPI lifespan initializes tables, marks unfinished recordings interrupted, clears and recreates the temporary media directory, records the running event loop, and starts `background_updates()`. On shutdown, it cancels that task, requests recording/preview/time-shift stop, and waits up to 35 seconds for active recorder threads to finalize. Time-shift shutdown joins its threads for up to three seconds; preview shutdown signals and closes its current stream but does not explicitly join preview threads.

Blocking Streamlink inspection is moved to a worker thread with `asyncio.to_thread`. Recording, preview, and time-shift workers each run their own Python daemon thread and FFmpeg subprocess. SQLite helper functions open a connection per operation with a 20-second timeout, WAL mode, and foreign keys enabled.

## Persistence and runtime state

SQLite stores configured streams, recording history, settings, and up to 2,000 log entries. Active recorder objects, monitor availability, previews, and time-shift state are in memory and are not represented as dedicated database tables. Recording file bytes live in the configured recording directory; HLS preview/time-shift files live under `data_dir()/media`.

## Authentication and errors

`authenticate_local_client` validates the Electron token when `STREAMX_TOKEN` is set. `/health`, FastAPI docs, `/media/*`, and `OPTIONS` requests bypass that middleware; the WebSocket performs its own token query check. CORS is configured for the Vite loopback origin and file/null origins. Route handlers use FastAPI `HTTPException` for validation, missing resources, conflicts, and storage limits; worker exceptions are exposed through snapshots and the database log.

The backend is intended to bind to `127.0.0.1`; the Electron launcher does so explicitly. Running Uvicorn with another bind address is outside the supported access model.
