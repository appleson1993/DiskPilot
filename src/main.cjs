const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { validateRequest } = require('./model.cjs');
let window, busy = false, inventory;
const plans = new Map();
const uiFile = path.join(__dirname, 'index.html');
const isSmoke = process.argv.includes('--smoke-test');
const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function verify(event) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(uiFile).href) throw new Error('來源不受信任');
}
async function native(action, payload = {}) {
  const jobs = path.join(app.getPath('userData'), 'jobs');
  await fs.mkdir(jobs, { recursive: true });
  const input = path.join(jobs, `${randomUUID()}.json`);
  await fs.writeFile(input, JSON.stringify(payload), 'utf8');
  const script = app.isPackaged ? path.join(process.resourcesPath, 'native', 'disk.ps1') : path.join(__dirname, '..', 'native', 'disk.ps1');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(psExe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-InputFile', input], { windowsHide: true });
      let out = '', err = '';
      child.stdout.on('data', d => { out += d.toString('utf8'); });
      child.stderr.on('data', d => { err += d.toString('utf8'); });
      child.on('error', reject);
      child.on('close', code => {
        try {
          const marker = out.lastIndexOf('DISKPILOT_JSON:');
          if (marker < 0) throw new Error(err.trim() || `Windows 操作未完成 (${code})`);
          const result = JSON.parse(out.slice(marker + 15).trim());
          if (!result.ok) throw new Error(result.error);
          resolve(result.data);
        } catch (error) { reject(error); }
      });
    });
  } finally { await fs.unlink(input).catch(() => {}); }
}
async function readHistory() {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'history.json'), 'utf8')); } catch { return []; }
}
async function appendHistory(entry) {
  const history = await readHistory();
  history.unshift({ ...entry, time: new Date().toISOString() });
  await fs.writeFile(path.join(app.getPath('userData'), 'history.json'), JSON.stringify(history.slice(0, 100), null, 2));
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    verify(event);
    try { return { ok: true, data: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1400, height: 940, minWidth: 1100, minHeight: 760, frame: false, backgroundColor: '#f5f7f9', icon: path.join(__dirname, '..', 'assets', 'icon.ico'), show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  window.on('close', event => { if (busy) { event.preventDefault(); dialog.showMessageBox(window, { type: 'info', message: '磁碟操作進行中，請等候完成後再關閉。' }); } });
  for (const [name, fn] of [['minimize', () => window.minimize()], ['maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize()], ['close', () => window.close()]]) ipcMain.on(`window:${name}`, event => { verify(event); fn(); });
  handle('disk:scan', async () => { if (busy) throw new Error('操作進行中'); inventory = await native('scan'); return inventory; });
  handle('disk:limits', async target => {
    if (busy) throw new Error('操作進行中');
    if (!target || !Number.isSafeInteger(target.diskNumber) || !Number.isSafeInteger(target.partitionNumber)) throw new Error('無效的分割區');
    return native('limits', { diskNumber: target.diskNumber, partitionNumber: target.partitionNumber });
  });
  handle('disk:plan', async request => {
    if (busy) throw new Error('操作進行中');
    const clean = validateRequest(request);
    const plan = await native('plan', clean);
    const id = randomUUID(); plans.clear(); plans.set(id, { ...plan, createdAt: Date.now() });
    return { ...plan, id };
  });
  handle('disk:apply', async (id, phrase) => {
    if (busy) throw new Error('另一項操作進行中');
    const plan = plans.get(id);
    if (!plan || Date.now() - plan.createdAt > 10 * 60 * 1000) throw new Error('操作預覽已到期，請重新準備');
    if (plan.destructive && phrase !== plan.confirmation) throw new Error('確認文字不正確');
    busy = true;
    try {
      const answer = await dialog.showMessageBox(window, { type: 'warning', title: '套用磁碟變更', message: plan.title, detail: `${plan.summary}\n\n${plan.warning}\n\n開始後無法取消，請保持電源連接。`, buttons: ['返回', '套用變更'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) return { cancelled: true };
      plans.delete(id);
      const result = await native('apply', plan);
      await appendHistory({ title: plan.title, status: 'success', detail: result.message, diskNumber: plan.request.diskNumber }).catch(() => { result.message += ' 操作成功，但無法寫入紀錄。'; });
      return result;
    } catch (error) {
      await appendHistory({ title: plan.title, status: 'error', detail: error.message, diskNumber: plan.request.diskNumber }).catch(() => {});
      throw error;
    } finally { busy = false; }
  });
  handle('disk:history', readHistory);
  handle('disk:export', async () => {
    if (!inventory) throw new Error('請先讀取磁碟');
    const result = await dialog.showSaveDialog(window, { defaultPath: `DiskPilot-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), inventory, history: await readHistory() }, null, 2));
    return true;
  });
  handle('app:elevate', async () => {
    if (busy) throw new Error('操作進行中');
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const args = app.isPackaged ? '' : app.getAppPath();
    const command = `Start-Process -FilePath '${exe.replaceAll("'", "''")}' ${args ? `-ArgumentList '"${args.replaceAll("'", "''")}"'` : ''} -Verb RunAs -WindowStyle Hidden`;
    await new Promise((resolve, reject) => {
      const p = spawn(psExe, ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true });
      p.on('error', reject); p.on('close', code => code === 0 ? resolve() : reject(new Error('未取得管理員權限')));
    });
    app.quit(); return true;
  });
  window.loadFile(uiFile);
  window.once('ready-to-show', () => window.show());
  if (isSmoke) {
    const smokeFolder = process.env.DISKPILOT_SMOKE_DIR;
    window.webContents.on('did-finish-load', async () => {
      try {
        const data = await native('scan');
        await fs.mkdir(smokeFolder, { recursive: true });
        await fs.writeFile(path.join(smokeFolder, 'scan.json'), JSON.stringify(data, null, 2));
        await new Promise(resolve => setTimeout(resolve, 6000));
        const png = await window.webContents.capturePage();
        await fs.writeFile(path.join(smokeFolder, 'screenshot.png'), png.toPNG());
        await fs.writeFile(path.join(smokeFolder, 'smoke.json'), JSON.stringify({ ok: true, disks: data.disks.length, title: window.getTitle() }));
      } catch (error) { await fs.writeFile(path.join(smokeFolder, 'smoke.json'), JSON.stringify({ ok: false, error: error.message })); }
      if (!process.argv.includes('--keep-open')) app.quit();
    });
  }
});
app.on('window-all-closed', () => app.quit());
