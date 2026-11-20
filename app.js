'use strict';
const VERSION = 'ver 3.12';
let selDay = null;
const MIN_YEAR = 1953;
const K = window.Koyomi;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const dnOf = s => { const p = parseYmd(s); return K.dn(p.y, p.m, p.d); };
const strOf = n => { const g = K.fromDn(n); return ymd(g.y, g.m, g.d); };
const WD = '日月火水木金土';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GOOD = ['一粒万倍日', '天赦日', '寅の日', '巳の日', '己巳の日', '甲子の日', '天恩日'];
const BAD = ['不成就日', '三隣亡', '十方暮', '八専'];
const STAMPS = ['', '🏥', '💊', '🍚', '🎂', '⛳', '🚗', '✈️', '🛒', '🙏', '👪', '📞', '💰', '♨️', '🌸', '🎉', '✂️', '⭐'];
const COLORS = ['#2f6fa8', '#c0466a', '#3f8f5a', '#c9822b', '#7a52a8', '#5f6b75', '#c4432e', '#2a8f93'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayStr = () => { const t = new Date(); return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate()); };

// ===== この端末の設定 =====
const LS = {
  get(k, d) { try { const v = localStorage.getItem('koyomi.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('koyomi.' + k, JSON.stringify(v)); } catch (e) { toast('保存できませんでした'); } }
};
let S = LS.get('settings', null) || {};
S = Object.assign({ me: null, show: 'f', fs: 1, cellRekichu: true, veil: .68, sync: null }, S);
const saveS = () => LS.set('settings', S);

// ===== みんなで同期するデータ =====
// ev:予定 person:人 place:場所 photo:写真の情報 meta:アイコンなど
const DB = (() => {
  let d = LS.get('db', null);
  if (!d) {
    d = { ev: {}, person: {}, place: {}, photo: {}, meta: {} };
    LS.get('events', []).forEach(e => { d.ev[e.id] = e; });
  }
  ['ev', 'person', 'place', 'photo', 'meta'].forEach(k => d[k] = d[k] || {});
  const seed = (id, name, order) => { if (!d.person[id]) d.person[id] = { id, name, order, updated: 1 }; };
  const old = S.names || {};
  seed('p_f', old.f && old.f !== 'お父さん' ? old.f : '美之', 0);
  seed('p_m', old.m && old.m !== 'お母さん' ? old.m : '博美', 1);
  seed('p_hana', '花', 2); seed('p_saki', '咲', 3); seed('p_takuma', '拓馬', 4);
  return d;
})();
let DIRTY = new Set(LS.get('dirty', []));
function persist() { LS.set('db', DB); LS.set('dirty', [...DIRTY]); }
function put(kind, rec, quiet) { rec.updated = Date.now(); DB[kind][rec.id] = rec; DIRTY.add(kind + ':' + rec.id); persist(); if (!quiet) scheduleSync(); }
function del(kind, id) { const r = DB[kind][id]; if (!r) return; r.deleted = true; put(kind, r); }
const list = kind => Object.values(DB[kind]).filter(r => !r.deleted);
const NAME = o => (DB.person['p_' + o] || {}).name || (o === 'f' ? '美之' : '博美');
const isAdmin = () => S.me === 'admin';
async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('koyomi-admin:' + t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function becomeAdmin() {
  const m = DB.meta.admin;
  const inp = '<input class="inp" id="dlgPin" type="password" inputmode="numeric" autocomplete="off" placeholder="パスワード" style="margin-top:12px">';
  if (!m || m.deleted || !m.hash) {
    const r = await dialog('管理者のパスワードを決めてください。\n（ほかのスマホで管理者に入るときに使います）', [['決める', 'ok', 'primary'], ['やめる', null]], inp + '<input class="inp" id="dlgPin2" type="password" inputmode="numeric" autocomplete="off" placeholder="もう一度" style="margin-top:8px">');
    if (!r) return false;
    const a = document.getElementById('dlgPin').value, b = document.getElementById('dlgPin2').value;
    if (a.length < 4) { await alertBox('4文字以上にしてください'); return becomeAdmin(); }
    if (a !== b) { await alertBox('2回の入力がちがいます'); return becomeAdmin(); }
    put('meta', { id: 'admin', hash: await sha(a) }); return true;
  }
  const r = await dialog('管理者のパスワードを入れてください', [['入る', 'ok', 'primary'], ['やめる', null]], inp);
  if (!r) return false;
  if (await sha(document.getElementById('dlgPin').value) === DB.meta.admin.hash) return true;
  await alertBox('パスワードがちがいます'); return false;
}
async function setMe(v) {
  if (v === 'admin' && !isAdmin() && !(await becomeAdmin())) return false;
  S.me = v; S.show = v === 'admin' ? 'both' : v; saveS(); return true;
}
const personName = id => (DB.person[id] || {}).name || '';
persist();

// ===== IndexedDB（写真・アイコン・背景の中身） =====
let db;
function idb() {
  return new Promise((res, rej) => {
    if (db) return res(db);
    const r = indexedDB.open('koyomi', 3);
    r.onupgradeneeded = () => { const d = r.result;
      if (!d.objectStoreNames.contains('photos')) { const s = d.createObjectStore('photos', { keyPath: 'id' }); s.createIndex('date', 'date'); }
      if (!d.objectStoreNames.contains('misc')) d.createObjectStore('misc', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' }); };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
async function storeGet(store, id) { const d = await idb(); return new Promise(res => { const r = d.transaction(store).objectStore(store).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); }
async function storePut(store, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function storeDel(store, id) { const d = await idb(); return new Promise(res => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(id); t.oncomplete = res; }); }
const blobGet = async id => (await storeGet('blobs', id) || {}).blob || null;
const blobPut = (id, blob) => storePut('blobs', { id, blob });
const miscGet = id => storeGet('misc', id), miscPut = v => storePut('misc', v), miscDel = id => storeDel('misc', id);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// 前の版の写真・アイコンを新しい形に移す
async function migrate() {
  if (S.migrated2) return;
  const d = await idb();
  const olds = await new Promise(res => { const out = []; const r = d.transaction('photos').objectStore('photos').openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; r.onerror = () => res(out); });
  for (const p of olds) {
    if (p.full) await blobPut(p.id + '_f', p.full);
    if (p.thumb) await blobPut(p.id + '_t', p.thumb);
    if (!DB.photo[p.id]) put('photo', { id: p.id, date: p.date, taken: p.taken || '', owner: S.me || 'f' }, true);
  }
  for (const o of ['f', 'm']) { const r = await miscGet('icon_' + o); if (r && r.blob) { await blobPut('icon_' + o, r.blob); put('meta', { id: 'icon_' + o, local: true }, true); } }
  S.migrated2 = true; saveS();
}

// ===== 予定の取り出し =====
function eventsOn(n, show) {
  show = show || S.show; const out = [];
  for (const e of list('ev')) {
    if (show !== 'both' && e.owner !== show) continue;
    const s = dnOf(e.date); const len = e.end ? Math.max(0, dnOf(e.end) - s) : 0;
    if (n < s) continue;
    const r = e.repeat || 'none'; let hit = false;
    for (let k = 0; k <= len && !hit; k++) {
      const base = n - k; if (base < s) break;
      const b = K.fromDn(base), o = K.fromDn(s);
      if (r === 'none') hit = base === s;
      else if (r === 'week') hit = (base - s) % 7 === 0;
      else if (r === 'month') hit = b.d === o.d;
      else if (r === 'year') hit = b.d === o.d && b.m === o.m;
    }
    if (hit) out.push(e);
  }
  return out.sort((a, b) => (a.start || '').localeCompare(b.start || '') || (a.title || '').localeCompare(b.title || ''));
}
const PCOLORS = ['#2f6fa8', '#c0466a', '#3f8f5a', '#c9822b', '#7a52a8', '#5f6b75', '#c4432e', '#2a8f93', '#8a5a2b', '#d4639a', '#1f8a70', '#3b3b98'];
const ownerColor = o => (S.pcolor && S.pcolor[o]) || (o === 'm' ? COLORS[1] : COLORS[0]);
const ownColor = e => e.color && !(e.color === COLORS[0] && e.owner !== 'm') && !(e.color === COLORS[1] && e.owner === 'm') ? e.color : '';
const evColor = e => ownColor(e) || ownerColor(e.owner);
const whoNames = e => (e.who || []).map(personName).filter(Boolean);
const evLabel = e => { const w = whoNames(e); return (e.stamp || '') + (w.length ? w.join('・') + ' ' : '') + (e.title || ''); };
const placeName = id => (DB.place[id] || {}).name || '';

// 誕生日
function birthdaysOn(y, m, d) {
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const out = [];
  for (const p of list('person')) {
    if (!p.birthday || p.hideBday) continue;
    const b = p.birthday.match(/^(\d{4}|-)?-?(\d\d)-(\d\d)$/); if (!b) continue;
    let bm = +b[2], bd = +b[3];
    if (bm === 2 && bd === 29 && !leap) bd = 28;
    if (bm !== m || bd !== d) continue;
    const by = b[1] && b[1] !== '-' ? +b[1] : null;
    out.push({ name: p.name, age: by && y >= by ? y - by : null });
  }
  return out;
}
const bdayText = b => b.age === 0 ? `${b.name}さん 誕生の日👶` : `${b.name}さん${b.age != null ? b.age + '歳' : ''}🎂`;

// ===== アイコン =====
const ICON = { f: null, m: null };
async function loadIcons() {
  for (const o of ['f', 'm']) {
    const m = DB.meta['icon_' + o];
    let blob = null;
    if (m && !m.deleted) {
      blob = await blobGet('icon_' + o);
      if (m.fileId && LS.get('iconFile_' + o, null) !== m.fileId && S.sync) {
        const b = await fetchFile(m.fileId).catch(() => null);
        if (b) { blob = b; await blobPut('icon_' + o, b); LS.set('iconFile_' + o, m.fileId); }
      }
    }
    if (ICON[o]) URL.revokeObjectURL(ICON[o]);
    ICON[o] = blob ? URL.createObjectURL(blob) : null;
  }
}
function avatar(o) { return ICON[o] ? `<img class="av" src="${ICON[o]}" alt="">` : `<span class="avt" style="background:${o === 'm' ? 'var(--m)' : 'var(--f)'}">${esc((NAME(o) || '?')[0])}</span>`; }
let iconTarget = 'f';
$('#fileIcon').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  busy('アイコンを入れています…');
  try { const t = (await resize(f)).thumb; const old = DB.meta['icon_' + iconTarget] || {}; await blobPut('icon_' + iconTarget, t); LS.set('iconFile_' + iconTarget, null); put('meta', { id: 'icon_' + iconTarget, local: true, oldFile: old.deleted ? '' : (old.fileId || old.oldFile || '') }); await loadIcons(); busy(false); toast('アイコンを変えました'); openSettings(); }
  catch (err) { busy(false); alertBox('アイコンに入れられませんでした'); }
};

// ===== 背景（この端末だけ） =====
const VEILS = [[.5, 'うすく'], [.68, 'ふつう'], [.82, 'しっかり']];
let bgUrl = null, bgType = null;
const SYNC_VIDEO_MAX = 20 * 1024 * 1024;
async function bgSource() {
  // 管理者：美之・博美だけを見ているときは、その人の背景
  if (isAdmin() && (S.show === 'f' || S.show === 'm')) {
    const m = DB.meta['bg_' + S.show];
    if (!m || m.deleted || !m.fileId) return null;
    let blob = LS.get('bgFile_' + S.show, null) === m.fileId ? await blobGet('bgc_' + S.show) : null;
    if (!blob && S.sync) { blob = await fetchFile(m.fileId).catch(() => null); if (blob) { await blobPut('bgc_' + S.show, blob); LS.set('bgFile_' + S.show, m.fileId); } }
    return blob ? { blob, type: m.type } : null;
  }
  return await miscGet('bg').catch(() => null);
}
let bgKey = '';
async function applyBg(force) {
  const key = isAdmin() ? 'admin:' + S.show + ':' + ((DB.meta['bg_' + S.show] || {}).fileId || '') : 'own';
  if (!force && key === bgKey && bgKey !== 'own') return;
  bgKey = key;
  const rec = await bgSource();
  const box = $('#bg');
  if (bgUrl) { URL.revokeObjectURL(bgUrl); bgUrl = null; }
  box.innerHTML = '';
  document.documentElement.style.setProperty('--veil', S.veil || .68);
  if (!rec) { document.body.classList.remove('hasbg'); bgType = null; return; }
  bgUrl = URL.createObjectURL(rec.blob); bgType = rec.type;
  if (rec.type === 'video') {
    const v = document.createElement('video'); v.src = bgUrl; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); box.appendChild(v); v.play().catch(() => { });
  } else { const im = new Image(); im.src = bgUrl; box.appendChild(im); }
  document.body.classList.add('hasbg');
}
function markBgChanged(type, size) {
  if (isAdmin() || !S.me) return;
  const old = DB.meta['bg_' + S.me] || {};
  if (!type) { if (old.fileId) del('meta', 'bg_' + S.me); return; }
  put('meta', { id: 'bg_' + S.me, type, local: true, tooBig: size > SYNC_VIDEO_MAX, oldFile: old.fileId || old.oldFile || '' });
}
$('#fileBg').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const isVideo = f.type.startsWith('video/');
  if (isVideo && f.size > 150 * 1024 * 1024) { alertBox('動画が大きすぎます（150MBまで）。\n短めの動画を選んでください。'); return; }
  busy('背景を入れています…');
  try {
    let blob = f; if (!isVideo) blob = (await resize(f)).full;
    await miscPut({ id: 'bg', type: isVideo ? 'video' : 'image', blob, added: Date.now() });
    markBgChanged(isVideo ? 'video' : 'image', blob.size);
    await applyBg(true); busy(false); toast('背景を変えました'); openSettings();
    if (isVideo && blob.size > SYNC_VIDEO_MAX && !isAdmin()) alertBox('この動画は大きいので、このスマホだけの背景になります。\n（管理者の画面にも出したいときは、20MBまでの短い動画にしてください）');
  } catch (err) { busy(false); alertBox('背景に入れられませんでした'); }
};

// ===== 月の表示 =====
let cur = (() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1 }; })();
function photoCountMap() { const c = {}; for (const p of list('photo')) c[p.date] = (c[p.date] || 0) + 1; return c; }
function render() {
  document.documentElement.style.setProperty('--fs', S.fs);
  const { y, m } = cur;
  const ki = K.info(y, m, 15);
  const season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  document.body.dataset.season = season;
  $('#title').innerHTML = `<div class="ym mincho">${y}<small>年</small>${m}<small>月</small><span class="tri">▾</span></div><div class="sub"><span class="gl"></span>${K.wareki(y, m, 15)}　旧暦 ${ki.kyurekiName}　${ETO_ANIMAL[((y - 4) % 12 + 12) % 12]}年<span class="gl"></span></div>`;
  const first = K.dn(y, m, 1); const start = first - K.fromDn(first).w;
  const last = K.dn(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
  const cellsN = Math.ceil((last - start + 1) / 7) * 7;
  const counts = photoCountMap(); const today = todayStr();
  if (!selDay || selDay.slice(0, 7) !== `${y}-${pad(m)}`) selDay = today.slice(0, 7) === `${y}-${pad(m)}` ? today : ymd(y, m, 1);
  let html = '';
  for (let i = 0; i < cellsN; i++) {
    const n = start + i; const g = K.fromDn(n); const info = K.info(g.y, g.m, g.d); const s = strOf(n);
    const cls = ['cell']; if (g.m !== m) cls.push('out'); if (g.w === 0) cls.push('sun'); if (g.w === 6) cls.push('sat'); if (info.holiday) cls.push('hol'); if (s === today) cls.push('today'); if (s === selDay) cls.push('sel');
    const evs = eventsOn(n); const bds = birthdaysOn(g.y, g.m, g.d);
    const maxEv = evs.length > 2 ? 1 : 2;
    const good = info.rekichu.some(r => r === '天赦日' || r === '一粒万倍日');
    const hn = info.holiday || info.terms[0] || info.events[0] || '';
    html += `<div class="${cls.join(' ')}" data-d="${s}">
      <div class="num mincho">${g.d === 1 && g.m !== m ? g.m + '/' + g.d : g.d}</div>
      <div class="rk${info.rokuyo === '大安' ? ' taian' : ''}">${info.rokuyo}${S.cellRekichu && good ? '<span class="dot"></span>' : ''}</div>
      ${hn ? `<div class="hn${info.holiday ? ' isHol' : ''}">${esc(hn)}</div>` : ''}
      ${bds.map(b => `<div class="bd">${b.age === 0 ? '👶' : '🎂'}${esc(b.name)}${b.age ? b.age + '歳' : ''}</div>`).join('')}
      ${evs.slice(0, maxEv).map(e => `<div class="ev" style="background:${evColor(e)}">${S.show === 'both' && ICON[e.owner] ? avatar(e.owner) : ''}<span>${esc(evLabel(e))}</span></div>`).join('')}
      ${evs.length > maxEv ? `<div class="more">ほか${evs.length - maxEv}件</div>` : ''}
      <div class="marks">${counts[s] ? `<span class="cam">📷${counts[s]}</span>` : ''}</div>
    </div>`;
  }
  $('#grid').innerHTML = html;
  drawDayList();
  $('#whoIc').innerHTML = S.show === 'both' ? avatar('f') + avatar('m') : avatar(S.show);
  $('#whoTx').textContent = S.show === 'both' ? 'ふたり' : NAME(S.show);
}
function move(dm) { let { y, m } = cur; m += dm; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } if (y < MIN_YEAR || y > 2060) return; cur = { y, m }; render(); }
$('#prev').onclick = () => move(-1);
$('#next').onclick = () => move(1);
$('#bToday').onclick = () => { const t = new Date(); cur = { y: t.getFullYear(), m: t.getMonth() + 1 }; selDay = todayStr(); render(); };
$('#grid').onclick = e => { const c = e.target.closest('.cell'); if (!c) return; const d = c.dataset.d;
  if (d === selDay) { openDay(d); return; }
  if (d.slice(0, 7) !== `${cur.y}-${pad(cur.m)}`) { const p = parseYmd(d); cur = { y: p.y, m: p.m }; selDay = d; render(); return; }
  selDay = d; $('#grid').querySelectorAll('.cell.sel').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); drawDayList(); };
function drawDayList() {
  const s = selDay; if (!s) return; const p = parseYmd(s); const info = K.info(p.y, p.m, p.d);
  const evs = eventsOn(info.n); const bds = birthdaysOn(p.y, p.m, p.d);
  const extra = [info.holiday, ...info.terms, ...info.rekichu.filter(r => r === '天赦日' || r === '一粒万倍日')].filter(Boolean);
  let h = `<div class="dlh"><span class="dd mincho">${p.m}月${p.d}日（${WD[info.w]}）</span><span class="info">${info.rokuyo === '大安' ? '<b>大安</b>' : info.rokuyo}${extra.length ? '・' + esc(extra.join('・')) : ''}</span><button class="open" id="dlOpen">くわしく ›</button></div>`;
  bds.forEach(b => h += `<div class="dlbd">${esc(bdayText(b))}</div>`);
  h += evs.length ? evs.map(e => `<button class="dli" data-id="${e.id}"><span class="cb" style="background:${evColor(e)}"></span>${S.show === 'both' ? avatar(e.owner) : ''}<span class="tm">${e.start || '終日'}</span><span class="tt">${esc(evLabel(e))}${placeName(e.place) ? `<br><span class="pl">📍${esc(placeName(e.place))}</span>` : ''}</span></button>`).join('') : `<div class="dlempty">予定はありません</div>`;
  $('#dayList').innerHTML = h;
}
$('#dayList').onclick = e => { if (e.target.closest('#dlOpen')) { openDay(selDay); return; } const r = e.target.closest('.dli'); if (r) { const ev = DB.ev[r.dataset.id]; if (ev) openEdit(ev); } };
(() => { let x0 = null, y0 = 0; const g = $('#grid');
  g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  g.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1); x0 = null; }, { passive: true });
})();
const other = o => o === 'f' ? 'm' : 'f';
$('#bWho').onclick = () => { const me = S.me || 'f'; const order = me === 'admin' ? ['both', 'f', 'm'] : [me, 'both', other(me)]; S.show = order[(order.indexOf(S.show) + 1) % 3]; saveS(); render(); applyBg(); toast(S.show === 'both' ? 'ふたりの予定を表示' : NAME(S.show) + 'の予定だけ表示'); };
$('#bAdd').onclick = () => openEdit(null, selDay || todayStr());
$('#bPhoto').onclick = () => pickPhotos(null);
$('#bFind').onclick = openFind;
$('#bSet').onclick = openSettings;

// ===== 年月ジャンプ =====
const ETO_ANIMAL = 'ねずみ,うし,とら,うさぎ,たつ,へび,うま,ひつじ,さる,とり,いぬ,いのしし'.split(',');
function counts2() {
  const ey = {}, eym = {}, py = {}, pym = {};
  for (const e of list('ev')) { if (e.repeat && e.repeat !== 'none') continue; if (S.show !== 'both' && e.owner !== S.show) continue; const a = e.date.slice(0, 4), b = e.date.slice(0, 7); ey[a] = (ey[a] || 0) + 1; eym[b] = (eym[b] || 0) + 1; }
  for (const p of list('photo')) { const a = p.date.slice(0, 4), b = p.date.slice(0, 7); py[a] = (py[a] || 0) + 1; pym[b] = (pym[b] || 0) + 1; }
  return { ey, eym, py, pym };
}
const countTx = (ev, ph) => [ev ? `予定${ev}` : '', ph ? `📷${ph}` : ''].filter(Boolean).join('・');
function openYears() {
  const now = new Date().getFullYear(); const c = counts2();
  const btn = y => `<button class="ybtn${y === cur.y ? ' on' : ''}${y === now ? ' now' : ''}" data-y="${y}"><div class="y">${y}</div><div class="w">${K.wareki(y, 7, 1).replace('年', '')}・${ETO_ANIMAL[((y - 4) % 12 + 12) % 12]}</div><div class="c">${countTx(c.ey[y], c.py[y])}</div></button>`;
  let h = `<div class="jhint">見たい年をタップしてください。（上が新しい年です）</div><div class="jsec">これから</div><div class="ygrid">`;
  for (let y = Math.min(2060, now + 5); y > now; y--) h += btn(y);
  h += `</div><div class="jsec">今年と、これまで</div><div class="ygrid">`;
  for (let y = now; y >= MIN_YEAR; y--) h += btn(y);
  $('#jTitle').textContent = '年をえらぶ'; $('#jBody').innerHTML = h + '</div>'; $('#jYears').classList.add('hide');
  show('jump');
  const el = $('#jBody').querySelector(`[data-y="${cur.y}"]`); if (el) el.scrollIntoView({ block: 'center' });
}
function openMonths(y) {
  const t = new Date(); const c = counts2();
  let h = `<div class="jhint">${y}年（${K.wareki(y, 7, 1)}・${K.yearEto(y)}）　月をタップしてください。</div><div class="mgrid">`;
  for (let m = 1; m <= 12; m++) { const k = `${y}-${pad(m)}`; h += `<button class="mbtn${y === t.getFullYear() && m === t.getMonth() + 1 ? ' now' : ''}" data-m="${m}"><div class="m">${m}<small style="font-size:.55em">月</small></div><div class="w">${['', '睦月', '如月', '弥生', '卯月', '皐月', '水無月', '文月', '葉月', '長月', '神無月', '霜月', '師走'][m]}</div><div class="c">${countTx(c.eym[k], c.pym[k])}</div></button>`; }
  $('#jTitle').textContent = `${y}年`; $('#jBody').innerHTML = h + '</div>'; $('#jBody').dataset.y = y; $('#jBody').scrollTop = 0; $('#jYears').classList.remove('hide');
}
async function openYearWheel() {
  const c = counts2(); const t = new Date();
  const years = []; for (let y = MIN_YEAR; y <= 2060; y++) years.push({ v: y, t: String(y) });
  const r = await wheelPick({ title: '年と月をえらぶ', noneLabel: '今月にもどる',
    cols: [{ items: years, init: cur.y, unit: '年', uoff: 44 }, { items: Array.from({ length: 12 }, (_, i) => ({ v: i + 1, t: String(i + 1) })), init: cur.m, unit: '月' }],
    info: ([y, m]) => { const k = `${y}-${pad(m)}`; const x = countTx(c.eym[k], c.pym[k]); return `${K.wareki(y, m, 15)}・${ETO_ANIMAL[((y - 4) % 12 + 12) % 12]}年${x ? '　' + x : ''}`; } });
  if (r === undefined) return;
  cur = r === '' ? { y: t.getFullYear(), m: t.getMonth() + 1 } : { y: r[0], m: r[1] };
  render();
}
$('#title').onclick = openYearWheel;
$('#jBody').onclick = e => {
  const yb = e.target.closest('.ybtn'); if (yb) { openMonths(+yb.dataset.y); return; }
  const mb = e.target.closest('.mbtn'); if (mb) { cur = { y: +$('#jBody').dataset.y, m: +mb.dataset.m }; hide('jump'); render(); }
};
$('#jBack').onclick = () => { if (!$('#jYears').classList.contains('hide')) openYears(); else hide('jump'); };
$('#jYears').onclick = openYears;
$('#jToday').onclick = () => { const t = new Date(); cur = { y: t.getFullYear(), m: t.getMonth() + 1 }; hide('jump'); render(); };

// ===== 日の詳細 =====
let dayCur = null;
function evRow(e) {
  const pl = placeName(e.place);
  const tm = e.start ? e.start + (e.stop ? '<br>〜' + e.stop : '') : (e.stop ? '〜' + e.stop : '');
  const span = e.end ? `<div class="mm">📅 ${e.date.slice(5).replace('-', '/')}〜${e.end.slice(5).replace('-', '/')}</div>` : '';
  const t2 = e.start ? `<span class="t2">${e.start}${e.stop ? '〜' + e.stop : ''}</span>` : '';
  return `<div class="evrow" data-id="${e.id}"><div class="bar" style="background:${evColor(e)}"></div><div class="eav">${avatar(e.owner)}</div><div style="flex:1;min-width:0"><div class="tt">${t2}${esc(evLabel(e))}</div>${pl ? `<div class="pl2"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="#c4432e" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>${esc(pl)}</div>` : ''}<div class="mm" style="font-size:12px">${esc(NAME(e.owner))}のカレンダー</div>${span}${e.memo ? `<div class="mm">${esc(e.memo)}</div>` : ''}${e.repeat && e.repeat !== 'none' ? `<div class="mm">🔁 ${{ week: '毎週', month: '毎月', year: '毎年' }[e.repeat]}</div>` : ''}</div></div>`;
}
async function openDay(s) {
  dayCur = s; const p = parseYmd(s); const info = K.info(p.y, p.m, p.d); const n = info.n;
  $('#dTitle').innerHTML = `<span class="apt mincho">こよみ帳</span>`;
  const wc = info.w === 0 || info.holiday ? 'var(--sun)' : info.w === 6 ? 'var(--sat)' : 'var(--ink)';
  const kr = info.kyureki;
  let h = `<div class="dy2">${p.y}年${p.m}月・${K.wareki(p.y, p.m, p.d)}</div><div class="dhead"><div class="dd mincho" style="color:${wc === 'var(--ink)' ? '#4a2c1a' : wc}">${p.d}</div><div class="dw mincho" style="color:${wc === 'var(--ink)' ? '#4a2c1a' : wc}">${WD[info.w]}曜日</div></div><div class="brush"></div>`;
  h += `<div class="dsub mincho">旧暦 ${kr.leap ? '閏' : ''}${kr.m}月${kr.d}日　干支 ${info.kanshi}${info.fullMoon ? '　🌕' : info.newMoon ? '　🌑' : ''}</div>`;
  h += `<div class="chips">`;
  birthdaysOn(p.y, p.m, p.d).forEach(b => h += `<span class="chip hol">${esc(bdayText(b))}</span>`);
  if (info.holiday) h += `<span class="chip hol">${info.holiday}</span>`;
  h += `<button class="chip rk${info.rokuyo === '大安' ? ' taian' : ''}" data-i="${info.rokuyo}">${info.rokuyo}</button>`;
  info.terms.forEach(t => h += `<span class="chip">${t}</span>`);
  info.events.forEach(t => h += `<span class="chip">${t}</span>`);
  info.rekichu.forEach(r => h += `<button class="chip ${GOOD.includes(r) ? 'good' : BAD.includes(r) ? 'bad' : ''}" data-i="${r}">${r}</button>`);
  h += `</div><div style="font-size:12px;color:var(--sub);margin-top:8px;text-align:center">※ 六曜や暦注をタップすると意味が出ます</div>`;
  const evs = eventsOn(n);
  h += `<div class="sec"><h3 class="mincho"><svg class="fl" viewBox="0 0 24 24" width="22" height="22"><g fill="#c4432e"><circle cx="12" cy="5.5" r="4"/><circle cx="18.2" cy="10" r="4"/><circle cx="15.8" cy="17.3" r="4"/><circle cx="8.2" cy="17.3" r="4"/><circle cx="5.8" cy="10" r="4"/></g><circle cx="12" cy="12" r="2.6" fill="#e9b949"/></svg>予定<span class="hl"></span></h3>${evs.length ? evs.map(evRow).join('') : `<div class="empty">予定はありません</div>`}</div>`;
  h += `<div class="sec"><h3 class="mincho"><svg class="fl" viewBox="0 0 24 24" width="22" height="22"><g fill="#c4432e"><circle cx="12" cy="5.5" r="4"/><circle cx="18.2" cy="10" r="4"/><circle cx="15.8" cy="17.3" r="4"/><circle cx="8.2" cy="17.3" r="4"/><circle cx="5.8" cy="10" r="4"/></g><circle cx="12" cy="12" r="2.6" fill="#e9b949"/></svg>この日の写真<span class="hl"></span></h3><div class="photos" id="dPhotos"></div></div>`;
  $('#dBody').innerHTML = h; $('#dBody').scrollTop = 0;
  show('day');
  const ps = list('photo').filter(x => x.date === s).sort((a, b) => (a.taken || '').localeCompare(b.taken || ''));
  const box = $('#dPhotos');
  if (!ps.length) { box.outerHTML = `<div class="empty">こよみ帳に入れた写真はありません</div>`; return; }
  for (let i = 0; i < ps.length; i++) {
    const im = new Image(); im.onclick = () => openViewer(ps, i); box.appendChild(im);
    getPhotoBlob(ps[i], 't').then(b => { if (b) im.src = URL.createObjectURL(b); });
  }
}
$('#dBody').onclick = e => {
  const c = e.target.closest('[data-i]'); if (c) { const k = c.dataset.i; alertBox(`【${k}】\n${K.ROKUYO_INFO[k] || K.REKICHU_INFO[k] || ''}`); return; }
  const r = e.target.closest('.evrow'); if (r) { const ev = DB.ev[r.dataset.id]; if (ev) openEdit(ev); }
};
$('#dBack').onclick = () => { hide('day'); render(); };
$('#dPrev').onclick = () => openDay(strOf(dnOf(dayCur) - 1));
$('#dNext').onclick = () => openDay(strOf(dnOf(dayCur) + 1));
$('#dAdd').onclick = () => openEdit(null, dayCur);
$('#dPhoto').onclick = dayPhotoMenu;
async function dayPhotoMenu() {
  const p = parseYmd(dayCur);
  const r = await dialog(`${p.y}年${p.m}月${p.d}日の写真`, [['iPhoneの写真から選んで入れる', 'pick', 'primary'], ['Googleフォトでこの日を見る', 'gp'], ['やめる', null]]);
  if (r === 'pick') pickPhotos(dayCur);
  if (r === 'gp') window.open(`https://photos.google.com/search/${encodeURIComponent(`${p.y}年${p.m}月${p.d}日`)}`, '_blank');
}

// ===== 予定の入力（だれが・いつ・どこで・なにを） =====
let editing = null; const F = {};
function segSet(id, v) { document.querySelectorAll(id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
function segGet(id) { const b = document.querySelector(id + ' button.on'); return b ? b.dataset.v : null; }
['#fOwner', '#fRepeat'].forEach(id => $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; segSet(id, b.dataset.v);
  if (id === '#fOwner') { if (!F.colorTouched) { F.color = ownerColor(b.dataset.v); drawColors(); } F.who = F.who.filter(w => w !== 'p_' + b.dataset.v); drawWho(); } });
$('#fStamps').innerHTML = STAMPS.map(s => `<button data-s="${s}">${s || 'なし'}</button>`).join('');
$('#fStamps').querySelector('button').style.fontSize = '14px';
$('#fStamps').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.stamp = b.dataset.s; drawStamps(); };
const drawStamps = () => $('#fStamps').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === F.stamp));
function drawColors() { $('#fColors').innerHTML = COLORS.map(c => `<button data-c="${c}" style="background:${c}" class="${c === F.color ? 'on' : ''}"></button>`).join(''); }
$('#fColors').onclick = e => { const b = e.target.closest('button'); if (!b) return; F.color = b.dataset.c; F.colorTouched = true; drawColors(); };
function drawWho() { const n = F.who.map(personName).filter(Boolean); $('#fWho').innerHTML = n.length ? `<span>${esc(n.join('・'))}</span><span class="arr">›</span>` : `<span class="ph">（本人）</span><span class="arr">›</span>`; }
function drawPlace() { const n = placeName(F.place); $('#fPlace').innerHTML = n ? `<span>📍 ${esc(n)}</span><span class="arr">›</span>` : `<span class="ph">（なし）</span><span class="arr">›</span>`; }
function drawTimes() { [['#fStart', F.start], ['#fStop', F.stop]].forEach(([id, v]) => { $(id).textContent = v || 'なし'; $(id).classList.toggle('ph', !v); }); }
function drawSpan() {
  const d = $('#fDate').value, e = $('#fEnd').value;
  const n = d && e && e > d ? dnOf(e) - dnOf(d) + 1 : 1;
  const preset = [1, 2, 3, 7].includes(n) && !F.custom ? n : (n === 1 && !F.custom ? 1 : 0);
  $('#fSpan').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.n === preset));
  $('#fEndBox').style.display = preset === 0 ? '' : 'none';
}
$('#fSpan').onclick = e => { const b = e.target.closest('button'); if (!b) return; const n = +b.dataset.n; const d = $('#fDate').value;
  if (n === 0) { F.custom = true; if (!$('#fEnd').value && d) $('#fEnd').value = strOf(dnOf(d) + 1); }
  else { F.custom = false; $('#fEnd').value = n > 1 && d ? strOf(dnOf(d) + n - 1) : ''; }
  drawSpan(); };
