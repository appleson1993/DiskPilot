const { _electron: electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.join(__dirname, '..');
  const output = path.join(root, '..', 'diskpilot-qa');
  await fs.mkdir(output, { recursive: true });
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(root,'node_modules/electron/dist/electron.exe'), args:[process.env.DISKPILOT_UI_FIXTURE ? path.join(__dirname,'ui-fixture-main.cjs') : root], env });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.locator('.disk-card').first().waitFor({timeout:45000});
    assert.match(await page.locator('#total-capacity').innerText(), /70.00/);
    assert.equal(await page.locator('.volume-letter').innerText(),'C');
    await page.screenshot({path:path.join(output,'dashboard.png')});
    const admin = (await page.locator('#admin').innerText()).includes('✓');
    if(admin){
      await page.locator('[data-action="resize"]').click();
      await page.locator('#size-range').waitFor({timeout:60000});
      const max=Number(await page.locator('#size-range').getAttribute('max'));
      const min=Number(await page.locator('#size-range').getAttribute('min'));
      assert.ok(max>=min);
      await page.locator('#target-size').fill(String(Math.floor((max-512)/1024*1000)/1000));
      await page.screenshot({path:path.join(output,'resize.png')});
      await page.locator('#prepare').click();
      await page.locator('#pending').waitFor({state:'visible',timeout:60000});
      assert.match(await page.locator('#pending').innerText(),/1 項待執行/);
      await page.locator('#discard').click();
      await page.locator('#pending').waitFor({state:'hidden'});
    }else{
      await page.locator('[data-action="resize"]').click();
      assert.match(await page.locator('#toast').innerText(),/管理員模式/);
    }
    await page.locator('.segment.recovery').click();
    assert.equal(await page.locator('.action-button').count(),0);
    await page.locator('[data-page="help"]').click();
    assert.equal(await page.locator('.guide-card').count(),4);
    await page.locator('[data-page="history"]').click();
    await page.locator('#history-list .empty-state, #history-list .history-card').first().waitFor();
    await page.locator('[data-page="disks"]').click();
    await page.getByRole('button',{name:/選擇 C:/}).click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,760));
    await page.screenshot({path:path.join(output,'compact.png')});
    assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,process.env.DISKPILOT_UI_FIXTURE?'ui-fixture-result.json':admin?'ui-admin-result.json':'ui-result.json'),JSON.stringify({ok:true,admin,fixture:!!process.env.DISKPILOT_UI_FIXTURE,checks:['disk view','partition selection','protected recovery','navigation','responsive 1100px',admin?'resize preview and pending plan (no apply)':'admin guard'],errors},null,2));
  }finally{await app.close();}
})().catch(async error=>{console.error(error);process.exitCode=1;});
