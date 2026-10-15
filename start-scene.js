/* ============================================================
   시작 화면 픽셀 씬 — Claude Design "미궁 시작 화면" 원본 이식
   240px 폭 저해상도 캔버스를 화면에 꽉 채워 확대(픽셀 유지).
   scene: 하늘·바다·섬·항로 (정적) / actors: 반짝임·갈매기·배·나섬이 (260ms 틱)
   ============================================================ */
(function () {
  "use strict";
  const W = 240, INK = "#243B4A";
  // 나섬이(배재대 호랑이 마스코트) 9×7: o 주황, k 줄무늬·외곽, w 주둥이, p 코, e 눈
  const HEAD = [".k.....k.", "kok...kok", "kookkkook", "koooooook", "koeoooeok", "kowwpwwok", ".kwwwwwk."];
  const CATS = {
    "치즈": { o: "#F2A33A", w: "#FFF7EA", k: "#243B4A", p: "#E8667A", e: "#243B4A" },
    "구름": { o: "#A7A9B4", w: "#F4F4F6", k: "#243B4A", p: "#F4A3A8", e: "#243B4A" },
    "먹물": { o: "#3A3540", w: "#5D5766", k: "#16131A", p: "#E77F9A", e: "#F2D34A" },
  };
  const PAL = {
    "낮": { sky: ["#8FD8EE", "#A9E2F1", "#C4ECF4", "#DDF5F5"], sun: "#FFF1A8", halo: "#FFF8D6", cloud: "#FFFFFF", cloudS: "#CDEBF0", sea: ["#5CCADB", "#4FBDD0", "#43AEC4"], far: "#A9DCC8", isle: "#7CC77A", isleS: "#5DAE63", sand: "#F2D79B", spark: "#E9FBFD" },
    "노을": { sky: ["#F4A9A0", "#F8C0A4", "#FBD6B0", "#FFE8C6"], sun: "#FFF4C2", halo: "#FFEFD0", cloud: "#FFEBDD", cloudS: "#F0BBAA", sea: ["#6FB8C9", "#5DA6BB", "#4D93AA"], far: "#CDB9B0", isle: "#86B97A", isleS: "#6A9E64", sand: "#F2CF98", spark: "#FFEBD6" },
  };
  let CR = 0.47;

  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function geo(H) {
    const hz = Math.round(H * 0.56);
    return { hz, bx: Math.min(W - 42, Math.round(W * Math.max(0.74, CR + 0.06))), by: hz + Math.round((H - hz) * 0.42) - 24, ix: Math.min(W - 60, Math.round(W * Math.max(0.6, CR + 0.04))) };
  }

  function drawScene(cv, H, P) {
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), g = geo(H), hz = g.hz;
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    const disc = (cx, cy, rad, col) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * .6) px(cx + x, cy + y, 1, 1, col); };
    const b = [0, Math.round(hz * .3), Math.round(hz * .58), Math.round(hz * .82), hz];
    for (let i = 0; i < 4; i++) px(0, b[i], W, b[i + 1] - b[i], P.sky[i]);
    for (let i = 1; i < 4; i++) for (let x = 0; x < W; x++) { if (x % 2 === 0) px(x, b[i], 1, 1, P.sky[i - 1]); if (x % 4 === 1) px(x, b[i] + 1, 1, 1, P.sky[i - 1]); }
    disc(206, Math.round(hz * .28), 12, P.halo); disc(206, Math.round(hz * .28), 9, P.sun);
    const cloud = (x, y, w) => { px(x + 3, y, w - 6, 2, P.cloud); px(x + 1, y + 2, w - 2, 2, P.cloud); px(x, y + 4, w, 3, P.cloud); px(x + 1, y + 7, w - 2, 1, P.cloudS); };
    cloud(18, Math.round(hz * .16), 30); cloud(128, Math.round(hz * .08), 22); cloud(168, Math.round(hz * .5), 26); cloud(92, Math.round(hz * .42), 16); cloud(226, Math.round(hz * .62), 18);
    px(0, hz, W, H - hz, P.sea[0]);
    const s1 = hz + Math.round((H - hz) * .38), s2 = hz + Math.round((H - hz) * .72);
    px(0, s1, W, H - s1, P.sea[1]); px(0, s2, W, H - s2, P.sea[2]);
    for (let x = 0; x < W; x += 2) { px(x, s1 - 1, 1, 1, P.sea[1]); px(x + 1, s2 - 1, 1, 1, P.sea[2]); }
    const far = (cx, w, h) => { for (let i = 0; i < w; i++) { const t = Math.round(h * Math.sin(Math.PI * i / w)); px(cx - w / 2 + i, hz - t, 1, t, P.far); } };
    far(40, 34, 4); far(98, 18, 3); far(208, 28, 5); far(234, 16, 3);
    const isle = (cx, w, h) => {
      for (let i = 0; i < w; i++) { const t = Math.round(h * Math.sin(Math.PI * i / w)); px(cx - w / 2 + i, hz - t, 1, t + 1, P.isle); if (i > 1 && i < w - 2) px(cx - w / 2 + i, hz - 1, 1, 2, P.sand); }
      for (let i = 3; i < w - 3; i += 3) px(cx - w / 2 + i, hz - Math.round(h * Math.sin(Math.PI * i / w)) + 2, 2, 1, P.isleS);
    };
    isle(g.ix, 34, 8);
    for (let x = g.ix - 9; x <= g.ix + 9; x += 3) px(x, hz - 6, 1, 4, P.isleS);
    px(g.ix - 9, hz - 6, 19, 1, P.isleS);
    px(g.ix + 1, hz - 15, 1, 9, INK); px(g.ix + 2, hz - 15, 5, 3, "#E8667A"); px(g.ix + 2, hz - 12, 3, 1, "#E8667A");
    isle(186, 18, 5); px(185, hz - 10, 1, 5, "#8A5A3A"); disc(185, hz - 11, 2, P.isleS);
    const ax = g.bx + 6, ay = g.by + 32, cx2 = (ax + g.ix) / 2 + 26, cy2 = hz + 4;
    const pt = t => [Math.round((1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx2 + t * t * g.ix), Math.round((1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy2 + t * t * (hz + 2))];
    for (let i = 0; i <= 60; i++) { if (i % 3) continue; const [x, y] = pt(i / 60); px(x, y, 1, 1, "#FFF8E7"); }
    for (let i = 1; i <= 10; i++) {
      const [x, y] = pt(i / 10.5), big = i < 6;
      if (big) { px(x - 1, y - 1, 3, 3, INK); px(x, y - 1, 1, 2, i % 2 ? "#F2C14E" : "#E8667A"); }
      else px(x, y - 1, 1, 2, i % 2 ? "#F2C14E" : "#E8667A");
    }
  }

  function drawActors(cv, H, P, cat, t, sail) {
    if (cv.width !== W) cv.width = W; if (cv.height !== H) cv.height = H;
    const c = cv.getContext("2d"), g = geo(H), r = rng(9);
    c.clearRect(0, 0, W, H);
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    for (let i = 0; i < 34; i++) {
      const y = g.hz + 3 + Math.floor(r() * (H - g.hz - 4)), x0 = r() * W, sp = .6 + r();
      const x = Math.round((x0 + t * sp) % (W + 6)) - 3, len = 2 + Math.floor(r() * 3);
      if ((i + t) % 5 !== 0) px(x, y, len, 1, P.spark);
    }
    [[(t * 1.2) % (W + 40) - 20, Math.round(g.hz * .36)], [((t * 1.2) + 14) % (W + 40) - 20, Math.round(g.hz * .3)]].forEach(([x, y], i) => {
      x = Math.round(x); const up = (t + i) % 2;
      px(x, y + up, 1, 1, INK); px(x + 1, y + 1 - up, 1, 1, INK); px(x + 2, y + 1, 1, 1, INK); px(x + 3, y + 1 - up, 1, 1, INK); px(x + 4, y + up, 1, 1, INK);
    });
    const bx = g.bx + sail, by = g.by + (t % 4 < 2 ? 0 : 1);
    px(bx + 22, by, 1, 25, "#8A5A3A");
    px(bx + 23, by, 5, 3, "#F2C14E");
    for (let i = 0; i < 18; i++) {
      const y = by + 4 + i, w = Math.floor(i * .7) + 1;
      px(bx + 23, y, w, 1, i === 8 || i === 9 ? "#E8667A" : "#FFF8E7");
      px(bx + 23 + w, y, 1, 1, INK);
    }
    px(bx + 23, by + 22, Math.floor(17 * .7) + 2, 1, INK);
    const hx = bx + 8, hy = by + 17;
    HEAD.forEach((row, y) => [...row].forEach((ch, x) => { if (cat[ch]) px(hx + x, hy + y, 1, 1, cat[ch]); }));
    px(hx + 2, hy - 2, 5, 1, INK); px(hx + 1, hy - 1, 7, 1, INK); px(hx + 2, hy - 1, 5, 1, "#FFF8E7"); px(hx + 4, hy - 3, 1, 1, "#E8667A");
    const top = by + 24;
    for (let row = 0; row < 8; row++) {
      const inset = row < 2 ? 0 : row - 1, x0 = bx + 2 + inset, x1 = bx + 37 - inset;
      px(x0, top + row, x1 - x0 + 1, 1, row === 0 || row === 7 ? INK : row === 2 ? "#FFF8E7" : "#E8667A");
      px(x0, top + row, 1, 1, INK); px(x1, top + row, 1, 1, INK);
    }
    px(hx + 1, top, 2, 1, cat.w); px(hx + 6, top, 2, 1, cat.w);
    px(bx + 28, top + 3, 3, 3, INK); px(bx + 29, top + 4, 1, 1, "#DDF5F5");
    for (let x = bx; x < bx + 40; x += 2) px(x + (t % 2), top + 8, 1, 1, "#FFF8E7");
  }

  // ---------- 런타임 ----------
  const S = { H: 150, t: 0, sail: 0, launching: false, arrived: false, cat: "치즈", time: "낮", motion: true, onArrive: null };
  let root, scene, actor, bubble, iv = null, drawn = false;
  const pal = () => PAL[S.time] || PAL["낮"];
  function paint() { if (actor) drawActors(actor, S.H, pal(), CATS[S.cat] || CATS["치즈"], S.t, S.sail); }
  function placeBubble() {
    if (!bubble) return;
    const g = geo(S.H);
    bubble.style.left = ((g.bx + 6) / W * 100) + "%";
    bubble.style.bottom = ((S.H - (g.by + 13)) / S.H * 100) + "%";
  }
  function resize() {
    if (!root) return;
    const cw = Math.max(1, root.clientWidth), H = Math.max(110, Math.round(W * root.clientHeight / cw));
    const cr = Math.min(0.9, (Math.max(24, cw * 0.06) + 560) / cw);
    if (H !== S.H || cr !== CR || !drawn) { CR = cr; S.H = H; drawn = true; drawScene(scene, H, pal()); paint(); placeBubble(); }
  }
  function tick() {
    S.t += 1;
    if (S.launching && !S.arrived) { S.sail += 3; if (S.sail > W * 0.3) { S.arrived = true; if (S.onArrive) S.onArrive(); } }
    paint();
    const bl = document.getElementById("start-blink"); if (bl) bl.style.opacity = S.t % 2 ? "1" : "0.25";
  }
  function startTimer() { clearInterval(iv); iv = setInterval(tick, S.motion ? 260 : 100000); }

  window.StartScene = {
    mount(opts = {}) {
      root = document.getElementById("start-root"); scene = document.getElementById("scene-canvas"); actor = document.getElementById("actor-canvas"); bubble = document.getElementById("start-bubble");
      if (opts.motion === false) S.motion = false;
      window.addEventListener("resize", resize);
      resize(); startTimer();
      if (!S.motion) { S.t = 1; paint(); }
    },
    launch(onArrive) {
      if (S.launching) return;
      S.launching = true; S.arrived = false; S.sail = 0; S.onArrive = onArrive;
      if (bubble) bubble.hidden = true;
      if (!S.motion) { S.sail = Math.round(W * 0.3) + 3; S.arrived = true; paint(); if (onArrive) onArrive(); }
    },
    reset() { S.launching = false; S.arrived = false; S.sail = 0; if (bubble) bubble.hidden = false; paint(); },
    setBubble(text) { const el = bubble && bubble.querySelector(".bt"); if (el) el.textContent = text; },
    setMotion(on) { S.motion = !!on; startTimer(); },
    refresh() { drawn = false; resize(); },
  };
})();
