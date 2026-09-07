const { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } = require('electron');
const path = require('node:path');

// 开发态连接 Vite；发布包连接部署的 OpenMusic 服务（可用 OPENMUSIC_URL 覆盖）。
// 发布包不能指向 Vite，因为安装环境通常没有开发服务器。
const appUrl = process.env.OPENMUSIC_URL || (app.isPackaged ? 'http://localhost:4000' : 'http://localhost:5173');
const appIcon = path.join(__dirname, 'openmusic.ico');
const { TRAY_LYRICS_BOUNDS, shouldHideToTray } = require('./windowBehavior.cjs');
Menu.setApplicationMenu(null);
let mainWindow;
let tray;
let isQuitting = false;
let lyricsWindow;
let lastLyrics = { title: 'OpenMusic', artist: '', source: '', pic: '', activeText: '暂无歌词', translation: '', nextText: '' };

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#09090b',
    icon: appIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (shouldHideToTray(isQuitting)) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  void mainWindow.loadURL(appUrl);
}

function positionLyricsWindow() {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  const workArea = screen.getPrimaryDisplay().workArea;
  const [width, height] = lyricsWindow.getSize();
  lyricsWindow.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.max(workArea.y, Math.round(workArea.y + workArea.height - height - 12)),
  );
}

function createLyricsWindow() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) { positionLyricsWindow(); lyricsWindow.show(); return; }
  lyricsWindow = new BrowserWindow({
    width: TRAY_LYRICS_BOUNDS.width,
    height: TRAY_LYRICS_BOUNDS.height,
    minWidth: 560,
    minHeight: TRAY_LYRICS_BOUNDS.height,
    maxHeight: 110,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    icon: appIcon,
    title: 'OpenMusic 桌面歌词',
    webPreferences: {
      preload: path.join(__dirname, 'lyrics-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lyricsWindow.on('closed', () => { lyricsWindow = undefined; mainWindow?.webContents.send('lyrics-closed'); });
  lyricsWindow.on('resize', positionLyricsWindow);
  positionLyricsWindow();
  lyricsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void lyricsWindow.loadFile(path.join(__dirname, 'lyrics.html')).then(() => {
    lyricsWindow?.webContents.send('lyrics-update', lastLyrics);
  });
}

function sanitizeLyrics(value) {
  const text = (input, max) => typeof input === 'string' ? input.slice(0, max) : '';
  let pic = text(value?.pic, 2048);
  if (pic) {
    try {
      pic = new URL(pic, appUrl).protocol.match(/^https?:$/) ? new URL(pic, appUrl).href : '';
    } catch {
      pic = '';
    }
  }
  return {
    title: text(value?.title, 160), artist: text(value?.artist, 160), source: text(value?.source, 32), pic,
    activeText: text(value?.activeText, 500) || '暂无歌词', translation: text(value?.translation, 500), nextText: text(value?.nextText, 500),
  };
}

ipcMain.handle('lyrics-open', () => { createLyricsWindow(); });
ipcMain.handle('lyrics-close', () => { if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.close(); });
ipcMain.on('lyrics-update', (_event, value) => { lastLyrics = sanitizeLyrics(value); if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.webContents.send('lyrics-update', lastLyrics); });

ipcMain.handle('app-show-main', () => { mainWindow?.show(); mainWindow?.focus(); });
ipcMain.handle('app-quit', () => { isQuitting = true; app.quit(); });

function createTray() {
  tray = new Tray(appIcon);
  tray.setToolTip('OpenMusic');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 OpenMusic', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '打开桌面歌词', click: () => createLyricsWindow() },
    { type: 'separator' },
    { label: '退出 OpenMusic', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

app.whenReady().then(() => {
  createMainWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); else mainWindow?.show(); });
});
app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
