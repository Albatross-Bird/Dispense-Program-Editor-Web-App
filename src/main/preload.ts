import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () =>
    ipcRenderer.invoke('dialog:openFile'),
  saveFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('dialog:saveFile', filePath, content),
  saveFileAs: (content: string, defaultPath?: string) =>
    ipcRenderer.invoke('dialog:saveFileAs', content, defaultPath),
  loadImage: () =>
    ipcRenderer.invoke('dialog:loadImage'),
  storeGet: (key: string) =>
    ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('store:set', key, value),
});
