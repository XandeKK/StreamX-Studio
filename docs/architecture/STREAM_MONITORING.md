# Stream monitoring

## Availability checks

`background_updates()` in `backend/main.py` loops about once per second. Availability probes run no more frequently than `monitor_seconds` (with a 10-second floor). The task selects rows with `monitor=1`, skips sources with an active recording, and calls `streamlink_engine.inspect()` in a worker thread.

An available source gets an in-memory status of `live`, its discovered quality list, and no error. Probe failures produce `offline`, an empty quality list, and a bounded error string. `stream-status` is emitted only when the computed status differs from the previously stored status. The status is not persisted; on a new process it starts as `unknown` until a probe runs. Manual checks use `POST /api/streams/{id}/probe`; a URL not yet saved can be checked with `POST /api/probe`.

If `auto_record` is enabled, a successful monitor check attempts to call the normal recording start path. The existing active-recorder and global concurrency checks still apply. While a recording is active, the monitor skips that source rather than probing it separately.

## System telemetry

The background task publishes a `system` event every loop. `system_monitor.snapshot()` reports disk free/total and a `low` flag based on `low_disk_gb`. When `psutil` is present it also reports CPU percentage, RAM percentage, and an approximate network bytes-per-second rate. Without `psutil` those three values are null. The frontend also polls `/api/system` as part of its periodic refresh.

## Dashboard state

`GET /api/streams` joins persisted stream fields with runtime `session`, `availability`, `preview`, and `timeshift` snapshots. Recording snapshots are updated during capture; availability status is independent and can be stale while a recording causes monitoring to skip the source.

## Limitations

- Monitoring only tries Streamlink inspection at the configured interval; it is not a continuous socket health check.
- A source marked live has passed a Streamlink availability check; it does not guarantee that recording or playback will remain uninterrupted.
- `monitor_status` is memory-only and is not cleared or updated from a separate probe scheduler while a recorder is active.
