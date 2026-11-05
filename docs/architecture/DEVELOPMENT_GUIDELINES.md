# Development guidelines

## Before changing code

1. Read this architecture index and the relevant topic documents.
2. Inspect the current source files and runtime call sites; documentation can lag behind code.
3. Preserve the existing boundaries between Electron, renderer, FastAPI, Streamlink, FFmpeg, and SQLite unless the requested change calls for a boundary change.
4. Check current worktree changes before editing. Avoid broad rewrites or parallel implementations of existing services.

## After a significant change

- Update the relevant architecture documents when adding/changing a module, API, WebSocket event, table/column, setting, worker, process boundary, or data flow.
- Keep endpoint paths, payload examples, state names, and persistence claims grounded in the actual implementation.
- Clearly label partial behavior, unverified external service behavior, and known limitations. Do not document a README promise as implemented without checking its call path.
- Keep tokens, credentials, personal recordings, and local databases out of source control.

## Local development

Requirements and setup are in the root `README.md`. The setup scripts check Node.js/Python, install `requirements.txt` and npm dependencies, install the Electron binary, and run the local plugin matcher check. FFmpeg and FFprobe must already be on `PATH`.

- `npm run dev`: Vite plus Electron development shell.
- `npm run build`: TypeScript build check and Vite production assets.
- `npm run desktop`: launch the built Electron app.
- `python scripts/verify_streamlink_plugin.py`: local plugin matcher check using the selected Python environment.
- `.venv/bin/python scripts/smoke_multi_recording.py`: synthetic local HLS concurrent recording check (Windows: `.venv\\Scripts\\python.exe`).
- `.venv/bin/python scripts/smoke_playback_sessions.py`: synthetic local HLS preview/time-shift/recording and restart check (Windows: `.venv\\Scripts\\python.exe`).

The smoke scripts generate local feeds and use FFprobe; they do not establish access to a third-party live site. There is no `npm test` script or general frontend unit-test suite in `package.json` at the time of writing.

## Debugging

- Check the UI's Engine status, Settings diagnostics, and Logs page first.
- Open FastAPI `/docs` while the local backend is running to inspect the generated HTTP schema.
- Check `GET /health` for Streamlink/FFmpeg/FFprobe availability and `/api/diagnostics` for resolved paths.
- Inspect the bounded `logs` table for monitor/reconnect/preview issues. Recording worker FFmpeg stderr is suppressed, so missing executables and worker state errors are more visible than detailed FFmpeg diagnostics.
- Use isolated synthetic feeds for pipeline changes; avoid relying on a live website as a reproducible test fixture.

## Source/documentation consistency

If a change adds an API, document its method, path, request and response in `API_REFERENCE.md`; if it adds a WebSocket message, update `WEBSOCKET_EVENTS.md`; if it alters persistence, update `DATABASE_SCHEMA.md`; and update the index/overview when architectural boundaries change. Re-check file and symbol references after moving or renaming code. Run the relevant verification after modifying code, as requested by the project task.