$('#fDate').onchange = () => { const b = $('#fSpan .on'); if (b && +b.dataset.n > 1) $('#fEnd').value = strOf(dnOf($('#fDate').value) + +b.dataset.n - 1); drawSpan(); };
$('#fEnd').onchange = drawSpan;
$('#fStart').onclick = async () => { const v = await wheel('はじまりの時間', F.start || F.stop || '10:00'); if (v !== undefined) { F.start = v; drawTimes(); } };
$('#fStop').onclick = async () => { const v = await wheel('おわりの時間', F.stop || (F.start ? pad(Math.min(23, +F.start.slice(0, 2) + 1)) + F.start.slice(2) : '11:00')); if (v !== undefined) { F.stop = v; drawTimes(); } };
$('#fWho').onclick = async () => { const r = await pickWho(F.who, segGet('#fOwner')); if (r) { F.who = r; drawWho(); } };
$('#fPlace').onclick = async () => { const r = await pickPlace(F.place); if (r !== undefined) { F.place = r; drawPlace(); } };
function openEdit(ev, date) {
  editing = ev;
  const me = S.me || 'f';
  $('#fOwner').querySelectorAll('button').forEach(b => b.innerHTML = avatar(b.dataset.v) + esc(NAME(b.dataset.v)));
  $('#eTitle').textContent = ev ? '予定を直す' : '予定を入れる';
  $('#fTitle').value = ev ? ev.title || '' : '';
  $('#fDate').value = ev ? ev.date : date;
  $('#fEnd').value = ev && ev.end ? ev.end : '';
  $('#fMemo').value = ev ? ev.memo || '' : '';
  const owner = ev ? ev.owner : (S.show === 'both' ? (me === 'admin' ? 'f' : me) : S.show);
  segSet('#fOwner', owner);
  segSet('#fRepeat', ev ? ev.repeat || 'none' : 'none');
  F.who = ev ? [...(ev.who || [])] : []; F.place = ev ? ev.place || '' : ''; F.start = ev ? ev.start || '' : ''; F.stop = ev ? ev.stop || '' : '';
  F.stamp = ev ? ev.stamp || '' : ''; F.color = ev ? evColor(ev) : ownerColor(owner); F.colorTouched = !!(ev && ownColor(ev));
  const len = ev && ev.end ? dnOf(ev.end) - dnOf(ev.date) + 1 : 1; F.custom = ![1, 2, 3, 7].includes(len);
  drawWho(); drawPlace(); drawTimes(); drawSpan(); drawStamps(); drawColors();
  $('#eDel').classList.toggle('hide', !ev);
  const hasMore = !!(ev && (ev.end || (ev.who || []).length || (ev.repeat && ev.repeat !== 'none') || ev.stamp || ev.memo || ownColor(ev) || ev.owner !== (S.me === 'admin' ? ev.owner : S.me)));
  $('#fMore').style.display = hasMore ? '' : 'none'; $('#fMoreBtn').style.display = hasMore ? 'none' : '';
  $('#edit .sbody').scrollTop = 0;
  show('edit');
  if (!ev) setTimeout(() => $('#fTitle').focus(), 80);
}
$('#fMoreBtn').onclick = () => { $('#fMore').style.display = ''; $('#fMoreBtn').style.display = 'none'; };
function saveEdit() {
  const title = $('#fTitle').value.trim();
  if (!title && !F.stamp) { alertBox('タイトルを書いてください'); return; }
  const d = $('#fDate').value; if (!d) { alertBox('日にちを選んでください'); return; }
  let end = $('#fEnd').value; if (end && end <= d) end = '';
  const rec = Object.assign(editing ? { ...editing } : { id: uid(), created: Date.now() }, {
    title, date: d, end, owner: segGet('#fOwner'), who: F.who, place: F.place, start: F.start, stop: F.stop,
    repeat: segGet('#fRepeat'), memo: $('#fMemo').value.trim(), stamp: F.stamp, color: F.color === ownerColor(segGet('#fOwner')) ? '' : F.color
  });
  put('ev', rec); hide('edit'); toast('保存しました');
  if ($('#day').classList.contains('on')) openDay(dayCur); else if ($('#find').classList.contains('on')) runFind(); else render();
}
$('#eSave').onclick = saveEdit; $('#eSave2').onclick = saveEdit;
$('#eCancel').onclick = () => hide('edit');
$('#eDel').onclick = async () => {
  if (!editing) return;
  if (!(await confirmBox(`「${evLabel(editing)}」を削除しますか？` + (editing.repeat && editing.repeat !== 'none' ? '\n（くりかえしの予定は全部消えます）' : '')))) return;
  del('ev', editing.id); hide('edit'); toast('削除しました');
  if ($('#day').classList.contains('on')) openDay(dayCur); else if ($('#find').classList.contains('on')) runFind(); else render();
};

