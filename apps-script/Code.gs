/**
 * 미궁 — 대전 보물항해 · 구글 시트 저장 백엔드 (Google Apps Script)
 *
 * 시트 구성(자동 생성):
 *  - events : 모든 이벤트 원본 (start / solve / collect / idea) 한 줄씩 누적
 *  - crew   : 선원(sessionId)별 최신 요약 1줄 (upsert) — 진행자 화면이 읽는 탭
 *
 * 배포: 배포 > 새 배포 > 유형 "웹 앱" > 실행 계정 "나" > 액세스 권한 "모든 사용자"
 * 웹앱 URL을 site/config.js 의 SHEET_ENDPOINT 에 넣는다.
 */
var ADMIN_KEY = "captain"; // site/config.js 의 ADMIN_KEY 와 같게

var EVENT_COLS = ["at", "type", "sessionId", "name", "dept", "puzzleId", "result", "collected", "attempts", "hints", "assisted", "currentPuzzleId", "ideaResources", "ideaCustomer", "ideaProblem", "ideaText", "userAgent"];
var CREW_COLS = ["sessionId", "name", "dept", "startedAt", "updatedAt", "finishedAt", "currentPuzzleId", "solved", "collected", "attempts", "hints", "assisted", "interest", "ideaResources", "ideaCustomer", "ideaProblem", "ideaText", "puzzleDetail", "userAgent"];

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(cols); sh.setFrozenRows(1); }
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

    // crew upsert: sessionId 기준으로 마지막 이벤트의 요약을 반영
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
    return ContentService.createTextOutput(JSON.stringify({ ok: true, n: events.length })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
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
  return json_({ ok: true, service: "migung", time: new Date().toISOString() });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
