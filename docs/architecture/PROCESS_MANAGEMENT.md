# Process management

## Desktop startup

`npm run dev` runs Vite and Electron through `concurrently`; `electron/main.cjs` runs in `--dev` mode and loads `http://127.0.0.1:5173`. `npm run build` compiles TypeScript and creates `dist/`. `npm run desktop` opens the built renderer. Electron selects a Python interpreter from `STREAMX_PYTHON`, a project `.venv`, a packaged Python path, or the platform Python fallback, then starts Uvicorn on `127.0.0.1:8765`.

Electron generates a random token for each launch and passes it to the backend environment. It retries `/health` before creating the main window. The `before-quit` handler sends SIGTERM to the Uvicorn child.

## Backend workers and external processes

| Worker | Python lifecycle | External process | Stop/finalization |
| --- | --- | --- | --- |
| Recording | One daemon `Recorder` thread per recording row. | One FFmpeg process fed via stdin. | Stop event and source close; close FFmpeg stdin, wait, SIGINT, then kill on timeout; rename or remove partial output. |
| Preview | One daemon thread per source in `PreviewManager`. | One FFmpeg process per attempt. | Stop event and source close; close stdin and wait, then kill on timeout. Up to four attempts on failure. |
| Time-shift | One daemon `TimeShiftCapture` thread per source. | One FFmpeg process per active buffer. | Stop event and source close; close stdin and wait, then kill on timeout; remove that UUID temp directory when configured to delete. No source retry loop. |
| Availability probe | `asyncio.to_thread()` around blocking Streamlink inspect. | None beyond Streamlink Python operations. | Completes or raises to the monitor loop. |

Streamlink reads run inside the worker's Python thread. FFmpeg stderr is either suppressed (recording) or drained to a bounded recent-line buffer (preview/time-shift). FFmpeg and FFprobe are system executables found through `PATH`; the app does not install or package them.

## Shutdown and cleanup

FastAPI lifespan requests worker stops and waits for recording finalization; preview and time-shift managers signal workers as described above. At startup, `lifespan()` iterates over the full `data_dir()/media` directory and recursively removes every child directory or file before recreating `previews/` and `timeshift/`.

**Known cleanup boundary:** The default recording directory (`data_dir()/Recordings`) is outside `data_dir()/media`, so normal output is unaffected. A user-configured recording directory inside `data_dir()/media` overlaps startup cleanup and can be deleted on next launch. Avoid that configuration. This behavior should be scoped to the two temporary folders in a future implementation change.

The worker threads are daemon threads. A Streamlink plugin blocked in a read may delay worker exit; shutdown waits are bounded and process termination may interrupt finalization if the source cannot be released in time.