// くるくる選ぶホイール（時間・年月）
function wheelPick({ title, cols, noneLabel, info }) {
  return new Promise(res => {
    const box = $('#wCols'); const n = cols.length;
    box.style.gridTemplateColumns = `repeat(${n},1fr)`;
    const padr = '<div class="padd"></div><div class="padd"></div>';
    box.innerHTML = cols.map((c, i) => `<div class="wcol" data-c="${i}">${padr}${c.items.map(it => `<div>${esc(it.t)}</div>`).join('')}${padr}</div>`).join('') + '<div class="wsel"></div>' +
      cols.map((c, i) => c.unit ? `<span class="wunit" style="left:calc(${(i + .5) * 100 / n}% + ${c.uoff || 30}px)">${c.unit}</span>` : '').join('');
    const els = [...box.querySelectorAll('.wcol')];
    const idx = i => Math.max(0, Math.min(cols[i].items.length - 1, Math.round(els[i].scrollTop / 44)));
    const vals = () => els.map((_, i) => cols[i].items[idx(i)].v);
    const upd = () => { $('#wInfo').textContent = info ? info(vals()) : ''; };
    $('#wTitle').textContent = title; $('#wNone').textContent = noneLabel || 'なし';
    $('#wheel').classList.add('on');
    els.forEach((el, i) => { const k = Math.max(0, cols[i].items.findIndex(it => it.v === cols[i].init)); el.scrollTop = k * 44; let t; el.onscroll = () => { clearTimeout(t); t = setTimeout(upd, 60); }; });
    upd();
    const done = v => { $('#wheel').classList.remove('on'); $('#wOk').onclick = $('#wNone').onclick = $('#wheel').onclick = null; els.forEach(el => el.onscroll = null); res(v); };
    $('#wOk').onclick = () => done(vals());
    $('#wNone').onclick = () => done('');
    $('#wheel').onclick = e => { if (e.target.id === 'wheel') done(undefined); };
  });
}
async function wheel(title, init) {
  const [h, m] = (init || '10:00').split(':').map(Number);
  const r = await wheelPick({ title, noneLabel: 'なし',
    cols: [{ items: Array.from({ length: 24 }, (_, i) => ({ v: i, t: String(i) })), init: h, unit: '時' },
           { items: Array.from({ length: 12 }, (_, i) => ({ v: i * 5, t: pad(i * 5) })), init: Math.round(m / 5) % 12 * 5, unit: '分' }] });
  if (r === undefined || r === '') return r;
  return `${pad(r[0])}:${pad(r[1])}`;
}

