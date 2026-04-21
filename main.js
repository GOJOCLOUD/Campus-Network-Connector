const { app, BrowserWindow, dialog, globalShortcut, ipcMain, clipboard } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const BACKEND_PORT = 51888;
let backendProcess = null;
let selectedJsonSetting = '';
let pinyinTextSetting = '';
let pinyinSourcesSetting = { button: 'textbox', shortcut: 'clipboard' };
let autoSwitchImeSetting = true;
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

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
  } catch (_) {}
}

function saveSettings() {
  try {
    const fp = SETTINGS_FILE();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(
      fp,
      JSON.stringify(
        {
          selectedJson: selectedJsonSetting,
          pinyinText: pinyinTextSetting,
          pinyinSources: pinyinSourcesSetting,
          autoSwitchIme: autoSwitchImeSetting,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch (_) {}
}

function httpJson(method, url, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + (u.search || ''),
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : undefined,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf || '{}'));
          } catch (e) {
            resolve({ status: 'error', message: 'invalid json', raw: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy(new Error('timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function resolveBackendDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'backend'),
    path.join(__dirname, 'backend'),
    path.join(process.resourcesPath || '', 'app', 'backend'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'main.py'))) return dir;
  }
  return candidates[0];
}

function embeddedPythonPaths() {
  const prefix = ['python-runtime', 'python'];
  const bin = process.platform === 'win32' ? 'python.exe' : 'python3';
  const rel = [...prefix, 'bin', bin];
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, ...rel)];
  }
  return [path.join(__dirname, ...rel)];
}

function resolvePythonExecutable() {
  for (const p of embeddedPythonPaths()) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      return { exe: p, pythonHome: path.join(path.dirname(p), '..') };
    }
  }
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'ignore' });
      return { exe: cmd, pythonHome: null };
    } catch (_) {}
  }
  return { exe: 'python3', pythonHome: null };
}

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/api/health`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).status === 'success');
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

async function waitBackendReady(maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkBackendHealth()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureBackendStarted() {
  if (await checkBackendHealth()) return true;

  const backendDir = resolveBackendDir();
  const { exe: pythonExe, pythonHome } = resolvePythonExecutable();

  console.log(`[backend] dir=${backendDir} python=${pythonExe} PYTHONHOME=${pythonHome || '(system)'}`);

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
  };
  if (pythonHome) {
    env.PYTHONHOME = path.resolve(pythonHome);
    env.PYTHONNOUSERSITE = '1';
  }

  backendProcess = spawn(pythonExe, ['-u', 'main.py'], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on('data', (d) => process.stderr.write(`[backend-err] ${d}`));
  backendProcess.on('error', (err) => console.error(`[backend] spawn error: ${err.message}`));
  backendProcess.on('exit', (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });

  return waitBackendReady();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 460,
    minHeight: 560,
    frame: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    transparent: false,
    backgroundColor: '#ffffff',
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

async function triggerDefaultExecute() {
  const ok = await ensureBackendStarted();
  if (!ok) return;

  let fileName = (selectedJsonSetting || '').trim();
  if (!fileName) {
    const data = await httpJson('GET', `http://127.0.0.1:${BACKEND_PORT}/api/files`);
    const files = Array.isArray(data.files) ? data.files : [];
    if (!files.length) return;
    fileName = [...files].sort((a, b) => (a.name < b.name ? 1 : -1))[0].name;
  }

  await httpJson('POST', `http://127.0.0.1:${BACKEND_PORT}/api/play`, {
    json_file: fileName,
    interval: 0.5,
    input_text: '',
  });
}

async function triggerPinyinFromClipboard() {
  const ok = await ensureBackendStarted();
  if (!ok) return;
  const source = pinyinSourcesSetting?.shortcut === 'textbox' ? 'textbox' : 'clipboard';
  const t = (source === 'textbox' ? pinyinTextSetting : clipboard.readText() || '').trim();
  if (!t) return;
  await httpJson('POST', `http://127.0.0.1:${BACKEND_PORT}/api/pinyin_input`, {
    text: t,
    initial_delay_seconds: 3,
    auto_switch_ime: !!autoSwitchImeSetting,
  });
}

function registerShortcuts() {
  // 用户要求：A+D / A+S（Electron globalShortcut 语法为组合键，不是“先按A再按D”）
  const ok1 = globalShortcut.register('A+D', () => {
    triggerDefaultExecute().catch((e) => console.error('[shortcut] default execute failed', e));
  });
  const ok2 = globalShortcut.register('A+S', () => {
    triggerPinyinFromClipboard().catch((e) => console.error('[shortcut] pinyin failed', e));
  });
  console.log(`[shortcut] register A+D=${ok1} A+S=${ok2}`);
}

app.on('ready', () => {
  loadSettings();

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

  createWindow();
  ensureBackendStarted().then((ok) => {
    if (!ok) {
      dialog.showErrorBox(
        '后端启动失败',
        '无法启动内嵌 Python 后端。请完全退出应用后重试；若仍失败请重新下载安装包。'
      );
      return;
    }
    registerShortcuts();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
