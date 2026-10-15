/**
 * 미궁 — 대전 보물항해 · 구글 시트 저장 백엔드 (Google Apps Script) v2
 *
 * 시트 구성(자동 생성):
 *  - events : 모든 이벤트 원본 (start / solve / collect / finish / picks) 한 줄씩 누적
 *  - crew   : 선원(sessionId)별 최신 요약 1줄 (upsert) — 진행자 화면이 읽어 순위를 매긴다
 *
 * v2 변경: totalSec(완주 초), elapsedSec, penaltySec, picks, reason 컬럼 추가.
 * 기존 crew 탭이 v1 헤더면 자동으로 v2 헤더로 바꾼다(기존 행은 유지, 새 컬럼은 비어 있음).
 *
 * 배포: 배포 > 배포 관리 > 연필 > 버전 "새 버전" > 배포 (URL은 그대로)
 */
var ADMIN_KEY = "captain"; // site/config.js 의 ADMIN_KEY 와 같게

var EVENT_COLS = ["at", "type", "sessionId", "name", "dept", "puzzleId", "result", "collected", "attempts", "hints", "assisted", "currentPuzzleId", "totalSec", "elapsedSec", "penaltySec", "picks", "reason", "userAgent"];
var CREW_COLS = ["sessionId", "name", "dept", "startedAt", "updatedAt", "finishedAt", "currentPuzzleId", "solved", "collected", "attempts", "hints", "assisted", "totalSec", "elapsedSec", "penaltySec", "picks", "reason", "ideaResources", "ideaCustomer", "ideaProblem", "ideaText", "puzzleDetail", "userAgent"];

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(cols); sh.setFrozenRows(1); return sh; }
  // 헤더가 다르면(v1) v2 헤더로 갱신
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (head.join("|") !== cols.join("|")) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  }
  return sh;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    var events = body.events || [];
    var ev = sheet_("events", EVENT_COLS);
    var crew = sheet_("crew", CREW_COLS);
    var rows = events.map(function (x) { return EVENT_COLS.map(function (c) { return x[c] == null ? "" : x[c]; }); });
    if (rows.length) ev.getRange(ev.getLastRow() + 1, 1, rows.length, EVENT_COLS.length).setValues(rows);

    var data = crew.getDataRange().getValues();
    var index = {};
    for (var i = 1; i < data.length; i++) index[data[i][0]] = i + 1;
    events.forEach(function (x) {
      if (!x.sessionId) return;
      var row = CREW_COLS.map(function (c) { return x[c] == null ? "" : x[c]; });
      var r = index[x.sessionId];
      if (r) crew.getRange(r, 1, 1, CREW_COLS.length).setValues([row]);
      else { crew.appendRow(row); index[x.sessionId] = crew.getLastRow(); }
    });
    return json_({ ok: true, n: events.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === "crew") {
    if (ADMIN_KEY && p.key !== ADMIN_KEY) return json_({ ok: false, error: "key" });
    var sh = sheet_("crew", CREW_COLS);
    var data = sh.getDataRange().getValues();
    var head = data[0] || CREW_COLS;
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var o = {};
      head.forEach(function (h, k) { o[h] = data[i][k]; });
      rows.push(o);
    }
    return json_({ ok: true, rows: rows });
  }
  return json_({ ok: true, service: "migung", version: 2, time: new Date().toISOString() });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
