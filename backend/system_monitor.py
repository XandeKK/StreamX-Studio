from __future__ import annotations

import shutil
import time
from pathlib import Path

try:
    import psutil
except ImportError:
    psutil = None

from .database import settings


def snapshot() -> dict:
    prefs = settings()
    root = Path(prefs.get("recording_dir", str(Path.home())))
    try:
        usage = shutil.disk_usage(root if root.exists() else root.parent)
        disk = {"free": usage.free, "total": usage.total}
    except OSError:
        disk = {"free": 0, "total": 0}
    disk["low"] = bool(disk["free"] and disk["free"] < int(prefs.get("low_disk_gb", "5")) * 1024 ** 3)
    if psutil:
        try:
            net = psutil.net_io_counters()
            now = time.monotonic()
            previous = getattr(snapshot, "_net", (now, net.bytes_recv + net.bytes_sent))
            bandwidth = max(0, (net.bytes_recv + net.bytes_sent - previous[1]) / max(.001, now - previous[0]))
            snapshot._net = (now, net.bytes_recv + net.bytes_sent)
            return {"cpu": psutil.cpu_percent(interval=None), "ram": psutil.virtual_memory().percent,
                    "network_bps": bandwidth, "disk": disk}
        except Exception:
            pass
    return {"cpu": None, "ram": None, "network_bps": None, "disk": disk}
