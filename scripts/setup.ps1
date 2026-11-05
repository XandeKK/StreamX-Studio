$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3 is required." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is required." }
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) { throw "Python 3.10 or newer is required." }
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if ($LASTEXITCODE -ne 0) { throw "Node.js 22.12 or newer is required." }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw "FFmpeg was not found on PATH." }
if (-not (Get-Command ffprobe -ErrorAction SilentlyContinue)) { throw "FFprobe was not found on PATH." }
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm install
npm run install:electron
.\.venv\Scripts\python.exe -c "import streamlink, fastapi; print('Streamlink', streamlink.__version__, 'and FastAPI ready')"
if ($LASTEXITCODE -ne 0) { throw "Streamlink dependencies failed verification." }
.\.venv\Scripts\python.exe scripts/verify_streamlink_plugin.py
if ($LASTEXITCODE -ne 0) { throw "The Streamlink Stripchat plugin failed verification." }
Write-Host "Setup complete. Run npm run dev to open StreamX Studio."
