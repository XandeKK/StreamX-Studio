from __future__ import annotations

from pathlib import Path

from streamlink import Streamlink, __version__


PLUGIN_DIR = Path(__file__).resolve().parents[1] / "backend" / "plugins"
CHECK_URLS = (
    "https://stripchat.com/streamx-plugin-check",
    "https://edge-hls.doppiocdn.com/streamx-plugin-check.m3u8",
)


def main() -> None:
    session = Streamlink()
    if not session.plugins.load_path(str(PLUGIN_DIR)):
        raise SystemExit(f"No Streamlink plugin found in {PLUGIN_DIR}")
    for url in CHECK_URLS:
        plugin_name, _, _ = session.resolve_url_no_redirect(url)
        if plugin_name != "stripchat":
            raise SystemExit(f"Expected Stripchat plugin for {url}, got {plugin_name}")
    print(f"Streamlink {__version__}: Stripchat and DoppioCDN plugin matchers verified")


if __name__ == "__main__":
    main()
