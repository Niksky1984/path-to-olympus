/* Path to Olympus — lightning & storm effects (canvas + Web Audio, no files needed).
 *  • aura:  a living electric ring around David's avatar, crawling sparks and random strikes
 *  • storm: full-screen bolts, flashes, rain, thunder, screen shake and vibration for big moments
 * All settings come from the Admin (config/effects). Exposed as window.OlympusFX. */
(function () {
  'use strict';

  const DEFAULTS = {
    aura: true,          // lightning around the avatar
    auraPower: 60,       // 0–100: brightness / thickness / number of sparks
    auraRate: 10,        // strikes per minute
    color: 'electric',   // electric | gold | violet | rank
    auraSound: false,    // quiet thunder with each aura strike
    storm: true,         // storms on events
    stormPower: 80,      // 0–100: number and size of bolts, flash strength
    stormSecs: 4,        // duration of a storm
    shake: 60,           // 0–100 screen shake
    vibrate: true,
    stormSound: true,
    volume: 80,          // 0–100 thunder volume
    events: { close: true, medal: true, rank: true, record: true, quest: true, test: true, lost: false },
  };
  const COLORS = {
    electric: ['#9FD8FF', '#3FA9FF'],
    gold: ['#FFF1B8', '#F2B735'],
    violet: ['#E6C8FF', '#A35BFF'],
  };

  let opts = { cfg: () => DEFAULTS, anchor: () => null, rankColor: () => '#C9A227', sound: () => true, vibrate: () => true };
  const cfg = () => ({ ...DEFAULTS, ...(opts.cfg() || {}), events: { ...DEFAULTS.events, ...((opts.cfg() || {}).events || {}) } });
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function palette(c) {
    if (c.color === 'rank') { const k = opts.rankColor() || '#C9A227'; return ['#FFFFFF', k]; }
    return COLORS[c.color] || COLORS.electric;
  }

  /* ------------------------------ bolt geometry ------------------------------ */

  /** Jagged line from a to b (midpoint displacement) → [[x,y],…] */
  function jag(x1, y1, x2, y2, rough) {
    let pts = [[x1, y1], [x2, y2]];
    let disp = Math.hypot(x2 - x1, y2 - y1) * rough;
    while (disp > 1.2 && pts.length < 300) {
      const next = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay) || 1;
        const off = rnd(-disp, disp);
        next.push([mx - ((by - ay) / len) * off, my + ((bx - ax) / len) * off], pts[i]);
      }
      pts = next; disp /= 2;
    }
    return pts;
  }
  /** A bolt with branches: [{ pts, w }] (w = relative width) */
  function bolt(x1, y1, x2, y2, branchy) {
    const main = jag(x1, y1, x2, y2, 0.22);
    const parts = [{ pts: main, w: 1 }];
    const len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
    const nb = Math.round(branchy * rnd(1, 4));
    for (let i = 0; i < nb; i++) {
      const at = main[Math.floor(rnd(0.15, 0.8) * main.length)];
      const a = ang + rnd(0.35, 0.9) * (Math.random() < 0.5 ? -1 : 1), l = len * rnd(0.15, 0.4);
      parts.push({ pts: jag(at[0], at[1], at[0] + Math.cos(a) * l, at[1] + Math.sin(a) * l, 0.3), w: 0.45 });
    }
    return parts;
  }
  function stroke(ctx, parts, scale, alpha, pal) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [lw, col, a] of [[9, pal[1], 0.12], [4.5, pal[1], 0.35], [1.6, pal[0], 1]]) {
      ctx.strokeStyle = col; ctx.globalAlpha = a * alpha;
      for (const p of parts) {
        ctx.lineWidth = Math.max(0.6, lw * scale * p.w);
        ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* --------------------------------- audio --------------------------------- */

  let AC = null, white = null, brown = null;
  function audio() {
    if (!AC) {
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      const n = AC.sampleRate * 5;
      white = AC.createBuffer(1, n, AC.sampleRate); brown = AC.createBuffer(1, n, AC.sampleRate);
      const w = white.getChannelData(0), b = brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < n; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
    }
    if (AC.state === 'suspended') AC.resume().catch(() => {});
    return AC;
  }
  // browsers allow sound only after a tap: wake the audio on the first touch
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, () => audio(), { once: true, passive: true }));

  /** Thunder: a sharp crack, then a rolling rumble. near = 0..1 (1 = right overhead). */
  function thunder(vol, near) {
    const c = cfg();
    if (!opts.sound() || vol <= 0) return;
    const ac = audio(); if (!ac || ac.state !== 'running') return;
    const t0 = ac.currentTime + (1 - near) * 0.5;
    const out = ac.createGain(); out.gain.value = clamp(vol, 0, 1) * (c.volume / 100); out.connect(ac.destination);
    // crack
    const cs = ac.createBufferSource(); cs.buffer = white;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const cg = ac.createGain(); cg.gain.setValueAtTime(0.0001, t0); cg.gain.exponentialRampToValueAtTime(0.9 * near + 0.1, t0 + 0.008); cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    cs.connect(hp); hp.connect(cg); cg.connect(out); cs.start(t0, rnd(0, 3), 0.4);
    // rumble
    const dur = rnd(2.5, 4.5);
    const rs = ac.createBufferSource(); rs.buffer = brown;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(140, t0 + dur);
    const rg = ac.createGain(); rg.gain.setValueAtTime(0.0001, t0);
    rg.gain.exponentialRampToValueAtTime(1.0, t0 + 0.06);
    let t = t0 + 0.06;
    while (t < t0 + dur - 0.3) { t += rnd(0.18, 0.5); rg.gain.exponentialRampToValueAtTime(rnd(0.25, 0.9) * (1 - (t - t0) / dur) + 0.02, t); }
    rg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    rs.connect(lp); lp.connect(rg); rg.connect(out); rs.start(t0, rnd(0, 0.4), dur + 0.1);
    setTimeout(() => { try { out.disconnect(); } catch (e) { /* gone */ } }, (dur + 1.5) * 1000);
  }
  const buzz = (pattern) => { const c = cfg(); if (c.vibrate && opts.vibrate()) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* none */ } } };

  /* ------------------------------ avatar aura ------------------------------ */

  let auraCv = null, auraCtx = null, aStrikes = [], aSparks = [], nextStrike = 0, lastSpark = 0;
  function auraCanvas() {
    if (auraCv) return auraCv;
    auraCv = document.createElement('canvas');
    auraCv.id = 'fx-aura';
    auraCv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:25;display:none';
    document.body.appendChild(auraCv);
    auraCtx = auraCv.getContext('2d');
    return auraCv;
  }
  function auraFrame(now) {
    const c = cfg(), el = c.aura ? opts.anchor() : null;
    const cv = auraCanvas();
    if (!el || document.hidden) { cv.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.bottom < -50 || r.top > innerHeight + 50) { cv.style.display = 'none'; return; }
    const R = r.width / 2, size = Math.round(r.width * 2.4), dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== size * dpr) { cv.width = cv.height = size * dpr; cv.style.width = cv.style.height = size + 'px'; }
    cv.style.display = 'block';
    cv.style.transform = `translate(${Math.round(r.left + R - size / 2)}px, ${Math.round(r.top + R - size / 2)}px)`;
    const ctx = auraCtx, cx = size / 2, cy = size / 2, pw = c.auraPower / 100, pal = palette(c);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';
    // breathing glow ring
    const pulse = 0.55 + 0.45 * Math.sin(now / 520) * Math.sin(now / 1270 + 1);
    const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.45);
    g.addColorStop(0, hexA(pal[1], 0)); g.addColorStop(0.18, hexA(pal[1], 0.28 * pw * (0.6 + 0.4 * pulse))); g.addColorStop(1, hexA(pal[1], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2); ctx.fill();
    // crawling sparks along the ring (re-rolled ~12 times a second)
    if (now - lastSpark > 85) {
      lastSpark = now; aSparks = [];
      const n = Math.round(1 + pw * 4);
      for (let i = 0; i < n; i++) {
        if (Math.random() > 0.35 + pw * 0.6) continue;
        const a0 = rnd(0, Math.PI * 2), span = rnd(0.25, 0.7), rr = R * rnd(1.0, 1.08);
        const pts = []; const steps = 9;
        for (let k = 0; k <= steps; k++) { const a = a0 + (span * k) / steps; const d = rr + rnd(-R * 0.06, R * 0.06); pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]); }
        aSparks.push([{ pts, w: 0.5 }]);
      }
    }
    aSparks.forEach((s) => stroke(ctx, s, R / 60 * (0.6 + pw * 0.6), 0.85, pal));
    // strikes from outside onto the ring
    if (now > nextStrike) {
      if (nextStrike) {
        const a = rnd(0, Math.PI * 2), from = R * rnd(1.55, 1.95), to = R * 1.02, a2 = a + rnd(-0.4, 0.4);
        aStrikes.push({ t: now, life: rnd(260, 420), parts: bolt(cx + Math.cos(a) * from, cy + Math.sin(a) * from, cx + Math.cos(a2) * to, cy + Math.sin(a2) * to, 0.6 + pw) });
        if (c.auraSound) thunder(0.25 + pw * 0.25, 0.4);
      }
      nextStrike = now + (60000 / Math.max(1, c.auraRate)) * rnd(0.4, 1.6);
    }
    aStrikes = aStrikes.filter((s) => now - s.t < s.life);
    aStrikes.forEach((s) => {
      const k = (now - s.t) / s.life, flick = k < 0.15 ? 1 : (Math.random() < 0.7 ? 1 - k : 0.15);
      stroke(ctx, s.parts, R / 60 * (0.8 + pw * 0.9), flick, pal);
      if (k < 0.2) { ctx.globalAlpha = 0.35 * pw * (1 - k * 5); ctx.fillStyle = pal[0]; ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------------------------- storm ---------------------------------- */

  let storm = null, lastStorm = -1e9;
  function stormCanvas() {
    let cv = document.getElementById('fx-storm');
    if (!cv) {
      cv = document.createElement('canvas'); cv.id = 'fx-storm';
      cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:130';
      document.body.appendChild(cv);
    }
    return cv;
  }
  /** Start a storm. kind = event name (close, medal, rank…) or 'preview'. */
  function startStorm(kind, force) {
    const c = cfg();
    if (!force && (!c.storm || !c.events[kind])) return;
    const now = performance.now();
    if (!force && now - lastStorm < 6000) return;   // one storm per burst of celebrations
    lastStorm = now;
    const pw = c.stormPower / 100, secs = clamp(+c.stormSecs || 4, 1.5, 10);
    const n = Math.round(2 + pw * 7);
    const strikes = [];
    for (let i = 0; i < n; i++) strikes.push({ at: i === 0 ? 150 : rnd(300, secs * 1000 - 700), done: false, big: i === 0 || Math.random() < 0.35 });
    const drops = Array.from({ length: Math.round(60 + pw * 160) }, () => ({ x: Math.random(), y: Math.random(), v: rnd(0.9, 1.6), l: rnd(0.025, 0.06) }));
    storm = { t0: now, secs, pw, strikes, bolts: [], drops, flash: 0, shakeAmp: 0 };
  }
  function stormFrame(now) {
    if (!storm) return;
    const c = cfg(), cv = stormCanvas(), W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const el = now - storm.t0, T = storm.secs * 1000, pal = palette(c), pw = storm.pw;
    if (el > T) { ctx.clearRect(0, 0, W, H); storm = null; shake(0); cv.remove(); return; }
    const fade = Math.min(1, el / 400, (T - el) / 600);
    ctx.clearRect(0, 0, W, H);
    // darkness + vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.4, Math.min(W, H) * 0.2, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, `rgba(10,12,30,${0.25 * fade * (0.5 + pw / 2)})`); vg.addColorStop(1, `rgba(5,6,18,${0.7 * fade * (0.5 + pw / 2)})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // rain
    ctx.strokeStyle = `rgba(190,210,255,${0.28 * fade})`; ctx.lineWidth = 1;
    ctx.beginPath();
    storm.drops.forEach((d) => {
      const y = ((d.y + (el / 1000) * d.v * 1.4) % 1.1) - 0.05, x = (d.x + y * 0.18) % 1;
      ctx.moveTo(x * W, y * H); ctx.lineTo((x - d.l * 0.25) * W, (y - d.l) * H);
    });
    ctx.stroke();
    // strikes
    const anchor = opts.anchor && opts.anchor();
    storm.strikes.forEach((s, i) => {
      if (s.done || el < s.at) return;
      s.done = true;
      let tx = rnd(0.1, 0.9) * W, ty = rnd(0.45, 0.95) * H;
      if (i === 0 && anchor) { const r = anchor.getBoundingClientRect(); if (r.width && r.bottom > 0 && r.top < H) { tx = r.left + r.width / 2; ty = r.top + r.height / 2; } }
      const sx = clamp(tx + rnd(-0.35, 0.35) * W, 0, W);
      storm.bolts.push({ t: now, life: s.big ? rnd(380, 560) : rnd(220, 380), parts: bolt(sx, -10, tx, ty, s.big ? 1.6 + pw : 0.8), big: s.big });
      storm.flash = Math.max(storm.flash, (s.big ? 0.75 : 0.4) * (0.4 + pw * 0.6));
      storm.shakeAmp = Math.max(storm.shakeAmp, (s.big ? 1 : 0.5) * (c.shake / 100));
      if (c.stormSound) thunder((s.big ? 1 : 0.6) * (0.5 + pw * 0.5), s.big ? 1 : rnd(0.3, 0.7));
      buzz(s.big ? [180, 60, 260, 80, 120] : [90, 40, 60]);
    });
    ctx.globalCompositeOperation = 'lighter';
    storm.bolts = storm.bolts.filter((b) => now - b.t < b.life);
    storm.bolts.forEach((b) => {
      const k = (now - b.t) / b.life, alpha = k < 0.12 ? 1 : (Math.random() < 0.6 ? 1 - k : 0.2);
      stroke(ctx, b.parts, b.big ? 2.4 + pw * 1.4 : 1.2, alpha, pal);
    });
    ctx.globalCompositeOperation = 'source-over';
    // flash
    if (storm.flash > 0.01) { ctx.fillStyle = `rgba(235,240,255,${storm.flash})`; ctx.fillRect(0, 0, W, H); storm.flash *= 0.82; }
    // shake
    shake(storm.shakeAmp); storm.shakeAmp *= 0.9;
  }
  /** Shake the page (each layer on its own, so fixed bars and pop-ups keep their place). */
  function shake(amp) {
    const els = document.querySelectorAll('#app > header, #app > main, #app > nav, #celebration, #app > .sheet-wrap');
    els.forEach((e) => {
      if (amp < 0.02) { if (e.style.transform) e.style.transform = ''; return; }
      const m = 16 * amp;
      e.style.transform = `translate(${rnd(-m, m).toFixed(1)}px, ${rnd(-m, m).toFixed(1)}px) rotate(${rnd(-0.6, 0.6) * amp}deg)`;
    });
  }

  /* ---------------------------------- loop ---------------------------------- */

  function loop(now) {
    try { auraFrame(now); stormFrame(now); } catch (e) { console.warn('fx', e); }
    requestAnimationFrame(loop);
  }
  let started = false;
  function init(o) {
    opts = { ...opts, ...o };
    if (!started) { started = true; requestAnimationFrame(loop); }
  }
  /** Preview one aura strike right now (Admin). */
  function strikeNow() { nextStrike = 1; }

  window.OlympusFX = { init, storm: startStorm, strikeNow, thunder: (v) => thunder(v, 1), DEFAULTS };
})();
