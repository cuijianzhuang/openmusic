const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lyricsAPI', {
  onUpdate: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('lyrics-update', handler); return () => ipcRenderer.removeListener('lyrics-update', handler); },
  close: () => ipcRenderer.invoke('lyrics-close'),
});
