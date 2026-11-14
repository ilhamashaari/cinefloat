/* ==========================================================================
   preload.js — the ONLY bridge between the web page and Electron.
   With contextIsolation on, the page cannot see Node or Electron. It only gets
   the tiny, read-only `window.desktop` object that we expose here.
   ========================================================================== */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  getVersion: () => ipcRenderer.invoke('app:version')
});
