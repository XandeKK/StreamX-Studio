# Frontend architecture

## Entry point and composition

`src/main.tsx` mounts the React 19 application and imports `src/index.css`. `src/App.tsx` is the application shell and currently contains the page components; page navigation is local React state rather than a router. The pages are Dashboard, Live Streams, Recordings, Playback Library, Stream Manager, Settings, Browser, and Logs.

The dashboard and live-stream page share stream-card/grid components. The detail modal combines stream status, recording controls, `VideoPreview`, and `TimeShiftPlayer`. Recording history and the playback library use the same recording table and native `<video>` modal. `src/types.ts` defines the frontend view of backend objects.

## Backend communication

`src/api.ts` defines `request<T>()`, which obtains the token from `window.streamx`, sends JSON requests to `http://127.0.0.1:8765`, and adds `X-StreamX-Token` when available. It turns non-2xx JSON `detail` fields into thrown `Error`s. `mediaUrl()` prefixes local HLS paths; the recording player includes the token as a query parameter because a media element cannot set the custom API header.

`App` calls `refresh()` on mount and every 2.5 seconds. It fetches streams, recordings, settings, system metrics, logs, and `/health` in parallel. A separate WebSocket reconnects after closure; `system` messages update metrics, while `stream-status`, `recording`, and `recording-finished` trigger a REST refresh. The initial WebSocket `snapshot` is currently not consumed by the renderer.

## Electron bridge

The renderer accesses Electron functions only through `window.streamx`, declared in `src/types.ts` and exposed by `electron/preload.cjs`:

- `getApiToken()` supplies the launch-scoped API token.
- `openPath(target)` asks the main process to open a path or reveal a file.
- `openBrowser(url)` opens an isolated Chromium window after HTTP(S) URL validation.

`electron/main.cjs` enables context isolation and disables Node integration in the main window. The manual browser window uses a separate session partition; its credentials are not forwarded to Streamlink.

## Media components

`VideoPreview` dynamically imports HLS.js, attaches a local HLS playlist, attempts network/media recovery, and exposes play, mute, volume, and fullscreen controls. It reports loading until the media element emits `playing`. Native HLS is used if HLS.js is unsupported but the platform reports native HLS capability.

`TimeShiftPlayer` also dynamically imports HLS.js. Its seek range comes from `HTMLVideoElement.seekable`; controls adjust playback position/rate and can return to the latest buffered edge. It does not pause the backend source capture. Completed recordings use the native video element with a backend file URL and save positions in browser `localStorage` under `streamx-playback-positions`.

## Current limitations

- Page components and much UI behavior live in one large `App.tsx`; there is no separate page/router or state-management package.
- Renderer data refresh is polling based. WebSocket messages do not provide a complete replacement for that polling.
- Native playback of MKV/MP4/TS depends on Chromium and the actual codecs/container; no transcoding or alternate recording playback pipeline is implemented.
- Remembered recording positions are local to the renderer profile, not stored in SQLite or synchronized across machines.
