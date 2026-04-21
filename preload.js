const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cnc', {
  clipboardReadText() {
    try {
      return clipboard.readText() || '';
    } catch (_) {
      return '';
    }
  },
  settings: {
    setSelectedJson(fileName) {
      try {
        ipcRenderer.send('settings:setSelectedJson', String(fileName || ''));
      } catch (_) {}
    },
    getSelectedJson() {
      try {
        return ipcRenderer.invoke('settings:getSelectedJson');
      } catch (_) {
        return Promise.resolve('');
      }
    },
  },
});