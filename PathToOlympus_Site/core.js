/* =============================================================================
 * Path to Olympus — shared core for index.html (David) and admin.html (Admin).
 *  • data layer: Firebase (compat SDK, real-time) or DEMO mode (localStorage)
 *  • shared state + derived helpers
 *  • SVG art: laurel, avatar, emblems, medals, coats of arms, charts
 *  • shared views: calendar, day pop-up, analytics, milestones
 *  • celebrations: 9:16 video player and medal reveal
 * Classic script (no ES modules) so the pages also work when double-clicked.
 * ========================================================================== */
(function () {
  'use strict';
  const E = window.Engine;
  const CFG = window.OLYMPUS_CONFIG || {};
  const FB_VER = '10.14.1';
  const ATHLETE = CFG.athleteId || 'david';

  /* --------------------------------- utils --------------------------------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function fmtDate(iso, style = 'short') {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const dow = DAYS_LONG[E.DOW.indexOf(E.dowOf(iso))];
    if (style === 'long') return `${dow}, ${d} ${MONTHS_LONG[m - 1]} ${y}`;
    if (style === 'day') return `${dow.slice(0, 3)} ${d} ${MONTHS[m - 1]}`;
    if (style === 'dm') return `${d} ${MONTHS[m - 1]}`;
    return `${dow.slice(0, 3)} ${d} ${MONTHS[m - 1]} ${y}`;
  }
  const fmtMillis = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
  const n0 = (v) => (Number.isFinite(+v) ? +v : 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* ---------------------------------- state ---------------------------------- */

  const S = {
    demo: false,
    role: 'david',
    user: null,
    isAdmin: false,
    got: { profile: false, plans: false, logs: false },
    profile: null,
    plans: [],
    overrides: {},
    logs: {},
    targets: {},
    awards: [],
    media: { slots: {} },
    scoring: E.scoring(),
    guide: { texts: {} },
    today: E.todayISO(),
    draft: null, // { date, entries } — David's in-progress edits
    error: null,
  };
  const subs = new Set();
  const onChange = (fn) => subs.add(fn);
  let emitQueued = false;
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    Promise.resolve().then(() => {
      emitQueued = false;
      afterData();
      subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    });
  }
  const loaded = () => S.got.profile && S.got.plans && S.got.logs;

  /* --------------------------------- derived --------------------------------- */

  const profile = () => S.profile || { name: 'David', avatarPhoto: null, score: 0, currentStreak: 0, bestStreak: 0, daysDone: 0, daysLost: 0, startDate: null, lastEvaluated: null };
  const planForDate = (d) => E.planFor(d, S.plans, S.overrides);
  const startDate = () => profile().startDate || S.today;
  const todayPlan = () => planForDate(S.today);
  const todayLog = () => S.logs[S.today] || null;
  const todayClosed = () => !!(todayLog() && todayLog().status === 'DONE');
  function todayEntries() {
    const log = todayLog();
    if (log && log.status !== 'PENDING') return log.entries || [];
    if (S.draft && S.draft.date === S.today) return S.draft.entries;
    return (log && log.entries) || [];
  }
  /** Exercises shown on today's log: planned ones first, then anything extra David added. */
  function todayRows() {
    const plan = todayPlan();
    const entries = todayEntries();
    const rows = ((plan && plan.exercises) || []).map((p) => ({ planned: p, entry: entries.find((e) => e.exercise === p.exercise) || null }));
    entries.filter((e) => !rows.some((r) => r.planned.exercise === e.exercise)).forEach((e) => rows.push({ planned: null, entry: e }));
    return rows;
  }
  const todayStats = () => E.dayStats(todayPlan(), todayEntries(), S.scoring);
  const baseline = () => E.baseline(startDate(), S.today, S.logs);
  function planTarget(hid) {
    const h = E.HZ[hid];
    const idx = E.blockIndex(startDate(), S.today, h);
    return E.planTarget(h, E.blockRange(startDate(), h, idx)[0], planForDate, S.scoring);
  }
  const ghost = (hid) => E.ghostProposal(E.HZ[hid], baseline(), planTarget(hid));
  /** Stored target, or the default: master horizons follow the plan officially, others are ghosts. */
  function target(hid) {
    if (S.targets[hid]) return S.targets[hid];
    return E.HZ[hid].master ? { ...planTarget(hid), state: 'OFFICIAL' } : ghost(hid);
  }
  function currentBlock(hid) {
    const h = E.HZ[hid];
    const idx = E.blockIndex(startDate(), S.today, h);
    return { idx, tot: E.totals(Object.values(S.logs), E.blockRange(startDate(), h, idx)) };
  }
  function week() {
    const mon = E.mondayOf(S.today);
    let planned = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const d = E.addDays(mon, i);
      if (!E.isRest(planForDate(d))) planned++;
      if (S.logs[d] && S.logs[d].status === 'DONE') done++;
    }
    return { done, planned };
  }
  const earnedIds = () => new Set(S.awards.map((a) => a.id));

  /* ============================== BACKENDS ============================== */

  /* ----------------------------- DEMO (localStorage) ----------------------------- */

  function localBackend() {
    const KEY = 'olympus_demo_db';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const blank = () => ({ profile: null, plans: {}, overrides: {}, days: {}, targets: {}, awards: {}, media: { slots: {} }, scoring: {}, guide: { texts: {} } });
    let db = Object.assign(blank(), read());
    let handlers = null;
    const push = () => {
      if (!handlers) return;
      handlers.profile(db.profile);
      handlers.plans(Object.entries(db.plans).map(([id, p]) => ({ ...p, id })));
      handlers.overrides({ ...db.overrides });
      handlers.days(Object.fromEntries(Object.entries(db.days).map(([d, l]) => [d, { ...l, date: d }])));
      handlers.targets({ ...db.targets });
      handlers.awards(Object.entries(db.awards).map(([id, a]) => ({ ...a, id })));
      handlers.media(db.media || { slots: {} });
      handlers.scoring(db.scoring || {});
      handlers.guide(db.guide || { texts: {} });
    };
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (e) { toast('Browser storage is full — use smaller images'); }
      setTimeout(push, 0);
    };
    window.addEventListener('storage', (e) => { if (e.key === KEY) { db = Object.assign(blank(), read()); push(); } });
    let authCb = null;
    let user = JSON.parse(localStorage.getItem('olympus_demo_user') || 'null');
    const setUser = (u) => { user = u; localStorage.setItem('olympus_demo_user', JSON.stringify(u)); authCb && authCb(u); };

    return {
      demo: true,
      onAuth(cb) { authCb = cb; setTimeout(() => cb(user), 0); },
      async signInAnon() { if (!user) setUser({ uid: 'demo-david', anonymous: true }); },
      // Admin = a device that proved the PIN (demo keeps it in this browser)
      async adminState(uid) {
        const sec = JSON.parse(localStorage.getItem('olympus_demo_admin') || '{}');
        return { ready: !!sec.pinHash, registered: !!(sec.devices || {})[uid], hash: (sec.devices || {})[uid] || null };
      },
      async createAdminPin(uid, hash) {
        const sec = JSON.parse(localStorage.getItem('olympus_demo_admin') || '{}');
        if (sec.pinHash) throw new Error('A PIN already exists');
        localStorage.setItem('olympus_demo_admin', JSON.stringify({ pinHash: hash, devices: { [uid]: hash } }));
      },
      async registerAdmin(uid, hash) {
        const sec = JSON.parse(localStorage.getItem('olympus_demo_admin') || '{}');
        if (sec.pinHash !== hash) throw Object.assign(new Error('Wrong PIN'), { code: 'permission-denied' });
        sec.devices = { ...(sec.devices || {}), [uid]: hash }; localStorage.setItem('olympus_demo_admin', JSON.stringify(sec));
      },
      async changeAdminPin(uid, hash) { localStorage.setItem('olympus_demo_admin', JSON.stringify({ pinHash: hash, devices: { [uid]: hash } })); },
      async forgetAdmin(uid) {
        const sec = JSON.parse(localStorage.getItem('olympus_demo_admin') || '{}');
        delete (sec.devices || {})[uid]; localStorage.setItem('olympus_demo_admin', JSON.stringify(sec));
      },
      listen(h) { handlers = h; push(); return () => { handlers = null; }; },
      async ensureProfile(today) { if (!db.profile) { db.profile = newProfile(today); save(); } else if (!db.profile.startDate) { db.profile.startDate = today; save(); } },
      saveDraft(date, entries) { db.days[date] = { ...(db.days[date] || {}), date, status: 'PENDING', entries }; save(); },
      closeDay(r, best, awards) {
        db.days[r.log.date] = r.log;
        const p = db.profile;
        p.score = n0(p.score) + r.points; p.currentStreak = r.newStreak; p.bestStreak = best; p.daysDone = n0(p.daysDone) + 1;
        awards.forEach((a) => { db.awards[a.id] = a; });
        save();
      },
      async evaluate(today, pf, localLogs, sc) {
        const p = db.profile;
        if (!p || !p.startDate) return null;
        const ev = E.evaluate(p.startDate, p.lastEvaluated, today, db.days, pf, sc);
        if (!ev) return null;
        ev.lostDates.forEach((d) => { db.days[d] = { ...(db.days[d] || {}), ...ev.lostLogs[d] }; });
        p.lastEvaluated = ev.evaluatedThrough; p.currentStreak = ev.newStreak;
        if (ev.lostDates.length) { p.score = n0(p.score) - ev.penalty; p.daysLost = n0(p.daysLost) + ev.lostDates.length; }
        save();
        return ev;
      },
      markDaysCelebrated(dates) { dates.forEach((d) => { if (db.days[d]) db.days[d].celebrated = true; }); save(); },
      markAwardsCelebrated(ids) { ids.forEach((id) => { if (db.awards[id]) db.awards[id].celebrated = true; }); save(); },
      updateProfileNow(fields) { db.profile = { ...(db.profile || newProfile(S.today)), ...fields }; save(); },
      async savePlan(plan) { const id = plan.id || uid(); const copy = { ...plan }; delete copy.id; db.plans[id] = copy; save(); },
      async deletePlan(id) { delete db.plans[id]; save(); },
      async saveTarget(t) { db.targets[t.horizon] = t; save(); },
      async deleteTarget(hid) { delete db.targets[hid]; save(); },
      async setMedia(key, url) { db.media.slots = db.media.slots || {}; if (url) db.media.slots[key] = url; else delete db.media.slots[key]; save(); },
      async saveScoring(sc) { db.scoring = sc; save(); },
      async saveGuide(texts) { db.guide = { texts: { ...((db.guide || {}).texts || {}), ...texts } }; save(); },
      async updateProfile(fields) { db.profile = { ...(db.profile || newProfile(S.today)), ...fields }; save(); },
      wipe() { localStorage.removeItem(KEY); localStorage.removeItem('olympus_demo_offset'); db = blank(); save(); },
    };
  }

  /* ------------------------------- FIREBASE ------------------------------- */

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });
  }

  async function firebaseBackend() {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    await loadScript(base + 'firebase-app-compat.js');
    await Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]);
    const fb = window.firebase;
    const app = fb.apps.length ? fb.app() : fb.initializeApp(CFG.firebase);
    const auth = app.auth();
    const db = app.firestore();
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { console.warn('offline cache unavailable', e.code); }
    const inc = fb.firestore.FieldValue.increment;
    const root = db.collection('athletes').doc(ATHLETE);
    const col = (n) => root.collection(n);
    const adminPin = db.collection('adminPin').doc('main');      // secret: nobody can read it
    const adminInfo = db.collection('adminState').doc('main');   // public: "a PIN exists"
    const adminDev = (uid) => db.collection('admins').doc(uid);   // devices that proved the PIN

    return {
      demo: false,
      onAuth(cb) { auth.onAuthStateChanged(cb); },
      async signInAnon() { if (!auth.currentUser) await auth.signInAnonymously(); },
      async adminState(uid) {
        const [info, mine] = await Promise.all([adminInfo.get(), adminDev(uid).get()]);
        return { ready: info.exists, registered: mine.exists, hash: mine.exists ? mine.data().pinHash : null };
      },
      async createAdminPin(uid, hash) {
        const b = db.batch();
        b.set(adminPin, { pinHash: hash });
        b.set(adminInfo, { ready: true, at: Date.now() });
        b.set(adminDev(uid), { pinHash: hash, at: Date.now() });
        await b.commit();
      },
      // the security rules accept this only when the hash matches the secret PIN
      async registerAdmin(uid, hash) { await adminDev(uid).set({ pinHash: hash, at: Date.now() }); },
      async changeAdminPin(uid, hash) {
        const others = await db.collection('admins').get();
        const b = db.batch();
        b.update(adminPin, { pinHash: hash });
        others.docs.forEach((d) => { if (d.id !== uid) b.delete(d.ref); });
        b.set(adminDev(uid), { pinHash: hash, at: Date.now() });
        await b.commit();
      },
      async forgetAdmin(uid) { await adminDev(uid).delete(); },
      listen(h) {
        const warn = (what) => (err) => { console.warn('listen', what, err); S.error = `${what}: ${err.message}`; emit(); };
        const unsubs = [
          root.onSnapshot((s) => h.profile(s.exists ? s.data() : null), warn('profile')),
          col('plans').onSnapshot((q) => h.plans(q.docs.map((d) => ({ ...d.data(), id: d.id }))), warn('plans')),
          col('overrides').onSnapshot((q) => h.overrides(Object.fromEntries(q.docs.map((d) => [d.id, d.data()]))), warn('overrides')),
          col('days').onSnapshot((q) => h.days(Object.fromEntries(q.docs.map((d) => [d.id, { ...d.data(), date: d.id }]))), warn('days')),
          col('targets').onSnapshot((q) => h.targets(Object.fromEntries(q.docs.map((d) => [d.id, d.data()]))), warn('targets')),
          col('awards').onSnapshot((q) => h.awards(q.docs.map((d) => ({ ...d.data(), id: d.id }))), warn('awards')),
          col('config').doc('media').onSnapshot((s) => h.media(s.exists ? s.data() : { slots: {} }), warn('media')),
          col('config').doc('scoring').onSnapshot((s) => h.scoring(s.exists ? s.data() : {}), warn('scoring')),
          col('config').doc('guide').onSnapshot((s) => h.guide(s.exists ? s.data() : { texts: {} }), warn('guide')),
        ];
        return () => unsubs.forEach((u) => u());
      },
      async ensureProfile(today) {
        const s = await root.get();
        if (!s.exists) await root.set(newProfile(today));
        else if (!s.data().startDate) await root.set({ startDate: today }, { merge: true });
      },
      saveDraft(date, entries) {
        col('days').doc(date).set({ date, status: 'PENDING', entries }, { merge: true }).catch((e) => console.warn('saveDraft', e));
      },
      closeDay(r, best, awards) {
        const b = db.batch();
        b.set(col('days').doc(r.log.date), r.log);
        b.update(root, { score: inc(r.points), currentStreak: r.newStreak, bestStreak: best, daysDone: inc(1) });
        awards.forEach((a) => b.set(col('awards').doc(a.id), a));
        b.commit().catch((e) => { console.warn('closeDay', e); toast('Could not save — check the connection'); });
      },
      async evaluate(today, pf, localLogs, sc) {
        return db.runTransaction(async (tx) => {
          const ps = await tx.get(root);
          if (!ps.exists) return null;
          const p = ps.data();
          if (!p.startDate) return null;
          const through = E.addDays(today, -1);
          let from = p.lastEvaluated ? E.addDays(p.lastEvaluated, 1) : p.startDate;
          if (from < p.startDate) from = p.startDate;
          const earliest = E.addDays(through, -E.RULES.MAX_LOOKBACK_DAYS);
          if (from < earliest) from = earliest;
          if (from > through) return null;
          const logs = { ...localLogs };
          for (let d = from; d <= through; d = E.addDays(d, 1)) {
            const ds = await tx.get(col('days').doc(d));
            if (ds.exists) logs[d] = { ...ds.data(), date: d }; else delete logs[d];
          }
          const ev = E.evaluate(p.startDate, p.lastEvaluated || null, today, logs, pf, sc);
          if (!ev) return null;
          ev.lostDates.forEach((d) => tx.set(col('days').doc(d), ev.lostLogs[d], { merge: true }));
          const upd = { lastEvaluated: ev.evaluatedThrough, currentStreak: ev.newStreak };
          if (ev.lostDates.length) { upd.score = inc(-ev.penalty); upd.daysLost = inc(ev.lostDates.length); }
          tx.update(root, upd);
          return ev;
        });
      },
      markDaysCelebrated(dates) { const b = db.batch(); dates.forEach((d) => b.set(col('days').doc(d), { celebrated: true }, { merge: true })); b.commit().catch(console.warn); },
      markAwardsCelebrated(ids) { const b = db.batch(); ids.forEach((id) => b.set(col('awards').doc(id), { celebrated: true }, { merge: true })); b.commit().catch(console.warn); },
      updateProfileNow(fields) { root.set(fields, { merge: true }).catch((e) => { console.warn(e); toast('Could not save: ' + e.message); }); },
      async savePlan(plan) { const copy = { ...plan }; const id = copy.id; delete copy.id; await (id ? col('plans').doc(id) : col('plans').doc()).set(copy); },
      async deletePlan(id) { await col('plans').doc(id).delete(); },
      async saveTarget(t) { await col('targets').doc(t.horizon).set(t); },
      async deleteTarget(hid) { await col('targets').doc(hid).delete(); },
      async setMedia(key, url) {
        const del = window.firebase.firestore.FieldValue.delete();
        await col('config').doc('media').set({ slots: { [key]: url ? url : del } }, { merge: true });
      },
      async saveScoring(sc) { await col('config').doc('scoring').set(sc); },
      async saveGuide(texts) { await col('config').doc('guide').set({ texts }, { merge: true }); },
      async updateProfile(fields) { await root.set(fields, { merge: true }); },
    };
  }

  function newProfile(today) {
    return { name: 'David', avatarPhoto: null, score: 0, currentStreak: 0, bestStreak: 0, daysDone: 0, daysLost: 0, startDate: today, lastEvaluated: null };
  }

  /* ================================ START ================================ */

  let backend = null;
  let unlisten = null;
  const isConfigured = () => !!(CFG.firebase && CFG.firebase.apiKey && !/PASTE/i.test(CFG.firebase.apiKey));

  function demoOffset() { return S.demo ? n0(localStorage.getItem('olympus_demo_offset')) : 0; }
  function computeToday() { return E.addDays(E.todayISO(), demoOffset()); }

  async function start(role) {
    S.role = role;
    const forceDemo = /[?&]demo\b/.test(location.search);
    try {
      backend = isConfigured() && !forceDemo ? await firebaseBackend() : localBackend();
    } catch (e) {
      console.error(e);
      S.error = 'Could not reach Firebase (' + e.message + '). Running in demo mode.';
      backend = localBackend();
    }
    S.demo = backend.demo;
    S.today = computeToday();
    if (S.demo) window.addEventListener('storage', (e) => { if (e.key === 'olympus_demo_offset') refreshToday(); });

    backend.onAuth(async (user) => {
      S.user = user;
      S.isAdmin = false; S.adminState = null;
      if (unlisten) { unlisten(); unlisten = null; }
      S.got = { profile: false, plans: false, logs: false };
      if (!user) { backend.signInAnon().catch((e) => { S.error = 'Sign-in failed: ' + e.message; emit(); }); emit(); return; }
      if (role === 'admin') await refreshAdmin();
      else subscribe(role);
      emit();
    });

    setInterval(refreshToday, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshToday(); evaluateNow(); } });
  }

  /** Admin: is this device one that proved the PIN? Then start listening. */
  async function refreshAdmin() {
    try { S.adminState = await backend.adminState(S.user.uid); }
    catch (e) { S.adminState = { ready: true, registered: false, hash: null, error: e.message }; }
    const was = S.isAdmin;
    S.isAdmin = !!S.adminState.registered;
    if (S.isAdmin && !was) subscribe('admin');
    if (!S.isAdmin && unlisten) { unlisten(); unlisten = null; }
    emit();
  }

  function subscribe(role) {
    if (unlisten) return;
        unlisten = backend.listen({
          profile: (p) => { S.profile = p; S.got.profile = true; emit(); },
          plans: (v) => { S.plans = v; S.got.plans = true; emit(); },
          overrides: (v) => { S.overrides = v; emit(); },
          days: (v) => { S.logs = v; S.got.logs = true; emit(); },
          targets: (v) => { S.targets = v; emit(); },
          awards: (v) => { S.awards = v.sort((a, b) => n0(a.earnedAt) - n0(b.earnedAt)); emit(); },
          media: (v) => { S.media = { slots: (v && v.slots) || {} }; emit(); },
          scoring: (v) => { S.scoring = E.scoring(v); emit(); },
          guide: (v) => { S.guide = { texts: (v && v.texts) || {} }; emit(); },
        });
        if (role === 'david') backend.ensureProfile(S.today).catch((e) => console.warn('ensureProfile', e));
  }

  function refreshToday() {
    const t = computeToday();
    if (t !== S.today) { S.today = t; emit(); }
  }

  /* -------------------- after every data change (David's device) -------------------- */

  let lastEvalDay = null;
  let evaluating = false;
  function afterData() {
    if (S.role !== 'david' || !loaded() || !S.profile || !S.profile.startDate) return;
    if (lastEvalDay !== S.today) { lastEvalDay = S.today; evaluateNow(); }
    queueStoredCelebrations();
  }

  async function evaluateNow() {
    if (S.role !== 'david' || !backend || !loaded() || evaluating) return;
    evaluating = true;
    try { await backend.evaluate(S.today, planForDate, S.logs, S.scoring); }
    catch (e) { console.warn('evaluate (will retry later)', e); lastEvalDay = null; }
    finally { evaluating = false; }
  }

  /* ============================== ACTIONS ============================== */

  function updateEntry(exId, fn) {
    const log = todayLog();
    if (log && (log.status === 'DONE' || log.status === 'LOST')) return;
    const plan = todayPlan();
    const planned = plan && (plan.exercises || []).find((p) => p.exercise === exId);
    const cur = todayEntries().find((e) => e.exercise === exId) || { exercise: exId, level: planned ? planned.level : 1, perSet: [] };
    const u = fn({ ...cur });
    u.level = clamp(n0(u.level) || 1, 1, 3);
    // one number per set (reps, or seconds when timed); sets / minutes kept alongside for reading
    u.perSet = E.setList(u).slice(0, 30).map((v) => clamp(Math.round(v), 0, 9999));
    delete u.reps;
    u.sets = u.perSet.length;
    u.minutes = Math.round(E.minutesOf(u) * 10) / 10;
    const order = todayRows().map((r) => (r.planned ? r.planned.exercise : r.entry.exercise));
    if (!order.includes(exId)) order.push(exId);
    const entries = todayEntries().filter((e) => e.exercise !== exId).concat([u])
      .sort((a, b) => order.indexOf(a.exercise) - order.indexOf(b.exercise));
    S.draft = { date: S.today, entries };
    backend.saveDraft(S.today, entries);
    emit();
  }

  /** Add an exercise that isn't in today's plan. */
  const addExtra = (exId) => updateEntry(exId, (e) => e);
  function removeExtra(exId) {
    const plan = todayPlan();
    if (plan && (plan.exercises || []).some((p) => p.exercise === exId)) return;
    const entries = todayEntries().filter((e) => e.exercise !== exId);
    S.draft = { date: S.today, entries };
    backend.saveDraft(S.today, entries);
    emit();
  }

  function closeToday() {
    if (todayClosed()) return;
    const plan = todayPlan();
    const start = startDate();
    const r = E.closeDay(S.today, start, plan, todayEntries(), S.logs, planForDate, S.scoring);
    if (!r) { toast('Log at least one exercise before closing the day'); return; }
    const logsAfter = { ...S.logs, [S.today]: r.log };
    const best = Math.max(n0(profile().bestStreak), r.newStreak);
    const now = Date.now();
    const doneLogs = Object.values(logsAfter).filter((l) => l.status === 'DONE');
    const earned = earnedIds();
    const medals = E.newlyEarned({ streak: r.newStreak, bestStreak: best, doneLogs }, earned).map((m) => E.medalAward(m, now));
    const coats = E.newlyAchieved(start, S.today, E.HORIZONS.map((h) => target(h.id)), Object.values(logsAfter), earned)
      .map((x) => E.milestoneAward(x.h, x.idx, now));
    backend.closeDay(r, best, medals.concat(coats));
    queued.add('closed_' + S.today);
    const line = `+${r.points} points · ${r.pct}% of the plan · Streak ${r.newStreak} ${r.newStreak === 1 ? 'day' : 'days'}`;
    // every closed day gets its video, then the % ring. Below 100% it uses video_day_incomplete.mp4 if you add one, else day_passed.
    if (r.complete) enqueue({ type: 'video', id: 'closed_' + S.today, key: 'day_passed', title: 'Day Passed!', subtitle: line });
    else enqueue({ type: 'video', id: 'closed_' + S.today, key: 'day_incomplete', fallback: 'day_passed', title: 'Day Closed', subtitle: line });
    enqueue({ type: 'summary', id: 'ring_' + S.today, title: r.complete ? 'Day Passed!' : 'Day Closed', subtitle: line, pct: r.pct });
  }

  /** Read a photo from the phone, crop it square and shrink it (≈20–40 KB) so it fits in the database. */
  function photoToDataURL(file, size = 320) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file is not an image the browser can read')); };
      img.src = url;
    });
  }
  function saveAvatarPhoto(dataUrl) {
    backend.updateProfileNow({ avatarPhoto: dataUrl || null });
    toast(dataUrl ? 'Avatar saved' : 'Avatar removed');
  }

  async function adminOp(okMsg, fn) {
    try { await fn(); toast(okMsg); return true; } catch (e) { console.error(e); toast('Failed: ' + e.message); return false; }
  }

  /* --------------------------------- PIN --------------------------------- */

  async function sha(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0; for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h;
  }
  /** One Admin PIN for all your devices (checked by the server rules), remembered per device after entry. */
  const ADMIN = {
    hash: (pin) => sha('olympus-admin:' + pin),
    remembered: () => !!S.user && localStorage.getItem('olympus_admin_device') === S.user.uid,
    remember: () => localStorage.setItem('olympus_admin_device', S.user.uid),
    lock: () => localStorage.removeItem('olympus_admin_device'),
    refresh: () => refreshAdmin(),
  };
  const PIN = {
    has: () => !!localStorage.getItem('olympus_pin_hash'),
    async set(pin) { const salt = uid(); localStorage.setItem('olympus_pin_salt', salt); localStorage.setItem('olympus_pin_hash', await sha(salt + ':' + pin)); },
    async verify(pin) { return (await sha((localStorage.getItem('olympus_pin_salt') || '') + ':' + pin)) === localStorage.getItem('olympus_pin_hash'); },
    clear() { localStorage.removeItem('olympus_pin_hash'); localStorage.removeItem('olympus_pin_salt'); },
  };

  /* ================================ TOAST ================================ */

  function toast(msg) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  /* ================================ ART (SVG) ================================ */

  const C = {
    gold: '#C9A227', goldLight: '#E9D27F', goldDeep: '#9A7612', marble: '#F5F1E8', marbleWarm: '#FBF8F1', vein: '#DCD3C3',
    bronze: '#7B4A1E', bronzeDeep: '#5E3815', bronzeLight: '#A8692F', ink: '#2A1F14', inkSoft: '#6B5B48',
    laurel: '#5B7A3A', lost: '#9B2F2F', aegean: '#27496D', night: '#140E08',
  };
  const f = (v) => Math.round(v * 100) / 100;

  /** Two laurel branches growing from the bottom up around (cx, cy). */
  function laurelLeaves(cx, cy, r, color, leaves = 9, opacity = 1) {
    const len = r * 0.36, wid = r * 0.15;
    const pt = (deg, rr) => [cx + rr * Math.cos((deg * Math.PI) / 180), cy + rr * Math.sin((deg * Math.PI) / 180)];
    const leafPath = `M0 ${f(-len / 2)} Q${f(wid / 2)} 0 0 ${f(len / 2)} Q${f(-wid / 2)} 0 0 ${f(-len / 2)} Z`;
    let out = `<g opacity="${opacity}">`;
    // stems
    const [lx0, ly0] = pt(112, r), [lx1, ly1] = pt(245, r), [rx0, ry0] = pt(68, r), [rx1, ry1] = pt(-65, r);
    out += `<path d="M${f(lx0)} ${f(ly0)} A${f(r)} ${f(r)} 0 0 1 ${f(lx1)} ${f(ly1)} M${f(rx0)} ${f(ry0)} A${f(r)} ${f(r)} 0 0 0 ${f(rx1)} ${f(ry1)}" fill="none" stroke="${color}" stroke-width="${f(wid * 0.3)}" stroke-linecap="round"/>`;
    out += `<g fill="${color}">`;
    // left branch grows with increasing angle, right branch with decreasing angle;
    // each leaf sits just off the stem and leans its tip outward/inward along the growth.
    const leaf = (deg, side, alt) => {
      const [x, y] = pt(deg, r + alt * wid * 0.75);
      const rot = deg + side * alt * 32 - side * 6;
      out += `<path d="${leafPath}" transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"/>`;
    };
    for (let i = 0; i < leaves; i++) {
      const t = i / (leaves - 1), alt = i % 2 === 0 ? 1 : -1;
      leaf(118 + t * 122, -1, alt);
      leaf(62 - t * 122, 1, alt);
    }
    // a pair of leaves at each tip
    const [tlx, tly] = pt(250, r), [trx, try_] = pt(-70, r);
    out += `<path d="${leafPath}" transform="translate(${f(tlx)} ${f(tly)}) rotate(${250 - 90 + 90})"/>`;
    out += `<path d="${leafPath}" transform="translate(${f(trx)} ${f(try_)}) rotate(${-70})"/>`;
    return out + '</g></g>';
  }
  const laurelSVG = (size, color = C.laurel, opacity = 1) =>
    `<svg class="laurel" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${laurelLeaves(50, 50, 40, color, 9, opacity)}</svg>`;

  function starPoints(cx, cy, outer, inner, n = 5) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? outer : inner, a = -Math.PI / 2 + (i * Math.PI) / n;
      pts.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`);
    }
    return pts.join(' ');
  }

  function emblemSVG(e, cx, cy, s, color) {
    const h = s / 2;
    const P = (x, y) => `${f(x)} ${f(y)}`;
    switch (e) {
      case 'CLUB': {
        let g = `<g transform="rotate(-30 ${f(cx)} ${f(cy)})" fill="${color}">`;
        g += `<path d="M${P(cx - 0.18 * h, cy + h)} L${P(cx - 0.42 * h, cy - 0.7 * h)} Q${P(cx, cy - 1.15 * h)} ${P(cx + 0.42 * h, cy - 0.7 * h)} L${P(cx + 0.18 * h, cy + h)} Z"/>`;
        for (let k = -1; k <= 1; k++) g += `<circle cx="${f(cx + k * 0.42 * h)}" cy="${f(cy - 0.35 * h + k * k * 0.1 * h)}" r="${f(0.12 * h)}"/>`;
        return g + '</g>';
      }
      case 'LIGHTNING':
        return `<polygon fill="${color}" points="${[[0.25, -1], [-0.45, 0.1], [-0.02, 0.1], [-0.25, 1], [0.5, -0.2], [0.05, -0.2]].map(([x, y]) => `${f(cx + x * h)},${f(cy + y * h)}`).join(' ')}"/>`;
      case 'TRIDENT': {
        const w = f(s * 0.09);
        return `<g stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none">` +
          `<line x1="${f(cx)}" y1="${f(cy - 0.5 * h)}" x2="${f(cx)}" y2="${f(cy + h)}"/>` +
          `<path d="M${P(cx - 0.6 * h, cy - h)} L${P(cx - 0.6 * h, cy - 0.4 * h)} Q${P(cx, cy - 0.05 * h)} ${P(cx + 0.6 * h, cy - 0.4 * h)} L${P(cx + 0.6 * h, cy - h)}"/>` +
          `<line x1="${f(cx)}" y1="${f(cy - h)}" x2="${f(cx)}" y2="${f(cy - 0.3 * h)}"/></g>`;
      }
      case 'OWL':
        return `<g><ellipse fill="${color}" cx="${f(cx)}" cy="${f(cy + 0.2 * h)}" rx="${f(0.6 * h)}" ry="${f(0.8 * h)}"/>` +
          `<polygon fill="${color}" points="${f(cx - 0.6 * h)},${f(cy - 0.35 * h)} ${f(cx - 0.5 * h)},${f(cy - 0.95 * h)} ${f(cx - 0.2 * h)},${f(cy - 0.55 * h)}"/>` +
          `<polygon fill="${color}" points="${f(cx + 0.6 * h)},${f(cy - 0.35 * h)} ${f(cx + 0.5 * h)},${f(cy - 0.95 * h)} ${f(cx + 0.2 * h)},${f(cy - 0.55 * h)}"/>` +
          `<circle fill="${C.marbleWarm}" cx="${f(cx - 0.25 * h)}" cy="${f(cy - 0.2 * h)}" r="${f(0.22 * h)}"/><circle fill="${C.marbleWarm}" cx="${f(cx + 0.25 * h)}" cy="${f(cy - 0.2 * h)}" r="${f(0.22 * h)}"/>` +
          `<circle fill="${C.ink}" cx="${f(cx - 0.25 * h)}" cy="${f(cy - 0.2 * h)}" r="${f(0.09 * h)}"/><circle fill="${C.ink}" cx="${f(cx + 0.25 * h)}" cy="${f(cy - 0.2 * h)}" r="${f(0.09 * h)}"/></g>`;
      case 'SUN': {
        let g = `<g stroke="${color}" stroke-width="${f(s * 0.06)}" stroke-linecap="round"><circle fill="${color}" stroke="none" cx="${f(cx)}" cy="${f(cy)}" r="${f(0.45 * h)}"/>`;
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6;
          g += `<line x1="${f(cx + 0.6 * h * Math.cos(a))}" y1="${f(cy + 0.6 * h * Math.sin(a))}" x2="${f(cx + 0.95 * h * Math.cos(a))}" y2="${f(cy + 0.95 * h * Math.sin(a))}"/>`;
        }
        return g + '</g>';
      }
      default:
        return `<polygon fill="${color}" points="${starPoints(cx, cy, h, h * 0.42)}"/>`;
    }
  }

  const EMBLEMS = ['CLUB', 'LIGHTNING', 'TRIDENT', 'OWL', 'SUN', 'STAR'];

  /** David's avatar: his own photo, or a laurel medallion with his initial. */
  function avatarHTML(p, size) {
    p = p || profile();
    if (p.avatarPhoto) return `<img class="avatar-photo" src="${esc(p.avatarPhoto)}" width="${size}" height="${size}" alt="Avatar">`;
    const initial = esc(String(p.name || 'D').trim().charAt(0).toUpperCase() || 'D');
    return `<svg class="avatar" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="Avatar">
      <circle cx="50" cy="50" r="49" fill="${C.bronzeDeep}" stroke="${C.gold}" stroke-width="2"/>
      ${laurelLeaves(50, 52, 34, C.gold, 7, 0.9)}
      <text x="50" y="62" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="34" fill="${C.goldLight}">${initial}</text></svg>`;
  }

  /* ------------------------------ media slots ------------------------------ */

  /** github.com/…/blob/… → raw.githubusercontent.com/… so pasted links just work. */
  function rawUrl(u) {
    u = String(u || '').trim();
    const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : u;
  }
  const mediaCache = {};
  const IMG_EXT = ['webp', 'png', 'jpg', 'jpeg', 'gif'];
  /** Bump when you replace pictures in media/ so phones load the new ones at once. */
  const MEDIA_V = 2;
  /**
   * URL for a media slot: the Admin's link wins; otherwise look for media/<key>.webp|png|jpg|jpeg|gif
   * next to index.html (checked once, then remembered). Returns null while unknown / missing.
   */
  function mediaURL(key) {
    const link = S.media.slots[key];
    if (link) return rawUrl(link);
    if (key in mediaCache) return mediaCache[key] === 'pending' ? null : mediaCache[key];
    mediaCache[key] = 'pending';
    let i = 0;
    const tryNext = () => {
      if (i >= IMG_EXT.length) { mediaCache[key] = null; return; }
      const url = `media/${key}.${IMG_EXT[i++]}?v=${MEDIA_V}`;
      const img = new Image();
      img.onload = () => { mediaCache[key] = url; emit(); };
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();
    return null;
  }
  /** Wait (briefly) until we know whether a media slot has a picture, so pop-ups show the real art. */
  function whenMedia(key, ms = 3000) {
    return new Promise((res) => {
      const t0 = Date.now();
      const tick = () => { const u = mediaURL(key); if (u || mediaCache[key] === null || Date.now() - t0 > ms) res(u); else setTimeout(tick, 60); };
      tick();
    });
  }
  /** First video that exists among the keys (an Admin link counts as existing). */
  async function pickVideo(keys) {
    keys = keys.filter(Boolean);
    for (const k of keys) {
      if (S.media.slots['video_' + k]) return videoURL(k);
      try { const r = await fetch(videoURL(k), { method: 'HEAD' }); if (r.ok) return videoURL(k); } catch (e) { /* try the next */ }
    }
    return videoURL(keys[0]);
  }
  const videoURL = (key) => (S.media.slots['video_' + key] ? rawUrl(S.media.slots['video_' + key]) : `media/video_${key}.mp4`);

  /** Medal or coat of arms: the Admin's image/GIF if present, otherwise the drawn one. */
  function awardArt(kind, id, earned, size, seed = 0) {
    const key = kind === 'COAT_OF_ARMS' ? 'coat_' + String(id).toLowerCase() : 'medal_' + id;
    const url = mediaURL(key);
    if (url) return `<span class="art ${earned ? '' : 'locked'}" style="width:${size}px;height:${size}px"><img src="${esc(url)}" alt=""></span>`;
    return kind === 'COAT_OF_ARMS' ? coatSVG(id, earned, size) : medalSVG(earned, seed, size);
  }

  function medalSVG(earned, seed, size) {
    const dim = earned ? 1 : 0.28;
    const id = 'md' + Math.random().toString(36).slice(2, 7);
    const stops = earned ? [C.goldLight, C.gold, C.goldDeep] : [C.vein, C.vein, '#B8AC9A'];
    const emblem = EMBLEMS[((seed % EMBLEMS.length) + EMBLEMS.length) % EMBLEMS.length];
    return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 100 100">
      <defs><radialGradient id="${id}" cx="40%" cy="40%" r="70%"><stop offset="0" stop-color="${stops[0]}"/><stop offset=".55" stop-color="${stops[1]}"/><stop offset="1" stop-color="${stops[2]}"/></radialGradient></defs>
      <polygon points="20,0 45,0 58,58 38,58" fill="#8E2A24" opacity="${dim}"/>
      <polygon points="80,0 55,0 42,58 62,58" fill="${C.aegean}" opacity="${dim}"/>
      <circle cx="50" cy="58" r="32" fill="url(#${id})"/>
      <circle cx="50" cy="58" r="26" fill="none" stroke="${earned ? C.goldDeep : '#B8AC9A'}" stroke-width="1.8"/>
      ${emblemSVG(emblem, 50, 58, 30, earned ? C.bronzeDeep : 'rgba(107,91,72,.35)')}
    </svg>`;
  }

  function coatSVG(hid, earned, size) {
    const h = E.HZ[hid] || E.HORIZONS[0];
    const dim = earned ? 1 : 0.3;
    const cx = 50, top = 10, w = 62, hg = 74;
    const d = `M${cx - w / 2} ${top} L${cx + w / 2} ${top} L${cx + w / 2} ${f(top + hg * 0.45)} Q${cx + w / 2} ${f(top + hg * 0.85)} ${cx} ${top + hg} Q${cx - w / 2} ${f(top + hg * 0.85)} ${cx - w / 2} ${f(top + hg * 0.45)} Z`;
    return `<svg class="coat" width="${size}" height="${size}" viewBox="0 0 100 100">
      ${laurelLeaves(50, top + hg * 0.55, 42, C.laurel, 8, dim)}
      <path d="${d}" fill="${h.field}" opacity="${dim}"/>
      <path d="${d}" fill="none" stroke="${earned ? C.gold : C.inkSoft}" stroke-opacity="${earned ? 1 : 0.4}" stroke-width="3.5"/>
      ${emblemSVG(h.emblem, 50, top + hg * 0.45, w * 0.55, earned ? C.goldLight : 'rgba(220,211,195,.6)')}
    </svg>`;
  }

  /* --------------------------------- charts --------------------------------- */

  function niceMax(v) {
    if (v <= 0) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  const compact = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Number.isInteger(v) ? String(v) : v.toFixed(1));

  /** series: [{label, values:[number|null], color, dashed, ghost, fill}] */
  function lineChartSVG(series, xLabels, H = 180) {
    const W = 340, L = 34, B = 18, w = W - L - 4, h = H - B - 6;
    const n = Math.max(0, ...series.map((s) => s.values.length));
    const maxV = niceMax(Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v != null))));
    const X = (i) => L + (n <= 1 ? w / 2 : (w * i) / (n - 1));
    const Y = (v) => 6 + h - h * Math.min(1.05, v / maxV);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = 6 + h - (h * i) / 4;
      g += `<line x1="${L}" y1="${f(y)}" x2="${W}" y2="${f(y)}" stroke="${C.vein}" stroke-width="1"/><text x="0" y="${f(y + 3)}" class="ct">${compact((maxV * i) / 4)}</text>`;
    }
    series.forEach((s) => {
      let d = '', started = false;
      s.values.forEach((v, i) => {
        if (v == null) { started = false; return; }
        d += `${started ? 'L' : 'M'}${f(X(i))} ${f(Y(v))} `;
        started = true;
      });
      const op = s.ghost ? 0.45 : 1;
      if (s.fill && d && !s.values.includes(null)) {
        g += `<path d="${d} L${f(X(s.values.length - 1))} ${6 + h} L${f(X(0))} ${6 + h} Z" fill="${s.color}" opacity=".16"/>`;
      }
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-opacity="${op}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="7 5"' : ''}/>`;
      if (n <= 31 && !s.dashed) s.values.forEach((v, i) => { if (v != null) g += `<circle cx="${f(X(i))}" cy="${f(Y(v))}" r="2.6" fill="${s.color}" fill-opacity="${op}"/>`; });
    });
    if (xLabels.length) {
      [...new Set([0, Math.floor(xLabels.length / 2), xLabels.length - 1])].forEach((i) => {
        g += `<text x="${f(clamp(X(i), L + 12, W - 16))}" y="${H - 3}" text-anchor="middle" class="ct">${esc(xLabels[i])}</text>`;
      });
    }
    const legend = series.map((s) => `<span class="lg"><i style="background:${s.color};opacity:${s.ghost ? 0.45 : 1}"></i>${esc(s.label)}</span>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="legend">${legend}</div>`;
  }

  /* ============================= SHARED VIEWS ============================= */

  const bar = (p, ghost = false, cls = '') => `<div class="bar ${ghost ? 'ghost' : ''} ${cls}"><i style="width:${f(clamp(p, 0, 1) * 100)}%"></i></div>`;
  const labeled = (label, value, p, ghost = false) => `<div class="lp"><div class="lp-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>${bar(p, ghost)}</div>`;
  const section = (t) => `<div class="section"><i></i><span>${esc(t)}</span><s></s></div>`;
  /**
   * Editor for the sets of one exercise: a row per set with − / + and ✕, then "+ Add a set".
   * Buttons carry data-act="sl-step|sl-del|sl-add" plus `attrs` (so a page can tell exercises apart).
   */
  function setsEditorHTML(exId, list, attrs = '') {
    const info = E.EX[exId], timed = E.isTimed(exId), step = info.step || 1;
    const f = (v) => (timed ? E.fmtSecs(v) : v);
    const rows = list.map((v, i) => `<div class="set-row"><span class="set-no">SET ${i + 1}</span>
      <button class="sb" data-act="sl-step" ${attrs} data-i="${i}" data-d="${-step}" ${v <= 0 ? 'disabled' : ''} aria-label="Less">−</button>
      <b class="set-v">${f(v)}${timed ? '' : `<small>${info.unit}</small>`}</b>
      <button class="sb" data-act="sl-step" ${attrs} data-i="${i}" data-d="${step}" aria-label="More">+</button>
      <button class="sx" data-act="sl-del" ${attrs} data-i="${i}" aria-label="Remove set ${i + 1}">✕</button></div>`).join('');
    return `<div class="sets-ed">${rows || '<p class="muted small center">No sets yet.</p>'}
      ${list.length < 20 ? `<button class="btn-line add-set" data-act="sl-add" ${attrs}>＋ Add a set</button>` : ''}</div>`;
  }
  /** Shared handler: returns the changed list for sl-step / sl-del / sl-add. */
  function setsEdit(exId, list, act, d) {
    const l = list.slice(), info = E.EX[exId];
    if (act === 'sl-step') l[+d.i] = clamp(n0(l[+d.i]) + +d.d, 0, 9999);
    if (act === 'sl-del') l.splice(+d.i, 1);
    if (act === 'sl-add') l.push(l.length ? l[l.length - 1] || info.dflt : info.dflt);
    return l;
  }
  const levelBadge = (n) => `<span class="lvl">${E.lvl(n).label}</span>`;

  const fmtNum = (v) => Math.round(n0(v)).toLocaleString();
  const pct1 = (v) => (Math.round(n0(v) * 10) / 10) + '%';

  /** One line describing a target, e.g. "9,600 pts · 450 min · skipped ≤ 0%". */
  function targetLine(t) {
    const parts = [];
    if (n0(t.points)) parts.push(`${fmtNum(t.points)} pts`);
    if (n0(t.minutes)) parts.push(`${fmtNum(t.minutes)} min`);
    if (n0(t.reps)) parts.push(`${fmtNum(t.reps)} reps`);
    if (n0(t.sets)) parts.push(`${fmtNum(t.sets)} sets`);
    if (n0(t.avgLevel)) parts.push(`level ≥ ${t.avgLevel}`);
    if (E.hasMax(t.maxSkippedPct)) parts.push(`skipped ≤ ${t.maxSkippedPct}%`);
    if (E.hasMax(t.maxMissedPct)) parts.push(`missed min ≤ ${t.maxMissedPct}%`);
    return parts.join(' · ');
  }

  function horizonsCard() {
    let out = `<div class="card">${section('Milestones')}`;
    E.HORIZONS.forEach((h) => {
      const t = target(h.id);
      const { idx, tot } = currentBlock(h.id);
      const ghost = t.state === 'GHOST';
      const label = `${h.title}${h.repeats ? ' ' + E.roman(idx + 1) : ''}${ghost ? ' · ghost' : ''}`;
      const value = n0(t.points) ? `${fmtNum(tot.points)} / ${fmtNum(t.points)} pts` : `${fmtNum(tot.minutes)} / ${fmtNum(t.minutes)} min`;
      out += labeled(label, value, E.progress(t, tot), ghost);
      out += `<div class="muted tiny">Skipped ${pct1(tot.skippedPct)}${E.hasMax(t.maxSkippedPct) ? ` (max ${t.maxSkippedPct}%)` : ''} · missed minutes ${pct1(tot.missedPct)}${E.hasMax(t.maxMissedPct) ? ` (max ${t.maxMissedPct}%)` : ''}</div>`;
    });
    const b = baseline();
    if (!b.calibrated) out += `<p class="muted small">Ghost targets are calibrating from the first ${E.RULES.CALIBRATION_DAYS} days (${b.elapsedDays}/${E.RULES.CALIBRATION_DAYS}).</p>`;
    return out + '</div>';
  }

  /** done (completed) · incomplete · skipped · today · planned · empty · before */
  function markFor(d) {
    const log = S.logs[d];
    if (log && log.status === 'DONE') return log.complete === false ? 'incomplete' : 'done';
    if (log && log.status === 'LOST') return 'skipped';
    if (d === S.today) return 'today';
    if (d < startDate()) return 'before';
    if (d > S.today && !E.isRest(planForDate(d))) return 'planned';
    return 'empty';
  }
  const CIRCLE_SLOT = { done: 'circle_done', incomplete: 'circle_incomplete', skipped: 'circle_skipped', today: 'circle_today', planned: 'circle_planned' };

  function dayCircle(iso, label) {
    const mark = markFor(iso);
    const slot = CIRCLE_SLOT[mark];
    const url = slot ? mediaURL(slot) : null;
    const pct = mark === 'incomplete' ? Math.max(0, Math.min(100, n0(S.logs[iso].pct))) : 0;
    const style = mark === 'incomplete' && !url ? ` style="--pct:${pct}%"` : '';
    return `<button class="dc ${mark}${url ? ' img' : ''}"${style} data-act="day" data-date="${iso}">${url ? `<img src="${esc(url)}" alt="">` : ''}<span>${label}</span></button>`;
  }

  /** month: "YYYY-MM". Day circles carry data-act="day" data-date. */
  function calendarCard(month) {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = E.DOW.indexOf(E.dowOf(first));
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let d = 1; d <= len; d++) cells += dayCircle(`${month}-${String(d).padStart(2, '0')}`, d);
    const leg = (cls, label) => {
      const url = CIRCLE_SLOT[cls] ? mediaURL(CIRCLE_SLOT[cls]) : null;
      return `<span class="lg">${url ? `<img class="lg-img" src="${esc(url)}" alt="">` : `<i class="dot ${cls}"></i>`}${label}</span>`;
    };
    const bg = mediaURL('month_' + String(m).padStart(2, '0')) || mediaURL('month_bg');
    return `<div class="card cal-card${bg ? ' has-bg' : ''}"${bg ? ` style="background-image:url('${esc(bg)}')"` : ''}>
      <div class="cal-head"><button class="icon" data-act="month" data-dir="-1" aria-label="Previous month">‹</button><h3>${MONTHS_LONG[m - 1]} ${y}</h3><button class="icon" data-act="month" data-dir="1" aria-label="Next month">›</button></div>
      <div class="cal-grid wk">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="legend">${leg('done', 'Completed')}${leg('incomplete', 'Incomplete')}${leg('skipped', 'Skipped')}${leg('today', 'Today')}${leg('planned', 'Planned')}</div>
    </div>`;
  }

  function dayDetailHTML(date) {
    const log = S.logs[date];
    const plan = (log && log.plan) || planForDate(date);
    let status, cls;
    if (log && log.status === 'DONE') { status = `${log.complete === false ? 'INCOMPLETE' : 'COMPLETED'} · ${n0(log.pct)}% · +${fmtNum(log.points)} pts`; cls = log.complete === false ? 'warn' : 'ok'; }
    else if (log && log.status === 'LOST') { status = `SKIPPED · ${n0(log.points)} pts`; cls = 'bad'; }
    else if (date === S.today) { status = 'IN PROGRESS'; cls = ''; }
    else { status = date > S.today ? 'UPCOMING' : E.isRest(plan) ? 'NO PLAN' : 'NOT CLOSED'; cls = 'muted'; }

    const entries = (log && log.entries) || (date === S.today ? todayEntries() : []);
    const ids = [...new Set([...((plan && plan.exercises) || []).map((p) => p.exercise), ...entries.map((e) => e.exercise)])];
    let body = '';
    if (!ids.length) body = `<p>${plan ? 'Rest day.' : 'No plan was set for this day.'}</p>`;
    ids.forEach((id) => {
      const info = E.EX[id] || { name: id, unit: 'reps' };
      const p = plan && (plan.exercises || []).find((x) => x.exercise === id);
      const e = entries.find((x) => x.exercise === id && E.isActive(x));
      body += `<div class="dd-row"><div class="dd-top"><b>${esc(info.name)}</b><span class="${e ? 'ok' : 'muted'}">${e ? `${fmtNum(E.exercisePoints(e, S.scoring))} pts` : '—'}</span></div>
        ${p ? `<div class="muted small">Plan: ${E.lvl(p.level).label} · ${E.fmtSets(E.planEntry(p))}</div>` : '<div class="muted small">Extra — not in the plan</div>'}
        ${e ? `<div>Done: ${E.lvl(e.level).label} · ${E.fmtSets(e)}</div>` : ''}</div>`;
    });
    const mins = Math.round(entries.filter(E.isActive).reduce((a, e) => a + E.minutesOf(e), 0) * 10) / 10, pMins = E.plannedMinutes(plan);
    if (ids.length) body += `<p class="strong">${mins || pMins ? `Timed: ${mins} / ${pMins} min · ` : ''}Points: ${fmtNum(log && log.status === 'DONE' ? log.points : E.dayPoints(entries, S.scoring))} / ${fmtNum(log && log.planned != null ? log.planned : E.plannedPoints(plan, S.scoring))}</p>`;
    if (plan && plan.note) body += `<p class="muted small">Note: ${esc(plan.note)}</p>`;
    return `<h3>${fmtDate(date, 'long')}</h3><div class="status ${cls}">${status}</div>${body}`;
  }

  function totalsCard() {
    const all = E.totals(Object.values(S.logs));
    const p = profile();
    const st = (l, v) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="card">${section('The chronicle so far')}<div class="stats">${st('Completed', all.completeDays)}${st('Incomplete', all.days - all.completeDays)}${st('Skipped', all.skipped)}${st('Points', fmtNum(all.points))}</div>
      <div class="stats" style="margin-top:10px">${st('Minutes', fmtNum(all.minutes))}${st('Reps', fmtNum(all.reps))}${st('Sets', fmtNum(all.sets))}${st('Avg level', all.avgLevel ? all.avgLevel.toFixed(1) : '–')}</div>
      <p class="muted tiny center" style="margin-top:8px">Skipped ${pct1(all.skippedPct)} of days · missed ${pct1(all.missedPct)} of planned minutes · best streak ${n0(p.bestStreak)}</p></div>`;
  }

  const METRICS = [['POINTS', 'Points'], ['MINUTES', 'Minutes'], ['REPS', 'Reps'], ['SETS', 'Sets'], ['LEVEL', 'Avg level']];
  function trendsCard(metric) {
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(E.addDays(S.today, -i));
    const pick = { POINTS: (l) => n0(l.points), MINUTES: E.logMinutes, REPS: E.logReps, SETS: E.logSets, LEVEL: E.logAvgLevel }[metric] || ((l) => n0(l.points));
    const values = days.map((d) => {
      const l = S.logs[d];
      if (!l || l.status === 'PENDING') return null;
      if (l.status === 'LOST') return 0;
      return pick(l);
    });
    const series = [{ label: (METRICS.find((m) => m[0] === metric) || METRICS[0])[1], values, color: C.bronze }];
    if (metric === 'POINTS') series.push({ label: 'Planned', values: days.map((d) => { const l = S.logs[d]; return l && l.status !== 'PENDING' ? n0(l.planned) : null; }), color: C.gold, dashed: true });
    const chips = METRICS.map(([k, l]) => `<button class="chip ${k === metric ? 'on' : ''}" data-act="metric" data-metric="${k}">${l}</button>`).join('');
    return `<div class="card">${section('Trends · last 30 days')}<div class="chips">${chips}</div>${lineChartSVG(series, days.map((d) => fmtDate(d, 'dm')))}</div>`;
  }

  /** Cumulative points vs the ghost pace and the 10-year master trajectory. */
  function trajectoryCard() {
    const start = startDate();
    const elapsed = Math.max(1, E.diffDays(start, S.today) + 1);
    const stride = Math.max(1, Math.ceil(elapsed / 60));
    const idx = [];
    for (let i = 0; i < elapsed; i += stride) idx.push(i);
    if (idx[idx.length - 1] !== elapsed - 1) idx.push(elapsed - 1);
    const done = Object.values(S.logs).filter((l) => l.status === 'DONE').sort((a, b) => (a.date < b.date ? -1 : 1));
    const cum = new Array(elapsed).fill(0);
    let run = 0, li = 0;
    for (let i = 0; i < elapsed; i++) {
      const d = E.addDays(start, i);
      while (li < done.length && done[li].date <= d) { run += n0(done[li].points); li++; }
      cum[i] = run;
    }
    const gy = target('YEAR'), master = target('TEN_YEAR');
    const gpd = n0(gy.points) / 365, mpd = n0(master.points) / 3652;
    const projected = Math.round((cum[elapsed - 1] / elapsed) * 3652);
    const pct = master.points ? Math.round((projected * 100) / master.points) : 0;
    const isGhost = gy.state === 'GHOST';
    const chart = lineChartSVG([
      { label: 'Actual', values: idx.map((i) => cum[i]), color: C.bronze, fill: true },
      { label: isGhost ? 'Ghost pace' : 'Yearly target pace', values: idx.map((i) => (i + 1) * gpd), color: C.gold, dashed: true, ghost: isGhost },
      { label: '10-year path', values: idx.map((i) => (i + 1) * mpd), color: C.aegean, dashed: true },
    ], idx.map((i) => 'Day ' + (i + 1)));
    return `<div class="card">${section('Perspective · the 10-year road')}${chart}
      <p class="muted small">At today's pace: about <b>${fmtNum(projected)}</b> points by year 10 — ${pct}% of the Master Target (${fmtNum(master.points)} pts).</p></div>`;
  }

  /* ------------------------------ modal helper ------------------------------ */

  function modal(html) {
    closeModal();
    const m = document.createElement('div');
    m.id = 'modal';
    m.innerHTML = `<div class="modal-card">${html}<div class="right"><button class="btn-text" data-act="close-modal">Close</button></div></div>`;
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-act="close-modal"]')) closeModal(); });
    document.body.appendChild(m);
  }
  function closeModal() { const m = document.getElementById('modal'); if (m) m.remove(); }

  /* ============================ CELEBRATIONS ============================ */

  const queue = [];
  const queued = new Set();
  let showing = false;

  function enqueue(c) { queue.push(c); if (!showing) showNext(); }

  function queueStoredCelebrations() {
    const lost = Object.values(S.logs).filter((l) => l.status === 'LOST' && !l.celebrated && !queued.has('lost_' + l.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (lost.length) {
      lost.forEach((l) => queued.add('lost_' + l.date));
      const n = lost.length;
      enqueue({ type: 'video', id: 'lost_' + lost[n - 1].date, key: 'day_failed', title: n === 1 ? 'A Day Was Lost' : `${n} Days Were Lost`, subtitle: `Streak reset to 0 · −${n * n0(S.scoring.penalty)} points.<br>The road is still there — walk it today.` });
      backend.markDaysCelebrated(lost.map((l) => l.date));
    }
    const fresh = S.awards.filter((a) => !a.celebrated && !queued.has(a.id));
    if (fresh.length) {
      fresh.forEach((a) => {
        queued.add(a.id);
        if (a.kind === 'COAT_OF_ARMS' && a.horizon) enqueue({ type: 'video', id: a.id, key: E.HZ[a.horizon].video, title: a.title, subtitle: esc(a.subtitle), award: a });
        else enqueue({ type: 'medal', id: a.id, award: a });
      });
      backend.markAwardsCelebrated(fresh.map((a) => a.id));
    }
  }

  function showNext() {
    const c = queue.shift();
    if (!c) { showing = false; return; }
    showing = true;
    const el = document.createElement('div');
    el.id = 'celebration';
    const done = () => { el.remove(); showNext(); };

    if (c.type === 'summary') {
      el.className = 'cel medal-reveal';
      el.innerHTML = `<div class="mr"><div class="eyebrow">THE DAY IS CLOSED</div><div class="pop ring" style="--pct:${clamp(n0(c.pct), 0, 100)}%"><b>${n0(c.pct)}%</b><small>of the plan</small></div>
        <h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p><p class="muted-light">Every step counts. Tomorrow, walk a little further.</p><button class="btn-gold" data-x="done">Continue</button></div>`;
      el.querySelector('[data-x="done"]').onclick = done;
      document.body.appendChild(el);
      return;
    }

    if (c.type === 'medal' && !c.artReady) {
      // make sure the uploaded medal picture is known before showing it
      whenMedia('medal_' + c.award.id).then(() => { queue.unshift({ ...c, artReady: true }); showNext(); });
      return;
    }
    if (c.type === 'medal') {
      el.className = 'cel medal-reveal';
      el.innerHTML = `<div class="mr"><div class="eyebrow">MEDAL EARNED</div><div class="pop">${awardArt('MEDAL', c.award.id, true, 200, E.MEDALS.findIndex((m) => m.id === c.award.id))}</div>
        <h2>${esc(c.award.title)}</h2><p>${esc(c.award.subtitle)}</p><button class="btn-gold" data-x="done">Continue</button></div>`;
      el.querySelector('[data-x="done"]').onclick = done;
      document.body.appendChild(el);
      return;
    }

    const failed = c.key === 'day_failed';
    el.className = 'cel' + (failed ? ' failed' : '');
    el.innerHTML = `<div class="stage">
        <video playsinline preload="auto"></video>
        <div class="placeholder hidden"><div class="pbar"><i></i></div>${laurelSVG(220, failed ? '#8A4A4A' : C.gold)}<div class="ph-name">video_${c.key}.mp4</div></div>
        <button class="sound hidden" data-x="sound">🔊 Tap for sound</button>
        <div class="caption"><h2>${esc(c.title)}</h2><p>${c.subtitle}</p><button class="btn-text gold" data-x="skip" disabled>Skip</button></div>
      </div>`;
    document.body.appendChild(el);
    const v = el.querySelector('video');
    const ph = el.querySelector('.placeholder');
    const skip = el.querySelector('[data-x="skip"]');
    const sound = el.querySelector('[data-x="sound"]');
    let ended = false, closeTimer = null;
    const finish = () => {
      if (ended) return;
      ended = true;
      skip.disabled = false; skip.textContent = 'Continue';
      closeTimer = setTimeout(done, 4000);
    };
    skip.onclick = () => { clearTimeout(closeTimer); done(); };
    setTimeout(() => { skip.disabled = false; }, 3000);
    const placeholder = () => {
      v.remove(); sound.classList.add('hidden'); ph.classList.remove('hidden');
      requestAnimationFrame(() => ph.querySelector('.pbar i').style.width = '100%');
      setTimeout(finish, 10000);
    };
    v.onerror = placeholder;
    v.onended = finish;
    pickVideo([c.key, c.fallback]).then((src) => {
      v.src = src;
      v.play().catch(() => {
        v.muted = true;
        v.play().then(() => {
          sound.classList.remove('hidden');
          sound.onclick = () => { v.muted = false; sound.classList.add('hidden'); };
        }).catch(() => { if (!ended && v.isConnected && v.error) placeholder(); });
      });
    });
  }

  /* --------------------------- exercise image + GIF --------------------------- */

  /** The Admin's picture for an exercise level: image slot first, then the GIF slot. Empty if neither exists. */
  function exerciseMediaURL(exId, level) {
    return mediaURL(E.imgKey(exId, level)) || mediaURL(E.gifKey(exId, level));
  }
  function exerciseMediaHTML(exId, level) {
    const url = exerciseMediaURL(exId, level);
    return url ? `<div class="exmedia"><img src="${esc(url)}" alt="" onerror="this.parentNode.remove()"></div>` : '';
  }

  /** Codex text: the Admin's version, or the built-in default. */
  function guideText(key) {
    const t = S.guide.texts[key];
    if (t != null && String(t).trim() !== '') return String(t);
    const sec = E.GUIDE_SECTIONS.find((x) => x[0] === key);
    if (sec) return sec[2];
    const m = key.match(/^ex_([A-Z_]+)_(\d)$/);
    return m && E.EX[m[1]] ? E.EX[m[1]].levels[m[2]] : '';
  }

  /* ------------------------------ demo toolbar ------------------------------ */

  function demoBarHTML() {
    if (!S.demo) return '';
    return `<div class="demo-bar"><b>DEMO</b><span>Today: ${fmtDate(S.today, 'day')}${demoOffset() ? ` (+${demoOffset()}d)` : ''}</span>
      <button data-act="demo-next">+1 day</button><button data-act="demo-today">Real today</button><button data-act="demo-wipe">Wipe</button></div>`;
  }
  function demoAction(act) {
    if (act === 'demo-next') localStorage.setItem('olympus_demo_offset', String(demoOffset() + 1));
    if (act === 'demo-today') localStorage.setItem('olympus_demo_offset', '0');
    if (act === 'demo-wipe') {
      if (!confirm('Wipe all demo data (plans, days, medals)?')) return;
      backend.wipe(); PIN.clear(); localStorage.removeItem('olympus_demo_admin'); ADMIN.lock(); location.reload(); return;
    }
    lastEvalDay = null;
    refreshToday();
  }

  /* ============================== EXPORT ============================== */

  window.Olympus = {
    E, C, S, start, onChange, emit, loaded, esc, fmtDate, fmtMillis, fmtNum, n0, clamp,
    profile, planForDate, startDate, todayPlan, todayLog, todayClosed, todayEntries, todayRows, todayStats, baseline, planTarget, ghost, target, currentBlock, week, earnedIds,
    updateEntry, addExtra, removeExtra, closeToday, photoToDataURL, saveAvatarPhoto, adminOp, PIN, ADMIN, toast,
    backend: () => backend,
    laurelSVG, avatarHTML, medalSVG, coatSVG, emblemSVG, lineChartSVG, rawUrl, mediaURL, awardArt, targetLine,
    bar, labeled, section, videoURL, levelBadge, setsEditorHTML, setsEdit, horizonsCard, calendarCard, dayDetailHTML, totalsCard, trendsCard, trajectoryCard, exerciseMediaHTML, exerciseMediaURL, guideText,
    modal, closeModal, demoBarHTML, demoAction,
    MOTTO: 'The road is mastered by the one who walks it.',
  };
})();
