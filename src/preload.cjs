const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('diskpilot', Object.freeze({
  scan: () => ipcRenderer.invoke('disk:scan'),
  limits: (target) => ipcRenderer.invoke('disk:limits', target),
  plan: (request) => ipcRenderer.invoke('disk:plan', request),
  apply: (id, phrase) => ipcRenderer.invoke('disk:apply', id, phrase),
  history: () => ipcRenderer.invoke('disk:history'),
  exportReport: () => ipcRenderer.invoke('disk:export'),
  elevate: () => ipcRenderer.invoke('app:elevate'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
}));
