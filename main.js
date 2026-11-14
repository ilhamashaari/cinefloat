/* ==========================================================================
   main.js — the Electron MAIN process.
   It creates the window and applies security rules. All the app logic lives
   in the renderer files (index.html + js/*.js), exactly like a normal web page.
   ========================================================================== */
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');

// YouTube now refuses embedded players that arrive WITHOUT a Referer header,
// and pages loaded from file:// never send one (you would see "Error 153").
// We add a Referer only to YouTube requests. Change it to your own site if you have one.
const EMBED_REFERER = 'https://cinefloat.app/';

let mainWindow = null;

/** Open a link in the user's normal browser (only http/https are allowed). */
function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
  } catch { /* ignore malformed URLs */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 420,
    minHeight: 600,
    title: 'CineFloat',
    backgroundColor: '#07070d', // avoids a white flash before the page paints
    autoHideMenuBar: true,      // press Alt (Windows/Linux) to show the menu with DevTools
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // the page cannot reach Electron/Node internals
      nodeIntegration: false,   // no require() inside the page
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Links that want a new window (target="_blank") open in the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  // The app window may never navigate away from our own page.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // a second copy of the app is already running
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const ses = session.defaultSession;

    // The app needs no special permissions, except fullscreen for the trailer player.
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'fullscreen');
    });

    // Give YouTube the Referer header it asks for (see EMBED_REFERER above).
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] },
      (details, callback) => callback({ requestHeaders: { ...details.requestHeaders, Referer: EMBED_REFERER } })
    );

    ipcMain.handle('app:version', () => app.getVersion());

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(); // macOS dock click
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
