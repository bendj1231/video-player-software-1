const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('wmplayer', {
  pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  saveDialog: (defaultName) => ipcRenderer.invoke('save-dialog', defaultName),
  getStorageDir: () => ipcRenderer.invoke('storage-get-dir'),
  setStorageDir: () => ipcRenderer.invoke('storage-set-dir'),
  getStorageStats: () => ipcRenderer.invoke('storage-stats'),
  listStorageFiles: () => ipcRenderer.invoke('storage-list'),
  saveFileToStorage: (relPath, data) => ipcRenderer.invoke('storage-save-file', relPath, data),
  importPaths: (paths, destDir) => ipcRenderer.invoke('storage-import', paths, destDir),
  importPick: () => ipcRenderer.invoke('storage-import-pick'),
  mkdirStorage: (name, parentRel) => ipcRenderer.invoke('storage-mkdir', name, parentRel),
  moveStoragePath: (src, dest) => ipcRenderer.invoke('storage-move', src, dest),
  renameStoragePath: (src, newName) => ipcRenderer.invoke('storage-rename', src, newName),
  deleteStoragePath: (relPath) => ipcRenderer.invoke('storage-delete', relPath),
  openStoragePath: (relPath) => ipcRenderer.invoke('storage-open-path', relPath),
  openInVlc: (relPath) => ipcRenderer.invoke('storage-open-vlc', relPath),
  trashStoragePaths: (relPaths) => ipcRenderer.invoke('storage-trash', relPaths),
  vlcStart: (relPath, width) => ipcRenderer.invoke('vlc-start', relPath, width),
  vlcCtl: (cmd) => ipcRenderer.invoke('vlc-ctl', cmd),
  vlcStop: () => ipcRenderer.invoke('vlc-stop'),
  onVlcFrame: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('vlc-frame', handler);
    return () => ipcRenderer.removeListener('vlc-frame', handler);
  },
  onVlcEnded: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('vlc-ended', handler);
    return () => ipcRenderer.removeListener('vlc-ended', handler);
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getThumbnail: (relPath) => ipcRenderer.invoke('storage-thumbnail', relPath),
  transcode: (relPath) => ipcRenderer.invoke('storage-transcode', relPath),
  onTranscodeDone: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('transcode-done', handler);
    return () => ipcRenderer.removeListener('transcode-done', handler);
  },
  storageUrl: (relPath) => 'media://local/' + relPath.split('/').map(encodeURIComponent).join('/'),
  platform: process.platform,
  isElectron: true,
});