// ===== 人・場所をえらぶ =====
let pickRes = null;
function pickSheet(title, noneLabel) { $('#pTitle').textContent = title; $('#pNone').textContent = noneLabel; show('pick'); $('#pBody').scrollTop = 0; return new Promise(r => pickRes = r); }
function pickDone(v) { hide('pick'); const r = pickRes; pickRes = null; if (r) r(v); }
$('#pCancel').onclick = () => pickDone(undefined);
function pickWho(sel, owner) {
  let chosen = new Set(sel);
  const draw = () => {
    const ppl = list('person').filter(p => p.id !== 'p_' + owner).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'ja'));
    $('#pBody').innerHTML = `<div class="jhint">いっしょに予定がある人、または予定の主役をえらびます（何人でも）。だれもえらばなければ「${esc(NAME(owner))}本人」の予定になります。</div>
      <div class="plist">${ppl.map(p => `<button class="prow${chosen.has(p.id) ? ' on' : ''}" data-p="${p.id}"><span class="ck">✓</span>${esc(p.name)}${p.birthday ? '<span class="cnt">🎂</span>' : ''}</button>`).join('')}</div>
      <div class="hdr2">新しい人を登録</div><div class="addrow"><input class="inp" id="pNew" placeholder="名前（例：としさん）"><button id="pAdd">登録</button></div>`;
  };
  draw();
  $('#pBody').onclick = e => {
    const r = e.target.closest('[data-p]'); if (r) { const id = r.dataset.p; chosen.has(id) ? chosen.delete(id) : chosen.add(id); r.classList.toggle('on'); return; }
    if (e.target.id === 'pAdd') { const n = $('#pNew').value.trim(); if (!n) return; let p = list('person').find(x => x.name === n); if (!p) { p = { id: 'p_' + uid(), name: n, order: 50 }; put('person', p); } chosen.add(p.id); draw(); }
  };
  $('#pOk').onclick = $('#pOk2').onclick = () => pickDone([...chosen]);
  $('#pNone').onclick = () => pickDone([]);
  return pickSheet('だれが', 'だれもなし（本人）');
}
function placeUse() { const c = {}; for (const e of list('ev')) if (e.place) c[e.place] = (c[e.place] || 0) + 1; return c; }
function pickPlace(sel) {
  let chosen = sel || '', sort = 'use', q = '';
  // 入力欄は1回だけ作り、下の一覧だけを入れ替える（日本語入力の途中を壊さない）
  $('#pBody').innerHTML = `<div class="addrow"><input class="inp" id="pNew" placeholder="場所を書く・さがす"><button id="pAdd">登録</button></div>
    <div class="seg" id="pSort"><button data-v="use" class="on">よく使う順</button><button data-v="name">名前順</button></div>
    <div id="pList"></div>`;
  const draw = () => {
    const use = placeUse();
    let pl = list('place').filter(p => !q || p.name.includes(q));
    pl.sort(sort === 'use' ? (a, b) => (use[b.id] || 0) - (use[a.id] || 0) || a.name.localeCompare(b.name, 'ja') : (a, b) => a.name.localeCompare(b.name, 'ja'));
    segSet('#pSort', sort);
    $('#pList').innerHTML = `<div class="hdr2">登録してある場所（${pl.length}）</div>
      <div class="plist">${pl.map(p => `<button class="prow${chosen === p.id ? ' on' : ''}" data-p="${p.id}"><span class="ck">✓</span>📍 ${esc(p.name)}<span class="cnt">${use[p.id] ? use[p.id] + '回' : ''}</span></button>`).join('') || '<div class="empty">まだありません。上に書いて「登録」を押してください。</div>'}</div>`;
  };
  const inp = $('#pNew'); let composing = false;
  inp.addEventListener('compositionstart', () => composing = true);
  inp.addEventListener('compositionend', () => { composing = false; q = inp.value.trim(); draw(); });
  inp.addEventListener('input', e => { if (composing || e.isComposing) return; q = inp.value.trim(); draw(); });
  draw();
  $('#pBody').onclick = e => {
    const r = e.target.closest('[data-p]'); if (r) { chosen = chosen === r.dataset.p ? '' : r.dataset.p; pickDone(chosen); return; }
    const s = e.target.closest('#pSort button'); if (s) { sort = s.dataset.v; draw(); return; }
    if (e.target.id === 'pAdd') { const n = $('#pNew').value.trim(); if (!n) return; let p = list('place').find(x => x.name === n); if (!p) { p = { id: 'pl_' + uid(), name: n }; put('place', p); } pickDone(p.id); }
  };
  $('#pOk').onclick = $('#pOk2').onclick = () => pickDone(chosen);
  $('#pNone').onclick = () => pickDone('');
  return pickSheet('どこで', '場所なし');
}

