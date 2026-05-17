const { app, BrowserWindow, dialog, globalShortcut, ipcMain, clipboard } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// ── Native CoreGraphics addon ──
const mac = require('./mac-coregraphics');

// ── Paths ──
const BACKEND_DIR = path.join(__dirname, 'backend');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const INSTALL_ID_FILE = () => path.join(BACKEND_DIR, 'install.id');
const INPUT_SOURCE_CONFIG_FILE = () => path.join(BACKEND_DIR, 'input_source_config.json');

// ── App State ──
let mainWindow = null;
let selectedJsonSetting = '';
let pinyinTextSetting = '';
let pinyinSourcesSetting = { button: 'textbox', shortcut: 'clipboard' };
let autoSwitchImeSetting = true;
let keepaliveEnabledSetting = true;
let keepaliveTimer = null;

// ── Single Instance Lock ──
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.isMinimized() ? mainWindow.restore() : mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── Settings ──
function loadSettings() {
  try {
    const fp = SETTINGS_FILE();
    if (!fs.existsSync(fp)) return;
    const raw = fs.readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw || '{}');
    selectedJsonSetting = String(data.selectedJson || '');
    pinyinTextSetting = String(data.pinyinText || '');
    const src = data.pinyinSources || {};
    pinyinSourcesSetting = {
      button: src.button === 'clipboard' ? 'clipboard' : 'textbox',
      shortcut: src.shortcut === 'textbox' ? 'textbox' : 'clipboard',
    };
    autoSwitchImeSetting = typeof data.autoSwitchIme === 'boolean' ? data.autoSwitchIme : true;
    keepaliveEnabledSetting = typeof data.keepaliveEnabled === 'boolean' ? data.keepaliveEnabled : true;
  } catch (_) {}
}

function saveSettings() {
  try {
    const fp = SETTINGS_FILE();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify({
      selectedJson: selectedJsonSetting,
      pinyinText: pinyinTextSetting,
      pinyinSources: pinyinSourcesSetting,
      autoSwitchIme: autoSwitchImeSetting,
      keepaliveEnabled: keepaliveEnabledSetting,
    }, null, 2), 'utf-8');
  } catch (_) {}
}

