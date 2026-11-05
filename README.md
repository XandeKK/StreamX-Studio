# StreamX Studio

StreamX Studio is a local desktop monitor and recorder for sources accessible through Streamlink. The Electron shell hosts a React/TypeScript interface; a loopback-only Python service manages Streamlink, FFmpeg, SQLite, monitoring, and WebSocket status updates.

## What works

- Add website URLs supported by installed Streamlink plugins, or direct HTTP(S) stream URLs. Compatibility checks report Streamlink's actual available qualities and errors; unsupported sources are not marked as live.
- Record independent sources at the same time, with a configurable session limit. Streamlink feeds each session's own FFmpeg process, using stream copy to avoid re-encoding. MKV, MP4, and TS containers are available.
- Stop/finalize recordings independently, track elapsed time and file size, and retry interrupted Streamlink connections using the configured interval.
- Monitor configured sources, optionally begin a recording when an offline source becomes live, and receive per-source status and resource updates over WebSocket.
- Start an independent Streamlink/FFmpeg HLS preview pipeline for a source. Preview uses separate bandwidth and compute resources from recording.
- Manage recordings, play completed local files, open their location, persist source/settings/history in SQLite, and review backend logs.
- Open a normal Chromium window for manual browsing. It does not extract browser media or circumvent site protections.

Streamlink plugin availability depends on the installed Streamlink release and the source website. A recognized website is not a guarantee that every stream is accessible; the source can be offline, unsupported, or require access Streamlink cannot provide.

## Live preview and time-shift playback

Select a source card to open its detail control room. **Start preview** opens an independent Streamlink/FFmpeg pipeline and serves a rolling HLS playlist to HLS.js. The preview reports ready only after FFmpeg has written a complete segment. HLS playlists are not cached; the player retries transient playlist failures and attempts media decoder recovery. Browser preview transcoding to H.264/AAC is enabled by default for broader playback support and can be disabled in Settings to use stream copy.

Select **Open time-shift player** to start a second, independent source connection for buffered playback. It transcodes to H.264/AAC and writes complete two-second MPEG-TS segments into a rolling HLS window. HLS.js drives playback from that window; pausing, seeking, changing speed, or jumping to Live only changes the player position. Closing the player stops that capture and removes its temporary buffer. The active recording and its output file are not used or modified by playback. Each stream can have its own playback session.

Time-shift playback consumes an additional network connection, CPU for video transcoding, and temporary storage. Settings limit the rewind window, total temporary storage, and minimum free disk space. FFmpeg deletes segments outside the configured window, and StreamX stops the oldest playback buffer if the storage cap or free-space threshold is reached. Closing a time-shift session removes its own temporary buffer, not a recording file. Playback buffers are temporary and do not survive an application restart. At backend startup, StreamX currently clears all of `~/.streamx/media`; keep a custom recording folder outside that directory (the default `~/.streamx/Recordings` is separate).

The **Playback Library** lists completed recordings and remembers each file's last playback position locally in the desktop UI. Active and completed recordings remain available in **Recordings**, with search, date filtering, file metadata, and confirmed deletion.

## Stripchat support

