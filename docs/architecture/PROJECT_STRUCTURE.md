# Project structure

The repository is a compact desktop application. UI page implementations are currently concentrated in `src/App.tsx`; backend HTTP routes and orchestration are concentrated in `backend/main.py`.

| Path | Responsibility |
| --- | --- |
| `electron/main.cjs` | Creates the Electron window, starts and stops the Python service, opens the separate browser window, and handles IPC. |
| `electron/preload.cjs` | Exposes the limited `window.streamx` bridge to the renderer. |
| `src/main.tsx` | React entry point; mounts `App` and imports global CSS. |
| `src/App.tsx` | UI state, data refresh, navigation, stream/source forms, dashboard, recordings, settings, diagnostics, logs, and recording playback modal. |
| `src/VideoPreview.tsx` | HLS.js-backed live preview controls and error/recovery display. |
| `src/TimeShiftPlayer.tsx` | HLS.js time-shift controls, seekable-window timeline, speed, volume, and live-edge jump. |
| `src/api.ts` | REST request helper, API token header, WebSocket URL, and media URL builder. |
| `src/types.ts` | TypeScript data shapes for streams, recording sessions, recordings, settings, and playback sessions. |
| `src/index.css` | Global visual design and component styles. |
| `backend/main.py` | FastAPI app, lifecycle, routes, background updates, manager instances, and WebSocket hub. |
| `backend/database.py` | SQLite connection, schema creation, CRUD helpers, settings defaults, and bounded log insertion. |
| `backend/models.py` | Pydantic request models and validation bounds. |
| `backend/streamlink_engine.py` | Streamlink session creation, plugin path loading, source inspection, quality selection, and stream opening. |
| `backend/ffmpeg_recorder.py` | `Recorder`, recording FFmpeg command, retry loop, file finalization, and periodic FFprobe metadata. |
| `backend/preview_manager.py` | Per-source preview workers and preview HLS generation. |
| `backend/timeshift_manager.py` | Independent time-shift capture workers, rolling segments, storage checks, and cleanup. |
| `backend/system_monitor.py` | Disk, CPU, memory, and network-rate snapshots. |
| `backend/plugins/stripchat.py` | Sideloaded Streamlink plugin for configured Stripchat-related and DoppioCDN URL patterns. |
| `backend/plugins/LICENSE.stripchat` | License file included with the bundled plugin. |
| `scripts/setup.sh`, `scripts/setup.ps1` | Platform setup, dependency installation, and local tool/plugin checks. |
| `scripts/verify_streamlink_plugin.py` | Offline matcher check for the bundled Streamlink plugin. |
| `scripts/smoke_multi_recording.py` | Local synthetic-HLS recording concurrency smoke test. |
| `scripts/smoke_playback_sessions.py` | Local synthetic-HLS preview, time-shift, recording, cleanup, and restart smoke test. |
| `package.json`, `package-lock.json` | Node scripts and locked frontend/Electron dependency tree. |
| `requirements.txt` | Python runtime dependency constraints. |
| `vite.config.ts`, `tsconfig.json`, `postcss.config.js`, `tailwind.config.js` | Frontend build and compiler configuration. |
| `index.html` | Vite renderer HTML entry point. |
| `README.md` | User-facing setup, features, settings, and troubleshooting. |
| `docs/architecture/` | Developer architecture reference. |

Runtime user data defaults to `~/.streamx` (or `%USERPROFILE%/.streamx` on Windows), configurable with `STREAMX_HOME`. The SQLite database is `streamx.sqlite3`; the default recordings folder is `Recordings` below that data directory. Vite output is `dist/`; dependencies and virtual environments are not source files.
