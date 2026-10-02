// Test-only IPC fixture. Excluded from the packaged app. No disk operations.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(()=>{
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'../../diskpilot-qa/scan.json'),'utf8'));
  fixture.admin = true;
  const c = fixture.disks.flatMap(d=>d.partitions).find(p=>p.letter==='C');
  const result = data => ({ok:true,data});
  ipcMain.handle('disk:scan',()=>result(fixture));
  ipcMain.handle('disk:limits',()=>result({min:48*1024**3,max:c.size,current:c.size,recovery:null,recoveryReason:'測試配置沒有足夠未配置空間'}));
  ipcMain.handle('disk:plan',(_e,q)=>result({id:'test-only-plan',request:q,title:'調整磁碟 0 / C: 容量',summary:`測試預覽：${(c.size/1024**3).toFixed(2)} GiB → ${(q.size/1024**3).toFixed(2)} GiB`,before:c.size,after:q.size,warning:'測試環境，不會修改磁碟。',destructive:false}));
  ipcMain.handle('disk:history',()=>result([]));
  const w=new BrowserWindow({width:1400,height:940,minWidth:1100,minHeight:760,frame:false,webPreferences:{preload:path.join(__dirname,'../src/preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  w.loadFile(path.join(__dirname,'../src/index.html'));
});
app.on('window-all-closed',()=>app.quit());
