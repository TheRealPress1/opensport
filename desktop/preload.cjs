const { contextBridge, ipcRenderer } = require('electron')

// A narrow bridge, never raw IPC, filesystem, process, or shell access.
const invoke = (method, value) => ipcRenderer.invoke(`opensport:${method}`, value)
contextBridge.exposeInMainWorld('opensportDesktop', Object.freeze({
  getStatus: () => invoke('getStatus'),
  showDataFolder: () => invoke('showDataFolder'),
  setup: value => invoke('setup', value),
  start: () => invoke('start'),
  stop: () => invoke('stop'),
  backup: () => invoke('backup'),
  restore: () => invoke('restore'),
  recoverOwner: email => invoke('recoverOwner', email),
  openExternal: value => invoke('openExternal', value),
}))
