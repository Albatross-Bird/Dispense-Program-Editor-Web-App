import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'path';
import { registerIpcHandlers } from './ipc-handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import started from 'electron-squirrel-startup';
if (started) app.quit();

// In development, watch the built output and restart Electron on changes.
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  require('electron-reload')(__dirname, {
    electron: process.execPath,
    forceHardReset: true,
    hardResetMethod: 'exit',
  });
}

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // defer show until renderer has painted (eliminates blank-window flash)
    backgroundColor: '#1f2937', // match app background so any brief flash is the right colour
    icon: join(app.getAppPath(), 'MYE.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show the window only once the renderer has finished its first paint.
  win.once('ready-to-show', () => win.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
