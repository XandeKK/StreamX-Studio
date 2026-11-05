#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON_BIN="${PYTHON_BIN:-python3}"
NODE_BIN="${NODE_BIN:-node}"

command -v "$PYTHON_BIN" >/dev/null || { echo "Python 3 is required." >&2; exit 1; }
command -v "$NODE_BIN" >/dev/null || { echo "Node.js is required." >&2; exit 1; }
"$PYTHON_BIN" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10 or newer is required." >&2; exit 1; }
"$NODE_BIN" -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' || { echo "Node.js 22.12 or newer is required." >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "FFmpeg was not found. Install FFmpeg and make it available on PATH." >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "FFprobe was not found. Install FFmpeg/FFprobe and make them available on PATH." >&2; exit 1; }

"$PYTHON_BIN" -m venv .venv
if [ -x .venv/bin/python ]; then PY=".venv/bin/python"; else PY=".venv/Scripts/python.exe"; fi
"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r requirements.txt
npm install
npm run install:electron
"$PY" -c 'import streamlink, fastapi; print("Streamlink", streamlink.__version__, "and FastAPI ready")'
"$PY" scripts/verify_streamlink_plugin.py
echo "Setup complete. Run npm run dev to open StreamX Studio."
