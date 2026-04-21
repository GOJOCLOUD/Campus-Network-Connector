const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

const BACKEND_PORT = 51888;
let backendProcess = null;

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

app.on('ready', () => {
  createWindow();
  ensureBackendStarted().then((ok) => {
    if (!ok) {
      dialog.showErrorBox(
        '后端启动失败',
        '无法启动内嵌 Python 后端。请完全退出应用后重试；若仍失败请重新下载安装包。'
      );
    }
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
