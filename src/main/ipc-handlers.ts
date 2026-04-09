import { ipcMain, dialog } from 'electron';
import Store from 'electron-store';
import { readPrgFile, writePrgFileAtomic, readImageAsBase64 } from './file-io';

const store = new Store<Record<string, unknown>>();

export function registerIpcHandlers(): void {
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
    const data = await readImageAsBase64(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/bmp';
    return { filePath, data, mime };
  });

  ipcMain.handle('store:get', (_event, key: string) => store.get(key));
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });
}
