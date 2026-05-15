const { contextBridge, clipboard, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cnc', {
  quit() {
    try { ipcRenderer.invoke('window:quit'); } catch (_) {}
  },
  minimize() {
    try { ipcRenderer.invoke('window:minimize'); } catch (_) {}
  },
  maximize() {
    try { ipcRenderer.invoke('window:maximize'); } catch (_) {}
  },
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
    setPinyinText(text) {
      try {
        ipcRenderer.send('settings:setPinyinText', String(text || ''));
      } catch (_) {}
    },
    setPinyinSources(sources) {
      try {
        ipcRenderer.send('settings:setPinyinSources', sources || {});
      } catch (_) {}
    },
    setAutoSwitchIme(enabled) {
      try {
        ipcRenderer.send('settings:setAutoSwitchIme', !!enabled);
      } catch (_) {}
    },
  },
});