// ===== さがす =====
const FQ = { text: '', who: new Set(), place: new Set(), sort: 'new' };
function openFind() { drawFindChips(); runFind(); show('find'); }
function drawFindChips() {
  const me = S.me || 'f';
  const ppl = [{ id: '@self', name: '本人' }].concat(list('person').sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'ja')));
  $('#sfWho').innerHTML = ppl.map(p => `<button data-w="${p.id}" class="${FQ.who.has(p.id) ? 'on' : ''}">${esc(p.name)}</button>`).join('');
  const use = placeUse();
  $('#sfPlace').innerHTML = list('place').sort((a, b) => (use[b.id] || 0) - (use[a.id] || 0)).map(p => `<button data-pl="${p.id}" class="${FQ.place.has(p.id) ? 'on' : ''}">📍${esc(p.name)}</button>`).join('') || '<span class="empty">登録した場所はまだありません</span>';
  segSet('#sfSort', FQ.sort);
}
function runFind() {
  const t = FQ.text.trim();
  let r = list('ev').filter(e => S.show === 'both' || e.owner === S.show);
  if (t) r = r.filter(e => [e.title, e.memo, placeName(e.place), whoNames(e).join(' ')].join(' ').includes(t));
  if (FQ.who.size) r = r.filter(e => [...FQ.who].some(w => w === '@self' ? !(e.who || []).length || (e.who || []).includes('p_' + e.owner) : (e.who || []).includes(w) || w === 'p_' + e.owner && !(e.who || []).length));
  if (FQ.place.size) r = r.filter(e => FQ.place.has(e.place));
  r.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')) * (FQ.sort === 'new' ? -1 : 1));
  const filtered = t || FQ.who.size || FQ.place.size;
  $('#sfRes').innerHTML = `<div class="scount">${filtered ? '' : 'すべての予定　'}${r.length}件${S.show !== 'both' ? `（${esc(NAME(S.show))}のカレンダー）` : ''}</div>` + r.slice(0, 300).map(e => { const p = parseYmd(e.date); return `<button class="sres" data-d="${e.date}"><div class="dt">${p.y}年<br>${p.m}/${p.d}（${WD[K.fromDn(dnOf(e.date)).w]}）</div><div style="min-width:0"><div class="tt">${esc(evLabel(e))}</div><div class="pl">${e.start ? e.start + '　' : ''}${placeName(e.place) ? '📍' + esc(placeName(e.place)) : ''}</div></div></button>`; }).join('') + (r.length > 300 ? '<div class="empty">多いので300件まで出しています。しぼりこんでください。</div>' : '');
}
$('#sfText').oninput = e => { FQ.text = e.target.value; runFind(); };
$('#sfWho').onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; const id = b.dataset.w; FQ.who.has(id) ? FQ.who.delete(id) : FQ.who.add(id); b.classList.toggle('on'); runFind(); };
$('#sfPlace').onclick = e => { const b = e.target.closest('[data-pl]'); if (!b) return; const id = b.dataset.pl; FQ.place.has(id) ? FQ.place.delete(id) : FQ.place.add(id); b.classList.toggle('on'); runFind(); };
$('#sfSort').onclick = e => { const b = e.target.closest('button'); if (!b) return; FQ.sort = b.dataset.v; segSet('#sfSort', FQ.sort); runFind(); };
$('#sfRes').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; const p = parseYmd(b.dataset.d); cur = { y: p.y, m: p.m }; openDay(b.dataset.d); };
$('#sfClear').onclick = () => { FQ.text = ''; FQ.who.clear(); FQ.place.clear(); $('#sfText').value = ''; drawFindChips(); runFind(); };
$('#sfBack').onclick = $('#sfClose').onclick = () => { hide('find'); render(); };

// ===== 人の登録・誕生日 =====
function openPeople() {
  const ppl = list('person').sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name, 'ja'));
  const bt = b => { if (!b) return '誕生日：なし'; const m = b.match(/^(\d{4}|-)?-?(\d\d)-(\d\d)$/); if (!m) return ''; return `誕生日：${m[1] && m[1] !== '-' ? m[1] + '年' : ''}${+m[2]}月${+m[3]}日`; };
  $('#plBody').innerHTML = `<div class="jhint">登録した人は「だれが」でえらべます。誕生日を入れると、カレンダーに「◯◯さん◯歳🎂」と出ます。タップで直せます。</div>
    <div class="plist">${ppl.map(p => `<button class="prow" data-p="${p.id}"><div><div>${esc(p.name)}</div><div class="sub2">${bt(p.birthday)}${p.birthday && p.hideBday ? '（カレンダーに出さない）' : ''}</div></div><span class="cnt">›</span></button>`).join('')}</div>`;
  show('people');
}
async function editPerson(p) {
  const isNew = !p; p = p ? { ...p } : { id: 'p_' + uid(), name: '', order: 50 };
  const fixed = ['p_f', 'p_m'].includes(p.id);
  const m = (p.birthday || '').match(/^(\d{4}|-)?-?(\d\d)-(\d\d)$/);
  const y = m && m[1] && m[1] !== '-' ? m[1] : '', mo = m ? +m[2] : '', d = m ? +m[3] : '';
  const extra = `<div style="margin-top:12px"><label style="font-size:14px;color:var(--sub);font-weight:700">名前</label><input class="inp" id="ppName" value="${esc(p.name)}"></div>
    <div style="margin-top:10px"><label style="font-size:14px;color:var(--sub);font-weight:700">誕生日（年は分からなければ空のまま）</label>
    <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:6px"><input class="inp" id="ppY" inputmode="numeric" placeholder="年" value="${y}"><input class="inp" id="ppM" inputmode="numeric" placeholder="月" value="${mo}"><input class="inp" id="ppD" inputmode="numeric" placeholder="日" value="${d}"></div></div>
    <label class="chk"><input type="checkbox" id="ppHide" ${p.hideBday ? 'checked' : ''}>誕生日をカレンダーに出さない</label>`;
  const btns = [['保存', 'save', 'primary']]; if (!isNew && !fixed) btns.push(['この人を消す', 'del', 'danger']); btns.push(['やめる', null]);
  const r = await dialog(isNew ? '新しい人を登録' : '人を直す', btns, extra);
  if (r === 'save') {
    const name = (document.getElementById('ppName').value || '').trim(); if (!name) return;
    const Y = document.getElementById('ppY').value.trim(), M = +document.getElementById('ppM').value, D = +document.getElementById('ppD').value;
    p.name = name; p.hideBday = document.getElementById('ppHide').checked;
    p.birthday = M >= 1 && M <= 12 && D >= 1 && D <= 31 ? (/^\d{4}$/.test(Y) ? Y : '-') + `-${pad(M)}-${pad(D)}` : '';
    put('person', p); openPeople();
  } else if (r === 'del') { if (await confirmBox(`「${p.name}」を消しますか？`)) { del('person', p.id); openPeople(); } }
}
$('#plBody').onclick = e => { const b = e.target.closest('[data-p]'); if (b) editPerson(DB.person[b.dataset.p]); };
$('#plAdd').onclick = () => editPerson(null);
$('#plBack').onclick = () => { hide('people'); openSettings(); };
$('#plVcf').onclick = async () => {
  await alertBox('iPhoneの「連絡先」アプリで、誕生日を読み込みたい人を開き、「連絡先を共有」→「ファイルに保存」で保存してください。（iCloud.comからまとめて書き出したファイルも使えます）\n\n次の画面で、そのファイル（.vcf）を選んでください。');
  $('#fileVcf').value = ''; $('#fileVcf').click();
};
$('#fileVcf').onchange = async e => {
  let add = 0, upd = 0;
  for (const f of e.target.files) {
    const t = await f.text();
    for (const card of t.split(/BEGIN:VCARD/i).slice(1)) {
      const un = card.replace(/\r?\n[ \t]/g, '');
      const get = k => { const m = un.match(new RegExp('^' + k + '(?:;[^:\\n]*)?:(.*)$', 'mi')); return m ? m[1].trim() : ''; };
      const bd = get('BDAY'); if (!bd) continue;
      let mm = bd.match(/(\d{4}|--)-?(\d\d)-?(\d\d)/); if (!mm) continue;
      let year = mm[1] === '--' || mm[1] === '1604' ? '-' : mm[1];
      const birthday = `${year}-${mm[2]}-${mm[3]}`;
      const nParts = get('N').split(';'); const fam = (nParts[0] || '').trim(), giv = (nParts[1] || '').trim();
      const fn = get('FN').replace(/\\,/g, ',') || (fam + giv);
      const flat = s => s.replace(/\s/g, '');
      let p = list('person').find(x => flat(x.name) === flat(fn) || (giv && x.name === giv) || flat(x.name) === flat(fam + giv));
      if (p) { put('person', { ...p, birthday }, true); upd++; }
      else { put('person', { id: 'p_' + uid(), name: fn.trim(), birthday, order: 60, fromContacts: true }, true); add++; }
    }
  }
  scheduleSync();
  alertBox(add + upd ? `誕生日を読み込みました。\n新しく登録：${add}人\n誕生日を入れた：${upd}人` : '誕生日が入っている連絡先が見つかりませんでした。');
  openPeople();
};

