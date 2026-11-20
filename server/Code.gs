// こよみ帳 同期サーバー（Google Apps Script）
// 1) setup を1回実行（スプレッドシートと写真フォルダを作り、合言葉を作ります）
// 2) ウェブアプリとしてデプロイ（実行ユーザー：自分 / アクセス：全員）
var SHEET = 'data';
var PARENT = '13doBV8GSvhd_suZtgyMba_E8SWeXgCSY'; // 会社ドライブ「開発アプリ/14_こよみ帳」
function parent_() { try { return DriveApp.getFolderById(PARENT); } catch (e) { return DriveApp.getRootFolder(); } }
function props_() { return PropertiesService.getScriptProperties(); }
function ss_() {
  var id = props_().getProperty('SSID');
  if (id) return SpreadsheetApp.openById(id);
  var s = SpreadsheetApp.create('こよみ帳データ（さわらないでください）');
  var sh = s.getSheets()[0]; sh.setName(SHEET); sh.appendRow(['kind', 'id', 'updated', 'deleted', 'srv', 'json']);
  props_().setProperty('SSID', s.getId());
  try { DriveApp.getFileById(s.getId()).moveTo(parent_()); } catch (e) { }
  return s;
}
function sheet_() { return ss_().getSheetByName(SHEET); }
function folder_() {
  var id = props_().getProperty('FOLDER');
  if (id) return DriveApp.getFolderById(id);
  var f = parent_().createFolder('こよみ帳の写真（さわらないでください）');
  props_().setProperty('FOLDER', f.getId());
  return f;
}
function setup() {
  if (!props_().getProperty('KEY')) props_().setProperty('KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  ss_(); folder_();
  try { DriveApp.getFileById(ScriptApp.getScriptId()).moveTo(parent_()); } catch (e) { }
  Logger.log('KEY=' + props_().getProperty('KEY'));
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function ok_(k) { var key = props_().getProperty('KEY'); return key && k === key; }

function doGet(e) {
  var q = e.parameter || {};
  if (!ok_(q.key)) return out_({ error: 'auth' });
  try {
    if (q.action === 'ping') return out_({ ok: true, now: Date.now() });
    if (q.action === 'pull') {
      var since = Number(q.since || 0);
      var v = sheet_().getDataRange().getValues(), items = [];
      for (var i = 1; i < v.length; i++) {
        if (Number(v[i][4]) > since) items.push({ kind: v[i][0], id: String(v[i][1]), updated: Number(v[i][2]), deleted: v[i][3] === true || v[i][3] === 'TRUE', json: String(v[i][5]) });
      }
      return out_({ now: Date.now(), items: items });
    }
    if (q.action === 'file') {
      var f = DriveApp.getFileById(q.id);
      if (!isMine_(f)) return out_({ error: 'notfound' });
      return out_({ b64: Utilities.base64Encode(f.getBlob().getBytes()), type: f.getMimeType() });
    }
    return out_({ error: 'action' });
  } catch (err) { return out_({ error: String(err) }); }
}
function trash_(id) { if (!id) return; try { var ff = DriveApp.getFileById(id); if (isMine_(ff)) ff.setTrashed(true); } catch (x) { } }
function isMine_(f) { var p = f.getParents(); var fid = props_().getProperty('FOLDER'); while (p.hasNext()) if (p.next().getId() === fid) return true; return false; }

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'json' }); }
  if (!ok_(b.key)) return out_({ error: 'auth' });
  try {
    if (b.action === 'upload') {
      var blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.type || 'image/jpeg', b.name || 'photo.jpg');
      var f = folder_().createFile(blob);
      if (b.replace) trash_(b.replace);
      return out_({ fileId: f.getId() });
    }
    if (b.action === 'push') {
      var lock = LockService.getScriptLock(); lock.waitLock(25000);
      try {
        var sh = sheet_(), last = sh.getLastRow();
        var v = last > 1 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
        var idx = {};
        for (var i = 0; i < v.length; i++) idx[v[i][0] + '|' + v[i][1]] = i + 2;
        var now = Date.now(), app = [];
        (b.items || []).forEach(function (it, n) {
          var row = [it.kind, String(it.id), Number(it.updated), !!it.deleted, now + n, it.json];
          var r = idx[it.kind + '|' + it.id];
          if (r > 0) { if (Number(v[r - 2][2]) <= Number(it.updated)) sh.getRange(r, 1, 1, 6).setValues([row]); }
          else if (!r) { app.push(row); idx[it.kind + '|' + it.id] = -1; }
          if ((it.kind === 'photo' || it.kind === 'meta') && it.deleted) { try { var j = JSON.parse(it.json); [j.fileId, j.thumbId].forEach(trash_); } catch (x) { } }
        });
        if (app.length) sh.getRange(sh.getLastRow() + 1, 1, app.length, 6).setValues(app);
        return out_({ ok: true, now: now });
      } finally { lock.releaseLock(); }
    }
    return out_({ error: 'action' });
  } catch (err) { return out_({ error: String(err) }); }
}
