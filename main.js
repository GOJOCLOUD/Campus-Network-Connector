const { app, BrowserWindow, dialog, globalShortcut, ipcMain, clipboard } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const nacl = require('tweetnacl');

// ── Native CoreGraphics addon ──
const mac = require('./mac-coregraphics');

// ── Paths ──
const LEGACY_BACKEND_DIR = path.join(__dirname, 'backend');
const DATA_DIR = () => path.join(app.getPath('userData'), 'data');
const RECORDINGS_DIR = () => path.join(DATA_DIR(), 'recordings');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const INSTALL_ID_FILE = () => path.join(app.getPath('userData'), 'install.id');
const ACTIVATION_STATE_FILE = () => path.join(app.getPath('userData'), 'activation-state.json');
const INPUT_SOURCE_CONFIG_FILE = () => path.join(DATA_DIR(), 'input_source_config.json');
const ACTIVATION_PUBLIC_KEY_B64 = 'j5FyVLxHq1KZLNMrWYey+pfbq/wRSghcy7URZLmiYBU=';
const ACTIVATION_PRODUCT_ID = 'campus-network-connector';
const ACTIVATION_LICENSE_PREFIX = 'cs1';

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
  const fp = INSTALL_ID_FILE();
  if (fs.existsSync(fp)) {
    const existing = fs.readFileSync(fp, 'utf-8').trim();
    if (existing) return existing;
  }
  const id = crypto.randomUUID();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, id + '\n', 'utf-8');
  return id;
}

function readActivationState() {
  try {
    const fp = ACTIVATION_STATE_FILE();
    if (!fs.existsSync(fp)) return {};
    const raw = fs.readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (_) {
    return {};
  }
}

function writeActivationState(nextState) {
  const fp = ACTIVATION_STATE_FILE();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(nextState, null, 2), 'utf-8');
}

function getActivationSnapshot() {
  const state = readActivationState();
  let dirty = false;
  if (!state.deviceUuid) {
    state.deviceUuid = crypto.randomUUID();
    dirty = true;
  }
  if (!state.installId) {
    state.installId = getInstallId();
    dirty = true;
  }
  if (dirty) writeActivationState(state);
  const snapshot = {
    installId: String(state.installId || ''),
    deviceUuid: String(state.deviceUuid || ''),
    trialUsed: state.trialUsed === true,
    trialExpiresAt: Number(state.trialExpiresAt || 0) || 0,
    license: String(state.license || ''),
  };
  snapshot.licenseValid = snapshot.license
    ? verifyLicenseForDevice(snapshot.license, snapshot.deviceUuid).ok
    : false;
  return snapshot;
}

function updateActivationState(patch) {
  const snapshot = getActivationSnapshot();
  const current = {
    installId: snapshot.installId,
    deviceUuid: snapshot.deviceUuid,
    trialUsed: snapshot.trialUsed,
    trialExpiresAt: snapshot.trialExpiresAt,
    license: snapshot.license,
  };
  const next = { ...current, ...patch };
  writeActivationState(next);
  return getActivationSnapshot();
}

function b64urlToBuffer(value) {
  const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function normalizeUuidForLicense(uuid) {
  const raw = String(uuid || '').trim();
  if (!raw) throw new Error('UUID 不能为空');
  const hexOnly = raw.replace(/[^a-fA-F0-9]/g, '');
  if (hexOnly.length >= 24) return hexOnly.slice(0, 24).toLowerCase();
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function verifyLicenseForDevice(license, deviceUuid) {
  const parts = String(license || '').trim().split('.');
  if (parts.length !== 3) return { ok: false, error: '激活码格式不正确' };
  const [prefix, payloadB64Url, sigB64Url] = parts;
  if (prefix !== ACTIVATION_LICENSE_PREFIX) {
    return { ok: false, error: `激活码前缀不匹配（期望 ${ACTIVATION_LICENSE_PREFIX}）` };
  }
  let payloadBytes;
  let sigBytes;
  try {
    payloadBytes = b64urlToBuffer(payloadB64Url);
    sigBytes = b64urlToBuffer(sigB64Url);
  } catch (_) {
    return { ok: false, error: '激活码内容无法解析' };
  }
  const publicKey = Buffer.from(ACTIVATION_PUBLIC_KEY_B64, 'base64');
  if (!nacl.sign.detached.verify(payloadBytes, sigBytes, publicKey)) {
    return { ok: false, error: '激活码校验失败：签名不合法' };
  }
  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf-8') || '{}');
  } catch (_) {
    return { ok: false, error: '激活码 payload 不是有效 JSON' };
  }
  if (Number(payload?.v || 0) !== 1) return { ok: false, error: '激活码版本不支持' };
  if (String(payload?.product || '') !== ACTIVATION_PRODUCT_ID) {
    return { ok: false, error: '激活码 product 不匹配' };
  }
  if (String(payload?.device || '') !== normalizeUuidForLicense(deviceUuid)) {
    return { ok: false, error: '激活码设备不匹配' };
  }
  return { ok: true };
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
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    fs.writeFileSync(INPUT_SOURCE_CONFIG_FILE(), JSON.stringify(config, null, 2), 'utf-8');
  } catch (_) {}
}

