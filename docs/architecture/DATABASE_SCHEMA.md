# Database schema

`backend/database.py:init_db()` creates tables with `CREATE TABLE IF NOT EXISTS` and inserts default settings with `INSERT OR IGNORE`. Connections use SQLite WAL mode, foreign keys, and a 20-second timeout. There is no migration framework or schema-version table in the current implementation.

## Tables

### `streams`

| Column | Meaning |
| --- | --- |
| `id` | Autoincrement primary key. |
| `name`, `url` | Display name and unique HTTP(S) URL. |
| `group_name` | UI grouping label; defaults to `General`. |
| `quality` | Requested Streamlink quality, default `best`. |
| `container` | Recording format, default `mkv`; route accepts `mkv`, `mp4`, or `ts`. |
| `auto_record`, `monitor` | Integer boolean flags; defaults are 0 and 1. |
| `created_at` | SQLite timestamp default. |

### `recordings`

Stores `id`, nullable `stream_id`, `stream_name`, `path`, `format`, `started_at`, nullable `ended_at`, `status`, and nullable `error`. `stream_id` references `streams(id) ON DELETE SET NULL`, preserving history if a source is removed. File size, existence, and active progress are computed when listing recordings rather than stored in columns.

### `settings`

Key/value text store with `key` as the primary key. Defaults: `recording_dir`, `max_recordings=4`, `retry_seconds=10`, `monitor_seconds=30`, `low_disk_gb=5`, `segment_minutes=0`, `timeshift_buffer_minutes=60`, `timeshift_max_storage_gb=4`, `timeshift_min_free_gb=5`, and `preview_transcode=true`. Values are stored as text, including booleans; Pydantic validates API writes.

### `logs`

Stores autoincrement `id`, `at`, `level`, and `message`. `database.log()` truncates messages to 2,000 characters and retains the most recent 2,000 rows. The logs endpoint returns at most 500 rows.

## Relationships and non-database state

One stream can have many recording history rows. Deleting a stream nulls the foreign key in recordings; it does not delete the recorded files. Deleting a recording row through the API also deletes its file(s). Active worker state, preview/time-shift state, availability, CPU/network metrics, and playback resume positions are not database tables. Resume positions are stored in renderer `localStorage`.

The runtime database path is `data_dir()/streamx.sqlite3`; `data_dir()` uses `STREAMX_HOME` or `Path.home() / ".streamx"`.
