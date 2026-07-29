const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rosterAPI', {
  build: (args) => ipcRenderer.invoke('roster:build', args),
  save: (args) => ipcRenderer.invoke('roster:save', args),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('roster:progress');
    ipcRenderer.on('roster:progress', (_event, payload) => callback(payload));
  }
});
