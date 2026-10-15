/* ============================================================
   미궁 — 대전 보물항해 · 게임 로직 v2 (타이핑 미궁 + 시간 순위)
   화면: start → game(P01~P10, 제시어 입력) → final(끌린 보물 2개) → result
   시간: 1번 방 입장에 시작, 10번 정답에 정지. 힌트 +30초, 정답 보기 +90초
   저장: localStorage(항상) + Google Sheets 엔드포인트(설정 시)
   ============================================================ */
(function () {
  "use strict";
  const CFG = window.MIGUNG_CONFIG || {};
  const STORAGE_KEY = "migung.v2";
  const QUEUE_KEY = "migung.queue.v2";
  const SCHEMA = 2;

  let PUZZLES = [], PHOTOS = {}, CONTENT = {};
  let PEN = { hintSec: 30, revealSec: 90 };
  let state = null;
  let ui = { lastFocus: null, timerIv: null };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = () => new Date().toISOString();
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmt = (sec) => { sec = Math.max(0, Math.round(sec)); return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`; };
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s·.,!?'"“”‘’\-_()\[\]~]/g, "");

  // ---------- 상태 ----------
  function freshState() {
    return {
      schemaVersion: SCHEMA, contentVersion: "", sessionId: uid(),
      crew: { name: "", dept: "" }, startedAt: null, timerStartedAt: null, finishedAt: null,
      currentPuzzleId: "P01", puzzles: {}, penaltySec: 0,
      picks: { resourceIds: [], reason: "", submittedAt: null },
      settings: { motion: true, large: false },
    };
  }
  function ps(id) {
    if (!state.puzzles[id]) state.puzzles[id] = { status: "open", attempts: 0, hintLevel: 0, assisted: false, solvedAt: null, collectedAt: null, lastInput: "", wrong: [] };
    return state.puzzles[id];
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.schemaVersion !== SCHEMA || !s.sessionId || !s.puzzles) throw new Error("bad");
      return s;
    } catch (e) { return { __corrupt: true }; }
  }
  let storageOk = true;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { if (storageOk) toast("이 브라우저에서는 저장이 제한돼요. 결과 화면에서 기록을 파일로 받아 두세요."); storageOk = false; }
  }
  const nameOf = (rid) => (PUZZLES.find((p) => p.resourceId === rid) || {}).name || (PHOTOS[rid] || {}).name || rid;
  function countCollected() { return PUZZLES.filter((p) => state.puzzles[p.id] && state.puzzles[p.id].status === "collected").length; }
  function idx(id) { return PUZZLES.findIndex((p) => p.id === id); }
  function isUnlocked(id) { const i = idx(id); return i === 0 || ps(PUZZLES[i - 1].id).status === "collected"; }

  // ---------- 시간 ----------
  function elapsedSec() {
    if (!state.timerStartedAt) return 0;
    const end = state.finishedAt ? new Date(state.finishedAt) : new Date();
    return Math.max(0, (end - new Date(state.timerStartedAt)) / 1000);
  }
  function totalSec() { return elapsedSec() + (state.penaltySec || 0); }
  function renderTimer() {
    const t = $("#timer"); if (!t) return;
    t.textContent = fmt(totalSec());
    t.title = `순수 ${fmt(elapsedSec())} + 페널티 ${state.penaltySec || 0}초`;
    const p = $("#timer-pen"); if (p) { p.textContent = state.penaltySec ? `+${state.penaltySec}s` : ""; }
  }
  function startTimerLoop() { clearInterval(ui.timerIv); ui.timerIv = setInterval(renderTimer, 500); renderTimer(); }

  // ---------- 원격 저장(구글 시트) ----------
  const Sync = {
    enabled: () => !!(CFG.SHEET_ENDPOINT && /^https:\/\//.test(CFG.SHEET_ENDPOINT)),
    queue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; } },
    setQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {} },
    summary() {
      const solved = PUZZLES.filter((p) => ["solved", "collected"].includes(ps(p.id).status)).length;
      const collected = countCollected();
      const attempts = PUZZLES.reduce((a, p) => a + ps(p.id).attempts, 0);
      const hints = PUZZLES.reduce((a, p) => a + ps(p.id).hintLevel, 0);
      const assisted = PUZZLES.filter((p) => ps(p.id).assisted).length;
      const done = !!state.finishedAt;
      const tot = Math.round(totalSec()), el = Math.round(elapsedSec());
      const picks = (state.picks.resourceIds || []).map(nameOf).join(" + ");
      return {
        sessionId: state.sessionId, name: state.crew.name, dept: state.crew.dept,
        startedAt: state.startedAt, updatedAt: now(), finishedAt: state.finishedAt,
        currentPuzzleId: state.currentPuzzleId, solved, collected, attempts, hints, assisted,
        interest: "",
        totalSec: done ? tot : "", elapsedSec: el, penaltySec: state.penaltySec || 0,
        picks, reason: state.picks.reason || "",
        // 구버전 시트 컬럼 호환: 완주 시간과 선택을 텍스트로도 남긴다
        ideaResources: picks,
        ideaCustomer: done ? `완주 ${fmt(tot)}` : `진행 ${fmt(tot)}`,
        ideaProblem: `페널티 +${state.penaltySec || 0}s`,
        ideaText: done ? `TOTAL=${tot}s | 보물: ${picks} | ${state.picks.reason || ""}` : "",
        puzzleDetail: PUZZLES.map((p) => { const s = ps(p.id); return `${p.id}:${s.status}/${s.attempts}회/힌트${s.hintLevel}${s.assisted ? "/정답보기" : ""}`; }).join(", "),
        userAgent: navigator.userAgent.slice(0, 120),
      };
    },
    push(type, extra) {
      if (!this.enabled()) return;
      const q = this.queue(); q.push({ type, at: now(), ...this.summary(), ...(extra || {}) }); this.setQueue(q); this.flush();
    },
    flushing: false,
    async flush() {
      if (this.flushing || !this.enabled()) return;
      const q = this.queue(); if (!q.length) return;
      this.flushing = true;
      try {
        await fetch(CFG.SHEET_ENDPOINT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ events: q }) });
        this.setQueue([]); state.lastSyncAt = now(); save();
      } catch (e) {} finally { this.flushing = false; }
    },
  };
  window.addEventListener("online", () => Sync.flush());
  setInterval(() => Sync.flush(), 20000);

  // ---------- 픽셀 아트(나섬이 옆패널) ----------
  const PAL = { k: "#243B4A", o: "#F2A33A", c: "#FFF4D6", a: "#F2B08A", t: "#236D75", p: "#F08AA0", n: "#E0675D", b: "#F7B2B7", e: "#243B4A", h: "#FFFFFF", w: "#FFF7EA", y: "#F6CD69" };
  // 나섬이 24×24 (72px 표시 = 3배) — o 주황, k 외곽·줄무늬, w 주둥이, n 코, p 혀·귀속, b 볼터치, e 눈, h 눈 하이라이트, t 스카프
  const BASE = [
    "....kk............kk....",
    "...kppk..........kppk...",
    "...koppok......koppok...",
    "..koooookkkkkkkkoooook..",
    ".koooookkookkookkoooook.",
    "kooooookkookkookkooooook",
    "kooooooooooooooooooooook",
    "kkkooooooooooooooooookkk",
    "kkkooooheeooooeehooookkk",
    "kkoooooeeeooooeeeoooookk",
    "kkkooooooooooooooooookkk",
    "kkoooooowwwwwwwwooooookk",
    "kooooowwwwwnnwwwwwoooook",
    "kooooowwkwwwwwwkwwoooook",
    ".kooooowwwkkkkwwwoooook.",
    ".koooooowwppppwwooooook.",
    "..kooooooowwwwoooooook..",
    "...kooooooooooooooook...",
    "....kkkooooooooookkk....",
    "......kkkkkkkkkkkk......",
    ".......kttttttttk.......",
    "........kkkkkkkk........",
    "........................",
    "........................",
  ];
  const variant = (edits) => { const r = BASE.slice(); edits.forEach(([i, s]) => (r[i] = s)); return r; };
  const HAPPY8 = "kkkooookkkooookkkooookkk", HAPPY9 = "kkooooooooooooooooooookk";
  const NARU = {
    idle: BASE,
    wave: variant([[8, HAPPY8], [9, HAPPY9]]),
    cheer: variant([[8, HAPPY8], [9, HAPPY9], [0, "y...kk............kk...y"], [14, ".kooooowwkkkkkkwwoooook."]]),
    think: variant([[8, "kkkooookkkooooeehooookkk"], [9, "kkooooooooooooeeeoooookk"], [1, "...kppk..........kppk..y"]]),
    help: variant([[0, "....kk............kk...y"], [15, ".koooooowwwwwwwwooooook."]]),
  };
  function drawPix(canvas, rows) { const h = rows.length, w = rows[0].length; canvas.width = w; canvas.height = h; const c = canvas.getContext("2d"); rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = PAL[row[x]]; if (col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); } } }); }
  function setNaru(mood, text) { const c = $("#naru-side"); if (c) { c.dataset.mood = mood; drawPix(c, NARU[mood] || NARU.idle); } const s = $("#naru-say"); if (s && text) s.textContent = text; }

  // ---------- 화면·모달·토스트 ----------
  function show(name) { $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== name)); window.scrollTo({ top: 0 }); }
  function toast(msg, ms = 3200) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._tm); t._tm = setTimeout(() => (t.hidden = true), ms); }
  function stars() { if (state && state.settings.motion === false) return; const w = document.createElement("div"); w.className = "stars"; for (let i = 0; i < 3; i++) { const s = document.createElement("i"); s.style.left = 45 + i * 5 + "%"; s.style.top = 40 + (i % 2) * 6 + "%"; s.style.animationDelay = i * 80 + "ms"; w.appendChild(s); } document.body.appendChild(w); setTimeout(() => w.remove(), 900); }
  function openModal(html, opts = {}) {
    ui.lastFocus = document.activeElement;
    const root = $("#modal-root"), m = $("#modal");
    m.classList.toggle("wide", !!opts.wide); $("#modal-body").innerHTML = html;
    root.hidden = false; document.body.style.overflow = "hidden"; m.focus();
    if (opts.onOpen) opts.onOpen(m);
  }
  function closeModal() { const root = $("#modal-root"); if (root.hidden) return; root.hidden = true; document.body.style.overflow = ""; $("#modal-body").innerHTML = ""; if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { closeModal(); return; }
    const o = e.target.closest("[data-open]"); if (o) openNamed(o.dataset.open);
  });
  function openNamed(n) { if (n === "howto") openHowto(); else if (n === "sources") openSources(); else if (n === "settings") openSettings(); else if (n === "logbook") openLogbook(); }

  // ---------- 시작 화면 ----------
  function initStart() {
    $("#start-camp").textContent = CFG.CAMP_NAME || "배재대학교 로컬 창업 캠프";
    $("#start-program").textContent = CFG.PROGRAM_NAME || "LOCAL WAVE 0→1";
    const saved = load();
    const hasSave = !!(saved && !saved.__corrupt && saved.startedAt);
    if (hasSave) {
      state = saved;
      $("#crew-name").value = state.crew.name; $("#crew-dept").value = state.crew.dept;
      $("#btn-start-label").textContent = state.finishedAt ? "결과 보기" : "이어서 항해";
      $("#btn-start-reset").hidden = false;
      const g = $("#start-greet"); g.hidden = false;
      g.textContent = state.finishedAt ? `${state.crew.name} 선원, 완주 기록 ${fmt(totalSec())}이 저장돼 있어요.` : `다시 왔구나, ${state.crew.name} 선원! 발견 ${countCollected()}/10, 시간 ${fmt(totalSec())}에서 이어가요.`;
    } else {
      if (saved && saved.__corrupt) toast("이전 기록을 읽을 수 없어 새 항해를 시작해요.");
      state = freshState();
    }
    applySettings();
    window.StartScene.mount({ motion: state.settings.motion !== false });
    const nameEl = $("#crew-name");
    const bubbleFor = () => window.StartScene.setBubble(nameEl.value.trim() ? `${nameEl.value.trim()}, 같이 출항하자냥!` : "같이 출항하자냥!");
    bubbleFor(); nameEl.addEventListener("input", bubbleFor);
    $("#btn-start-reset").addEventListener("click", () => confirmReset(() => { localStorage.removeItem(STORAGE_KEY); location.reload(); }));
    $("#btn-arrive-go").addEventListener("click", () => { $("#arrive-overlay").hidden = true; enterGame(); });
    $("#form-start").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = nameEl.value.trim(), dept = $("#crew-dept").value.trim();
      nameEl.closest("label").classList.toggle("invalid", !name);
      $("#crew-dept").closest("label").classList.toggle("invalid", !dept);
      $("#start-error").hidden = !!(name && dept);
      if (!name || !dept) return;
      if (state.startedAt) { state.crew = { name, dept }; save(); window.StartScene.launch(() => enterGame()); return; }
      startNew(name, dept);
    });
  }
  function startNew(name, dept) {
    state = freshState(); state.crew = { name, dept }; state.startedAt = now(); state.contentVersion = CONTENT.contentVersion || "";
    ps("P01")._arrived = true; save(); Sync.push("start");
    const first = PUZZLES[0];
    $("#arrive-title").textContent = `${first.island || first.name}에 도착!`;
    $("#arrive-text").textContent = `${name} 선원, 첫 수수께끼를 여는 순간부터 시간이 흘러요. 준비됐나요?`;
    window.StartScene.launch(() => { $("#arrive-overlay").hidden = false; $("#btn-arrive-go").focus(); });
  }
  function confirmReset(onYes) {
    openModal(`<h2>처음부터 다시 할까요?</h2>
      <p>이 브라우저에 저장된 <b>${esc(state.crew.name)}</b>의 기록(발견 ${countCollected()}/10, 시간 ${fmt(totalSec())})이 지워져요. 이미 진행자 시트로 보낸 기록은 남아요. 새로 시작하면 시간도 0부터예요.</p>
      <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>취소</button><button type="button" class="btn btn-coral" id="btn-reset-yes">지우고 새로 시작</button></div>`);
    $("#btn-reset-yes").addEventListener("click", () => { closeModal(); onYes(); });
  }

  // ---------- 게임 ----------
  function enterGame() {
    applySettings();
    $("#crew-label").textContent = `${state.crew.name} · ${state.crew.dept}`;
    if (countCollected() === PUZZLES.length) { if (state.picks.submittedAt) return showResult(); return enterFinal(); }
    const cur = PUZZLES.find((p) => ps(p.id).status !== "collected");
    state.currentPuzzleId = cur.id;
    if (!state.timerStartedAt) state.timerStartedAt = now();
    save();
    show("game"); startTimerLoop();
    renderRoute(); renderProgress(); renderLogMini();
    renderPuzzle(cur);
  }
  function renderProgress() {
    const pips = $("#progress-pips"); pips.innerHTML = "";
    PUZZLES.forEach((p) => { const i = document.createElement("i"); const s = ps(p.id).status; i.className = s === "collected" ? "done" : p.id === state.currentPuzzleId ? "cur" : ""; pips.appendChild(i); });
    $("#progress-count").textContent = `${countCollected()}/10`;
  }
  function renderRoute() {
    const ol = $("#route"); ol.innerHTML = "";
    PUZZLES.forEach((p, i) => {
      const s = ps(p.id).status, unlocked = isUnlocked(p.id);
      const li = document.createElement("li");
      li.className = s === "collected" ? "done" : !unlocked ? "locked" : p.id === state.currentPuzzleId ? "cur" : "";
      const label = s === "collected" ? p.name : (p.island || `${i + 1}번 섬`);
      const st = s === "collected" ? "✓" : !unlocked ? "🔒" : p.id === state.currentPuzzleId ? "▸" : "";
      li.innerHTML = `<button type="button" ${unlocked ? "" : 'aria-disabled="true"'} data-go="${p.id}" title="${unlocked ? esc(label) : "앞 섬을 풀면 열려요"}"><b>${pad2(i + 1)}</b><span class="nm">${esc(label)}</span><span class="st">${st}</span></button>`;
      ol.appendChild(li);
    });
    ol.onclick = (e) => {
      const b = e.target.closest("[data-go]"); if (!b) return;
      const p = PUZZLES.find((x) => x.id === b.dataset.go);
      if (!isUnlocked(p.id)) { toast("앞 섬을 먼저 풀어야 열려요."); return; }
      state.currentPuzzleId = p.id; save(); renderRoute(); renderProgress(); renderPuzzle(p);
    };
  }
  function renderLogMini() {
    const box = $("#log-mini"); box.innerHTML = "";
    PUZZLES.forEach((p, i) => { const el = document.createElement("i"); const got = ps(p.id).status === "collected"; el.className = got ? "got" : ""; el.textContent = got ? "★" : pad2(i + 1); el.title = got ? p.name : ""; box.appendChild(el); });
    $("#log-count").textContent = `보물 카드 ${countCollected()}/10`;
  }
  function openArrive(p) {
    ps(p.id)._arrived = true;
    openModal(`<div class="island-arrive"><div class="island-pix"><div class="land"></div><div class="flag"></div><div class="water"></div></div>
      <div><div class="eyebrow">${pad2(idx(p.id) + 1)} / 10 · ${esc(p.island || "섬")} 도착</div>
      <h2>${esc(p.title)}</h2><p>사진과 수수께끼를 읽고 <b>제시어</b>를 입력하세요. 힌트는 +${PEN.hintSec}초, 정답 보기는 +${PEN.revealSec}초예요.</p>
      <div class="btn-row end"><button type="button" class="btn btn-coral" data-close>수수께끼 열기 ▸</button></div></div></div>`);
  }
  function shortDate(d) { const m = String(d || "").match(/(\d{4})/); return m ? m[1] + "년" : d || ""; }
  function photoHtml(p, cls = "") {
    const ph = PHOTOS[p.resourceId];
    return `<div class="photo-frame ${cls}" data-photo="${p.resourceId}">
      <span class="tag photo-tag">사진 관찰</span>
      <img src="${ph.file}" alt="${esc(p.photoAlt || ph.name)}" decoding="async">
      <button type="button" class="btn btn-sm btn-ghost photo-zoom" data-zoom="${p.resourceId}">확대 보기</button>
    </div>
    <div class="photo-meta"><span>${esc(shortDate(ph.date))} 촬영 · ${esc(ph.author)} · ${esc(ph.license)}</span><span class="muted">기록사진이라 지금 모습과 다를 수 있어요</span></div>`;
  }
  function wirePhoto(root) {
    const wireImg = (img) => img.addEventListener("error", () => { const f = img.closest(".photo-frame"); f.classList.add("failed"); f.innerHTML = `<div class="photo-fail"><b>사진을 불러오지 못했어요.</b><span>${esc(img.alt)}</span><button type="button" class="btn btn-sm btn-ghost" data-retry="${esc(img.getAttribute("src"))}" data-alt="${esc(img.alt)}">다시 시도</button></div>`; });
    root.querySelectorAll(".photo-frame img").forEach(wireImg);
    if (root._photoWired) return; root._photoWired = true;
    root.addEventListener("click", (e) => {
      const r = e.target.closest("[data-retry]");
      if (r) { const f = r.closest(".photo-frame"); f.classList.remove("failed"); const img = new Image(); img.alt = r.dataset.alt; img.src = r.dataset.retry + "?r=" + Date.now(); f.innerHTML = `<span class="tag photo-tag">사진 관찰</span>`; f.appendChild(img); f.insertAdjacentHTML("beforeend", `<button type="button" class="btn btn-sm btn-ghost photo-zoom" data-zoom="${esc(f.dataset.photo)}">확대 보기</button>`); wireImg(img); return; }
      const z = e.target.closest("[data-zoom]"); if (z) openZoom(z.dataset.zoom);
    });
  }
  function openZoom(rid) {
    const ph = PHOTOS[rid];
    openModal(`<h2>${esc(ph.name)}</h2><img src="${ph.file}" alt="${esc(ph.description || ph.name)}" style="width:100%;height:auto;max-height:70vh;object-fit:contain;border:3px solid var(--ink);background:var(--cream-2)">
      <p class="muted" style="margin:10px 0 0">${esc(ph.date)} 촬영 · ${esc(ph.author)} · <a href="${esc(ph.license_url)}" target="_blank" rel="noopener">${esc(ph.license)}</a> · <a href="${esc(ph.source)}" target="_blank" rel="noopener">원본 출처</a><br>${esc(ph.modification)}</p>`, { wide: true });
  }

  function renderPuzzle(p) {
    const s = ps(p.id); const panel = $("#puzzle-panel"); const n = pad2(idx(p.id) + 1);
    const done = ["solved", "collected"].includes(s.status);
    panel.innerHTML = `
      <div class="puzzle-head"><span class="tag">P${n}</span><span class="chip chip-leaf">제시어 입력</span><span class="chip chip-sea">${esc(p.island || "")}</span><span class="muted">시도 ${s.attempts}회 · 힌트 ${s.hintLevel}/2</span></div>
      <h2>${esc(p.title)}</h2>
      <div class="photo-row">
        <div>${photoHtml(p)}</div>
        <div class="riddle"><span class="eyebrow">RIDDLE</span>${p.riddle.split("\n").map((l) => `<p>${esc(l)}</p>`).join("")}</div>
      </div>
      <form class="answer-row" id="answer-form" autocomplete="off">
        <label for="answer-input" class="answer-label">제시어</label>
        <input id="answer-input" type="text" maxlength="30" placeholder="${done ? "" : "답을 입력하고 Enter"}" value="${done ? esc(p.answerDisplay) : esc(s.lastInput || "")}" ${done ? "disabled" : ""}>
        <button type="submit" class="btn btn-lg" id="btn-submit" ${done ? "disabled" : ""}>${done ? "정답 ✓" : "제출"}</button>
      </form>
      <div id="feedback"></div>
      <div class="submit-row" id="submit-row"></div>`;
    wirePhoto(panel);
    const form = $("#answer-form"), input = $("#answer-input");
    if (!done) {
      input.addEventListener("input", () => { s.lastInput = input.value; });
      form.addEventListener("submit", (e) => { e.preventDefault(); submit(p); });
      setTimeout(() => input.focus(), 50);
    }
    renderHints(p); renderSubmit(p); updateNaru(p); renderProgress();
    if (done) feedback(s.assisted ? "info" : "right", `${s.assisted ? "정답 보기로 확인했어요" : "정답이에요"}: ${p.answerDisplay}. 보물 카드를 열어 이야기를 읽어 보세요.`);
    if (s.status === "open" && !s._arrived) openArrive(p);
  }
  function feedback(kind, text) { const f = $("#feedback"); if (f) f.innerHTML = `<div class="feedback ${kind}"><span>${kind === "wrong" ? "✕" : kind === "right" ? "★" : "ℹ"}</span><span>${esc(text)}</span></div>`; }
  function check(p, input) {
    const v = norm(input); if (!v) return false;
    const list = p.answers.map(norm);
    if (list.includes(v)) return true;
    const v2 = v.replace(/^대전/, ""); if (v2 && list.includes(v2)) return true;
    return false;
  }
  let submitting = false;
  function submit(p) {
    if (submitting) return; submitting = true;
    const s = ps(p.id); const input = $("#answer-input"); const val = (input.value || "").trim();
    if (!val) { submitting = false; input.focus(); return; }
    s.attempts += 1;
    if (check(p, val)) {
      s.status = "solved"; s.solvedAt = now(); save(); stars();
      setNaru("cheer", "맞았어요! 보물 카드를 열어 이 보물의 이야기를 읽어 봐요.");
      Sync.push("solve", { puzzleId: p.id, result: "correct" });
      renderPuzzle(p);
      setTimeout(() => openDiscovery(p), 350);
    } else {
      s.wrong.push(val); if (s.wrong.length > 20) s.wrong.shift(); save();
      input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
      const msg = s.attempts >= 3 ? "아직이에요. 사진 속 글씨나 수수께끼의 숫자를 다시 봐요. 막히면 힌트를 써도 돼요(+30초)." : "아직이에요. 수수께끼의 조건을 하나씩 다시 맞춰 볼까요?";
      feedback("wrong", msg);
      setNaru("think", s.attempts >= 3 ? "힌트 한 번 열어 볼까요? 30초면 충분히 만회돼요." : "거의 다 왔어요. 입력한 답은 그대로 두고 생각해 봐요.");
      $(".puzzle-head .muted").textContent = `시도 ${s.attempts}회 · 힌트 ${s.hintLevel}/2`;
      input.select();
    }
    submitting = false;
  }
  function renderSubmit(p) {
    const s = ps(p.id); const row = $("#submit-row"); if (!row) return;
    if (s.status === "collected") {
      const next = PUZZLES[idx(p.id) + 1];
      row.innerHTML = `<button type="button" class="btn btn-ghost" id="btn-card-again">보물 카드 다시 보기</button>${next ? `<button type="button" class="btn" id="btn-next">다음 섬으로 ▸</button>` : `<button type="button" class="btn btn-coral" id="btn-next">항해 마무리 ▸</button>`}`;
      $("#btn-card-again").onclick = () => openDiscovery(p);
      $("#btn-next").onclick = () => { if (next) { state.currentPuzzleId = next.id; save(); renderRoute(); renderPuzzle(next); } else enterFinal(); };
    } else if (s.status === "solved") {
      row.innerHTML = `<button type="button" class="btn btn-yellow btn-lg" id="btn-card">보물 카드 열기 ▸</button>`;
      $("#btn-card").onclick = () => openDiscovery(p);
    } else row.innerHTML = "";
  }
  function renderHints(p) {
    const s = ps(p.id); const box = $("#hint-box");
    const locked = ["solved", "collected"].includes(s.status);
    const items = p.hints.slice(0, s.hintLevel).map((h, i) => `<li>힌트 ${i + 1}. ${esc(h)}</li>`).join("");
    let btn = "";
    if (!locked) {
      if (s.hintLevel === 0) btn = `<button type="button" class="btn btn-leaf w-full" id="btn-hint">힌트 1 열기 <small>(+${PEN.hintSec}초)</small></button>`;
      else if (s.hintLevel === 1) btn = `<button type="button" class="btn btn-leaf w-full" id="btn-hint">힌트 2 열기 <small>(+${PEN.hintSec}초)</small></button>`;
      else btn = `<button type="button" class="btn btn-coral w-full" id="btn-reveal">정답 보기 <small>(+${PEN.revealSec}초)</small></button>`;
    } else if (s.assisted) btn = `<p class="muted">정답 보기로 확인했어요 (+${PEN.revealSec}초).</p>`;
    box.innerHTML = `<ul class="hint-list">${items || `<li class="muted" style="border-left-color:var(--sky-2)">힌트는 시간 페널티만 있어요. 막히면 쓰는 게 이득.</li>`}</ul>${btn}`;
    const hb = $("#btn-hint"); if (hb) hb.onclick = () => { s.hintLevel += 1; state.penaltySec = (state.penaltySec || 0) + PEN.hintSec; save(); renderTimer(); renderHints(p); setNaru("help", p.hints[s.hintLevel - 1]); $(".puzzle-head .muted").textContent = `시도 ${s.attempts}회 · 힌트 ${s.hintLevel}/2`; toast(`+${PEN.hintSec}초`, 1500); };
    const rb = $("#btn-reveal"); if (rb) rb.onclick = () => reveal(p);
  }
  function reveal(p) {
    const s = ps(p.id); s.assisted = true; s.status = "solved"; s.solvedAt = now(); state.penaltySec = (state.penaltySec || 0) + PEN.revealSec; save(); renderTimer();
    setNaru("wave", "괜찮아요. 정답과 이야기를 확인하고 다음 섬으로 가요.");
    Sync.push("solve", { puzzleId: p.id, result: "assisted" });
    renderPuzzle(p); setTimeout(() => openDiscovery(p), 300);
  }
  function updateNaru(p) {
    const s = ps(p.id);
    if (s.status === "collected") return setNaru("idle", "이 섬은 끝났어요. 카드는 기록장에서 언제든 다시 볼 수 있어요.");
    if (s.status === "solved") return setNaru("cheer", "보물 카드를 열어 이야기를 읽고 '카드 받기'를 눌러요.");
    setNaru("idle", "사진과 수수께끼 속 숫자·이름을 단서로 써요. 띄어쓰기는 신경 안 써도 돼요.");
  }

  // 보물 카드
  function openDiscovery(p) {
    const s = ps(p.id); const got = s.status === "collected"; const c = p.card || {};
    openModal(`<div class="eyebrow">TREASURE · ${pad2(idx(p.id) + 1)} / 10</div>
      <h2>${esc(p.name)}</h2>
      <div class="card-discover">
        <div>${photoHtml(p)}</div>
        <dl>
          <div><dt>대전의 상징</dt><dd>${esc(c.symbol)}</dd></div>
          <div><dt>이야기</dt><dd>${esc(c.story)}</dd></div>
          <div><dt>가는 법 · 비용</dt><dd>${esc(c.howto)}</dd></div>
          <div><dt>꿀팁</dt><dd class="idea-q">${esc(c.tip)}</dd></div>
          <div><dt>확인 출처</dt><dd><a href="${esc(p.source)}" target="_blank" rel="noopener" style="font-size:13px;word-break:break-all">${esc(p.source)}</a></dd></div>
        </dl>
      </div>
      <div class="btn-row end" style="margin-top:18px">
        <button type="button" class="btn btn-yellow btn-lg" id="btn-collect">${got ? "닫기" : "카드 받기 ▸"}</button>
      </div>`, { wide: true, onOpen: (m) => wirePhoto(m) });
    $("#btn-collect").onclick = () => { closeModal(); if (!got) collect(p); };
  }
  function collect(p) {
    const s = ps(p.id);
    if (s.status !== "collected") { s.status = "collected"; s.collectedAt = now(); save(); Sync.push("collect", { puzzleId: p.id }); }
    renderRoute(); renderProgress(); renderLogMini();
    const next = PUZZLES[idx(p.id) + 1];
    if (!next) { state.finishedAt = state.finishedAt || now(); save(); renderTimer(); Sync.push("finish"); return enterFinal(); }
    state.currentPuzzleId = next.id; save(); renderRoute(); renderPuzzle(next);
  }

  // 기록장
  function openLogbook() {
    openModal(`<div class="eyebrow-row"><span class="eyebrow">LOGBOOK</span><span class="muted">${esc(state.crew.name || "")} · 보물 카드 ${countCollected()}/10 · ${fmt(totalSec())}</span></div>
      <h2>항해 기록장</h2>
      <div class="log-grid">${PUZZLES.map((p, i) => { const got = ps(p.id).status === "collected"; const ph = PHOTOS[p.resourceId];
        if (!got) return `<div class="log-card locked"><div class="ph">${pad2(i + 1)}</div><div class="bd"><b>미발견</b><span class="cat">${esc(p.island || "")}</span></div></div>`;
        return `<button type="button" class="log-card" data-card="${p.id}"><div class="ph"><img src="${ph.file}" alt="${esc(p.photoAlt)}" loading="lazy"></div><div class="bd"><b>${esc(p.name)}</b><span class="cat">${esc(p.island || "")}</span></div></button>`; }).join("")}</div>`,
      { wide: true, onOpen: (m) => m.addEventListener("click", (e) => { const c = e.target.closest("[data-card]"); if (c) openDiscovery(PUZZLES.find((p) => p.id === c.dataset.card)); }) });
  }

  // ---------- 마무리: 끌린 보물 2개 ----------
  function enterFinal() {
    $("#crew-label-2").textContent = `${state.crew.name} · ${state.crew.dept}`;
    show("idea"); clearInterval(ui.timerIv);
    const i = state.picks; const body = $("#idea-body");
    $("#idea-steps").innerHTML = `<span class="done">10/10 발견</span><span class="done">완주 ${fmt(totalSec())}</span><span class="on">끌린 보물 2개</span><span>결과</span>`;
    const render = () => {
      body.innerHTML = `<div class="eyebrow">FINISH</div><h2>완주! 기록 ${fmt(totalSec())}</h2>
        <p class="muted">순수 ${fmt(elapsedSec())} + 페널티 ${state.penaltySec || 0}초. 순위는 진행자 화면에서 발표돼요.</p>
        <h3 style="margin-top:14px">10개 보물 중 가장 끌린 2개를 고르세요</h3>
        <p class="muted">다음 시간에 '왜 끌렸는지'를 창업 재료로 꺼내 쓸 거예요.</p>
        <div class="pick-grid">${PUZZLES.map((p) => { const ph = PHOTOS[p.resourceId]; const on = i.resourceIds.includes(p.resourceId); return `<button type="button" class="log-card ${on ? "on" : ""}" data-pick="${p.resourceId}" aria-pressed="${on}"><div class="ph"><img src="${ph.file}" alt="${esc(p.photoAlt)}" loading="lazy"></div><div class="bd"><b>${esc(p.name)}</b><span class="cat">${esc((p.card || {}).symbol || "")}</span></div></button>`; }).join("")}</div>
        <div class="field"><label for="pick-reason">왜 끌렸나요? 한 줄 (선택)</label><input id="pick-reason" type="text" maxlength="120" placeholder="예: 친구 데려가면 반응 좋을 것 같아서" value="${esc(i.reason || "")}"></div>
        <div class="btn-row end" style="margin-top:16px"><button type="button" class="btn btn-coral btn-lg" id="btn-finish" ${i.resourceIds.length === 2 ? "" : "disabled"}>기록 제출 ▸</button></div>`;
      $("#pick-reason").oninput = (e) => { i.reason = e.target.value; save(); };
      $("#btn-finish").onclick = () => { i.submittedAt = now(); save(); Sync.push("picks"); showResult(); };
    };
    render();
    body.onclick = (e) => { const b = e.target.closest("[data-pick]"); if (!b) return; const r = b.dataset.pick; const k = i.resourceIds.indexOf(r); if (k >= 0) i.resourceIds.splice(k, 1); else { if (i.resourceIds.length >= 2) { toast("2개까지예요. 하나를 해제한 뒤 고르세요."); return; } i.resourceIds.push(r); } save(); render(); };
  }

  // ---------- 결과 ----------
  function shareText() { const s = Sync.summary(); return `[미궁 — 대전 보물항해] ${state.crew.name}(${state.crew.dept}) 완주 ${fmt(s.totalSec)} (힌트 ${s.hints}, 페널티 +${s.penaltySec}s) · 끌린 보물: ${s.picks}`; }
  function showResult() {
    show("result"); clearInterval(ui.timerIv);
    const s = Sync.summary(); const i = state.picks;
    $("#result-panel").innerHTML = `
      <div class="result-head"><span class="tag">${esc(CFG.CAMP_NAME || "배재대학교 로컬 창업 캠프")}</span><span class="chip chip-sea">LOCAL WAVE 0→1</span></div>
      <h2 style="font-size:30px;margin-top:10px">${esc(state.crew.name)} 선원의 항해 기록</h2>
      <p class="muted">${esc(state.crew.dept)} · 발견 10/10 · 시도 ${s.attempts}회 · 힌트 ${s.hints}개 · 정답 보기 ${s.assisted}회</p>
      <div class="big-sentence" id="big-sentence">완주 기록 <b style="font-family:var(--font-pixel);font-size:1.3em">${fmt(s.totalSec)}</b><br><span class="muted" style="font-size:15px;font-weight:500">순수 ${fmt(s.elapsedSec)} + 페널티 ${s.penaltySec}초 · 가장 빨리 푼 상위 3명은 2점!</span></div>
      <div class="result-grid">
        <div class="result-box"><div class="eyebrow">끌린 보물</div>${i.resourceIds.map((r) => `<div><b>${esc(nameOf(r))}</b></div>`).join("")}</div>
        <div class="result-box"><div class="eyebrow">왜</div><div>${esc(i.reason || "—")}</div></div>
      </div>
      <p>보물 카드의 '가는 법'을 보고 이번 주말에 하나는 직접 가 보세요. 다음 시간에 이 보물들을 창업 재료로 다시 꺼냅니다.</p>
      <div class="btn-row">
        <button type="button" class="btn" id="btn-copy">기록 복사</button>
        <button type="button" class="btn btn-ghost" data-open="logbook">보물 카드 다시 보기</button>
        <button type="button" class="btn btn-ghost" id="btn-export">기록 저장 (JSON)</button>
      </div>
      <p class="save-state ${Sync.enabled() ? (Sync.queue().length ? "warn" : "ok") : ""}" id="save-state">${Sync.enabled() ? (Sync.queue().length ? "진행자 시트로 아직 보내지 못한 기록이 있어요. 인터넷이 연결되면 자동으로 다시 보내요." : "진행자 시트에 기록을 보냈어요. 순위는 진행자가 발표해요.") : "이 기록은 이 브라우저에만 저장돼요. 진행자에게 화면을 보여 주세요."}</p>
      <div class="btn-row" style="margin-top:20px"><button type="button" class="link" id="btn-restart">처음부터 다시 하기</button><button type="button" class="link" data-open="sources">사진 출처</button></div>
      <p class="muted" style="margin-top:10px;font-size:12px">사진: Wikimedia Commons 공개 라이선스 · 나섬이는 배재대학교 캐릭터이며 이 게임의 픽셀 호랑이는 캠프용 자체 제작</p>`;
    $("#btn-copy").onclick = async (e) => { try { await navigator.clipboard.writeText(shareText()); e.target.textContent = "복사했어요 ✓"; } catch (err) { toast("복사가 막혔어요. 화면을 캡처해 주세요."); } };
    $("#btn-export").onclick = () => { const blob = new Blob([JSON.stringify({ ...state, summary: s }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `미궁_${state.crew.name}_${state.crew.dept}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    $("#btn-restart").onclick = () => confirmReset(() => { localStorage.removeItem(STORAGE_KEY); location.reload(); });
    Sync.flush();
  }

  // ---------- 설정·출처·사용법 ----------
  function applySettings() { document.documentElement.dataset.motion = state && state.settings.motion === false ? "off" : "on"; document.documentElement.dataset.large = state && state.settings.large ? "1" : "0"; }
  function openSettings() {
    const st = state.settings;
    const row = (k, label, desc) => `<div class="setting-row"><div><b>${label}</b><div class="muted">${desc}</div></div><button type="button" class="switch" role="switch" aria-checked="${!!st[k]}" data-set="${k}" aria-label="${label}"></button></div>`;
    openModal(`<h2>설정</h2>${row("motion", "움직임", "물결과 고양이 애니메이션.")}${row("large", "글자 크게 보기", "본문 글자를 한 단계 키워요.")}
      <div class="setting-row"><div><b>저장 상태</b><div class="muted">${storageOk ? "이 브라우저에 자동 저장 중" : "이 브라우저에서는 저장이 제한돼요"} · ${Sync.enabled() ? `진행자 시트 연결됨${Sync.queue().length ? ` (대기 ${Sync.queue().length}건)` : ""}` : "진행자 시트 미연결"}</div></div></div>
      <div class="danger-zone"><b>처음부터 다시</b><div class="muted">기록과 시간을 지우고 새로 시작해요.</div><div class="btn-row" style="margin-top:8px"><button type="button" class="btn btn-sm btn-ghost" id="btn-reset-all">기록 지우고 새로 시작</button></div></div>`, {
      onOpen: (m) => { m.addEventListener("click", (e) => { const b = e.target.closest("[data-set]"); if (!b) return; const k = b.dataset.set; st[k] = !st[k]; b.setAttribute("aria-checked", st[k]); save(); applySettings(); if (k === "motion" && window.StartScene) window.StartScene.setMotion(st[k]); }); $("#btn-reset-all").onclick = () => confirmReset(() => { localStorage.removeItem(STORAGE_KEY); location.reload(); }); },
    });
  }
  function openSources() {
    const rows = PUZZLES.map((p) => PHOTOS[p.resourceId]).map((ph) => `<tr><td><b>${esc(ph.name)}</b></td><td>${esc(ph.author)}</td><td>${esc(ph.date)}</td><td><a href="${esc(ph.license_url || ph.source)}" target="_blank" rel="noopener">${esc(ph.license)}</a></td><td><a href="${esc(ph.source)}" target="_blank" rel="noopener">Wikimedia Commons</a></td></tr>`).join("");
    openModal(`<h2>사진 출처</h2><p class="muted">모든 사진은 Wikimedia Commons의 공개 라이선스 사진이에요. 자르기와 색상 변경 없이 축소만 했어요. 기록사진이라 현재 모습과 다를 수 있어요. 실비김치 방의 사진은 일반 배추김치 사진이에요.</p>
      <div class="table-wrap"><table class="src-table"><thead><tr><th>장소</th><th>저작자</th><th>촬영 시점</th><th>라이선스</th><th>원문</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="margin-top:14px">캐릭터 고지: '나섬이'는 배재대학교의 캐릭터예요. 이 게임의 픽셀 호랑이는 배재대 캠프용으로 자체 제작한 그림이며, 학교의 공식 이미지·로고를 사용하지 않았어요. 캠프 외 용도로는 쓰지 않아요.</p>`, { wide: true });
  }
  function openHowto() {
    openModal(`<h2>사용 방법</h2>
      <ol style="padding-left:20px;display:grid;gap:8px">
        <li>섬마다 <b>사진 한 장</b>과 <b>수수께끼</b>가 있어요. 답은 대전의 보물(장소·브랜드·캐릭터) 이름이에요.</li>
        <li>답을 <b>직접 입력</b>하고 Enter. 띄어쓰기·대소문자는 상관없고, 별명도 어지간하면 인정돼요.</li>
        <li>틀려도 페널티는 없어요. 입력한 답은 남아 있으니 고쳐서 다시 제출.</li>
        <li>막히면 <b>힌트 2개</b>(+${PEN.hintSec}초씩), 그래도 안 되면 <b>정답 보기</b>(+${PEN.revealSec}초).</li>
        <li>맞히면 <b>보물 카드</b>(상징·이야기·가는 법·꿀팁)를 읽고 <b>카드 받기</b> → 다음 섬.</li>
        <li>시간은 1번 섬을 여는 순간 시작, 10번 정답에 멈춰요. <b>가장 빨리 푼 상위 3명은 2점!</b></li>
      </ol>
      <p class="muted">새로고침해도 같은 섬과 시간으로 돌아와요. 예상 소요 20~30분.</p>
      <div class="btn-row end"><button type="button" class="btn" data-close>알겠어요</button></div>`);
  }
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY && e.newValue) toast("다른 탭에서 기록이 갱신됐어요. 새로고침하면 최신 기록을 불러와요.", 6000); });

  // ---------- 부팅 ----------
  async function boot() {
    try {
      const [pz, ph] = await Promise.all([fetch("data/puzzles.json").then((r) => r.json()), fetch("data/photos.json").then((r) => r.json())]);
      CONTENT = pz; PUZZLES = pz.puzzles; if (pz.penalties) PEN = pz.penalties;
      ph.forEach((x) => (PHOTOS[x.id] = { ...x, file: x.file || "photos/" + x.id + ".jpg" }));
    } catch (e) {
      document.body.innerHTML = `<div class="narrow"><div class="panel"><h2>문제 데이터를 불러오지 못했어요</h2><p>인터넷 연결을 확인한 뒤 새로고침해 주세요.</p></div></div>`; return;
    }
    const c = $("#naru-side"); if (c) drawPix(c, NARU.idle);
    initStart(); show("start");
    Object.values(PHOTOS).forEach((p) => { const im = new Image(); im.src = p.file; });
    Sync.flush();
  }
  boot();
})();
