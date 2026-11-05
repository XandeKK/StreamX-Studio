from __future__ import annotations

from pathlib import Path
from typing import Any


class StreamAccessError(Exception):
    pass


PLUGIN_DIR = Path(__file__).with_name("plugins")


def _streamlink():
    try:
        from streamlink import Streamlink
    except ImportError as exc:
        raise StreamAccessError("Streamlink is not installed. Run the setup instructions in README.md.") from exc
    session = Streamlink()
    try:
        loaded = session.plugins.load_path(str(PLUGIN_DIR))
    except Exception as exc:
        raise StreamAccessError(f"Could not load StreamX's Streamlink plugins: {exc}") from exc
    if not loaded:
        raise StreamAccessError(f"No Streamlink plugins were loaded from {PLUGIN_DIR}.")
    return session


def inspect(url: str) -> dict[str, Any]:
    session = _streamlink()
    try:
        available = session.streams(url)
    except Exception as exc:
        detail = str(exc).strip() or exc.__class__.__name__
        raise StreamAccessError(f"Streamlink could not access this URL: {detail}") from exc
    if not available:
        raise StreamAccessError("No playable stream is available. The source may be offline, unsupported, or require access Streamlink cannot provide.")
    return {"qualities": list(available.keys()), "is_live": True, "plugin": url.split('/')[2] if '://' in url else "direct"}


def open_stream(url: str, quality: str):
    session = _streamlink()
    try:
        available = session.streams(url)
    except Exception as exc:
        raise StreamAccessError(str(exc).strip() or "Streamlink could not access this URL.") from exc
    if not available:
        raise StreamAccessError("No playable stream is available; the source may be offline or unsupported.")
    selected = quality if quality in available else "best" if quality.lower() == "best" else None
    if selected is None:
        requested = quality.lower().replace('p', '')
        selected = next((q for q in available if requested in str(q).lower()), None)
    if selected is None or selected not in available:
        raise StreamAccessError(f"Requested quality '{quality}' is unavailable. Available: {', '.join(map(str, available))}")
    try:
        return available[selected].open()
    except Exception as exc:
        raise StreamAccessError(f"Could not open selected stream: {exc}") from exc