// ── Keepalive ──
function pingNetwork() {
  return new Promise((resolve) => {
    const req = http.get('https://www.baidu.com', { timeout: 5000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(async () => {
    if (!keepaliveEnabledSetting) return;
    await pingNetwork();
  }, 180000); // 3 分钟
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

// ── Install ID ──
function getInstallId() {
  try {
    const fp = INSTALL_ID_FILE();
    if (fs.existsSync(fp)) {
      return fs.readFileSync(fp, 'utf-8').trim();
    }
    const id = crypto.randomUUID();
    fs.mkdirSync(BACKEND_DIR, { recursive: true });
    fs.writeFileSync(fp, id + '\n', 'utf-8');
    return id;
  } catch (_) {
    return crypto.randomUUID();
  }
}

// ── Input Source Config ──
function readInputSourceConfig() {
  try {
    if (fs.existsSync(INPUT_SOURCE_CONFIG_FILE())) {
      return JSON.parse(fs.readFileSync(INPUT_SOURCE_CONFIG_FILE(), 'utf-8') || '{}');
    }
  } catch (_) {}
  return {};
}

function writeInputSourceConfig(config) {
  try {
    fs.mkdirSync(BACKEND_DIR, { recursive: true });
    fs.writeFileSync(INPUT_SOURCE_CONFIG_FILE(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (_) {}
}

// ── File Management ──
function listClickFiles() {
  try {
    if (!fs.existsSync(BACKEND_DIR)) return [];
    return fs.readdirSync(BACKEND_DIR)
      .filter(f => f.endsWith('.json') && f !== 'input_source_config.json')
      .sort()
      .map((name, i) => ({ id: i + 1, name }));
  } catch (_) { return []; }
}

// ── Playback / Input — helper: spawn worker via subprocess ──
// We run clicks/text injection in the main process synchronously so there
// is no subprocess/Accessibility-permission-split issue.
// For long playback we use a timeout to keep UI responsive.

function sleepMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function playClicks(clicks, interval, inputs) {
  const perClickInputs = Array.isArray(inputs)
    ? inputs.map(i => (i && String(i).trim()) ? String(i).trim() : null)
    : null;

  for (let i = 0; i < clicks.length; i++) {
    const c = clicks[i];
    mac.mouseClick(c.x, c.y);
    await sleepMs(100);

    if (perClickInputs && perClickInputs[i]) {
      await sleepMs(100);
      mac.sendText(perClickInputs[i]);
    }

    if (i < clicks.length - 1) {
      await sleepMs(Math.max(50, interval * 1000));
    }
  }
}

async function pinyinType(text, delaySeconds = 3, autoSwitchIme = false) {
  if (text.length === 0) return;

  if (autoSwitchIme) {
    // Switch to ASCII input source if configured
    const config = readInputSourceConfig();
    if (config.ascii_id) {
      mac.selectInputSource(config.ascii_id);
    }
    await sleepMs(300);
  }

  if (delaySeconds > 0) {
    await sleepMs(delaySeconds * 1000);
  }

  mac.sendText(text);
}

// ── IPC Handlers ──

// Window controls (unchanged)
ipcMain.handle('window:quit', () => app.quit());
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});

// Settings (unchanged)
ipcMain.on('settings:setSelectedJson', (_e, fileName) => {
  selectedJsonSetting = String(fileName || '');
  saveSettings();
});
ipcMain.handle('settings:getSelectedJson', async () => selectedJsonSetting);
ipcMain.on('settings:setPinyinText', (_e, text) => {
  pinyinTextSetting = String(text || '');
  saveSettings();
});
ipcMain.on('settings:setPinyinSources', (_e, sources) => {
  const s = sources || {};
  pinyinSourcesSetting = {
    button: s.button === 'clipboard' ? 'clipboard' : 'textbox',
    shortcut: s.shortcut === 'textbox' ? 'textbox' : 'clipboard',
  };
  saveSettings();
});
ipcMain.on('settings:setAutoSwitchIme', (_e, enabled) => {
  autoSwitchImeSetting = !!enabled;
  saveSettings();
});

// Keepalive
ipcMain.handle('keepalive:getStatus', async () => keepaliveEnabledSetting);
ipcMain.on('keepalive:setEnabled', (_e, enabled) => {
  keepaliveEnabledSetting = !!enabled;
  saveSettings();
});

// Install ID
ipcMain.handle('getInstallId', async () => getInstallId());

// Mouse click
ipcMain.handle('native:mouseClick', async (_e, x, y) => {
  return mac.mouseClick(x, y);
});

// Mouse position
ipcMain.handle('native:mouseGetPosition', async () => {
  return mac.mouseGetPosition();
});

// Send text
ipcMain.handle('native:sendText', async (_e, text) => {
  return mac.sendText(String(text || ''));
});

// Send key
ipcMain.handle('native:sendKey', async (_e, keyCode, flags) => {
  return mac.sendKey(keyCode, flags || 0);
});

// Input source
ipcMain.handle('native:getCurrentInputSource', async () => {
  return mac.getCurrentInputSource();
});

ipcMain.handle('native:selectInputSource', async (_e, sourceId) => {
  return mac.selectInputSource(String(sourceId || ''));
});

// Input source config (saved in backend/input_source_config.json)
ipcMain.handle('native:getInputSourceConfig', async () => {
  return readInputSourceConfig();
});

ipcMain.handle('native:saveInputSourceConfig', async (_e, config) => {
  const current = readInputSourceConfig();
  if (config.ascii_id !== undefined) current.ascii_id = String(config.ascii_id || '');
  if (config.pinyin_id !== undefined) current.pinyin_id = String(config.pinyin_id || '');
  if (config.switch_shortcut !== undefined) current.switch_shortcut = String(config.switch_shortcut || 'cmd+space');
  writeInputSourceConfig(current);
  return current;
});

ipcMain.handle('native:setCurrentAsInputSource', async (_e, role) => {
  const info = mac.getCurrentInputSource();
  if (!info.id) return { status: 'error', message: '无法读取当前输入源 ID' };
  const config = readInputSourceConfig();
  if (role === 'ascii') config.ascii_id = info.id;
  else if (role === 'pinyin') config.pinyin_id = info.id;
  else return { status: 'error', message: '未知角色' };
  writeInputSourceConfig(config);
  return { status: 'success', message: '已保存', ...config };
});

// Recording
ipcMain.handle('native:startRecording', async (_e, excludeRect) => {
  try {
    mac.startRecording(excludeRect || [0, 0, 0, 0]);
    return true;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('native:stopRecording', async () => {
  mac.stopRecording();
  const clicks = mac.getRecordingClicks();
  mac.clearRecordingClicks();
  return Array.isArray(clicks) ? clicks : [];
});

ipcMain.handle('native:getRecordingClicks', async () => {
  return mac.getRecordingClicks();
});

ipcMain.handle('native:clearRecordingClicks', async () => {
  mac.clearRecordingClicks();
  return true;
});

ipcMain.handle('native:isRecording', async () => {
  return mac.isRecording();
});

ipcMain.handle('native:tapFailed', async () => {
  return mac.tapFailed();
});

// File management
ipcMain.handle('file:listFiles', async () => {
  return listClickFiles();
});

ipcMain.handle('file:saveFile', async (_e, clicks, filename) => {
  try {
    fs.mkdirSync(BACKEND_DIR, { recursive: true });
    let name = filename;
    if (!name || !name.endsWith('.json')) {
      name = `点击_${Date.now()}.json`;
    }
    const data = {
      start_time: new Date().toISOString(),
      click_count: clicks.length,
      clicks,
    };
    fs.writeFileSync(path.join(BACKEND_DIR, name), JSON.stringify(data, null, 2), 'utf-8');
    return { status: 'success', file: name };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:renameFile', async (_e, oldName, newName) => {
  try {
    let nn = newName;
    if (!nn.endsWith('.json')) nn += '.json';
    fs.renameSync(path.join(BACKEND_DIR, oldName), path.join(BACKEND_DIR, nn));
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:deleteFile', async (_e, filename) => {
  try {
    fs.unlinkSync(path.join(BACKEND_DIR, filename));
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:readFile', async (_e, filename) => {
  try {
    const data = fs.readFileSync(path.join(BACKEND_DIR, filename), 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

// Playback (runs asynchronously)
ipcMain.handle('play:playFile', async (_e, fileName, interval, inputText) => {
  try {
    const filePath = path.join(BACKEND_DIR, fileName);
    if (!fs.existsSync(filePath)) return { status: 'error', message: '文件不存在' };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const clicks = data.clicks || [];

    // Check per-click input_text first
    const perClick = clicks.map(c => c.input_text || null);
    const hasPerClick = perClick.some(t => t !== null);
    const inputs = hasPerClick ? perClick : (inputText ? [inputText] : null);

    playClicks(clicks, interval || 0.5, inputs).catch(e => console.error('[play] error:', e));
    return { status: 'success', message: '开始执行' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('play:playData', async (_e, clicks, interval) => {
  try {
    playClicks(clicks || [], interval || 0.5, null).catch(e => console.error('[play] error:', e));
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('play:pinyinInput', async (_e, text, delaySeconds, autoSwitchIme) => {
  pinyinType(text || '', delaySeconds, autoSwitchIme).catch(e => console.error('[pinyin] error:', e));
  return { status: 'success', message: `将在 ${delaySeconds || 3} 秒后开始输入` };
});

// ── Window Creation ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 460,
    minHeight: 560,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const indexPath = path.join(__dirname, 'dist', 'index.html');
  console.log(`[main] loading ${indexPath}`);
  mainWindow.loadFile(indexPath);

  return mainWindow;
}

// ── Shortcuts ──

async function triggerDefaultExecute() {
  let fileName = (selectedJsonSetting || '').trim();
  if (!fileName) {
    const files = listClickFiles();
    if (!files.length) return;
    fileName = [...files].sort((a, b) => (a.name < b.name ? 1 : -1))[0].name;
  }

  const filePath = path.join(BACKEND_DIR, fileName);
  if (!fs.existsSync(filePath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const clicks = data.clicks || [];
    const perClick = clicks.map(c => c.input_text || null);
    const hasPerClick = perClick.some(t => t !== null);
    const inputs = hasPerClick ? perClick : null;
    await playClicks(clicks, 0.5, inputs);
  } catch (e) {
    console.error('[trigger] play error:', e);
  }
}

async function triggerPinyinFromClipboard() {
  const source = pinyinSourcesSetting?.shortcut === 'textbox' ? 'textbox' : 'clipboard';
  const t = (source === 'textbox' ? pinyinTextSetting : clipboard.readText() || '').trim();
  if (!t) return;

  await pinyinType(t, 0, !!autoSwitchImeSetting);
}

function registerShortcuts() {
  const ok1 = globalShortcut.register('Ctrl+Shift+A', () => {
    triggerDefaultExecute().catch(e => console.error('[shortcut] default execute failed', e));
  });
  const ok2 = globalShortcut.register('Ctrl+Shift+D', () => {
    triggerPinyinFromClipboard().catch(e => console.error('[shortcut] pinyin failed', e));
  });
  console.log(`[shortcut] Ctrl+Shift+A=${ok1} Ctrl+Shift+D=${ok2}`);
}

// ── App Lifecycle ──

app.on('ready', () => {
  loadSettings();
  createWindow();
  registerShortcuts();
  startKeepalive();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (_) {}
  stopKeepalive();
});
