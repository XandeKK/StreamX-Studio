const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('streamx', {
  openBrowser: url => ipcRenderer.invoke('open-browser', url),
  openPath: target => ipcRenderer.invoke('open-path', target),
  getApiToken: () => ipcRenderer.invoke('get-api-token')
})
