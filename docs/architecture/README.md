# StreamX Studio architecture

This directory describes the implementation present in the repository. It is a map for development, not a substitute for reading the current source. Check the referenced files before relying on an implementation detail; update this documentation when a significant boundary, API, event, table, or process changes.

## Documents

| Document | What it covers |
| --- | --- |
| [System overview](SYSTEM_OVERVIEW.md) | Components, process boundaries, and how data moves through the desktop app. |
| [Project structure](PROJECT_STRUCTURE.md) | Responsibilities of the checked-in directories and important files. |
| [Frontend architecture](FRONTEND_ARCHITECTURE.md) | React state, UI pages, REST/WebSocket clients, and Electron bridge. |
| [Backend architecture](BACKEND_ARCHITECTURE.md) | FastAPI composition, service ownership, persistence, and startup. |
| [Recording pipeline](RECORDING_PIPELINE.md) | Streamlink reads, FFmpeg stream-copy output, retries, and finalization. |
| [Stream monitoring](STREAM_MONITORING.md) | Availability checks, automatic recording, telemetry, and status behavior. |
| [Preview system](PREVIEW_SYSTEM.md) | Browser HLS preview and the separate rolling time-shift player. |
| [Database schema](DATABASE_SCHEMA.md) | SQLite tables, relationships, defaults, and persisted versus runtime data. |
| [API reference](API_REFERENCE.md) | Implemented HTTP routes, request fields, responses, and error behavior. |
| [WebSocket events](WEBSOCKET_EVENTS.md) | WebSocket authentication, initial snapshot, event envelope, and event payloads. |
| [Plugin system](PLUGIN_SYSTEM.md) | Streamlink plugin sideloading and the bundled Stripchat plugin. |
| [Process management](PROCESS_MANAGEMENT.md) | Electron/backend startup, worker threads, FFmpeg children, and shutdown. |
| [Development guidelines](DEVELOPMENT_GUIDELINES.md) | Local setup, debugging, verification, and instructions for future AI contributors. |

## Implementation status

- **Implemented:** Electron desktop shell, React UI, FastAPI service, SQLite storage, Streamlink source probing and capture, concurrent recordings, periodic availability monitoring, system telemetry, HLS preview, independent time-shift capture, recording history, settings, and the bundled Stripchat plugin loader.
- **Partially implemented:** WebSocket events are emitted by the backend, but the UI uses periodic REST refreshes for most state and ignores the initial WebSocket `snapshot` event. Completed-file playback uses the browser's native media element and therefore depends on its codec/container support. Source-specific Streamlink access and the bundled plugin's live behavior depend on the upstream site and are not established by local matcher checks.
- **Planned:** The repository contains no verified roadmap or planned-feature specification. No feature is labeled planned here based only on UI wording or README claims.
- **Known limitations:** Runtime preview/time-shift state is in memory and temporary media is cleared at startup. Recording data is separate from those HLS paths under the default configuration. Startup currently removes every entry under `data_dir()/media`; a custom recording directory placed inside that tree would overlap with this cleanup and should be avoided until cleanup is more narrowly scoped. See [process management](PROCESS_MANAGEMENT.md).

## Scope and source of truth

These documents were prepared from the current `README.md`, dependency manifests, Electron files, frontend, Python modules, scripts, and plugin files. They describe the code as found, including existing limitations. If documentation and code disagree later, inspect the implementation and correct the documentation.
