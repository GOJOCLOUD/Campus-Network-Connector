const { contextBridge, clipboard } = require('electron');

contextBridge.exposeInMainWorld('cnc', {
  clipboardReadText() {
    try {
      return clipboard.readText() || '';
    } catch (_) {
      return '';
    }
  },
});