// ===== 写真 =====
let photoTarget = null;
function pickPhotos(date) { photoTarget = date; $('#filePhoto').value = ''; $('#filePhoto').click(); }
$('#filePhoto').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const done = {}; const unknown = [];
  for (let i = 0; i < files.length; i++) {
    busy(`写真を入れています… ${i + 1} / ${files.length}`);
    try {
      const f = files[i];
      const taken = await exifDate(f);
      const conv = await resize(f);
      const rec = { id: uid(), date: photoTarget || (taken ? taken.slice(0, 10) : null), taken: taken || '', owner: isAdmin() ? 'f' : (S.me || 'f') };
      await blobPut(rec.id + '_f', conv.full); await blobPut(rec.id + '_t', conv.thumb);
      if (!rec.date) { unknown.push(rec); continue; }
      put('photo', rec, true); done[rec.date] = (done[rec.date] || 0) + 1;
    } catch (err) { console.error(err); }
  }
  busy(false);
  if (unknown.length) {
    const d = await askDate(`撮った日が分からない写真が ${unknown.length} 枚あります。\nどの日に入れますか？`, todayStr());
    if (d) { for (const r of unknown) { r.date = d; put('photo', r, true); } done[d] = (done[d] || 0) + unknown.length; }
  }
  scheduleSync();
  const days = Object.keys(done).sort(); const total = days.reduce((a, k) => a + done[k], 0);
  if (total) {
    if (photoTarget) toast(`${total}枚 入れました`);
    else alertBox(`${total}枚の写真を、撮った日に入れました。\n\n` + days.slice(0, 12).map(k => { const p = parseYmd(k); return `${p.y}年${p.m}月${p.d}日　${done[k]}枚`; }).join('\n') + (days.length > 12 ? `\nほか ${days.length - 12}日分` : ''));
  }
  if ($('#day').classList.contains('on')) openDay(dayCur); else render();
};
async function getPhotoBlob(p, kind) {
  let b = await blobGet(p.id + '_' + kind); if (b) return b;
  const fid = kind === 't' ? (p.thumbId || p.fileId) : p.fileId;
  if (!fid || !S.sync) return null;
  b = await fetchFile(fid).catch(() => null);
  if (b) await blobPut(p.id + '_' + kind, b);
  return b;
}
async function resize(file) {
  const bmp = await createImageBitmap(file);
  const mk = (max, q, square) => {
    let w = bmp.width, h = bmp.height, sx = 0, sy = 0, sw = w, sh = h;
    if (square) { const m = Math.min(w, h); sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = Math.min(max, m); }
    else { const r = Math.min(1, max / Math.max(w, h)); w = Math.round(w * r); h = Math.round(h * r); }
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
    return new Promise(res => c.toBlob(res, 'image/jpeg', q));
  };
  const full = await mk(1800, .84, false); const thumb = await mk(360, .8, true);
  bmp.close && bmp.close();
  return { full, thumb };
}
async function exifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer(); const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o < v.byteLength - 4) {
      const mk = v.getUint16(o); const len = v.getUint16(o + 2);
      if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10; const le = v.getUint16(t) === 0x4949;
        const u16 = x => v.getUint16(x, le), u32 = x => v.getUint32(x, le);
        const readStr = (off, n) => { let s = ''; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(t + off + i)); return s; };
        const ifd = (off, want) => { const n = u16(t + off); const r = {}; for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; const tag = u16(e); if (want.includes(tag)) r[tag] = { cnt: u32(e + 4), val: u32(e + 8) }; } return r; };
        const i0 = ifd(u32(t + 4), [0x8769, 0x0132]);
        let s = null;
        if (i0[0x8769]) { const ex = ifd(i0[0x8769].val, [0x9003, 0x9004]); const x = ex[0x9003] || ex[0x9004]; if (x) s = readStr(x.val, x.cnt); }
        if (!s && i0[0x0132]) s = readStr(i0[0x0132].val, i0[0x0132].cnt);
        if (s && /^\d{4}:\d\d:\d\d/.test(s)) return s.slice(0, 10).replace(/:/g, '-') + 'T' + s.slice(11, 19);
        return null;
      }
      if ((mk & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch (e) { }
  return null;
}
let vList = [], vIdx = 0, vUrl = null;
function openViewer(l, i) { vList = l; vIdx = i; drawViewer(); show('viewer'); }
async function drawViewer() {
  if (vUrl) URL.revokeObjectURL(vUrl); vUrl = null;
  const p = vList[vIdx]; $('#vImg img').src = '';
  $('#vTitle').textContent = `${vIdx + 1} / ${vList.length}` + (p.taken ? `　${p.taken.slice(11, 16)}` : '');
  $('#vPrev').style.opacity = vIdx > 0 ? 1 : .3; $('#vNext').style.opacity = vIdx < vList.length - 1 ? 1 : .3;
  const b = await getPhotoBlob(p, 'f') || await getPhotoBlob(p, 't');
  if (b && vList[vIdx] === p) { vUrl = URL.createObjectURL(b); $('#vImg img').src = vUrl; }
}
$('#vPrev').onclick = () => { if (vIdx > 0) { vIdx--; drawViewer(); } };
$('#vNext').onclick = () => { if (vIdx < vList.length - 1) { vIdx++; drawViewer(); } };
$('#vBack').onclick = () => { hide('viewer'); openDay(dayCur); };
$('#vDel').onclick = async () => {
  if (!(await confirmBox('この写真を、こよみ帳から削除しますか？\n（iPhoneの写真アプリの写真は消えません）'))) return;
  const p = vList[vIdx]; del('photo', p.id); storeDel('blobs', p.id + '_f'); storeDel('blobs', p.id + '_t');
  vList.splice(vIdx, 1);
  if (!vList.length) { hide('viewer'); openDay(dayCur); return; }
  vIdx = Math.min(vIdx, vList.length - 1); drawViewer();
};
(() => { let x0 = null; const g = $('#vImg');
  g.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  g.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (dx < -50) $('#vNext').onclick(); if (dx > 50) $('#vPrev').onclick(); x0 = null; }, { passive: true });
})();

