# WebSocket events

The backend exposes `ws://127.0.0.1:8765/ws`. When `STREAMX_TOKEN` is configured, clients must supply it as `?token=...`; a mismatch is closed with code `4401`. The Electron renderer builds this URL in `src/api.ts` and reconnects about 1.8 seconds after a close.

Every server message has the envelope:

```json
{"event":"event-name","data":{}}
```

## Events emitted

| Event | `data` payload | Emission behavior |
| --- | --- | --- |
| `snapshot` | `{streams, system, recordings}` | Sent once after connection acceptance. The current renderer does not consume this message; it separately performs its initial REST refresh. |
| `system` | System snapshot: `{cpu, ram, network_bps, disk}` | Sent each `background_updates()` loop, roughly once per second. |
| `stream-status` | `{stream_id, state, qualities, error}` | Sent when the in-memory result of a monitored availability check changes. |
| `recording` | Recorder snapshot: recording/stream IDs, state, duration, file size, path, error, retry count, source name/URL, resolution, bitrate. | Emitted by the recorder and also published by the backend update loop. |
| `recording-finished` | Final recorder snapshot | Sent when the recorder thread exits and the history row is finalized. |

The `Hub` in `backend/main.py` sends events to connected clients and removes a client after a send exception. Recorder threads use `publish_threadsafe()` to schedule delivery on the FastAPI event loop. Clients should not assume every intermediate recording state is durable; the REST endpoints remain the authoritative persisted/history view.

## Client behavior and gaps

The React client handles `system` directly. It calls `refresh()` for `stream-status`, `recording`, and `recording-finished`. Preview and time-shift state do not currently have dedicated WebSocket events, so their snapshots are observed through the 2.5-second `/api/streams` polling. The client sends no application messages; its inbound `receive_text()` loop keeps the socket open.
