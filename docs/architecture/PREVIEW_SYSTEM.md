# Preview system

Preview and time-shift playback both produce HLS for the renderer, but they use separate managers, Streamlink reads, FFmpeg processes, URLs, and temporary folders. Neither controls or reads a recording file.

## Live preview

`PreviewManager.start()` in `backend/preview_manager.py` creates one `Preview` per stream ID. The worker opens a selected Streamlink quality, pipes bytes into FFmpeg, and writes `index.m3u8` plus MPEG-TS segments under `data_dir()/media/previews/{stream_id}`. The playlist targets two-second segments, keeps eight entries, and uses temporary files while writing segments. H.264/AAC transcoding is enabled by default; the `preview_transcode` setting switches to stream copy.

The backend reports `playing` only after the playlist references a nonempty segment. It times out after 30 seconds waiting for the first segment and retries failed startup/source attempts up to four times with a two-second delay. FFmpeg stderr is drained into a short diagnostic tail. `VideoPreview` loads HLS.js, attempts network/media recovery, and displays browser media errors. HLS playlists receive no-cache headers.

Start and stop routes are `POST` and `DELETE /api/streams/{id}/preview`. The frontend can start preview from a source card/detail view and renders the playlist served through `/media/*`.

## Time-shift playback

`TimeShiftManager` creates an independent `TimeShiftCapture` per source. Each capture gets a UUID folder under `data_dir()/media/timeshift`, opens its own Streamlink input, and transcodes H.264/AAC with FFmpeg into a rolling HLS playlist. The list size is derived from `timeshift_buffer_minutes` and two-second target segments. FFmpeg's HLS delete/temporary-file flags remove segments outside the list and avoid exposing an in-progress segment.

`TimeShiftPlayer` reads the browser's seekable HLS range and implements pause/play, seek, rewind/forward, speed, volume, and jump-to-live controls. Those operations affect the local media element; the backend capture keeps advancing while the viewer pauses or seeks. Closing the player calls `DELETE /api/streams/{id}/timeshift`, which stops the capture and removes that session's temporary directory.

The backend checks `timeshift_min_free_gb` and `timeshift_max_storage_gb` when starting. The background task checks caps every five seconds and stops the oldest active buffer when the cap or free-space threshold is exceeded. `timeshift_buffer_minutes` is bounded to 5–1440 minutes. Preview and time-shift buffers do not survive application restart; startup cleanup removes the contents of the temporary media root.

## Resource use and limitations

- Each preview or time-shift session is another source connection and FFmpeg process; time-shift always transcodes video/audio, and preview transcodes by default.
- Preview retries source failures up to four attempts. Time-shift capture currently does not retry after its source/FFmpeg loop fails; its state becomes `error`.
- Successful FFprobe validation of generated test segments does not establish compatibility with every source codec, source service, or installed Chromium build.
- HLS files are served from the local static mount and exempted from token authentication by the HTTP middleware. Keep the backend bound to loopback.
- Startup currently clears all entries below `data_dir()/media`, not only the two named temporary subdirectories. Keep a configured recording directory outside this tree.
