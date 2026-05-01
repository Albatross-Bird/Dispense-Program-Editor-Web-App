import { ipcMain, dialog, shell } from 'electron';
import Store from 'electron-store';
import { readPrgFile, writePrgFileAtomic, readImageAsBuffer } from './file-io';
import { promises as fs } from 'fs';
import { loadAllProfiles, getUserProfilesDir } from './profile-loader';
import type { SyntaxProfile } from '../lib/syntax-profiles';

const store = new Store<Record<string, unknown>>();

let profileCache: SyntaxProfile[] | null = null;

export function registerIpcHandlers(): void {
  profileCache = loadAllProfiles();
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Program Files', extensions: ['prg'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = await readPrgFile(filePath);
    return { filePath, content };
  });

  ipcMain.handle('dialog:saveFile', async (_event, filePath: string, content: string) => {
    await writePrgFileAtomic(filePath, content);
    return filePath;
  });

  ipcMain.handle('dialog:saveFileAs', async (_event, content: string, defaultPath?: string) => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'Program Files', extensions: ['prg'] }],
      ...(defaultPath ? { defaultPath } : {}),
    });
    if (result.canceled || !result.filePath) return null;
    await writePrgFileAtomic(result.filePath, content);
    return result.filePath;
  });

  ipcMain.handle('dialog:loadImage', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['bmp', 'png'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const { buffer, mime } = await readImageAsBuffer(filePath);
    return { filePath, buffer, mime };
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:readImage', async (_event, filePath: string) => {
    try {
      const { buffer, mime } = await readImageAsBuffer(filePath);
      return { buffer, mime };
    } catch {
      return null;
    }
  });

  ipcMain.handle('store:get', (_event, key: string) => store.get(key));
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('get-profiles', () => profileCache);

  ipcMain.handle('get-user-profiles-dir', () => getUserProfilesDir());

  ipcMain.handle('reload-profiles', () => {
    profileCache = loadAllProfiles();
    return profileCache;
  });

  ipcMain.handle('open-path', (_event, p: string) => shell.openPath(p));
}
