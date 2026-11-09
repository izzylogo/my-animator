// The small, fixed list of file actions the page may ask the desktop side to do.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('animatorFiles', {
  save: (text, suggested) => ipcRenderer.invoke('file-save', text, suggested),
  saveAs: (text, suggested) => ipcRenderer.invoke('file-save-as', text, suggested),
  open: () => ipcRenderer.invoke('file-open'),
  opened: () => ipcRenderer.invoke('file-opened'),
  forget: () => ipcRenderer.invoke('file-forget'),
  autosave: (text) => ipcRenderer.invoke('autosave-write', text),
  recovered: () => ipcRenderer.invoke('autosave-read'),
  clearAutosave: () => ipcRenderer.invoke('autosave-clear'),
  setChanged: (changed) => ipcRenderer.invoke('set-changed', changed),
  closeNow: () => ipcRenderer.invoke('close-now'),
  onCloseRequested: (listener) => ipcRenderer.on('close-requested', () => listener()),
});
