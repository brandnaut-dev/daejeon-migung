/* ============================================================
   미궁 — 대전 보물항해 · 게임 로직
   화면: start → game(P01~P10) → idea → result
   저장: localStorage(항상) + Google Sheets 엔드포인트(설정 시)
   ============================================================ */
(function () {
  "use strict";
  const CFG = window.MIGUNG_CONFIG || {};
  const STORAGE_KEY = "migung.v1";
  const QUEUE_KEY = "migung.queue.v1";
  const SCHEMA = 1;

  const CATEGORY = {
    "01_sungsimdang": "맛/상권", "02_jungang": "맛/상권", "03_station": "맛/상권",
    "04_science": "과학/문화", "09_art": "과학/문화",
    "10_zoo": "놀이/휴식", "06_yuseong": "놀이/휴식",
    "05_hanbat": "자연/역사", "07_daecheong": "자연/역사", "08_gyejok": "자연/역사",
  };
  const ISLAND_WORD = {
    "01_sungsimdang": "맛의 섬", "02_jungang": "시장 섬", "03_station": "출발의 섬", "04_science": "과학 섬",
    "09_art": "미술 섬", "10_zoo": "놀이 섬", "05_hanbat": "정원 섬", "06_yuseong": "휴식 섬",
    "08_gyejok": "성벽 섬", "07_daecheong": "호수 섬",
  };
  const CUSTOMERS = ["대전에 처음 온 대학생", "주말 가족 방문객", "짧은 틈의 방문객"];
  const PROBLEMS = ["무엇부터 할지 모름", "이동이 복잡함", "설명이 어려움", "기다림이 지루함"];
  const TYPE_LABEL = { choice: "선택형", order: "순서형", match: "연결형" };

  // ---------- 상태 ----------
  let PUZZLES = [];
  let PHOTOS = {};
  let state = null;
  let ui = { pick: null, matchLeft: null, ideaStep: 0, logFilter: "전체", lastFocus: null };

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = () => new Date().toISOString();

  function freshState() {
    return {
      schemaVersion: SCHEMA, contentVersion: "", sessionId: uid(),
      crew: { name: "", dept: "" }, startedAt: null, finishedAt: null,
      currentPuzzleId: "P01", puzzles: {}, interest: [],
      idea: { resourceIds: [], customer: "", problem: "", ideaText: "", submittedAt: null },
      settings: { motion: true, large: false, sound: false },
    };
  }
  function puzzleState(id) {
    if (!state.puzzles[id]) state.puzzles[id] = { status: "available", selectedAnswer: null, attempts: 0, hintLevel: 0, assisted: false, solvedAt: null, collectedAt: null };
    return state.puzzles[id];
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.schemaVersion !== SCHEMA || !s.sessionId || !s.puzzles) throw new Error("bad");
      return s;
    } catch (e) {
      return { __corrupt: true };
    }
  }
  let storageOk = true;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { if (storageOk) toast("이 브라우저에서는 저장이 제한돼요. 결과 화면에서 기록을 파일로 받아 두세요."); storageOk = false; }
  }

  // ---------- 원격 저장(구글 시트) ----------
  const Sync = {
    enabled: () => !!(CFG.SHEET_ENDPOINT && /^https:\/\//.test(CFG.SHEET_ENDPOINT)),
    queue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (e) { return []; } },
    setQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {} },
    summary() {
      const solved = PUZZLES.filter((p) => ["solved", "collected"].includes(puzzleState(p.id).status));
      const collected = PUZZLES.filter((p) => puzzleState(p.id).status === "collected");
      const attempts = PUZZLES.reduce((a, p) => a + puzzleState(p.id).attempts, 0);
      const hints = PUZZLES.reduce((a, p) => a + puzzleState(p.id).hintLevel, 0);
      const assisted = PUZZLES.filter((p) => puzzleState(p.id).assisted).length;
      const i = state.idea;
      return {
        sessionId: state.sessionId, name: state.crew.name, dept: state.crew.dept,
        startedAt: state.startedAt, updatedAt: now(), finishedAt: state.finishedAt,
        currentPuzzleId: state.currentPuzzleId, solved: solved.length, collected: collected.length,
        attempts, hints, assisted, interest: state.interest.join("|"),
        ideaResources: (i.resourceIds || []).map((r) => PHOTOS[r]?.name || r).join(" + "),
        ideaCustomer: i.customer, ideaProblem: i.problem, ideaText: i.ideaText,
        puzzleDetail: PUZZLES.map((p) => { const s = puzzleState(p.id); return `${p.id}:${s.status}/${s.attempts}회/힌트${s.hintLevel}${s.assisted ? "/함께" : ""}`; }).join(", "),
        userAgent: navigator.userAgent.slice(0, 120),
      };
    },
    push(type, extra) {
      if (!this.enabled()) return;
      const q = this.queue();
      q.push({ type, at: now(), ...this.summary(), ...(extra || {}) });
      this.setQueue(q);
      this.flush();
    },
    flushing: false,
    async flush() {
      if (this.flushing || !this.enabled()) return;
      const q = this.queue();
      if (!q.length) return;
      this.flushing = true;
      try {
        // Apps Script는 text/plain + no-cors로 보내야 preflight 없이 받는다.
        await fetch(CFG.SHEET_ENDPOINT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ events: q }) });
        this.setQueue([]);
        state.lastSyncAt = now(); save();
      } catch (e) {
        // 남겨 두고 다음에 재시도
      } finally { this.flushing = false; }
    },
  };
  window.addEventListener("online", () => Sync.flush());
  setInterval(() => Sync.flush(), 20000);

  // ---------- 픽셀 아트 ----------
  const PAL = { k: "#243B4A", c: "#FFF4D6", a: "#F2B08A", t: "#236D75", p: "#E0675D", e: "#243B4A", w: "#FFFFFF", y: "#F6CD69", r: "#F28B82", s: "#FFF8E7", b: "#8C5A3C" };
  const NARU = {
    idle: [
      "..kk........kk..", "..kak......kak..", "..kaak....kaak..", "..kaaakkkkaaak..",
      "..kccccccccccck.", ".kcccccccccccck.", ".kcceccccccecck.", ".kcccccccccccck.",
      ".kccccckpkcccck.", ".kcccccckccccck.", "..kccccccccccck.", "..kkkttttttkkk..",
      "...kccccccck....", "...kcccccccck...", "...kcck..kcck...", "...kkk...kkk....",
    ],
    wave: null, think: null, cheer: null, help: null,
  };
  function variant(rows, edits) { const r = rows.slice(); edits.forEach(([i, s]) => (r[i] = s)); return r; }
  NARU.wave = variant(NARU.idle, [[6, ".kckkcccccckkck."], [9, ".kccccckkkccccck".slice(0, 16)], [12, "ak.kccccccck...."], [13, "k..kcccccccck..."]]);
  NARU.think = variant(NARU.idle, [[6, ".kcceccccckkcck."], [9, ".kccccccckcccck."], [0, "..kk........kk.y"]]);
  NARU.cheer = variant(NARU.idle, [[6, ".kckkcccccckkck."], [8, ".kacccckpkccccak".slice(0, 16)], [9, ".kccccckkkccccck".slice(0, 16)], [0, "y.kk........kk.y"]]);
  NARU.help = variant(NARU.idle, [[6, ".kcweccccccewck."], [9, ".kcccccckccccck."], [11, "..kkkttttttkkk.y"]]);
  const BOAT = [
    "..............k.............",
    "..............kk............",
    "..............ksk...........",
    "..............kssk..........",
    "..............ksssk.........",
    "..............kssssk........",
    "..............ksssssk.......",
    "..............kssssssk......",
    "..............kkkkkkkkk.....",
    "..............k.............",
    ".kkkkkkkkkkkkkkkkkkkkkkkkkk.",
    ".krrrrrrrrrrrrrrrrrrrrrrrrk.",
    "..kkrrrrkkrrrrkkrrrrkkrrrk..",
    "...kkrrrrrrrrrrrrrrrrrrrk...",
    "....kkkkkkkkkkkkkkkkkkkk....",
  ];
  function drawPix(canvas, rows) {
    const h = rows.length, w = rows[0].length;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = PAL[row[x]]; if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } } });
  }
  function drawNaru(canvas, mood) { canvas.dataset.mood = mood; drawPix(canvas, NARU[mood] || NARU.idle); }
  function drawAllNaru() { $$("canvas.naru").forEach((c) => drawNaru(c, c.dataset.mood || "idle")); $$("canvas.boat").forEach((c) => drawPix(c, BOAT)); }
  let idleTimer = null;
  function naruIdle() {
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (state && state.settings.motion === false) return;
      $$("canvas.naru").forEach((c) => { if (c.dataset.mood === "idle") { drawPix(c, NARU.think); setTimeout(() => { if (c.dataset.mood === "idle") drawPix(c, NARU.idle); }, 320); } });
    }, 4000);
  }

  // ---------- 화면 전환 ----------
  function show(name) {
    $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== name));
    window.scrollTo({ top: 0 });
  }
  function toast(msg, ms = 3200) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(t._tm); t._tm = setTimeout(() => (t.hidden = true), ms);
  }
  function stars() {
    if (state && state.settings.motion === false) return;
    const wrap = document.createElement("div"); wrap.className = "stars";
    for (let i = 0; i < 3; i++) { const s = document.createElement("i"); s.style.left = 45 + i * 5 + "%"; s.style.top = 40 + (i % 2) * 6 + "%"; s.style.animationDelay = i * 80 + "ms"; wrap.appendChild(s); }
    document.body.appendChild(wrap); setTimeout(() => wrap.remove(), 900);
  }

  // ---------- 모달 ----------
  function openModal(html, opts = {}) {
    ui.lastFocus = document.activeElement;
    const root = $("#modal-root"), m = $("#modal");
    m.classList.toggle("wide", !!opts.wide);
    $("#modal-body").innerHTML = html;
    root.hidden = false; document.body.style.overflow = "hidden";
    m.focus();
    if (opts.onOpen) opts.onOpen(m);
  }
  function closeModal() {
    const root = $("#modal-root"); if (root.hidden) return;
    root.hidden = true; document.body.style.overflow = "";
    $("#modal-body").innerHTML = "";
    if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus();
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]"); if (c) { closeModal(); return; }
    const o = e.target.closest("[data-open]"); if (o) { openNamed(o.dataset.open); }
  });
  function openNamed(name) {
    if (name === "howto") return openHowto();
    if (name === "sources") return openSources();
    if (name === "settings") return openSettings();
    if (name === "logbook") return openLogbook();
  }

  // ---------- 시작 화면 ----------
  function initStart() {
    $("#start-camp").textContent = CFG.CAMP_NAME || "배재대학교 로컬 창업 캠프";
    $("#start-program").textContent = CFG.PROGRAM_NAME || "LOCAL WAVE 0→1";
    const saved = load();
    const hasSave = !!(saved && !saved.__corrupt && saved.startedAt);
    if (hasSave) {
      state = saved;
      $("#crew-name").value = state.crew.name; $("#crew-dept").value = state.crew.dept;
      $("#btn-start-label").textContent = "이어서 항해";
      $("#btn-start-reset").hidden = false;
      const g = $("#start-greet"); g.hidden = false;
      g.textContent = `다시 왔구나, ${state.crew.name} 선원! 발견 ${countCollected()}/10 기록은 그대로 있어요.`;
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
      if (state.startedAt) {
        // 이어서 항해: 이름·학과를 고쳤으면 반영만 하고 기록은 유지
        state.crew = { name, dept }; save();
        window.StartScene.launch(() => enterGame());
        return;
      }
      startNew(name, dept);
    });
  }
  function startNew(name, dept) {
    state = freshState();
    state.crew = { name, dept };
    state.startedAt = now();
    state.contentVersion = (window.__content && window.__content.contentVersion) || "";
    puzzleState("P01")._arrived = true;
    save();
    Sync.push("start");
    const first = PUZZLES[0];
    $("#arrive-title").textContent = `${PHOTOS[first.resourceId]?.name || ""} 섬에 도착!`;
    $("#arrive-text").textContent = `${name} 선원, 첫 번째 수수께끼가 기다리고 있어요.`;
    window.StartScene.launch(() => { $("#arrive-overlay").hidden = false; $("#btn-arrive-go").focus(); });
  }
  function confirmReset(onYes) {
    openModal(`<h2>처음부터 다시 할까요?</h2>
      <p>지금 브라우저에 저장된 <b>${esc(state.crew.name)}</b>의 항해 기록(발견 카드 ${countCollected()}장, 아이디어 입력)이 지워져요. 이미 구글 시트로 보낸 기록은 남아 있어요.</p>
      <div class="btn-row end"><button type="button" class="btn btn-ghost" data-close>취소</button><button type="button" class="btn btn-coral" id="btn-reset-yes">지우고 새로 시작</button></div>`);
    $("#btn-reset-yes").addEventListener("click", () => { closeModal(); onYes(); });
  }

  // ---------- 게임 ----------
  function countCollected() { return PUZZLES.filter((p) => state.puzzles[p.id] && state.puzzles[p.id].status === "collected").length; }
  function idx(id) { return PUZZLES.findIndex((p) => p.id === id); }
  function isUnlocked(id) {
    const i = idx(id); if (i === 0) return true;
    const prev = PUZZLES[i - 1]; return puzzleState(prev.id).status === "collected";
  }
  function enterGame() {
    applySettings();
    $("#crew-label").textContent = `${state.crew.name} · ${state.crew.dept}`;
    if (countCollected() === PUZZLES.length) { if (state.idea.submittedAt) return showResult(); return enterIdea(); }
    // 현재 섬: 완료되지 않은 첫 섬
    const cur = PUZZLES.find((p) => puzzleState(p.id).status !== "collected");
    state.currentPuzzleId = cur.id; save();
    show("game");
    renderRoute(); renderProgress(); renderLogMini();
    const ps = puzzleState(cur.id);
    if (ps.status === "available" && !ps._arrived) openArrive(cur);
    renderPuzzle(cur);
  }
  function renderProgress() {
    const pips = $("#progress-pips"); pips.innerHTML = "";
    PUZZLES.forEach((p) => { const i = document.createElement("i"); const s = puzzleState(p.id).status; i.className = s === "collected" ? "done" : p.id === state.currentPuzzleId ? "cur" : ""; pips.appendChild(i); });
    $("#progress-count").textContent = `${countCollected()}/10`;
  }
  function renderRoute() {
    const ol = $("#route"); ol.innerHTML = "";
    PUZZLES.forEach((p, i) => {
      const s = puzzleState(p.id).status, unlocked = isUnlocked(p.id);
      const li = document.createElement("li");
      li.className = s === "collected" ? "done" : !unlocked ? "locked" : p.id === state.currentPuzzleId ? "cur" : "";
      const name = PHOTOS[p.resourceId]?.name || p.title;
      const st = s === "collected" ? "✓" : !unlocked ? "🔒" : p.id === state.currentPuzzleId ? "▸" : "";
      li.innerHTML = `<button type="button" ${unlocked ? "" : 'aria-disabled="true"'} data-go="${p.id}" title="${unlocked ? esc(name) : "앞 섬 발견 후 열림"}"><b>${String(i + 1).padStart(2, "0")}</b><span class="nm">${esc(name)}</span><span class="st">${st}</span></button>`;
      ol.appendChild(li);
    });
    ol.onclick = (e) => {
      const b = e.target.closest("[data-go]"); if (!b) return;
      const p = PUZZLES.find((x) => x.id === b.dataset.go);
      if (!isUnlocked(p.id)) { toast("앞 섬을 먼저 발견해야 열려요."); return; }
      state.currentPuzzleId = p.id; save(); renderRoute(); renderProgress(); renderPuzzle(p);
    };
  }
  function renderLogMini() {
    const box = $("#log-mini"); box.innerHTML = "";
    PUZZLES.forEach((p, i) => { const el = document.createElement("i"); const got = puzzleState(p.id).status === "collected"; el.className = (got ? "got" : "") + (state.interest.includes(p.resourceId) ? " heart" : ""); el.textContent = got ? "★" : String(i + 1).padStart(2, "0"); el.title = PHOTOS[p.resourceId]?.name || ""; box.appendChild(el); });
    $("#log-count").textContent = `자원 카드 ${countCollected()}/10`;
  }
  function openArrive(p) {
    const ps = puzzleState(p.id); ps._arrived = true;
    const name = PHOTOS[p.resourceId]?.name || p.title;
    openModal(`<div class="island-arrive"><div class="island-pix"><div class="land"></div><div class="flag"></div><div class="water"></div></div>
      <div><div class="eyebrow">${String(idx(p.id) + 1).padStart(2, "0")} · ${esc(ISLAND_WORD[p.resourceId] || "섬")} 도착</div>
      <h2>${esc(name)}</h2><p>${esc(p.story)}</p>
      <div class="btn-row end"><button type="button" class="btn btn-coral" data-close>수수께끼 풀기 ▸</button></div></div></div>`);
  }

  function photoHtml(p, cls = "") {
    const ph = PHOTOS[p.resourceId];
    const alt = esc(p.photoAlt || ph?.name || "");
    return `<div class="photo-frame ${cls}" data-photo="${p.resourceId}">
      <span class="tag photo-tag">사진 관찰</span>
      <img src="${ph.file}" alt="${alt}" loading="eager" decoding="async">
      <button type="button" class="btn btn-sm btn-ghost photo-zoom" data-zoom="${p.resourceId}">확대 보기</button>
    </div>
    <div class="photo-meta"><span>${esc(ph.name)} · ${esc(shortDate(ph.date))} 촬영 · ${esc(ph.author)} · ${esc(ph.license)}</span><span class="muted">기록사진이라 현재 모습과 다를 수 있어요</span></div>`;
  }
  function shortDate(d) { const m = String(d || "").match(/(\d{4})/); return m ? m[1] + "년" : d || ""; }
  function wirePhoto(root) {
    const wireImg = (img) => img.addEventListener("error", () => {
      const f = img.closest(".photo-frame"); f.classList.add("failed");
      f.innerHTML = `<div class="photo-fail"><b>사진을 불러오지 못했어요.</b><span>${esc(img.alt)}</span><button type="button" class="btn btn-sm btn-ghost" data-retry="${esc(img.getAttribute("src"))}" data-alt="${esc(img.alt)}">다시 시도</button></div>`;
    });
    root.querySelectorAll(".photo-frame img").forEach(wireImg);
    if (root._photoWired) return; root._photoWired = true;
    root.addEventListener("click", (e) => {
      const r = e.target.closest("[data-retry]");
      if (r) {
        const f = r.closest(".photo-frame"); f.classList.remove("failed");
        const img = new Image(); img.alt = r.dataset.alt; img.src = r.dataset.retry + "?r=" + Date.now();
        f.innerHTML = `<span class="tag photo-tag">사진 관찰</span>`; f.appendChild(img);
        f.insertAdjacentHTML("beforeend", `<button type="button" class="btn btn-sm btn-ghost photo-zoom" data-zoom="${esc(f.dataset.photo)}">확대 보기</button>`);
        wireImg(img); return;
      }
      const z = e.target.closest("[data-zoom]"); if (z) openZoom(z.dataset.zoom);
    });
  }
  function openZoom(rid) {
    const ph = PHOTOS[rid];
    openModal(`<h2>${esc(ph.name)}</h2>
      <img src="${ph.file}" alt="${esc(ph.description || ph.name)}" style="width:100%;height:auto;max-height:70vh;object-fit:contain;border:3px solid var(--ink);background:var(--cream-2)">
      <p class="muted" style="margin:10px 0 0">${esc(ph.date)} 촬영 · ${esc(ph.author)} · <a href="${esc(ph.license_url)}" target="_blank" rel="noopener">${esc(ph.license)}</a> · <a href="${esc(ph.source)}" target="_blank" rel="noopener">원본 출처</a><br>${esc(ph.modification)}</p>`, { wide: true });
  }

  function renderPuzzle(p) {
    const ps = puzzleState(p.id);
    const panel = $("#puzzle-panel");
    const n = String(idx(p.id) + 1).padStart(2, "0");
    const done = ["solved", "revealed", "collected"].includes(ps.status);
    panel.innerHTML = `
      <div class="puzzle-head"><span class="tag">P${n}</span><span class="chip chip-leaf">${TYPE_LABEL[p.type]}</span><span class="chip chip-sea">${esc(PHOTOS[p.resourceId]?.name || "")}</span><span class="muted">${esc(p.difficulty)} · 약 ${Math.round(p.estimatedSeconds / 60)}분</span></div>
      <h2>${esc(p.title)}</h2>
      <p class="puzzle-story">${esc(p.story)}</p>
      <div class="photo-row">
        <div>${photoHtml(p)}</div>
        <div class="clues"><span class="eyebrow">CLUES</span>${p.clues.map((c, i) => `<div class="clue"><b>${i + 1}</b><span>${esc(c)}</span></div>`).join("")}${p.fictionalConditions ? `<p class="fiction-note">시간·가격·요청은 게임 속 가상 조건이에요.</p>` : ""}</div>
      </div>
      <p class="question">${esc(p.question)}</p>
      <div id="answer-area"></div>
      <div id="feedback"></div>
      <div class="submit-row" id="submit-row"></div>`;
    wirePhoto(panel);
    renderAnswer(p);
    renderHints(p);
    updateNaru(p);
    renderProgress();
    if (done) showSolved(p, ps.status === "revealed");
  }

  function renderAnswer(p) {
    const ps = puzzleState(p.id);
    const area = $("#answer-area");
    const locked = ["solved", "revealed", "collected"].includes(ps.status);
    const sel = ps.selectedAnswer;
    const answer = p.answer;
    if (p.type === "choice") {
      area.innerHTML = `<div class="answers">${p.options.map((o) => {
        let cls = "opt"; if (sel === o.id) cls += " selected";
        if (locked && o.id === answer) cls += " correct"; else if (locked && sel === o.id) cls += " wrong";
        if (!locked && ps.status === "incorrect" && sel === o.id) cls += " wrong";
        return `<button type="button" class="${cls}" data-opt="${o.id}" ${locked ? "disabled" : ""} aria-pressed="${sel === o.id}"><b>${o.id}</b><span>${esc(o.label)}</span></button>`;
      }).join("")}</div>`;
      area.onclick = (e) => { const b = e.target.closest("[data-opt]"); if (!b || locked) return; ps.selectedAnswer = b.dataset.opt; ps.status = "ready"; save(); renderAnswer(p); clearFeedback(); };
    } else if (p.type === "order") {
      const seq = Array.isArray(sel) ? sel : [];
      area.innerHTML = `<p class="order-help">카드를 실행 순서대로 눌러요. 누른 카드를 다시 누르면 선택이 풀려요.</p><div class="order-list">${p.options.map((o) => {
        const k = seq.indexOf(o.id);
        let cls = "opt"; if (k >= 0) cls += " selected";
        if (locked) cls += " correct";
        return `<button type="button" class="${cls}" data-ord="${o.id}" ${locked ? "disabled" : ""}><span>${esc(o.label)}</span>${locked ? `<span class="seq">${answer.indexOf(o.id) + 1}번째</span>` : k >= 0 ? `<span class="seq">${k + 1}번째</span>` : ""}</button>`;
      }).join("")}</div>`;
      area.onclick = (e) => {
        const b = e.target.closest("[data-ord]"); if (!b || locked) return;
        let s = Array.isArray(ps.selectedAnswer) ? ps.selectedAnswer.slice() : [];
        const id = b.dataset.ord; const k = s.indexOf(id);
        if (k >= 0) s = s.slice(0, k); else s.push(id);
        ps.selectedAnswer = s; ps.status = s.length === p.options.length ? "ready" : "exploring"; save(); renderAnswer(p); clearFeedback(); renderSubmit(p);
      };
    } else if (p.type === "match") {
      const pairs = sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {};
      const L = p.options.left, R = p.options.right;
      const rightLabel = (id) => R.find((r) => r.id === id)?.label || id;
      const leftOf = (rid) => Object.keys(pairs).find((l) => pairs[l] === rid);
      area.innerHTML = `<p class="match-help">왼쪽 요청을 고른 다음 오른쪽 항목을 누르면 연결돼요. 연결된 요청을 다시 누르면 풀려요.</p>
        <div class="match-grid"><div class="col-h">요청</div><div class="col-h">연결할 항목</div>
        ${L.map((l, i) => {
          const r = R[i];
          const lp = locked ? answer[l.id] : pairs[l.id];
          let lc = "opt"; if (ui.matchLeft === l.id && !locked) lc += " active"; if (lp) lc += " paired";
          const rl = locked ? Object.keys(answer).find((k) => answer[k] === r.id) : leftOf(r.id);
          let rc = "opt"; if (rl) rc += " paired";
          return `<button type="button" class="${lc}" data-ml="${l.id}" ${locked ? "disabled" : ""}><b>${l.id}</b><span>${esc(l.label)}</span>${lp ? `<span class="pair">→ ${esc(rightLabel(lp))}</span>` : ""}</button>
                  <button type="button" class="${rc}" data-mr="${r.id}" ${locked ? "disabled" : ""}><b>${r.id}</b><span>${esc(r.label)}</span>${rl ? `<span class="pair">${rl} 연결</span>` : ""}</button>`;
        }).join("")}</div>`;
      area.onclick = (e) => {
        if (locked) return;
        const l = e.target.closest("[data-ml]"), r = e.target.closest("[data-mr]");
        const cur = sel && typeof sel === "object" && !Array.isArray(sel) ? { ...sel } : {};
        if (l) { const id = l.dataset.ml; if (cur[id]) { delete cur[id]; ui.matchLeft = null; } else ui.matchLeft = ui.matchLeft === id ? null : id; }
        else if (r && ui.matchLeft) { const rid = r.dataset.mr; Object.keys(cur).forEach((k) => { if (cur[k] === rid) delete cur[k]; }); cur[ui.matchLeft] = rid; ui.matchLeft = null; }
        else if (r && !ui.matchLeft) { toast("먼저 왼쪽 요청을 골라 주세요."); return; }
        ps.selectedAnswer = cur; ps.status = Object.keys(cur).length === L.length ? "ready" : "exploring"; save(); renderAnswer(p); clearFeedback(); renderSubmit(p);
      };
    }
    renderSubmit(p);
  }
  function isReady(p) {
    const s = puzzleState(p.id).selectedAnswer;
    if (p.type === "choice") return !!s;
    if (p.type === "order") return Array.isArray(s) && s.length === p.options.length;
    if (p.type === "match") return s && typeof s === "object" && Object.keys(s).length === p.options.left.length;
    return false;
  }
  function renderSubmit(p) {
    const ps = puzzleState(p.id); const row = $("#submit-row"); if (!row) return;
    if (ps.status === "collected") {
      const next = PUZZLES[idx(p.id) + 1];
      row.innerHTML = `<span class="muted">이 섬의 카드는 이미 기록장에 있어요.</span>${next ? `<button type="button" class="btn" id="btn-next">다음 섬으로 ▸</button>` : `<button type="button" class="btn btn-coral" id="btn-next">아이디어 출항 ▸</button>`}`;
      $("#btn-next").onclick = () => { if (next) { state.currentPuzzleId = next.id; save(); renderRoute(); renderPuzzle(next); const nps = puzzleState(next.id); if (nps.status === "available" && !nps._arrived) openArrive(next); } else enterIdea(); };
      return;
    }
    if (["solved", "revealed"].includes(ps.status)) {
      row.innerHTML = `<button type="button" class="btn btn-yellow btn-lg" id="btn-card">발견 카드 보기 ▸</button>`;
      $("#btn-card").onclick = () => openDiscovery(p);
      return;
    }
    row.innerHTML = `<button type="button" class="btn btn-lg" id="btn-submit" ${isReady(p) ? "" : "disabled"}>정답 제출</button>`;
    $("#btn-submit").onclick = () => submit(p);
  }
  function clearFeedback() { const f = $("#feedback"); if (f) f.innerHTML = ""; }
  function feedback(kind, text) { const f = $("#feedback"); if (f) f.innerHTML = `<div class="feedback ${kind}"><span>${kind === "wrong" ? "✕" : kind === "right" ? "★" : "ℹ"}</span><span>${esc(text)}</span></div>`; }
  function check(p, s) {
    if (p.type === "choice") return s === p.answer;
    if (p.type === "order") return Array.isArray(s) && s.join(",") === p.answer.join(",");
    if (p.type === "match") return s && Object.keys(p.answer).every((k) => s[k] === p.answer[k]);
    return false;
  }
  let submitting = false;
  function submit(p) {
    if (submitting) return; submitting = true;
    const ps = puzzleState(p.id);
    if (!isReady(p)) { submitting = false; return; }
    ps.attempts += 1;
    if (check(p, ps.selectedAnswer)) {
      ps.status = "solved"; ps.solvedAt = now(); save();
      stars(); setNaru("cheer", "발견했어요! 대전의 자원 카드가 기록장에 추가돼요. 발견 카드를 열어 볼까요?");
      renderAnswer(p); feedback("right", "정답이에요. " + p.explanation);
      Sync.push("solve", { puzzleId: p.id, result: "correct" });
      setTimeout(() => openDiscovery(p), 350);
    } else {
      ps.status = "incorrect"; save();
      let msg = p.wrongFeedback || "조건 하나를 다시 확인해 볼까요?";
      if (p.type === "choice" && p.wrongFeedbackByAnswer) msg = p.wrongFeedbackByAnswer[ps.selectedAnswer] || p.wrongFeedbackByAnswer.default || msg;
      renderAnswer(p); feedback("wrong", "거의 다 왔어요. " + msg);
      setNaru("think", ps.attempts >= 2 ? "힌트를 한 번 열어 봐도 좋아요. 오른쪽 힌트 버튼을 눌러 보세요." : "조건 하나를 다시 확인해 볼까요? 선택은 그대로 남아 있어요.");
    }
    submitting = false;
  }

  // 힌트
  function renderHints(p) {
    const ps = puzzleState(p.id); const box = $("#hint-box");
    const locked = ["solved", "revealed", "collected"].includes(ps.status);
    const items = p.hints.slice(0, ps.hintLevel).map((h, i) => `<li>힌트 ${i + 1}. ${esc(h)}</li>`).join("");
    let btn = "";
    if (!locked) {
      if (ps.hintLevel === 0) btn = `<button type="button" class="btn btn-leaf w-full" id="btn-hint">힌트 열기 (2개 남음)</button>`;
      else if (ps.hintLevel === 1) btn = `<button type="button" class="btn btn-leaf w-full" id="btn-hint">힌트 한 번 더 (1개 남음)</button>`;
      else btn = `<button type="button" class="btn btn-coral w-full" id="btn-reveal">함께 풀기 (정답 보기)</button>`;
    } else if (ps.assisted) btn = `<p class="muted">함께 풀기로 정답을 확인했어요.</p>`;
    box.innerHTML = `<ul class="hint-list">${items || `<li class="muted" style="border-left-color:var(--sky-2)">막히면 언제든 열어 보세요. 페널티는 없어요.</li>`}</ul>${btn}`;
    const hb = $("#btn-hint"); if (hb) hb.onclick = () => { ps.hintLevel += 1; save(); renderHints(p); setNaru("help", p.hints[ps.hintLevel - 1]); };
    const rb = $("#btn-reveal"); if (rb) rb.onclick = () => reveal(p);
  }
  function reveal(p) {
    const ps = puzzleState(p.id);
    ps.assisted = true; ps.status = "revealed"; ps.solvedAt = ps.solvedAt || now(); ps.selectedAnswer = p.answer; save();
    renderAnswer(p); renderHints(p);
    feedback("info", "함께 풀었어요. " + p.explanation + " " + (p.helpCompletion || ""));
    setNaru("wave", "괜찮아요, 같이 풀면 돼요. 정답과 이유를 확인하고 발견 카드를 받아요.");
    Sync.push("solve", { puzzleId: p.id, result: "assisted" });
  }
  function showSolved(p, assisted) {
    feedback(assisted ? "info" : "right", (assisted ? "함께 풀었어요. " : "정답이에요. ") + p.explanation);
  }
  function setNaru(mood, text) { const c = $("#naru-side"); if (c) drawNaru(c, mood); const s = $("#naru-say"); if (s && text) s.textContent = text; }
  function updateNaru(p) {
    const ps = puzzleState(p.id);
    if (ps.status === "collected") return setNaru("idle", "이 섬은 이미 발견했어요. 사진과 해설은 언제든 다시 볼 수 있어요.");
    if (["solved", "revealed"].includes(ps.status)) return setNaru("cheer", "발견 카드를 열어 자원과 창업 질문을 확인해요.");
    const tips = { choice: "사진부터 꼼꼼히 살펴봐요. 단서 세 개가 모두 맞는 답을 찾아요.", order: "단서의 연결어를 보면 순서가 보여요. 카드를 차례대로 눌러 봐요.", match: "요청마다 어떤 필요가 있는지 보고 짝을 지어요. 선 끌기는 필요 없어요." };
    setNaru("idle", tips[p.type]);
  }

  // 발견 카드
  function openDiscovery(p) {
    const ps = puzzleState(p.id); const ph = PHOTOS[p.resourceId];
    const got = ps.status === "collected";
    const heart = state.interest.includes(p.resourceId);
    openModal(`<div class="eyebrow">DISCOVERY · ${esc(CATEGORY[p.resourceId] || "")}</div>
      <h2>${esc(ph.name)} 카드</h2>
      <div class="card-discover">
        <div>${photoHtml(p)}</div>
        <dl>
          <div><dt>관찰한 사실</dt><dd>${esc(p.photoAlt)}</dd></div>
          <div><dt>왜 지역의 기회가 될까</dt><dd>${esc(p.learning)}</dd></div>
          <div><dt>창업 질문</dt><dd class="idea-q">${esc(p.ideaPrompt)}</dd></div>
          <div><dt>교육 내용 확인 출처</dt><dd><a href="${esc(p.source)}" target="_blank" rel="noopener" style="font-size:14px;word-break:break-all">${esc(p.source)}</a></dd></div>
        </dl>
      </div>
      <div class="btn-row between" style="margin-top:18px">
        <button type="button" class="btn btn-ghost" id="btn-heart" aria-pressed="${heart}">${heart ? "♥ 관심 카드" : "♡ 관심 카드로 표시"}</button>
        <button type="button" class="btn btn-yellow btn-lg" id="btn-collect">${got ? "기록장에 있어요 ✓" : "카드 받기 ▸"}</button>
      </div>`, { wide: true, onOpen: (m) => wirePhoto(m) });
    $("#btn-heart").onclick = (e) => { toggleInterest(p.resourceId); const on = state.interest.includes(p.resourceId); e.currentTarget.textContent = on ? "♥ 관심 카드" : "♡ 관심 카드로 표시"; e.currentTarget.setAttribute("aria-pressed", on); renderLogMini(); };
    $("#btn-collect").onclick = () => { closeModal(); collect(p); };
  }
  function toggleInterest(rid) { const i = state.interest.indexOf(rid); if (i >= 0) state.interest.splice(i, 1); else state.interest.push(rid); save(); }
  function collect(p) {
    const ps = puzzleState(p.id);
    if (ps.status !== "collected") { ps.status = "collected"; ps.collectedAt = now(); save(); Sync.push("collect", { puzzleId: p.id }); toast(`${PHOTOS[p.resourceId].name} 카드를 기록장에 넣었어요. (${countCollected()}/10)`); }
    renderRoute(); renderProgress(); renderLogMini();
    const next = PUZZLES[idx(p.id) + 1];
    if (!next) { state.finishedAt = state.finishedAt || now(); save(); return enterIdea(); }
    state.currentPuzzleId = next.id; save(); renderRoute(); renderPuzzle(next);
    const nps = puzzleState(next.id); if (nps.status === "available" && !nps._arrived) openArrive(next);
  }

  // 기록장
  function openLogbook() {
    const filters = ["전체", "맛/상권", "과학/문화", "놀이/휴식", "자연/역사"];
    const render = () => `<div class="eyebrow-row"><span class="eyebrow">LOGBOOK</span><span class="muted">${esc(state.crew.name || "")} · 자원 카드 ${countCollected()}/10 · 관심 ${state.interest.length}장</span></div>
      <h2>항해 기록장</h2>
      <div class="log-filters">${filters.map((f) => `<button type="button" class="${ui.logFilter === f ? "on" : ""}" data-f="${f}">${f}</button>`).join("")}</div>
      <div class="log-grid">${PUZZLES.filter((p) => ui.logFilter === "전체" || CATEGORY[p.resourceId] === ui.logFilter).map((p, i) => {
        const got = puzzleState(p.id).status === "collected"; const ph = PHOTOS[p.resourceId]; const n = String(idx(p.id) + 1).padStart(2, "0");
        if (!got) return `<div class="log-card locked"><div class="ph">${n}</div><div class="bd"><b>미발견</b><span class="cat">${n}번 섬 · ${esc(CATEGORY[p.resourceId])}</span></div></div>`;
        return `<button type="button" class="log-card" data-card="${p.id}"><div class="ph"><img src="${ph.file}" alt="${esc(p.photoAlt)}" loading="lazy"></div><div class="bd"><b>${esc(ph.name)} ${state.interest.includes(p.resourceId) ? '<span class="heart">♥</span>' : ""}</b><span class="cat">${n}번 섬 · ${esc(CATEGORY[p.resourceId])}</span></div></button>`;
      }).join("")}</div>`;
    openModal(render(), { wide: true, onOpen: (m) => {
      m.addEventListener("click", (e) => {
        const f = e.target.closest("[data-f]"); if (f) { ui.logFilter = f.dataset.f; $("#modal-body").innerHTML = render(); return; }
        const c = e.target.closest("[data-card]"); if (c) openDiscovery(PUZZLES.find((p) => p.id === c.dataset.card));
      });
    } });
  }

  // ---------- 아이디어 출항 ----------
  function enterIdea() {
    $("#crew-label-2").textContent = `${state.crew.name} · ${state.crew.dept}`;
    show("idea"); ui.ideaStep = 0; renderIdea();
  }
  function renderIdea() {
    const steps = ["카드 2장", "고객", "문제", "한 문장"];
    const i = state.idea;
    $("#idea-steps").innerHTML = steps.map((s, k) => `<span class="${k === ui.ideaStep ? "on" : k < ui.ideaStep ? "done" : ""}">${k + 1}. ${s}</span>`).join("");
    const body = $("#idea-body");
    const picked = i.resourceIds.map((r) => `<span class="chip">${esc(PHOTOS[r]?.name || r)}</span>`).join("");
    const strip = i.resourceIds.length ? `<div class="picked-strip"><span class="muted">선택한 자원</span>${picked}</div>` : "";
    const cust = i.customer, prob = i.problem;
    const nav = (prevOk, nextOk, nextLabel = "다음 ▸") => `<div class="btn-row between" style="margin-top:18px"><button type="button" class="btn btn-ghost" id="idea-prev" ${prevOk ? "" : "disabled"}>◂ 이전</button><button type="button" class="btn btn-coral" id="idea-next" ${nextOk ? "" : "disabled"}>${nextLabel}</button></div>`;
    if (ui.ideaStep === 0) {
      body.innerHTML = `<div class="eyebrow">STEP 1</div><h2>마음에 드는 자원 카드 2장을 고르세요</h2><p class="muted">관심 표시(♥)한 카드가 앞에 와요. 발견 10/10을 끝낸 모든 카드에서 고를 수 있어요.</p>${strip}
        <div class="pick-grid">${PUZZLES.slice().sort((a, b) => state.interest.includes(b.resourceId) - state.interest.includes(a.resourceId)).map((p) => { const ph = PHOTOS[p.resourceId]; const on = i.resourceIds.includes(p.resourceId); return `<button type="button" class="log-card ${on ? "on" : ""}" data-pick="${p.resourceId}" aria-pressed="${on}"><div class="ph"><img src="${ph.file}" alt="${esc(p.photoAlt)}" loading="lazy"></div><div class="bd"><b>${esc(ph.name)} ${state.interest.includes(p.resourceId) ? '<span class="heart">♥</span>' : ""}</b><span class="cat">${esc(p.learning)}</span></div></button>`; }).join("")}</div>
        ${nav(false, i.resourceIds.length === 2)}`;
      body.onclick = (e) => { const b = e.target.closest("[data-pick]"); if (!b) return; const r = b.dataset.pick; const k = i.resourceIds.indexOf(r); if (k >= 0) i.resourceIds.splice(k, 1); else { if (i.resourceIds.length >= 2) { toast("카드는 2장까지 고를 수 있어요. 하나를 해제한 뒤 고르세요."); return; } i.resourceIds.push(r); } save(); renderIdea(); };
    } else if (ui.ideaStep === 1) {
      const custom = cust && !CUSTOMERS.includes(cust) ? cust : "";
      body.innerHTML = `<div class="eyebrow">STEP 2</div><h2>누구를 위한 아이디어인가요?</h2>${strip}
        <div class="choices">${CUSTOMERS.map((c) => `<button type="button" class="opt ${cust === c ? "selected" : ""}" data-c="${esc(c)}" aria-pressed="${cust === c}"><span>${esc(c)}</span></button>`).join("")}
        <div class="field"><label for="cust-custom">직접 입력</label><input id="cust-custom" type="text" maxlength="40" placeholder="예: 혼자 여행 온 외국인 유학생" value="${esc(custom)}"></div></div>
        ${nav(true, !!cust)}`;
      body.onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; i.customer = b.dataset.c; $("#cust-custom").value = ""; save(); renderIdea(); };
      $("#cust-custom").oninput = (e) => { i.customer = e.target.value.trim(); $$("[data-c]", body).forEach((b) => b.classList.remove("selected")); $("#idea-next").disabled = !i.customer; save(); };
    } else if (ui.ideaStep === 2) {
      const custom = prob && !PROBLEMS.includes(prob) ? prob : "";
      body.innerHTML = `<div class="eyebrow">STEP 3</div><h2>${esc(cust)}이(가) 겪는 문제는?</h2>${strip}
        <div class="choices">${PROBLEMS.map((c) => `<button type="button" class="opt ${prob === c ? "selected" : ""}" data-p="${esc(c)}" aria-pressed="${prob === c}"><span>${esc(c)}</span></button>`).join("")}
        <div class="field"><label for="prob-custom">직접 입력</label><input id="prob-custom" type="text" maxlength="40" placeholder="예: 비가 오면 계획을 다시 짜야 함" value="${esc(custom)}"></div></div>
        ${nav(true, !!prob)}`;
      body.onclick = (e) => { const b = e.target.closest("[data-p]"); if (!b) return; i.problem = b.dataset.p; $("#prob-custom").value = ""; save(); renderIdea(); };
      $("#prob-custom").oninput = (e) => { i.problem = e.target.value.trim(); $$("[data-p]", body).forEach((b) => b.classList.remove("selected")); $("#idea-next").disabled = !i.problem; save(); };
    } else {
      const res = i.resourceIds.map((r) => PHOTOS[r]?.name || r).join("과 ");
      body.innerHTML = `<div class="eyebrow">STEP 4</div><h2>아이디어를 한 문장으로 만들어요</h2>${strip}
        <div class="sentence">우리는 <b>${esc(cust)}</b>이(가) 겪는 <b>${esc(prob)}</b> 문제를 <b>${esc(res)}</b>을(를) 활용한 <b class="blank" id="svc-preview">${esc(i.ideaText) || "[경험/서비스]"}</b>(으)로 해결한다.</div>
        <div class="field" style="margin-top:14px"><label for="idea-text">어떤 경험·서비스인가요? (120자 내외)</label><textarea id="idea-text" rows="3" maxlength="160" placeholder="예: 빵 구매 전후 30분 동선을 안내하는 포장·보관 서비스">${esc(i.ideaText)}</textarea><div class="counter"><span id="idea-count">${i.ideaText.length}</span>/160</div></div>
        ${nav(true, i.ideaText.trim().length >= 5, "항해 완료 ▸")}`;
      $("#idea-text").oninput = (e) => { i.ideaText = e.target.value; $("#svc-preview").textContent = i.ideaText || "[경험/서비스]"; $("#svc-preview").classList.toggle("blank", !i.ideaText); $("#idea-count").textContent = i.ideaText.length; $("#idea-next").disabled = i.ideaText.trim().length < 5; save(); };
    }
    const prev = $("#idea-prev"), next = $("#idea-next");
    if (prev) prev.onclick = () => { ui.ideaStep = Math.max(0, ui.ideaStep - 1); renderIdea(); };
    if (next) next.onclick = () => { if (ui.ideaStep < 3) { ui.ideaStep += 1; renderIdea(); } else finishIdea(); };
  }
  function finishIdea() {
    state.idea.submittedAt = now(); state.finishedAt = state.finishedAt || now(); save();
    Sync.push("idea");
    showResult();
  }

  // ---------- 결과 ----------
  function sentence() {
    const i = state.idea; const res = i.resourceIds.map((r) => PHOTOS[r]?.name || r).join("과 ");
    return `우리는 ${i.customer}이(가) 겪는 ${i.problem} 문제를 ${res}을(를) 활용한 ${i.ideaText.trim()}(으)로 해결한다.`;
  }
  function showResult() {
    show("result");
    const s = Sync.summary();
    const i = state.idea;
    $("#result-panel").innerHTML = `
      <div class="result-head"><span class="tag">${esc(CFG.CAMP_NAME || "배재대학교 로컬 창업 캠프")}</span><span class="chip chip-sea">LOCAL WAVE 0→1</span></div>
      <h2 style="font-size:30px;margin-top:10px">${esc(state.crew.name)} 선원의 항해 기록</h2>
      <p class="muted">${esc(state.crew.dept)} · 발견 ${s.collected}/10 · 시도 ${s.attempts}회 · 힌트 ${s.hints}개</p>
      <div class="result-grid">
        <div class="result-box"><div class="eyebrow">선택한 자원</div>${i.resourceIds.map((r) => `<div><b>${esc(PHOTOS[r]?.name || r)}</b> <span class="muted">${esc(CATEGORY[r] || "")}</span></div>`).join("")}</div>
        <div class="result-box"><div class="eyebrow">고객과 문제</div><div><b>${esc(i.customer)}</b></div><div>${esc(i.problem)}</div></div>
      </div>
      <div class="eyebrow">팀의 첫 아이디어</div>
      <div class="big-sentence" id="big-sentence">${esc(sentence())}</div>
      <p>발견한 보물을 팀의 첫 아이디어로 이어 보세요. 팀원과 선택 이유를 공유한 뒤 다음 캡슐 활동으로 이동해요.</p>
      <div class="btn-row">
        <button type="button" class="btn" id="btn-copy">문장 복사</button>
        <button type="button" class="btn btn-ghost" id="btn-export">항해 기록 저장 (JSON)</button>
        <button type="button" class="btn btn-ghost" data-open="logbook">기록장 다시 보기</button>
        <button type="button" class="btn btn-ghost" id="btn-edit-idea">아이디어 수정</button>
      </div>
      <p class="save-state ${Sync.enabled() ? (Sync.queue().length ? "warn" : "ok") : ""}" id="save-state">${Sync.enabled() ? (Sync.queue().length ? "진행자 시트로 아직 보내지 못한 기록이 있어요. 인터넷이 연결되면 자동으로 다시 보내요." : "진행자 시트에 기록을 보냈어요.") : "이 기록은 이 브라우저에만 저장돼요. 진행자에게 문장을 보여 주거나 JSON으로 저장해 두세요."}</p>
      <div class="btn-row" style="margin-top:20px"><button type="button" class="link" id="btn-restart">처음부터 다시 하기</button><button type="button" class="link" data-open="sources">사진 출처</button></div>`;
    $("#btn-copy").onclick = async (e) => { try { await navigator.clipboard.writeText(sentence()); e.target.textContent = "복사했어요 ✓"; } catch (err) { const r = document.createRange(); r.selectNodeContents($("#big-sentence")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("선택된 문장을 복사하세요 (Ctrl/Cmd+C)."); } };
    $("#btn-export").onclick = () => { const blob = new Blob([JSON.stringify({ ...state, summary: s, sentence: sentence() }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `미궁_${state.crew.name}_${state.crew.dept}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    $("#btn-edit-idea").onclick = () => enterIdea();
    $("#btn-restart").onclick = () => confirmReset(() => { localStorage.removeItem(STORAGE_KEY); location.reload(); });
    Sync.flush();
  }

  // ---------- 설정·출처·사용법 ----------
  function applySettings() {
    document.documentElement.dataset.motion = state && state.settings.motion === false ? "off" : "on";
    document.documentElement.dataset.large = state && state.settings.large ? "1" : "0";
  }
  function openSettings() {
    const st = state.settings;
    const row = (k, label, desc) => `<div class="setting-row"><div><b>${label}</b><div class="muted">${desc}</div></div><button type="button" class="switch" role="switch" aria-checked="${!!st[k]}" data-set="${k}" aria-label="${label}"></button></div>`;
    openModal(`<h2>설정</h2>
      ${row("motion", "움직임", "물결과 고양이 애니메이션. 끄면 상태만 바뀌어요.")}
      ${row("large", "글자 크게 보기", "본문 글자를 한 단계 키워요.")}
      <div class="setting-row"><div><b>저장 상태</b><div class="muted">${storageOk ? "이 브라우저에 자동 저장 중" : "이 브라우저에서는 저장이 제한돼요"} · ${Sync.enabled() ? `진행자 시트 연결됨${Sync.queue().length ? ` (대기 ${Sync.queue().length}건)` : ""}` : "진행자 시트 미연결"}</div></div></div>
      <div class="danger-zone"><b>처음부터 다시</b><div class="muted">이 브라우저의 항해 기록(발견 카드, 아이디어)을 지우고 새로 시작해요.</div><div class="btn-row" style="margin-top:8px"><button type="button" class="btn btn-sm btn-ghost" id="btn-reset-all">기록 지우고 새로 시작</button></div></div>`, {
      onOpen: (m) => {
        m.addEventListener("click", (e) => { const b = e.target.closest("[data-set]"); if (!b) return; const k = b.dataset.set; st[k] = !st[k]; b.setAttribute("aria-checked", st[k]); save(); applySettings(); if (k === "motion" && window.StartScene) window.StartScene.setMotion(st[k]); });
        $("#btn-reset-all").onclick = () => confirmReset(() => { localStorage.removeItem(STORAGE_KEY); location.reload(); });
      },
    });
  }
  function openSources() {
    const rows = PUZZLES.map((p) => PHOTOS[p.resourceId]).map((ph) => `<tr><td><b>${esc(ph.name)}</b></td><td>${esc(ph.author)}</td><td>${esc(ph.date)}</td><td><a href="${esc(ph.license_url)}" target="_blank" rel="noopener">${esc(ph.license)}</a></td><td><a href="${esc(ph.source)}" target="_blank" rel="noopener">Wikimedia Commons</a></td></tr>`).join("");
    openModal(`<h2>사진 출처</h2><p class="muted">모든 사진은 Wikimedia Commons의 공개 라이선스 사진이에요. 자르기와 색상 변경 없이 비율을 유지해 축소했어요. 과거에 촬영된 기록사진이므로 현재 시설 상태나 운영 정보로 보지 마세요.</p>
      <div class="table-wrap"><table class="src-table"><thead><tr><th>장소</th><th>저작자</th><th>촬영 시점</th><th>라이선스</th><th>원문</th></tr></thead><tbody>${rows}</tbody></table></div>`, { wide: true });
  }
  function openHowto() {
    openModal(`<h2>사용 방법</h2>
      <ol style="padding-left:20px;display:grid;gap:8px">
        <li>섬에 도착하면 <b>사진</b>과 <b>단서 3개</b>를 먼저 읽어요.</li>
        <li>문제는 세 가지예요. <b>선택형</b>은 답 하나를 고르고, <b>순서형</b>은 카드를 순서대로 누르고, <b>연결형</b>은 왼쪽 요청을 고른 뒤 오른쪽 항목을 눌러 짝을 지어요. 드래그는 필요 없어요.</li>
        <li>틀려도 페널티가 없어요. 선택은 그대로 남고, 어떤 조건이 어긋났는지 한 줄로 알려 줘요.</li>
        <li>막히면 <b>힌트</b>를 2개까지 열 수 있고, 그래도 어려우면 <b>함께 풀기</b>로 정답과 이유를 보고 진행해요.</li>
        <li>정답 뒤 <b>발견 카드</b>에서 자원의 의미와 창업 질문을 읽고 <b>카드 받기</b>를 누르면 다음 섬이 열려요.</li>
        <li>10개 섬을 모두 발견하면 카드 2장과 고객·문제를 골라 <b>아이디어 한 문장</b>을 만들어요.</li>
      </ol>
      <p class="muted">새로고침해도 이 브라우저에서는 같은 섬과 기록으로 돌아와요. 예상 소요 시간은 약 30분이에요.</p>
      <div class="btn-row end"><button type="button" class="btn" data-close>알겠어요</button></div>`);
  }

  // ---------- 다른 탭 동기화 ----------
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY && e.newValue) toast("다른 탭에서 기록이 갱신됐어요. 새로고침하면 최신 기록을 불러와요.", 6000); });

  // ---------- 부팅 ----------
  async function boot() {
    try {
      const [pz, ph] = await Promise.all([fetch("data/puzzles.json").then((r) => r.json()), fetch("data/photos.json").then((r) => r.json())]);
      PUZZLES = pz.puzzles; window.__content = pz;
      ph.forEach((x) => (PHOTOS[x.id] = { ...x, file: "photos/" + x.id + ".jpg" }));
    } catch (e) {
      document.body.innerHTML = `<div class="narrow"><div class="panel"><h2>문제 데이터를 불러오지 못했어요</h2><p>인터넷 연결을 확인한 뒤 새로고침해 주세요. 계속 안 되면 진행자에게 알려 주세요.</p></div></div>`;
      return;
    }
    drawAllNaru(); naruIdle();
    initStart();
    show("start");
    // 사진 프리로드
    Object.values(PHOTOS).forEach((p) => { const im = new Image(); im.src = p.file; });
    Sync.flush();
  }
  boot();
})();
