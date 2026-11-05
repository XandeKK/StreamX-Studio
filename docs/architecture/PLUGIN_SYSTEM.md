# Plugin system

## Streamlink plugin discovery

`backend/streamlink_engine.py::_streamlink()` creates a new `Streamlink` session for each inspection/open operation and calls `session.plugins.load_path()` with `backend/plugins`. If loading fails or no plugin is reported as loaded, it raises `StreamAccessError`. `inspect()` calls `session.streams(url)` and returns the available quality names; `open_stream()` resolves the requested quality and opens that stream.

This is Streamlink's Python sideload API. There is no separate StreamX plugin registry, UI, or plugin configuration database. Other installed Streamlink plugins can also resolve compatible URLs through the Streamlink session.

## Bundled Stripchat plugin

`backend/plugins/stripchat.py` declares `Stripchat` with `@pluginmatcher` patterns for configured Stripchat-related room domains and DoppioCDN HLS URLs, and assigns it to `__plugin__`. For room URLs, `_get_streams()` queries configured API hostnames to find a room/user and then parses HLS variants. For DoppioCDN URLs it parses a master playlist or returns a direct HLS stream. The file includes Mouflon v1/v2 playlist transformation code. Its license is included separately as `backend/plugins/LICENSE.stripchat`.

`scripts/verify_streamlink_plugin.py` loads this directory and uses `resolve_url_no_redirect()` to check that two representative URL shapes select the `stripchat` plugin. That verification does not make network requests to the source service and does not prove that a live room, API response, or media stream is accessible.

## Extension guidance and limitations

To add a source integration, prefer a normal Streamlink plugin in `backend/plugins` so existing `inspect()` and `open_stream()` paths can use it. Add an offline matcher check where possible and document external network dependencies. The bundled plugin targets the pinned Streamlink version in `requirements.txt`; upstream website endpoints, playlist formats, and Streamlink APIs can change. No generic plugin installation/update UI or automated plugin compatibility test suite is present.
