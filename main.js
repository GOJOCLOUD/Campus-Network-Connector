const { app, BrowserWindow, dialog, globalShortcut, ipcMain, clipboard } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const BACKEND_PORT = 51888;
let mainWindow = null;
let backendProcess = null;
let selectedJsonSetting = '';
let pinyinTextSetting = '';
let pinyinSourcesSetting = { button: 'textbox', shortcut: 'clipboard' };
let autoSwitchImeSetting = true;
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

const BACKEND_RESTART_MAX = 3;
let backendRestartCount = 0;

// 单实例锁：防止启动多个进程抢端口
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

// 启动前清理占着 51888 端口的孤儿进程
function killOrphanProcesses() {
  try {
    execSync(`lsof -ti tcp:${BACKEND_PORT} 2>/dev/null | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
  } catch (_) {}
}

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
    PYTHON: pythonExe,
  };
  if (pythonHome) {
    env.PYTHONHOME = path.resolve(pythonHome);
    env.PYTHONNOUSERSITE = '1';
  }

  for (let attempt = 0; attempt <= BACKEND_RESTART_MAX; attempt++) {
    if (attempt > 0) {
      console.log(`[backend] restart attempt ${attempt}/${BACKEND_RESTART_MAX}...`);
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 启动前确保端口没有被残留进程占用
    killOrphanProcesses();

    const proc = spawn(pythonExe, ['-u', 'main.py'], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[backend-err] ${d}`));
    proc.on('error', (err) => console.error(`[backend] spawn error: ${err.message}`));

    if (await waitBackendReady()) {
      // 成功——挂上退出清理，替换旧进程引用
      if (backendProcess && !backendProcess.killed) backendProcess.kill();
      backendProcess = proc;
      backendProcess.on('exit', (code) => {
        console.log(`[backend] exited with code ${code}`);
        backendProcess = null;
      });
      return true;
    }

    // 没起来 —— 杀掉再试
    if (!proc.killed) proc.kill();
  }

  return false;
}

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
    // 快捷键触发：不需要等待，直接开始输入
    initial_delay_seconds: 0,
    auto_switch_ime: !!autoSwitchImeSetting,
  });
}

function registerShortcuts() {
  // 快捷键说明：
  // 统一使用 Ctrl+Shift 避免 macOS Option 冲突
  // 注意 Ctrl 在 macOS 对应键盘左下角的 control 键，不是 Cmd
  const ok1 = globalShortcut.register('Ctrl+Shift+A', () => {
    triggerDefaultExecute().catch((e) => console.error('[shortcut] default execute failed', e));
  });
  const ok2 = globalShortcut.register('Ctrl+Shift+D', () => {
    triggerPinyinFromClipboard().catch((e) => console.error('[shortcut] pinyin failed', e));
  });
  console.log(`[shortcut] register Ctrl+Shift+A=${ok1} (默认执行) Ctrl+Shift+D=${ok2} (自动输入)`);
}

app.on('ready', () => {
  loadSettings();

  ipcMain.handle('window:quit', () => { app.quit(); });
  ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });

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
  app.quit();
});

app.on('before-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
  killOrphanProcesses();
});
