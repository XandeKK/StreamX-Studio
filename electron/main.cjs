const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')
const fs = require('node:fs')
const { randomBytes } = require('node:crypto')

let mainWindow
let backend
const dev = process.argv.includes('--dev')
const projectRoot = path.resolve(__dirname, '..')
const root = app.isPackaged ? process.resourcesPath : projectRoot
const uiRoot = app.isPackaged ? app.getAppPath() : projectRoot
const localPython = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
const packagedPython = path.join(root, process.platform === 'win32' ? 'python/Scripts/python.exe' : 'python/bin/python')
const python = process.env.STREAMX_PYTHON || (app.isPackaged && fs.existsSync(packagedPython) ? packagedPython : fs.existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'python' : 'python3'))
const apiToken = randomBytes(32).toString('hex')

function waitForBackend(done, attempts = 40) {
  const req = http.get('http://127.0.0.1:8765/health', res => {
    res.resume()
    done(res.statusCode === 200)
  })
  req.on('error', () => {
    if (attempts <= 0) return done(false)
    setTimeout(() => waitForBackend(done, attempts - 1), 400)
  })
  req.setTimeout(800, () => req.destroy())
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1050, minHeight: 700,
    backgroundColor: '#090c12', title: 'StreamX Studio',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  })
  if (dev) mainWindow.loadURL('http://127.0.0.1:5173')
  else mainWindow.loadFile(path.join(uiRoot, 'dist/index.html'))
}

app.whenReady().then(() => {
  backend = spawn(python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8765'], {
    cwd: root, stdio: 'ignore', windowsHide: true, env: { ...process.env, STREAMX_TOKEN: apiToken }
  })
  waitForBackend(ok => {
    createWindow()
    if (!ok && mainWindow) mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('backend-error'))")
    })
  })
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

ipcMain.handle('open-browser', async (_event, url) => {
  let target
  try { target = new URL(url) } catch { throw new Error('Enter a valid website URL.') }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only HTTP and HTTPS browser URLs are allowed.')
  const browser = new BrowserWindow({ width: 1280, height: 840, title: 'StreamX Browser', webPreferences: { contextIsolation: true, sandbox: true, partition: `streamx-browser-${Date.now()}` } })
  await browser.loadURL(target.toString())
})
ipcMain.handle('open-path', (_event, target) => {
  try { if (fs.statSync(target).isFile()) return shell.showItemInFolder(target) } catch {}
  return shell.openPath(target)
})
ipcMain.handle('get-api-token', () => apiToken)

app.on('before-quit', () => {
  if (backend && !backend.killed) backend.kill('SIGTERM')
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
