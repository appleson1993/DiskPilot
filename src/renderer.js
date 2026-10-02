const icons = {
  drive: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 13h18M7 16h.01M10 16h.01"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M19 9A7 7 0 0 0 6 5M5 15a7 7 0 0 0 13 4"/>',
  cursor: '<path d="m5 3 14 11-7 1-3 7z"/>',
  resize: '<path d="M4 8v8M20 8v8M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3"/>',
  expand: '<path d="M4 9V4h5M15 4h5v5M4 15v5h5M15 20h5v-5M4 4l6 6M20 20l-6-6"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z"/>',
  erase: '<path d="m4 14 9-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 8H9zM9 9l9 8M14 20h7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  queue: '<path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>'
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.drive}</svg>`;
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GiB = 1024 ** 3, MiB = 1024 ** 2;
const format = (n) => n < GiB ? `${(n / MiB).toFixed(n < 10 * MiB ? 1 : 0)} MiB` : `${(n / GiB).toFixed(2)} GiB`;
const amount = (n) => (n / GiB).toFixed(2);
const state = { inventory: null, selected: null, pending: null, working: false, scanning: false, generation: 0, modalBusy: false };
function decorate() { $$('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); }); }
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = error ? 'error' : ''; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 4500);
}
async function api(method, ...args) {
  const result = await window.diskpilot[method](...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function selected() {
  if (!state.selected || !state.inventory) return {};
  const disk = state.inventory.disks.find(d => d.number === state.selected.disk);
  return { disk, part: disk?.partitions.find(p => p.number === state.selected.partition), gap: disk?.gaps.find(g => g.offset === state.selected.gap) };
}
function protectedPart(p) { return p.system || p.recovery || !p.letter || p.fileSystem !== 'NTFS'; }
async function refresh() {
  if (state.working || state.scanning) return;
  state.scanning = true; $('#refresh').disabled = true;
  try {
    state.inventory = await api('scan'); state.pending = null;
    if (!state.selected) {
      const system = state.inventory.disks.find(d => d.partitions.some(p => p.boot));
      if (system) state.selected = { disk: system.number, partition: system.partitions.find(p => p.boot).number };
    }
    const choice = selected(); if (!choice.part && !choice.gap) state.selected = null;
    render();
  } catch (error) {
    toast(error.message, true);
    $('#disk-list').innerHTML = `<div class="empty-state"><h3>暫時無法讀取磁碟</h3><p>${escape(error.message)}</p><p>請按「重新整理」再次嘗試。</p></div>`;
    $('#footer-status').textContent = '掃描失敗';
  } finally { $('#refresh').disabled = false; state.scanning = false; }
}
function render() {
  const data = state.inventory; if (!data) return;
  const disks = data.disks;
  let total = 0, free = 0;
  for (const d of disks) { total += d.size; free += d.partitions.reduce((s,p) => s + (p.free || 0), 0) + d.gaps.reduce((s,g) => s + g.size, 0); }
  const pct = total ? Math.round(free / total * 100) : 0;
  $('#total-capacity').innerHTML = `${amount(total)} <small>GiB</small>`;
  $('#total-free').textContent = format(free); $('#total-used').textContent = format(total - free);
  $('#free-percent').textContent = `${pct}%`; $('#donut').style.background = `conic-gradient(#91cdb1 0% ${pct}%,#365d61 ${pct}% 100%)`;
  $('#disk-count').textContent = `${disks.length} 個磁碟`; $('#disk-tab-count').textContent = disks.length;
  $('#computer').textContent = data.computer; $('#admin').textContent = data.admin ? '✓ 管理員模式' : '↗ 開啟管理員模式';
  $('#admin').title = data.admin ? '已具備磁碟修改權限' : '修改磁碟需要管理員權限';
  const healthy = disks.every(d => d.health === 'Healthy' && !d.offline);
  $('#health-title').textContent = healthy ? '一切就緒' : '需要留意';
  $('#health-detail').textContent = healthy ? 'Windows 回報所有磁碟狀態良好' : '部分磁碟離線或健康狀態異常';
  $('#scan-time').textContent = `最近掃描 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  $('#footer-status').textContent = data.admin ? '已連接 Windows 儲存服務 · 變更前會再次確認' : '瀏覽模式 · 修改磁碟需管理員權限';
  if (!disks.length) $('#disk-list').innerHTML = '<div class="empty-state"><h3>未找到可管理的磁碟</h3><p>連接磁碟後按「重新整理」。</p></div>';
  else $('#disk-list').innerHTML = disks.map(renderDisk).join('');
  $$('[data-select]').forEach(el => {
    const choose = () => { state.selected = JSON.parse(el.dataset.select); render(); };
    el.addEventListener('click', choose);
    if (el.tagName === 'TR') el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
  });
  renderInspector(); renderPending();
}
function renderDisk(d) {
  const items = [...d.partitions.map(p => ({ ...p, isGap: false })), ...d.gaps.map(g => ({ ...g, isGap: true }))].sort((a,b) => a.offset-b.offset);
  const key = (p) => ({ disk: d.number, ...(p.isGap ? { gap: p.offset } : { partition: p.number }) });
  const isSelected = (p) => JSON.stringify(state.selected) === JSON.stringify(key(p));
  const title = (p) => p.isGap ? '未配置' : p.recovery ? '復原區' : p.system ? '系統保留' : p.letter ? `${p.letter}: ${p.label || (p.boot ? 'Windows' : '本機磁碟')}` : p.type === 'Reserved' ? '保留區' : `分割區 ${p.number}`;
  return `<article class="disk-card"><div class="disk-card-head"><div class="disk-id"><span class="disk-icon">${svg('drive')}</span><div><div class="disk-title">磁碟 ${d.number}<small>${d.offline ? '離線' : '線上'}</small></div><div class="disk-subtitle">${escape(d.name)} · ${escape(d.style)} · ${escape(d.bus)}</div></div></div><div class="disk-size">${amount(d.size)} <span>GiB</span></div></div>
    <div class="disk-map">${items.map(p => `<button title="${escape(title(p))} · ${format(p.size)}" aria-label="選擇 ${escape(title(p))}" data-select='${JSON.stringify(key(p))}' class="segment ${p.isGap?'gap':p.recovery?'recovery':p.system||!p.letter?'system':''} ${isSelected(p)?'selected':''}" style="flex-grow:${Math.max(.045,p.size/d.size)}"><strong>${escape(title(p))}</strong><small>${format(p.size)}</small></button>`).join('')}</div><p class="map-caption">點選分割區以管理 · 小型分割區以最小寬度顯示</p>
    <table class="partition-table"><thead><tr><th>分割區</th><th>容量</th><th>可用</th><th>檔案系統</th><th>狀態</th></tr></thead><tbody>${items.map(p => `<tr tabindex="0" data-select='${JSON.stringify(key(p))}' class="${isSelected(p)?'selected':''}"><td><i class="row-dot ${p.recovery||p.system?'purple':''}"></i>${escape(title(p))}</td><td>${format(p.size)}</td><td>${p.isGap?format(p.size):p.free!=null?format(p.free):'—'}</td><td>${p.isGap?'—':escape(p.fileSystem==='Unknown'?'—':p.fileSystem||'—')}</td><td>${p.isGap?'可配置':p.boot?'Windows 系統':p.recovery||p.system||!p.letter?'受保護':p.health==='Healthy'?'良好':escape(p.health||'—')}</td></tr>`).join('')}</tbody></table></article>`;
}
function renderInspector() {
  const { disk, part, gap } = selected();
  if (!disk || (!part && !gap)) { $('#inspector').innerHTML = `<div class="inspector-empty">${svg('cursor')}<h3>選擇一個分割區</h3><p>點選左側磁碟配置圖，<br>查看容量與可用操作。</p></div>`; return; }
  const p = part || gap, protectedTarget = part && protectedPart(part);
  const title = gap ? '未配置空間' : part.recovery ? 'Windows 復原區' : part.system ? '系統保留' : part.label || (part.boot ? 'Windows' : '本機磁碟');
  const action = (kind, icon, label, cls = '', disabled = false) => `<button class="action-button ${cls}" data-action="${kind}" ${disabled?'disabled':''}>${svg(icon)}${label}<span>›</span></button>`;
  let actions = gap ? action('create','plus','建立新分割區','featured') : protectedTarget ? '' : [action('resize','resize','調整容量','featured'), action('recoveryExtend','expand','跨復原區延伸','',!part.boot), action('rename','edit','重新命名'), action('format','erase','格式化','',part.boot), action('delete','trash','刪除分割區','danger-text',part.boot)].join('');
  const used = gap ? 0 : p.free == null ? 100 : Math.round((1-p.free/p.size)*100);
  $('#inspector').innerHTML = `<div class="inspector-top"><div class="inspector-caption">目前選取 ${svg(protectedTarget?'lock':'drive')}</div><div class="volume-heading"><div class="volume-letter">${gap?'+':part.letter?escape(part.letter):svg('shield')}</div><div><h3>${escape(title)}</h3><p>磁碟 ${disk.number} · ${gap?'未配置':escape(part.fileSystem||'系統')}</p></div></div><div class="inspector-stats"><span>${gap?'可配置容量':'使用率 '+used+'%'}</span><b>${format(p.size)}</b></div><div class="volume-progress"><i style="width:${used}%"></i></div></div><div class="actions">${actions}</div><p class="inspector-note">${protectedTarget?'此分割區用於啟動或復原 Windows，無法直接修改。':gap?'將未配置空間建立為新的 NTFS 磁碟槽。':'調整會先加入待執行清單，確認套用後才會變更磁碟。'}</p>`;
  $$('[data-action]').forEach(b => b.addEventListener('click', () => openAction(b.dataset.action)));
}
function renderPending() {
  const el = $('#pending'), p = state.pending; el.hidden = !p;
  if (!p) return;
  el.innerHTML = `<div class="pending-symbol">${svg('queue')}</div><div class="pending-copy"><strong>1 項待執行操作 · ${escape(p.title)}</strong><p>${escape(p.summary)}</p></div><button id="discard" class="text-link">移除</button><button id="apply" class="button primary">${svg('check')}套用變更</button>`;
  $('#discard').onclick = () => { state.pending = null; renderPending(); };
  $('#apply').onclick = confirmApply;
}
function closeModal() { if (state.modalBusy || state.working) return; $('#modal-backdrop').hidden = true; state.generation++; }
function modal(title, content, footer='') {
  $('#modal').innerHTML = `<div class="modal-top"><h2 id="modal-title">${title}</h2><button class="close-button" id="modal-close" aria-label="關閉對話框">×</button></div>${content}<div class="modal-footer">${footer}</div>`;
  $('#modal-backdrop').hidden = false; $('#modal-close').onclick = closeModal;
  $('#modal-cancel')?.addEventListener('click', closeModal);
  $('#modal').querySelector('input,select,button')?.focus();
}
function loading(message, detail='正在向 Windows 確認容量範圍，請稍候。') {
  modal(message, `<div class="loading-modal"><div class="spinner"></div><p>${detail}</p></div>`);
}
async function openAction(kind) {
  if (state.working || state.scanning) return;
  if (!state.inventory.admin) { toast('請先點選右上角「開啟管理員模式」。', true); return; }
  if (state.pending) { toast('請先套用或移除目前的待執行操作。', true); return; }
  const { disk, part, gap } = selected();
  if (!disk) return;
  const request = { kind, diskNumber: disk.number, ...(part ? { partitionNumber: part.number } : {}) };
  const generation = ++state.generation;
  if (kind === 'resize' || kind === 'recoveryExtend') {
    loading('正在確認可調整容量');
    try {
      const limits = await api('limits', request);
      if (generation !== state.generation) return;
      if (kind === 'recoveryExtend') {
        if (!limits.recovery) throw new Error(limits.recoveryReason);
        modal('跨復原區延伸', `<p class="modal-subtitle">保留 Windows 復原功能，將後方空間併入 ${escape(part.letter)}:。</p>${preview(limits.current,limits.recovery.size)}<div class="info-box warning-box">會先備份復原映像，再重建 ${format(limits.recovery.reserve)} 的復原區。此操作包含刪除舊復原分割區；請先備份重要資料。</div>`, '<button class="button secondary" id="modal-cancel">返回</button><button class="button primary" id="prepare">預覽變更</button>');
        $('#prepare').onclick = () => prepare(request);
      } else {
        const min = Math.ceil(limits.min/MiB)*MiB, max = Math.floor(limits.max/MiB)*MiB;
        const current = limits.current;
        modal('調整分割區容量', `<p class="modal-subtitle">磁碟 ${disk.number} / ${escape(part.letter)}: · 拖曳或輸入目標容量。</p>${preview(current,current)}<div class="form-row"><label for="target-size">調整後容量</label><div class="input-wrap"><input id="target-size" type="number" step="0.01" min="${min/GiB}" max="${max/GiB}" value="${(current/GiB).toFixed(3)}"><span>GiB</span></div><input aria-label="調整容量" id="size-range" class="range" type="range" min="${min/MiB}" max="${max/MiB}" value="${current/MiB}" step="1"><div class="range-labels"><span>最小 ${format(min)}</span><span>最大 ${format(max)}</span></div></div><div id="resize-hint" class="info-box">Windows 已提供可調整範圍。檔案位置可能限制可縮小的容量。</div>`, '<button class="button secondary" id="modal-cancel">取消</button><button class="button primary" id="prepare">加入待執行</button>');
        const update = (bytes) => {
          $('#preview-new').textContent = amount(bytes);
          $('#resize-hint').textContent = bytes > current ? `增加 ${format(bytes-current)}，使用右側相鄰未配置空間。` : bytes < current ? `釋出 ${format(current-bytes)}，可在完成後建立新的分割區。` : '尚未變更容量。';
          $('#prepare').disabled = !Number.isFinite(bytes) || bytes < min || bytes > max || Math.abs(bytes-current)<MiB;
        };
        $('#size-range').oninput = e => { const bytes = Number(e.target.value)*MiB; $('#target-size').value = (bytes/GiB).toFixed(3); update(bytes); };
        $('#target-size').oninput = e => { const bytes = Math.round(Number(e.target.value)*GiB/MiB)*MiB; $('#size-range').value = bytes/MiB; update(bytes); };
        update(current);
        $('#prepare').onclick = () => prepare({ ...request, size: Math.round(Number($('#target-size').value)*GiB/MiB)*MiB });
      }
    } catch (error) { if (generation === state.generation) modal('目前無法進行此調整', `<div class="info-box warning-box">${escape(error.message)}</div>`, '<button class="button secondary" id="modal-cancel">知道了</button>'); }
  } else if (kind === 'create') {
    const max = Math.floor(gap.size/MiB)*MiB;
    const available = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l=>!state.inventory.usedLetters.includes(l));
    modal('建立新分割區', `<p class="modal-subtitle">磁碟 ${disk.number} · 可配置空間 ${format(gap.size)}</p><div class="form-row"><label for="new-label">磁碟名稱</label><input class="field" id="new-label" maxlength="32" value="資料"></div><div class="form-cols"><div class="form-row"><label for="new-letter">磁碟機代號</label><select id="new-letter" class="field">${available.map(l=>`<option value="${l}">${l}:</option>`).join('')}</select></div><div class="form-row"><label for="new-size">容量（GiB）</label><input id="new-size" class="field" type="number" min="0.063" max="${max/GiB}" step="0.001" value="${Math.floor(max/GiB*1000)/1000}"></div></div><div class="info-box">將使用 NTFS 檔案系統。新分割區只使用目前選取的未配置空間。</div>`, '<button class="button secondary" id="modal-cancel">取消</button><button class="button primary" id="prepare">加入待執行</button>');
    $('#prepare').disabled = !available.length || max<64*MiB;
    $('#prepare').onclick = () => prepare({ ...request, offset: gap.offset, size: Math.round(Number($('#new-size').value)*GiB/MiB)*MiB, label: $('#new-label').value, letter: $('#new-letter').value, fileSystem: 'NTFS' });
  } else if (kind === 'rename' || kind === 'format') {
    modal(kind==='rename'?'重新命名磁碟':'格式化分割區', `<p class="modal-subtitle">磁碟 ${disk.number} / ${escape(part.letter)}: · ${format(part.size)}</p><div class="form-row"><label for="new-label">磁碟標籤</label><input id="new-label" class="field" maxlength="32" value="${escape(part.label)}"></div>${kind==='format'?'<div class="info-box error-box">格式化為 NTFS 會刪除此分割區的所有檔案。套用前會再次要求確認。</div>':'<div class="info-box">更新在檔案總管中顯示的磁碟名稱。</div>'}`, '<button class="button secondary" id="modal-cancel">取消</button><button class="button primary" id="prepare">加入待執行</button>');
    $('#prepare').onclick = () => prepare({ ...request, label: $('#new-label').value, ...(kind==='format'?{fileSystem:'NTFS'}:{}) });
  } else if (kind === 'delete') {
    modal('刪除分割區', `<p class="modal-subtitle">磁碟 ${disk.number} / ${escape(part.letter)}: · ${format(part.size)}</p><div class="info-box error-box">此分割區及其中所有檔案將被刪除，空間會變為未配置。套用前會再次要求輸入確認文字。</div>`, '<button class="button secondary" id="modal-cancel">取消</button><button class="button danger" id="prepare">預覽刪除</button>');
    $('#prepare').onclick = () => prepare(request);
  }
}
function preview(before,after) { return `<div class="resize-preview"><div><small>目前容量</small><strong>${amount(before)}</strong> <b>GiB</b></div><span>${svg('arrow')}</span><div class="new"><small>調整後</small><strong id="preview-new">${amount(after)}</strong> <b>GiB</b></div></div>`; }
async function prepare(request) {
  const button = $('#prepare'); button.disabled = true; button.textContent = '檢查中…'; state.modalBusy = true;
  try { state.pending = await api('plan',request); state.modalBusy=false; closeModal(); renderPending(); $('#pending').scrollIntoView({block:'nearest',behavior:'smooth'}); toast('已加入待執行，尚未修改磁碟。'); }
  catch(error) { toast(error.message,true); button.disabled=false; button.textContent='重新檢查'; }
  finally { state.modalBusy=false; }
}
function confirmApply() {
  const p = state.pending; if (!p || state.working) return;
  modal('確認這次變更', `<p class="modal-subtitle">${escape(p.title)}</p>${p.request.kind==='rename'?`<div class="info-box">${escape(p.summary)}</div>`:preview(p.before,p.after)}<div class="info-box ${p.destructive?'error-box':'warning-box'}">${escape(p.warning)}</div>${p.destructive?`<div class="form-row"><label for="confirm-phrase">輸入 ${escape(p.confirmation)} 以確認刪除資料</label><input id="confirm-phrase" class="field" autocomplete="off" placeholder="${escape(p.confirmation)}"></div>`:''}`, '<button class="button secondary" id="modal-cancel">返回</button><button class="button primary" id="run">確認並繼續</button>');
  if (p.destructive) { $('#run').disabled = true; $('#confirm-phrase').oninput = e => { $('#run').disabled = e.target.value !== p.confirmation; }; }
  $('#run').onclick = () => apply(p, $('#confirm-phrase')?.value || '');
}
async function apply(plan,phrase) {
  state.working = true; state.modalBusy = true;
  loading('正在套用變更', '請完成 Windows 的最後確認。<br>磁碟操作開始後無法取消，請保持電源連接。<br>大容量分割區可能需要幾分鐘。');
  $('#modal-close').disabled=true;
  try {
    const result=await api('apply',plan.id,phrase);
    if(result.cancelled){toast('已取消，沒有執行變更。');}
    else {state.pending=null;toast(result.message);}
  }catch(error){state.pending=null;modal('操作未完成',`<div class="info-box error-box">${escape(error.message)}</div><p class="modal-subtitle" style="margin:16px 0 0">部分步驟可能已完成。請查看最新磁碟配置與操作紀錄。</p>`,'<button class="button secondary" id="modal-cancel">知道了</button>');}
  finally{state.working=false;state.modalBusy=false;if($('#modal-title').textContent==='正在套用變更')closeModal();await refresh();}
}
async function page(name) {
  if(state.working)return;
  $$('.page').forEach(p=>{p.hidden=p.id!==`page-${name}`;});
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
  $('#breadcrumb-current').textContent=({disks:'磁碟總覽',history:'操作紀錄',help:'使用指南'})[name];
  if(name==='history'){
    try{const list=await api('history');$('#history-list').innerHTML=list.length?list.map(h=>`<article class="history-card"><span class="history-status ${h.status==='error'?'error':''}">${svg(h.status==='success'?'check':'help')}</span><div><h3>${escape(h.title)}</h3><p>${escape(h.detail)}</p></div><time>${new Date(h.time).toLocaleString('zh-TW')}</time></article>`).join(''):`<div class="empty-state">${svg('history')}<h3>每個好開始，都從第一步算起</h3><p>完成的磁碟操作會顯示在這裡。</p></div>`;}catch(error){toast(error.message,true);}
  }
}
$$('[data-window]').forEach(b=>b.addEventListener('click',()=>window.diskpilot[b.dataset.window]()));
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
$('#refresh').onclick=refresh;$('#tip-help').onclick=()=>page('help');
$('#admin').onclick=async()=>{if(state.inventory?.admin)return;try{await api('elevate');}catch(error){toast(error.message,true);}};
$('#export').onclick=async()=>{try{if(await api('exportReport'))toast('磁碟報告已匯出。');}catch(error){toast(error.message,true);}};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='Tab'&&!$('#modal-backdrop').hidden){const nodes=[...$('#modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
decorate();refresh();
