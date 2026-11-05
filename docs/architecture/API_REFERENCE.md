# API reference

The FastAPI app is in `backend/main.py`, with request validation in `backend/models.py`. The Electron shell binds it to `127.0.0.1:8765`. FastAPI-generated docs are available at `/docs` while it runs. Unless noted, JSON routes return JSON. When `STREAMX_TOKEN` is set, requests require `X-StreamX-Token`; the recording file route accepts the token in its query string.

## Health and diagnostics

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /health` | None | `{ok, streamlink: {installed, version}, ffmpeg, ffprobe}`. This route bypasses token middleware. |
| `GET /api/system` | None | `{cpu, ram, network_bps, disk: {free, total, low}}`; CPU/RAM/network may be null without `psutil`. |
| `GET /api/diagnostics` | None | Python version, Streamlink state, FFmpeg/FFprobe paths, database path, recording directory, and `psutil` availability. |
| `GET /api/logs` | None | Up to 500 newest log rows. |

## Sources and compatibility

`StreamInput` is used for create/update: `{name, url, group_name, quality, container, auto_record, monitor}`. Name is 1–120 characters; URL is 4–2048 characters; `container` must be `mkv`, `mp4`, or `ts`. `POST /api/streams` and both probe routes require an HTTP(S) URL. `PUT /api/streams/{stream_id}` currently does not repeat that scheme check. Defaults are `General`, `best`, `mkv`, false, and true respectively.

| Method and path | Request | Response / notable errors |
| --- | --- | --- |
| `GET /api/streams` | None | Array of persisted source fields plus `session`, `availability`, `preview`, and `timeshift` runtime snapshots. |
| `POST /api/streams` | `StreamInput` JSON | Created stream detail. `400` invalid URL/container; `409` duplicate URL. |
| `PUT /api/streams/{stream_id}` | `StreamInput` JSON | Updated detail. `404` unknown ID; `409` URL collision; `400` invalid container. |
| `DELETE /api/streams/{stream_id}` | None | `{ok: true}`; refuses with `409` while recording is active, and stops preview/time-shift before deletion. |
| `POST /api/probe` | `{url}` | `{ok, qualities, is_live, plugin}`; `400` non-HTTP(S), `422` Streamlink access failure. |
| `POST /api/streams/{stream_id}/probe` | None | `{ok, qualities, is_live, plugin}`; `404` unknown source, `422` access failure. |

## Recording and playback controls

| Method and path | Request | Response / notable errors |
| --- | --- | --- |
| `POST /api/streams/{stream_id}/record` | None | Initial recording snapshot; `404` unknown source, `409` already active or concurrent limit reached. |
| `POST /api/streams/{stream_id}/stop` | None | `{ok: true, state: "finalizing"}`; `404` if no current recording. |
| `POST /api/streams/{stream_id}/preview` | None | `{state, url, error}` initial preview snapshot. |
| `DELETE /api/streams/{stream_id}/preview` | None | `{ok: true}`. |
| `POST /api/streams/{stream_id}/timeshift` | None | Playback snapshot `{session_id, stream_id, state, error, url, started_at, buffer_minutes, buffer_seconds, storage_bytes}`; `404` unknown source, `507` storage/free-space refusal. |
| `DELETE /api/streams/{stream_id}/timeshift` | None | `{ok: true}`; removes the temporary buffer after stopping the capture. |
| `GET /api/recordings` | None | Newest-first history with computed `file_size`, `exists`, and optional active `progress`. |
| `DELETE /api/recordings/{recording_id}` | None | `{ok: true}`; `404` unknown row, `409` active/finalizing row, `500` file deletion failure. |
| `GET /api/recordings/{recording_id}/file` | `token` query parameter when auth enabled | Inline media file response; `404` if the row/file is unavailable. |

## Settings

`GET /api/settings` returns a key/value object; values are stored and generally returned as strings. `PUT /api/settings` accepts any subset of `SettingsInput` fields and returns the resulting object. Bounds are: `max_recordings >= 1`; `retry_seconds` 2–3600; `monitor_seconds` 10–3600; `low_disk_gb` 0–1000; `segment_minutes` 0–1440; `timeshift_buffer_minutes` 5–1440; `timeshift_max_storage_gb` 1–512; `timeshift_min_free_gb` 0–1000; `preview_transcode` boolean. A non-creatable recording directory returns `400`.

## Media and status transport

`GET /media/{path}` is the FastAPI static mount for temporary HLS playlists and segments. HLS playlists receive no-cache headers. These paths are exempted from HTTP token middleware; the intended deployment is loopback-only. See [WebSocket events](WEBSOCKET_EVENTS.md) for `/ws`.