// ── File Management ──
function migrateLegacyDataFiles() {
  try {
    fs.mkdirSync(RECORDINGS_DIR(), { recursive: true });
    if (!fs.existsSync(LEGACY_BACKEND_DIR)) return;

    for (const name of fs.readdirSync(LEGACY_BACKEND_DIR)) {
      const src = path.join(LEGACY_BACKEND_DIR, name);
      if (name === 'input_source_config.json') {
        if (!fs.existsSync(INPUT_SOURCE_CONFIG_FILE())) {
          fs.mkdirSync(DATA_DIR(), { recursive: true });
          fs.copyFileSync(src, INPUT_SOURCE_CONFIG_FILE());
        }
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const dest = path.join(RECORDINGS_DIR(), name);
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
  } catch (e) {
    console.error('[data] migration failed:', e);
  }
}

function listClickFiles() {
  try {
    migrateLegacyDataFiles();
    if (!fs.existsSync(RECORDINGS_DIR())) return [];
    return fs.readdirSync(RECORDINGS_DIR())
      .filter(f => f.endsWith('.json'))
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

// Activation
ipcMain.handle('activation:getSnapshot', async () => getActivationSnapshot());
ipcMain.handle('activation:startTrial', async (_e, expiresAt) => {
  const nextExpiry = Number(expiresAt || 0) || 0;
  if (nextExpiry <= Date.now()) {
    throw new Error('试用过期时间无效');
  }
  const current = getActivationSnapshot();
  if (current.trialUsed) return current;
  return updateActivationState({
    trialUsed: true,
    trialExpiresAt: nextExpiry,
  });
});
ipcMain.handle('activation:saveLicense', async (_e, license) => {
  const current = getActivationSnapshot();
  const result = verifyLicenseForDevice(license, current.deviceUuid);
  if (!result.ok) return result;
  updateActivationState({ license: String(license || '') });
  return { ok: true };
});
ipcMain.handle('activation:clearLicense', async () => {
  return updateActivationState({ license: '' });
});
ipcMain.handle('activation:migrateLegacy', async (_e, legacy) => {
  const current = getActivationSnapshot();
  if (current.trialUsed || current.trialExpiresAt || current.license) return current;
  const data = legacy && typeof legacy === 'object' ? legacy : {};
  return updateActivationState({
    deviceUuid: String(data.deviceUuid || current.deviceUuid),
    trialUsed: data.trialUsed === true,
    trialExpiresAt: Number(data.trialExpiresAt || 0) || 0,
    license: String(data.license || ''),
  });
});

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
    fs.mkdirSync(RECORDINGS_DIR(), { recursive: true });
    let name = filename;
    if (!name || !name.endsWith('.json')) {
      name = `点击_${Date.now()}.json`;
    }
    const data = {
      start_time: new Date().toISOString(),
      click_count: clicks.length,
      clicks,
    };
    fs.writeFileSync(path.join(RECORDINGS_DIR(), name), JSON.stringify(data, null, 2), 'utf-8');
    return { status: 'success', file: name };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:renameFile', async (_e, oldName, newName) => {
  try {
    let nn = newName;
    if (!nn.endsWith('.json')) nn += '.json';
    fs.renameSync(path.join(RECORDINGS_DIR(), oldName), path.join(RECORDINGS_DIR(), nn));
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:deleteFile', async (_e, filename) => {
  try {
    fs.unlinkSync(path.join(RECORDINGS_DIR(), filename));
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('file:readFile', async (_e, filename) => {
  try {
    const data = fs.readFileSync(path.join(RECORDINGS_DIR(), filename), 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
});

// Playback (runs asynchronously)
ipcMain.handle('play:playFile', async (_e, fileName, interval, inputText) => {
  try {
    const filePath = path.join(RECORDINGS_DIR(), fileName);
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
    frame: true,
    transparent: false,
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

  const filePath = path.join(RECORDINGS_DIR(), fileName);
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
  migrateLegacyDataFiles();
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
