// =============== PYTHON RADIO MONITOR MANAGEMENT ===============
const { ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

let pythonMonitorProcess = null;
let pythonMonitorLogs = [];
const MAX_MONITOR_LOGS = 500;
let monitorStartTime = null;
let monitorCaptureCount = 0;
let monitorAutoRestartAttempts = 0;
const MAX_AUTO_RESTART_ATTEMPTS = 3;
const AUTO_RESTART_DELAYS = [15000, 30000, 45000];

let _getMainWindow = null;
let _app = null;
let _machineId = null;

function getPythonCommand() {
  return new Promise((resolve) => {
    exec('python --version', (err) => {
      if (!err) return resolve('python');
      exec('python3 --version', (err2) => {
        if (!err2) return resolve('python3');
        resolve(null);
      });
    });
  });
}

function getMonitorScriptPath() {
  const app = _app;

  if (!app.isPackaged) {
    return path.join(__dirname, '..', '..', 'public', 'radio_monitor_supabase.py');
  }

  const userDataPath = path.join(app.getPath('userData'), 'radio_monitor_supabase.py');
  const possiblePaths = [
    userDataPath,
    path.join(process.resourcesPath, 'app', 'public', 'radio_monitor_supabase.py'),
    path.join(app.getAppPath(), 'public', 'radio_monitor_supabase.py'),
    path.join(process.resourcesPath, 'app.asar', 'dist', 'radio_monitor_supabase.py'),
    path.join(process.resourcesPath, 'app', 'dist', 'radio_monitor_supabase.py'),
    path.join(app.getAppPath(), 'dist', 'radio_monitor_supabase.py'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }

  return userDataPath;
}

function addMonitorLog(line) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  const entry = `[${timestamp}] ${line}`;
  pythonMonitorLogs.push(entry);
  if (pythonMonitorLogs.length > MAX_MONITOR_LOGS) {
    pythonMonitorLogs = pythonMonitorLogs.slice(-MAX_MONITOR_LOGS);
  }
  if (line.includes('scraped_songs') || line.includes('☁️') || line.includes('radio_historico')) {
    monitorCaptureCount++;
  }
  const mainWindow = _getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('monitor-log', entry);
  }
}

async function startPythonMonitor(isAutoStart = false) {
  if (pythonMonitorProcess) {
    console.log('[MONITOR] Already running, ignoring start request');
    return { success: false, error: 'Monitor já está em execução' };
  }

  const pythonCmd = await getPythonCommand();
  if (!pythonCmd) {
    const msg = 'Python não encontrado. Instale Python para usar o monitor.';
    console.error('[MONITOR]', msg);
    addMonitorLog('❌ ' + msg);
    return { success: false, error: msg };
  }

  const scriptPath = getMonitorScriptPath();
  if (!fs.existsSync(scriptPath)) {
    const msg = `Script não encontrado: ${scriptPath}`;
    console.error('[MONITOR]', msg);
    addMonitorLog('❌ ' + msg);
    return { success: false, error: msg };
  }

  console.log(`[MONITOR] Starting: ${pythonCmd} ${scriptPath}`);
  addMonitorLog(`🚀 Iniciando monitor... (${pythonCmd})`);

  try {
    pythonMonitorProcess = spawn(pythonCmd, ['-u', scriptPath, '--machine-id', _machineId], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });

    monitorStartTime = Date.now();
    monitorCaptureCount = 0;
    monitorAutoRestartAttempts = isAutoStart ? monitorAutoRestartAttempts : 0;

    pythonMonitorProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => addMonitorLog(line));
    });

    pythonMonitorProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => addMonitorLog('⚠️ ' + line));
    });

    pythonMonitorProcess.on('close', (code) => {
      const msg = `Monitor encerrado (código: ${code})`;
      console.log(`[MONITOR] ${msg}`);
      addMonitorLog(`🔴 ${msg}`);
      pythonMonitorProcess = null;

      const mainWindow = _getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor-status', getMonitorStatus());
      }

      // Only auto-restart on non-zero, non-null exit codes (null = killed intentionally by before-quit)
      if (code !== 0 && code !== null && monitorAutoRestartAttempts < MAX_AUTO_RESTART_ATTEMPTS) {
        const delay = AUTO_RESTART_DELAYS[monitorAutoRestartAttempts] || 45000;
        monitorAutoRestartAttempts++;
        addMonitorLog(`🔄 Auto-restart ${monitorAutoRestartAttempts}/${MAX_AUTO_RESTART_ATTEMPTS} em ${delay / 1000}s...`);
        setTimeout(() => startPythonMonitor(true), delay);
      }
    });

    pythonMonitorProcess.on('error', (err) => {
      console.error('[MONITOR] Process error:', err.message);
      addMonitorLog('❌ Erro: ' + err.message);
      pythonMonitorProcess = null;
    });

    setTimeout(() => {
      const mainWindow = _getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('monitor-status', getMonitorStatus());
      }
    }, 500);

    return { success: true };
  } catch (err) {
    console.error('[MONITOR] Failed to start:', err.message);
    addMonitorLog('❌ Falha ao iniciar: ' + err.message);
    return { success: false, error: err.message };
  }
}

function stopPythonMonitor() {
  if (!pythonMonitorProcess) {
    return { success: false, error: 'Monitor não está em execução' };
  }

  addMonitorLog('🛑 Parando monitor...');
  monitorAutoRestartAttempts = MAX_AUTO_RESTART_ATTEMPTS;

  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pythonMonitorProcess.pid} /T /F`);
    } else {
      pythonMonitorProcess.kill('SIGTERM');
    }
  } catch (e) {
    console.error('[MONITOR] Kill error:', e.message);
  }

  pythonMonitorProcess = null;
  monitorStartTime = null;
  return { success: true };
}

function getMonitorStatus() {
  const isRunning = pythonMonitorProcess !== null;
  return {
    isRunning,
    uptime: isRunning && monitorStartTime ? Math.floor((Date.now() - monitorStartTime) / 1000) : 0,
    captureCount: monitorCaptureCount,
    logCount: pythonMonitorLogs.length,
    autoRestartAttempts: monitorAutoRestartAttempts,
  };
}

function killMonitorProcess() {
  if (pythonMonitorProcess) {
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${pythonMonitorProcess.pid} /T /F`);
      } else {
        pythonMonitorProcess.kill('SIGTERM');
      }
    } catch (e) {
      console.error('[MONITOR] Kill on quit error:', e.message);
    }
    pythonMonitorProcess = null;
  }
}

function register({ app, getMainWindow, safeHandle, machineId }) {
  _app = app;
  _getMainWindow = getMainWindow;
  _machineId = machineId;
  const handle = safeHandle || ipcMain.handle.bind(ipcMain);

  handle('start-python-monitor', async () => {
    return await startPythonMonitor(false);
  });

  handle('stop-python-monitor', () => {
    return stopPythonMonitor();
  });

  handle('restart-python-monitor', async () => {
    stopPythonMonitor();
    await new Promise(resolve => setTimeout(resolve, 2000));
    monitorAutoRestartAttempts = 0;
    return await startPythonMonitor(false);
  });

  handle('get-monitor-status', () => {
    return getMonitorStatus();
  });

  handle('get-monitor-logs', () => {
    return pythonMonitorLogs;
  });
}

module.exports = {
  register,
  startPythonMonitor,
  stopPythonMonitor,
  getMonitorStatus,
  killMonitorProcess,
};
