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
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  readImage: (filePath: string) =>
    ipcRenderer.invoke('fs:readImage', filePath),
  storeGet: (key: string) =>
    ipcRenderer.invoke('store:get', key),
  storeSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('store:set', key, value),
  getProfiles: () =>
    ipcRenderer.invoke('get-profiles'),
  getUserProfilesDir: () =>
    ipcRenderer.invoke('get-user-profiles-dir'),
  reloadProfiles: () =>
    ipcRenderer.invoke('reload-profiles'),
  openPath: (path: string) =>
    ipcRenderer.invoke('open-path', path),
});
