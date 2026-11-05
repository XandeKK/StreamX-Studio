from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any


def data_dir() -> Path:
    base = Path(os.environ.get("STREAMX_HOME", Path.home() / ".streamx"))
    base.mkdir(parents=True, exist_ok=True)
    return base


DB_PATH = data_dir() / "streamx.sqlite3"


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS streams (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
          group_name TEXT NOT NULL DEFAULT 'General', quality TEXT NOT NULL DEFAULT 'best',
          container TEXT NOT NULL DEFAULT 'mkv', auto_record INTEGER NOT NULL DEFAULT 0,
          monitor INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recordings (
          id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id INTEGER, stream_name TEXT NOT NULL,
          path TEXT NOT NULL, format TEXT NOT NULL, started_at TEXT NOT NULL,
          ended_at TEXT, status TEXT NOT NULL, error TEXT,
          FOREIGN KEY(stream_id) REFERENCES streams(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          level TEXT NOT NULL, message TEXT NOT NULL
        );
        """)
        defaults = {
            "recording_dir": str(data_dir() / "Recordings"), "max_recordings": "4",
            "retry_seconds": "10", "monitor_seconds": "30", "low_disk_gb": "5", "segment_minutes": "0",
        }
        db.executemany("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", defaults.items())


def rows(query: str, args: tuple = ()) -> list[dict[str, Any]]:
    with connect() as db:
        return [dict(r) for r in db.execute(query, args).fetchall()]


def row(query: str, args: tuple = ()) -> dict[str, Any] | None:
    found = rows(query, args)
    return found[0] if found else None


def execute(query: str, args: tuple = ()) -> int:
    with connect() as db:
        cur = db.execute(query, args)
        return cur.lastrowid or cur.rowcount


def settings() -> dict[str, str]:
    return {x["key"]: x["value"] for x in rows("SELECT key,value FROM settings")}


def log(level: str, message: str) -> None:
    execute("INSERT INTO logs(level,message) VALUES(?,?)", (level, message[:2000]))
    execute("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 2000)")


def json_value(value: Any) -> str:
    return json.dumps(value)