// ===== 同期 =====
let syncing = false, syncTimer = null, syncState = '';
function setSyncState(s) { syncState = s; drawCopy(); const el = document.getElementById('sSyncState'); if (el) el.textContent = s; }
function drawCopy() { $('#copy').textContent = (isAdmin() ? '🔑管理者　' : '') + `こよみ帳 ${VERSION}　© 2026 bl-oom Inc.` + (S.sync ? `　${syncState}` : ''); }
function scheduleSync(ms) { if (!S.sync) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms ?? 1500); }
async function api(method, params) {
  const u = S.sync.url;
  let r;
  if (method === 'GET') r = await fetch(u + '?' + new URLSearchParams({ ...params, key: S.sync.key }));
  else r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...params, key: S.sync.key }) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j;
}
const toB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
async function fetchFile(id) { const j = await api('GET', { action: 'file', id }); const bin = atob(j.b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: j.type || 'image/jpeg' }); }
async function syncNow() {
  if (!S.sync || syncing) return; if (!navigator.onLine) { setSyncState('オフライン'); return; }
  syncing = true; setSyncState('同期中…');
  try {
    // 写真・アイコンを送る
    for (const p of Object.values(DB.photo)) {
      if (p.deleted || p.fileId) continue;
      const f = await blobGet(p.id + '_f'), t = await blobGet(p.id + '_t'); if (!f) continue;
      const a = await api('POST', { action: 'upload', b64: await toB64(f), name: p.date + '_' + p.id + '.jpg' });
      const b = t ? await api('POST', { action: 'upload', b64: await toB64(t), name: p.date + '_' + p.id + '_s.jpg' }) : {};
      put('photo', { ...DB.photo[p.id], fileId: a.fileId, thumbId: b.fileId || a.fileId }, true);
    }
    for (const o of ['f', 'm']) {
      const m = DB.meta['icon_' + o]; if (!m || m.deleted || m.fileId) continue;
      const bl = await blobGet('icon_' + o); if (!bl) continue;
      const a = await api('POST', { action: 'upload', b64: await toB64(bl), name: 'icon_' + o + '.jpg', replace: m.oldFile || '' });
      LS.set('iconFile_' + o, a.fileId); put('meta', { id: 'icon_' + o, fileId: a.fileId }, true);
    }
    if (S.me === 'f' || S.me === 'm') {
      const m = DB.meta['bg_' + S.me];
      if (m && !m.deleted && !m.fileId && !m.tooBig) {
        const r = await miscGet('bg');
        if (r && r.blob) { const a = await api('POST', { action: 'upload', b64: await toB64(r.blob), name: 'bg_' + S.me + (m.type === 'video' ? '.mp4' : '.jpg'), type: r.blob.type || (m.type === 'video' ? 'video/mp4' : 'image/jpeg'), replace: m.oldFile || '' });
          put('meta', { id: 'bg_' + S.me, type: m.type, fileId: a.fileId }, true); }
      }
    }
    // 変更を送る
    if (DIRTY.size) {
      const keys = [...DIRTY]; const snap = {};
      const items = keys.map(k => { const i = k.indexOf(':'); const kind = k.slice(0, i), id = k.slice(i + 1); const r = DB[kind] && DB[kind][id]; if (!r) return null; snap[k] = r.updated; return { kind, id, updated: r.updated, deleted: !!r.deleted, json: JSON.stringify(r) }; }).filter(Boolean);
      for (let i = 0; i < items.length; i += 150) await api('POST', { action: 'push', items: items.slice(i, i + 150) });
      keys.forEach(k => { const i = k.indexOf(':'); const r = DB[k.slice(0, i)][k.slice(i + 1)]; if (!r || r.updated === snap[k]) DIRTY.delete(k); });
      persist();
    }
    // 変更を受け取る
    const res = await api('GET', { action: 'pull', since: Math.max(0, (S.sync.last || 0) - 120000) });
    let changed = false, iconChanged = false;
    for (const it of res.items) {
      if (!DB[it.kind]) continue;
      const curR = DB[it.kind][it.id];
      if (!curR || (curR.updated || 0) < it.updated) {
        if (DIRTY.has(it.kind + ':' + it.id) && curR && curR.updated > it.updated) continue;
        try { DB[it.kind][it.id] = JSON.parse(it.json); changed = true; if (it.kind === 'meta') iconChanged = true; } catch (e) { }
      }
    }
    S.sync.last = res.now; saveS(); persist();
    if (iconChanged) { await loadIcons(); if (isAdmin()) applyBg(); }
    if (changed) refreshView();
    const t = new Date(); setSyncState(`同期済み ${pad(t.getHours())}:${pad(t.getMinutes())}`);
  } catch (e) { console.error(e); setSyncState('同期できませんでした'); }
  finally { syncing = false; if (DIRTY.size && syncState.startsWith('同期済み')) scheduleSync(3000); }
}
function refreshView() {
  if ($('#edit').classList.contains('on') || $('#pick').classList.contains('on') || $('#viewer').classList.contains('on')) return;
  if ($('#day').classList.contains('on')) openDay(dayCur);
  else if ($('#find').classList.contains('on')) { drawFindChips(); runFind(); }
  else if ($('#people').classList.contains('on')) openPeople();
  else if (!$('#settings').classList.contains('on')) render();
}
// 「つなぐリンク」で開いたとき
function readSyncLink() {
  const h = location.hash; if (!h.startsWith('#sync=')) return false;
  const q = new URLSearchParams(h.slice(1)); const url = q.get('sync'), key = q.get('k');
  history.replaceState(null, '', location.pathname);
  if (url && key && /^https:\/\/script\.google\.com\//.test(url)) { S.sync = { url, key, last: 0 }; saveS(); return true; }
  return false;
}
setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
window.addEventListener('online', () => scheduleSync(500));

// ===== 設定 =====
function openSettings() {
  const fsBtns = [[1, '標準'], [1.15, '大きめ'], [1.3, '特大']].map(([v, t]) => `<button data-v="${v}" class="${S.fs == v ? 'on' : ''}">${t}</button>`).join('');
  $('#sBody').innerHTML = `
  <button class="wbtn" id="sHelp" style="margin:0 0 14px;background:var(--accent);color:#fff">📖 使い方を見る</button>
  <div class="card"><h4>このスマホを使う人</h4><div class="seg" id="sMe"><button data-v="f" class="${S.me === 'f' ? 'on' : ''}">${avatar('f')}${esc(NAME('f'))}</button><button data-v="m" class="${S.me === 'm' ? 'on' : ''}">${avatar('m')}${esc(NAME('m'))}</button><button data-v="admin" class="${isAdmin() ? 'on' : ''}">🔑管理者</button></div>
    <p>アプリを開くと、いつもここで選んだ人のカレンダーから始まります。「管理者」は${esc(NAME('f'))}と${esc(NAME('m'))}の両方のカレンダーを見たり直したりできます（パスワードが必要）。</p>${isAdmin() ? '<button class="wbtn" id="sPin">管理者のパスワードを変える</button>' : ''}</div>
  <div class="card"><h4>ふたりの同期</h4>
    <p class="sync" id="sSyncState">${S.sync ? esc(syncState || '準備中') : 'まだつながっていません'}</p>
    <p>${S.sync ? '予定・人・場所・写真・アイコンが、美之と博美のスマホで同じになります。' : '「つなぐリンク」を開くと、2台のスマホで予定が同じになります。'}</p>
    <button class="wbtn${S.sync ? '' : ' hide'}" id="sSyncNow">今すぐ同期する</button></div>
  <div class="card"><h4>アイコン</h4><div class="icgrid">${['f', 'm'].map(o => `<div>${avatar(o)}<div class="nm">${esc(NAME(o))}</div><button class="wbtn" data-icon="${o}">写真を選ぶ</button><button class="wbtn${ICON[o] ? '' : ' hide'}" data-icondel="${o}">消す</button></div>`).join('')}</div>
    <p>好きな写真を選ぶと、丸く切り抜いてアイコンにします。</p></div>
  <div class="card"><h4>人の登録・誕生日</h4><p>「だれが」でえらぶ人と、誕生日（連絡先からも読めます）。名前の変更もここからできます。</p><button class="wbtn" id="sPeople">人の登録・誕生日を開く</button></div>
  <div class="card"><h4>予定の色</h4><p>それぞれの人の予定の色を変えられます。このスマホだけの設定です（相手のスマホは変わりません）。</p>
    ${['f', 'm'].map(o => `<div style="display:flex;align-items:center;gap:8px;margin:10px 0 6px;font-weight:700">${avatar(o)}${esc(NAME(o))}の予定<span class="ev" style="background:${ownerColor(o)};font-size:13px;padding:2px 8px;margin-left:auto">例：病院</span></div><div class="colors" data-pc="${o}">${PCOLORS.map(c => `<button data-c="${c}" style="background:${c}" class="${c === ownerColor(o) ? 'on' : ''}"></button>`).join('')}</div>`).join('')}</div>
  <div class="card"><h4>文字の大きさ</h4><div class="seg" id="sFs">${fsBtns}</div></div>
  <div class="card"><h4>背景の写真・動画</h4><div id="sBgPrev"></div>
    <p>好きな写真か動画を1つ選べます。動画はくりかえし流れます（音は出ません）。${isAdmin() ? '管理者の画面では、美之・博美だけを表示しているときはその人の背景、ふたりのときはここで選んだ背景が出ます。' : '同期していれば、管理者の画面にも出ます。変えると前の背景は消えます。'}</p>
    <label style="font-size:14px;font-weight:700;color:var(--sub)">文字を見やすくする白さ</label>
    <div class="seg" id="sVeil" style="margin-top:6px">${VEILS.map(([v, t]) => `<button data-v="${v}" class="${(S.veil || .68) == v ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="row2" style="margin-top:8px"><button class="wbtn" id="sBg">写真・動画を選ぶ</button><button class="wbtn" id="sBgOff">背景をなくす</button></div></div>
  <div class="card"><h4>表示</h4><label class="chk"><input type="checkbox" id="sDot" ${S.cellRekichu ? 'checked' : ''}>天赦日・一粒万倍日に金色の印を付ける</label></div>
  <div class="card"><h4>前のカレンダーの予定を取り込む</h4><p>CSVファイル（日付・時間・タイトル・メモ）を読み込んで、予定に入れます。</p><button class="wbtn" id="sCsv">CSVファイルを選ぶ</button></div>
  <div class="card"><h4>予定の書き出し・バックアップ</h4><p>CSVは表計算ソフトや、ほかのカレンダーに取り込むときに使えます。（写真は含みません）</p>
    <button class="wbtn" id="sCsvOut">CSVで書き出す（Excelなどで開ける）</button><button class="wbtn" id="sExp">予定を書き出す（このアプリ用）</button><button class="wbtn" id="sImp">バックアップから戻す</button></div>
  <div class="card"><h4>いま入っている予定</h4><p>${esc(NAME('f'))}：${list('ev').filter(e => e.owner === 'f').length}件　${esc(NAME('m'))}：${list('ev').filter(e => e.owner === 'm').length}件　写真：${list('photo').length}枚</p></div>
  <div class="ver">こよみ帳 ${VERSION}<br>© 2026 bl-oom Inc.</div>`;
  show('settings');
  const pv = $('#sBgPrev');
  if (bgUrl) { const el = document.createElement(bgType === 'video' ? 'video' : 'img'); el.className = 'bgprev'; el.src = bgUrl; if (bgType === 'video') { el.muted = true; el.loop = true; el.autoplay = true; el.playsInline = true; el.setAttribute('playsinline', ''); } pv.appendChild(el); if (el.play) el.play().catch(() => { }); }
  else pv.innerHTML = '<div class="bgprev" style="display:flex;align-items:center;justify-content:center;color:var(--sub);font-size:14px">いまは背景なし</div>';
}
$('#sBody').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.closest('[data-pc]')) { const o = b.closest('[data-pc]').dataset.pc; S.pcolor = Object.assign({}, S.pcolor, { [o]: b.dataset.c }); saveS(); const y = $('#sBody').scrollTop; openSettings(); $('#sBody').scrollTop = y; return; }
  if (b.closest('#sMe')) { setMe(b.dataset.v).then(() => { applyBg(true); openSettings(); }); }
  else if (b.id === 'sPin') { (async () => { const ok = await confirmBox('管理者のパスワードを変えますか？'); if (!ok) return; del('meta', 'admin'); await becomeAdmin(); openSettings(); })(); }
  else if (b.closest('#sFs')) { S.fs = Number(b.dataset.v); saveS(); document.documentElement.style.setProperty('--fs', S.fs); openSettings(); }
  else if (b.closest('#sVeil')) { S.veil = Number(b.dataset.v); saveS(); document.documentElement.style.setProperty('--veil', S.veil); document.querySelectorAll('#sVeil button').forEach(x => x.classList.toggle('on', x === b)); }
  else if (b.dataset.icon) { iconTarget = b.dataset.icon; $('#fileIcon').value = ''; $('#fileIcon').click(); }
  else if (b.dataset.icondel) { const o = b.dataset.icondel; storeDel('blobs', 'icon_' + o); del('meta', 'icon_' + o); loadIcons().then(openSettings); }
  else if (b.id === 'sBg') { $('#fileBg').value = ''; $('#fileBg').click(); }
  else if (b.id === 'sBgOff') { miscDel('bg').then(() => { markBgChanged(null); return applyBg(true); }).then(() => { toast('背景をなくしました'); openSettings(); }); }
  else if (b.id === 'sPeople') { hide('settings'); openPeople(); }
  else if (b.id === 'sSyncNow') syncNow();
  else if (b.id === 'sHelp') location.href = 'help.html';
  else if (b.id === 'sCsv') { importMode = 'csv'; $('#fileCsv').value = ''; $('#fileCsv').click(); }
  else if (b.id === 'sImp') { importMode = 'json'; $('#fileCsv').value = ''; $('#fileCsv').click(); }
  else if (b.id === 'sExp') exportJson();
  else if (b.id === 'sCsvOut') exportCsv();
};
$('#sBody').addEventListener('change', e => { if (e.target.id === 'sDot') { S.cellRekichu = e.target.checked; saveS(); } });
$('#sBack').onclick = () => { hide('settings'); render(); };

// ===== 書き出し・取り込み =====
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}
function exportJson() { shareOrDownload(new Blob([JSON.stringify({ app: 'koyomi', version: VERSION, exported: new Date().toISOString(), db: { ev: DB.ev, person: DB.person, place: DB.place } }, null, 1)], { type: 'application/json' }), `こよみ帳_バックアップ_${todayStr()}.json`); }
async function exportCsv() {
  const who = await dialog('どの予定を書き出しますか？', [['ふたり分', 'both', 'primary'], [NAME('f') + 'の予定', 'f'], [NAME('m') + 'の予定', 'm'], ['やめる', null]]);
  if (!who) return;
  const q = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const RP = { none: '', week: '毎週', month: '毎月', year: '毎年' };
  const rows = [['日付', '終了日', '開始時刻', '終了時刻', 'だれが', 'どこで', 'タイトル', 'マーク', 'メモ', 'カレンダー', 'くりかえし']];
  list('ev').filter(e => who === 'both' || e.owner === who).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))
    .forEach(e => rows.push([e.date.replace(/-/g, '/'), (e.end || '').replace(/-/g, '/'), e.start || '', e.stop || '', whoNames(e).join('・'), placeName(e.place), e.title, e.stamp || '', e.memo || '', NAME(e.owner), RP[e.repeat || 'none'] || '']));
  await shareOrDownload(new Blob(['\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), `こよみ帳_${who === 'both' ? 'ふたり' : NAME(who)}_${todayStr()}.csv`);
  toast(`${rows.length - 1}件を書き出しました`);
}
let importMode = 'csv';
$('#fileCsv').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  let text = await f.text();
  if (importMode === 'json' || f.name.endsWith('.json')) {
    try { const j = JSON.parse(text); let add = 0;
      if (j.db) { for (const kind of ['ev', 'person', 'place']) for (const r of Object.values(j.db[kind] || {})) { if (!DB[kind][r.id]) { put(kind, r, true); add++; } } }
      else (j.events || []).forEach(x => { if (!DB.ev[x.id]) { put('ev', x, true); add++; } });
      scheduleSync(); alertBox(`${add}件を戻しました`);
    } catch (err) { alertBox('ファイルを読めませんでした'); }
    openSettings(); return;
  }
  if (text.includes('\uFFFD')) { try { text = new TextDecoder('shift_jis').decode(await f.arrayBuffer()); } catch (err) { } }
  const rows = parseCsv(text); if (rows.length < 2) { alertBox('予定が見つかりませんでした'); return; }
  const recs = csvToEvents(rows);
  if (!recs.length) { alertBox('日付の列が見つかりませんでした。\n1行目に「日付」「タイトル」などの見出しがあるCSVにしてください。'); return; }
  const whoOwner = recs.some(r => !r.owner) ? await dialog(`${recs.length}件の予定が見つかりました。\nだれのカレンダーに入れますか？`, [[NAME('f'), 'f', 'primary'], [NAME('m'), 'm', 'primary'], ['やめる', null]]) : 'ok';
  if (!whoOwner) return;
  const key = e => [e.owner, e.date, e.start, e.title].join('|');
  const have = new Set(list('ev').map(key)); let add = 0;
  recs.forEach(r => { r.owner = r.owner || whoOwner; if (!have.has(key(r))) { put('ev', r, true); have.add(key(r)); add++; } });
  scheduleSync();
  alertBox(`${add}件の予定を取り込みました。` + (recs.length - add ? `\n（同じ予定 ${recs.length - add}件は飛ばしました）` : '')); openSettings();
};
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  t = t.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function normDate(s) { s = (s || '').trim(); const m = s.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/); return m ? ymd(+m[1], +m[2], +m[3]) : null; }
function normTime(s) { s = (s || '').trim(); const m = s.match(/(\d{1,2}):(\d{2})/); if (!m) return ''; let h = +m[1]; if (/PM|午後/i.test(s) && h < 12) h += 12; if (/AM|午前/i.test(s) && h === 12) h = 0; return pad(h) + ':' + m[2]; }
function csvToEvents(rows) {
  const hd = rows[0].map(h => h.trim().toLowerCase());
  const find = (...names) => hd.findIndex(h => names.some(n => h === n || h.includes(n)));
  const iDate = find('日付', 'start date', '開始日', 'date'), iEnd = find('終了日', 'end date');
  const iStart = find('開始時刻', 'start time', '開始時間', '時刻'), iStop = find('終了時刻', 'end time', '終了時間');
  const iTitle = find('タイトル', 'subject', '件名', '予定', 'title', 'なにを'), iMemo = find('メモ', 'description', '詳細', '内容', 'memo');
  const iCal = find('カレンダー', 'owner'), iWho = find('だれが'), iPlace = find('どこで', '場所', 'location');
  const iRep = find('くりかえし'), iStamp = find('マーク');
  if (iDate < 0) return [];
  const personByName = n => { n = n.trim(); if (!n) return null; let p = list('person').find(x => x.name === n); if (!p) { p = { id: 'p_' + uid(), name: n, order: 50 }; put('person', p, true); } return p.id; };
  const placeByName = n => { n = (n || '').trim(); if (!n) return ''; let p = list('place').find(x => x.name === n); if (!p) { p = { id: 'pl_' + uid(), name: n }; put('place', p, true); } return p.id; };
  const out = [];
  for (const r of rows.slice(1)) {
    const d = normDate(r[iDate]); if (!d) continue;
    let end = iEnd >= 0 ? normDate(r[iEnd]) : null; if (end && end <= d) end = '';
    const cal = iCal >= 0 ? (r[iCal] || '').trim() : '';
    out.push({ id: uid(), created: Date.now(), title: (iTitle >= 0 ? r[iTitle] : '').trim() || '（無題）', date: d, end: end || '',
      start: iStart >= 0 ? normTime(r[iStart]) : '', stop: iStop >= 0 ? normTime(r[iStop]) : '', memo: iMemo >= 0 ? (r[iMemo] || '').trim() : '',
      who: iWho >= 0 ? (r[iWho] || '').split(/[・、,]/).map(personByName).filter(Boolean) : [], place: iPlace >= 0 ? placeByName(r[iPlace]) : '',
      repeat: iRep >= 0 ? ({ '毎週': 'week', '毎月': 'month', '毎年': 'year' }[(r[iRep] || '').trim()] || 'none') : 'none', stamp: iStamp >= 0 ? (r[iStamp] || '').trim() : '', color: '',
      owner: cal === 'f' || cal === NAME('f') ? 'f' : cal === 'm' || cal === NAME('m') ? 'm' : '', imported: true });
  }
  return out;
}

// ===== 共通の部品 =====
function show(id) { $('#' + id).classList.add('on'); }
function hide(id) { $('#' + id).classList.remove('on'); }
let tt; function toast(s) { const t = $('#toast'); t.textContent = s; t.style.display = 'block'; clearTimeout(tt); tt = setTimeout(() => t.style.display = 'none', 1800); }
function busy(s) { $('#busy').classList.toggle('on', !!s); if (s) $('#busyTx').textContent = s; }
function dialog(msg, btns, extra) {
  return new Promise(res => {
    $('#dlgMsg').textContent = msg; $('#dlgExtra').innerHTML = extra || '';
    $('#dlgBtns').innerHTML = btns.map((b, i) => `<button class="big ${b[2] || ''}" data-i="${i}">${esc(b[0])}</button>`).join('');
    $('#dlgBtns').onclick = e => { const b = e.target.closest('button'); if (!b) return; const v = btns[+b.dataset.i][1]; $('#dlg').classList.remove('on'); res(v); };
    $('#dlg').classList.add('on');
  });
}
const alertBox = m => dialog(m, [['わかった', true, 'primary']]);
const confirmBox = m => dialog(m, [['はい', true, 'danger'], ['いいえ', false]]);
async function askDate(msg, def) {
  const r = await dialog(msg, [['この日に入れる', 'ok', 'primary'], ['入れない', null]], `<input class="inp" type="date" id="dlgDate" value="${def}" style="margin-top:12px">`);
  return r ? (document.getElementById('dlgDate') || {}).value || def : null;
}

// ===== はじめて =====
async function firstRun() {
  if (S.me) return;
  while (true) {
    const who = await dialog('こよみ帳へようこそ。\nこのスマホを使うのはどなたですか？\n（次からは、いつもこの人のカレンダーから開きます）', [[NAME('f'), 'f', 'primary'], [NAME('m'), 'm', 'primary'], ['🔑 管理者（拓馬）', 'admin']]);
    if (await setMe(who)) break;
  }
  render();
}
(async () => {
  const linked = readSyncLink();
  if (S.me) { S.show = S.me === 'admin' ? 'both' : S.me; saveS(); }
  drawCopy();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  await migrate().catch(e => console.error(e));
  await Promise.all([applyBg().catch(() => { }), loadIcons().catch(() => { })]);
  render();
  await firstRun();
  if (linked) toast('同期をつなぎました');
  if (S.sync) syncNow();
})();
document.addEventListener('visibilitychange', () => { if (document.hidden) return; const v = $('#bg video'); if (v) v.play().catch(() => { }); if (S.sync) syncNow(); else if (!$('#day').classList.contains('on')) render(); });