StreamX bundles the MIT-licensed [nbtu/Streamlink-Stripchat-Plugin](https://github.com/nbtu/Streamlink-Stripchat-Plugin) in `backend/plugins/stripchat.py` and loads it through Streamlink's Python plugin sideload API. The plugin README targets Streamlink 8.x; `requirements.txt` pins Streamlink 8.6.3, the version used to verify the plugin. Its only runtime dependencies are Streamlink and Python's standard library. The upstream license is included as `backend/plugins/LICENSE.stripchat`.

The plugin recognizes Stripchat room URLs and DoppioCDN HLS URLs. StreamX's existing compatibility check reports the qualities returned by the plugin; Best and returned qualities feed the existing independent recording and preview pipelines. The plugin handles Mouflon v1/v2 playlist formats and retries its listed alternate API domains when requests fail, including some Cloudflare challenge responses. Plugin/API behavior can change upstream, so setup verifies URL matching locally but does not contact Stripchat.

## Requirements

- Node.js 22.12 or newer and npm.
- Python 3.10 or newer.
- FFmpeg and FFprobe on `PATH`.
- Network access to install Node and Python dependencies.

The app does not download FFmpeg automatically because packaged FFmpeg distribution and licensing differ by platform. It checks for both executables and explains when they are missing.

## Install and run

Linux/macOS:

```sh
./scripts/setup.sh
npm run dev
```

Windows PowerShell:

```powershell
.\scripts\setup.ps1
npm run dev
```

Setup creates a local `.venv`, installs Streamlink/FastAPI/monitoring dependencies and frontend dependencies, installs the Electron platform binary, and verifies FFmpeg/FFprobe. It also checks that the bundled Stripchat plugin loads and matches Stripchat and DoppioCDN URL patterns without making network requests. Electron publishes its runtime separately from the npm package, so setup downloads that binary. On Linux, install the OS-provided FFmpeg package first (for example `sudo apt install ffmpeg`). On macOS or Windows, install a trusted FFmpeg build and add its `bin` directory to `PATH`.

The Electron shell starts the Python service on `127.0.0.1:8765`; Vite serves the development UI on `127.0.0.1:5173`. Run `npm run build` to build frontend assets and `npm run desktop` to launch the production UI in the Electron shell. This repository does not currently create a distributable installer. FFmpeg/FFprobe remain system dependencies and must be installed on the target machine.

To use a non-default Python environment, set `STREAMX_PYTHON` to that interpreter before launching Electron. The app stores its database and temporary previews under `~/.streamx` (Windows: the user's home directory `.streamx`) unless `STREAMX_HOME` is set. Recordings default to `~/.streamx/Recordings`.

## Configuration

Use **Settings** to choose the recording folder, the maximum number of concurrent recordings, reconnect and monitoring intervals, segmented recording length, time-shift buffer duration and storage caps, minimum free space, preview transcoding, and the low-disk threshold. Settings and stream definitions are saved in `streamx.sqlite3`. Original recordings copy source audio/video without re-encoding; browser preview and time-shift HLS use separate pipelines.

For each source, **Check Streamlink compatibility** calls Streamlink's Python API and displays the actual qualities returned by its plugin. You can select a returned quality after saving the source, or use Best. The dashboard's status and logs report probe failures. Automatic monitoring checks enabled sources at the configured interval; automatic recording starts when a monitored source comes online, subject to the simultaneous recording limit.

## Safety and access

Use only public broadcasts you are authorized to access and record, and follow the source site's terms and applicable laws. The Stripchat plugin processes Mouflon-encoded playlist data and may try alternate API domains after an endpoint failure. Do not use it for private or restricted broadcasts. Browser navigation is manual and isolated in a separate Chromium window; browser session credentials are not passed to Streamlink.

The Python service binds only to localhost. Electron creates a per-launch token for its API and WebSocket requests; preview HLS files are served only from the local service. The API is intended for the desktop UI, not direct exposure to a network.

## Troubleshooting

- **Engine offline:** confirm dependencies are installed in the selected Python environment. The Electron process launches `python3` (or `python` on Windows) unless `STREAMX_PYTHON` is set.
- **Streamlink not installed:** rerun setup or install `requirements.txt` into the interpreter used by Electron.
- **Stripchat plugin not recognized:** run `python scripts/verify_streamlink_plugin.py` with StreamX's interpreter and confirm Streamlink 8.6.3 is installed. Upstream API and playlist changes may require a plugin update.
- **Preview is still starting:** wait for the first complete HLS segment. If it fails, open the source details for the FFmpeg/Streamlink error, check FFmpeg is on `PATH`, and leave preview transcoding enabled for browser-incompatible source codecs.
- **Time-shift stopped early:** review the configured storage cap and minimum free-space threshold. Closing the player deletes its temporary buffer; start playback again to create a new buffer.
- **Unsupported / offline source:** use the compatibility check. Streamlink reports plugin and source errors; StreamX does not claim arbitrary sites are supported.
- **No output file:** verify FFmpeg and FFprobe are on `PATH`, check Logs, and verify the selected source quality. The app removes empty temporary outputs.
- **Preview is blank:** some inputs/codecs cannot be remuxed to HLS for Chromium playback. Recording runs in a separate process and can still work. Preview can use significant additional bandwidth.
- **MP4 cannot be played until stop:** MP4 indexes are finalized when a session stops; use MKV for interrupted/long captures where recovery matters more than player compatibility.
- **Shutdown:** active FFmpeg stdin is closed to finalize containers when the app quits. A network source blocked in a Streamlink read may take longer to release, depending on its plugin and network timeout.

## Developer structure

- `backend/`: SQLite, Streamlink adapter, FFmpeg recording and preview processes, monitoring, WebSocket events, system metrics, and HTTP API.
- `src/`: React dashboard, source controls, HLS preview, settings, recording library, browser launcher, and logs.
- `electron/`: isolated desktop window and optional browser window.

The API is documented by FastAPI at `http://127.0.0.1:8765/docs` while the backend runs.

For component boundaries, data flows, API and WebSocket contracts, database schema, and development guidance, see the [architecture documentation](docs/architecture/README.md).

To repeat the two-session recording check, run `.venv/bin/python scripts/smoke_multi_recording.py` (Windows: `.venv\Scripts\python.exe scripts\smoke_multi_recording.py`). To check preview and independent playback alongside two active recordings, run `.venv/bin/python scripts/smoke_playback_sessions.py`. These scripts create local synthetic HLS feeds and use FFprobe to verify audio/video segments and finalized recording files; they do not contact external stream sites.
