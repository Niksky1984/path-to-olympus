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
    quests: [],
    rewards: [],
    requests: [],
    messages: [],
    tests: [],
    sync: { offline: typeof navigator !== 'undefined' && navigator.onLine === false, pending: false },
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
  const todayClosed = () => !!(todayLog() && (todayLog().status === 'DONE' || todayLog().status === 'EXCUSED'));
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

  /* ------------------------------ v6 derived ------------------------------ */

  const logsArr = () => Object.values(S.logs);
  /** Glory from bonuses (finished quests + monthly tests) — kept when the Admin recalculates the score from the days. */
  const bonusTotal = () => E.sum(S.quests.filter((q) => q.claimedAt), (q) => n0(q.bonus)) + E.sum(S.tests, (t) => n0(t.bonus));
  /** Glory already spent or reserved in the shop. */
  const spent = () => E.sum(S.requests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED'), (r) => n0(r.cost));
  const treasury = () => Math.max(0, Math.round(n0(profile().score) - spent()));
  const rank = () => E.rankOf(profile().score);
  const thisTest = () => S.tests.find((t) => t.id === E.testId(S.today)) || null;

  /* ------------------------- offline / sync indicator ------------------------- */

  let wasPending = false;
  function setSync(fields) {
    const before = S.sync.pending || S.sync.offline;
    Object.assign(S.sync, fields);
    const now = S.sync.pending || S.sync.offline;
    if (before && !now && wasPending) toast('Synced ✓ — everything is saved online');
    wasPending = now;
    if (before !== now) emit();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => setSync({ offline: false }));
    window.addEventListener('offline', () => setSync({ offline: true }));
  }
  /** A small pill under the top bar while something waits to be sent. */
  function syncHTML() {
    if (S.demo || !(S.sync.offline || S.sync.pending)) return '';
    return `<div class="sync-pill ${S.sync.offline ? 'off' : ''}">${S.sync.offline ? '☁︎ Offline — your entries are saved on this phone and will be sent later' : '⟳ Saved on this phone — sending…'}</div>`;
  }

  /* --------------------------- David's own settings --------------------------- */

  const SET_KEY = 'olympus_settings';
  const SETTINGS_DEFAULT = { sound: true, vibrate: true, text: 'normal', calm: false };
  function settings() { try { return { ...SETTINGS_DEFAULT, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; } catch (e) { return { ...SETTINGS_DEFAULT }; } }
  function setSetting(k, v) { const s = settings(); s[k] = v; localStorage.setItem(SET_KEY, JSON.stringify(s)); applySettings(); }
  function applySettings() {
    if (typeof document === 'undefined' || !document.body) return;
    const s = settings();
    document.body.classList.toggle('text-l', s.text === 'large');
    document.body.classList.toggle('text-xl', s.text === 'xlarge');
    document.body.classList.toggle('calm', !!s.calm);
  }
  /** Beep + buzz, if David allows them. */
  function beep() {
    const s = settings();
    if (s.sound) {
      try { const a = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25].forEach((t) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.25, a.currentTime + t); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.15); }); } catch (e) { /* silent */ }
    }
    if (s.vibrate) { try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { /* none */ } }
  }

  /* ============================== BACKENDS ============================== */

  /* ----------------------------- DEMO (localStorage) ----------------------------- */

  function localBackend() {
    const KEY = 'olympus_demo_db';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const blank = () => ({ profile: null, plans: {}, overrides: {}, days: {}, targets: {}, awards: {}, media: { slots: {} }, scoring: {}, guide: { texts: {} }, quests: {}, rewards: {}, requests: {}, messages: {}, tests: {} });
    const list = (o) => Object.entries(o || {}).map(([id, v]) => ({ ...v, id }));
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
      ['quests', 'rewards', 'requests', 'messages', 'tests'].forEach((n) => handlers[n] && handlers[n](list(db[n])));
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
      async resetJourney(today, keep) {
        db.days = {}; db.awards = {}; db.tests = {}; db.requests = {};
        Object.values(db.quests).forEach((q) => { delete q.claimedAt; delete q.celebrated; });
        db.profile = { ...newProfile(today), ...keep, resetAt: Date.now() }; save();
      },
      async setDay(date, log) { if (log) db.days[date] = { ...log, date }; else delete db.days[date]; save(); },
      /* v6: quests, shop, messages, monthly test */
      async saveDoc(coll, id, data) { id = id || uid(); db[coll][id] = { ...data }; delete db[coll][id].id; save(); return id; },
      async patchDoc(coll, id, fields) { if (db[coll][id]) { db[coll][id] = { ...db[coll][id], ...fields }; save(); } },
      async deleteDoc(coll, id) { delete db[coll][id]; save(); },
      async claimQuest(id, bonus) {
        const q = db.quests[id];
        if (!q || q.claimedAt) return false;
        q.claimedAt = Date.now(); q.celebrated = true; db.profile.score = n0(db.profile.score) + n0(bonus); save(); return true;
      },
      async saveTest(id, doc, bonus) {
        if (db.tests[id]) throw new Error('This month\'s Trial is already done');
        db.tests[id] = doc; db.profile.score = n0(db.profile.score) + n0(bonus); save();
      },
      // pairing is not needed in demo (one browser = one device)
      async davidState() { return { ready: true, registered: true }; },
      async registerDavid() {},
      async setDavidCode() {},
      async exportAll() { return JSON.parse(JSON.stringify(db)); },
      async importAll(data) { db = Object.assign(blank(), JSON.parse(JSON.stringify(data))); save(); },
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
    /* offline indicator: which listeners still have writes waiting for the server */
    const pendingBy = {};
    const pend = (k, v) => { pendingBy[k] = v; setSync({ pending: Object.values(pendingBy).some(Boolean) }); };

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
          root.onSnapshot({ includeMetadataChanges: true }, (s) => { pend('profile', s.metadata.hasPendingWrites); h.profile(s.exists ? s.data() : null); }, warn('profile')),
          col('plans').onSnapshot((q) => h.plans(q.docs.map((d) => ({ ...d.data(), id: d.id }))), warn('plans')),
          col('overrides').onSnapshot((q) => h.overrides(Object.fromEntries(q.docs.map((d) => [d.id, d.data()]))), warn('overrides')),
          col('days').onSnapshot({ includeMetadataChanges: true }, (q) => { pend('days', q.metadata.hasPendingWrites); h.days(Object.fromEntries(q.docs.map((d) => [d.id, { ...d.data(), date: d.id }]))); }, warn('days')),
          col('targets').onSnapshot((q) => h.targets(Object.fromEntries(q.docs.map((d) => [d.id, d.data()]))), warn('targets')),
          col('awards').onSnapshot((q) => h.awards(q.docs.map((d) => ({ ...d.data(), id: d.id }))), warn('awards')),
          col('config').doc('media').onSnapshot((s) => h.media(s.exists ? s.data() : { slots: {} }), warn('media')),
          col('config').doc('scoring').onSnapshot((s) => h.scoring(s.exists ? s.data() : {}), warn('scoring')),
          col('config').doc('guide').onSnapshot((s) => h.guide(s.exists ? s.data() : { texts: {} }), warn('guide')),
          ...['quests', 'rewards', 'requests', 'messages', 'tests'].map((n) =>
            col(n).onSnapshot({ includeMetadataChanges: n === 'requests' || n === 'tests' }, (q) => {
              if (n === 'requests' || n === 'tests') pend(n, q.metadata.hasPendingWrites);
              h[n](q.docs.map((d) => ({ ...d.data(), id: d.id })));
            }, warn(n))),
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
      /** Start again: delete every day and award, zero the profile (plans, targets, media stay). */
      async resetJourney(today, keep) {
        const docs = (await Promise.all(['days', 'awards', 'tests', 'requests'].map((n) => col(n).get()))).flatMap((q) => q.docs);
        for (let i = 0; i < docs.length; i += 400) {
          const b = db.batch(); docs.slice(i, i + 400).forEach((d) => b.delete(d.ref)); await b.commit();
        }
        const del = window.firebase.firestore.FieldValue.delete();
        const qs = (await col('quests').get()).docs.filter((d) => d.data().claimedAt);
        if (qs.length) { const b = db.batch(); qs.forEach((d) => b.update(d.ref, { claimedAt: del, celebrated: del })); await b.commit(); }
        await root.set({ ...newProfile(today), ...keep, resetAt: Date.now() });
      },
      /** Admin: write (or delete) one day exactly as given. */
      async setDay(date, log) { if (log) await col('days').doc(date).set({ ...log, date }); else await col('days').doc(date).delete(); },
      /* ---- v6: quests, shop, messages, monthly test ---- */
      async saveDoc(coll, id, data) { const copy = { ...data }; delete copy.id; const ref = id ? col(coll).doc(id) : col(coll).doc(); await ref.set(copy); return ref.id; },
      // not awaited by David's phone, so it also works offline (queued by Firestore)
      patchDoc(coll, id, fields) { return col(coll).doc(id).set(fields, { merge: true }); },
      async deleteDoc(coll, id) { await col(coll).doc(id).delete(); },
      /** Mark a finished quest as claimed and add its bonus once (a transaction, so two phones can't double it). */
      async claimQuest(id, bonus) {
        return db.runTransaction(async (tx) => {
          const qs = await tx.get(col('quests').doc(id));
          if (!qs.exists || qs.data().claimedAt) return false;
          tx.update(col('quests').doc(id), { claimedAt: Date.now(), celebrated: true });
          tx.update(root, { score: inc(n0(bonus)) });
          return true;
        });
      },
      /** The month's test result + its Glory bonus. Works offline too (one doc per month, so no double bonus). */
      async saveTest(id, doc, bonus) {
        const ref = col('tests').doc(id);
        const b = db.batch();
        b.set(ref, doc);
        if (n0(bonus)) b.update(root, { score: inc(n0(bonus)) });
        b.commit().catch((e) => { console.warn('saveTest', e); toast('Could not save the Trial: ' + e.message); });
      },
      /* ---- David's phone pairing: davidCode/main is secret, davidState/main is public, davids/<uid> = paired phones ---- */
      async davidState(uid) {
        const [st, dv, ad] = await Promise.all([db.collection('davidState').doc('main').get(), db.collection('davids').doc(uid).get(), db.collection('admins').doc(uid).get()]);
        return { ready: st.exists, registered: dv.exists || ad.exists };
      },
      async registerDavid(uid, hash) { await db.collection('davids').doc(uid).set({ codeHash: hash, at: Date.now() }); },
      /** Admin: set a new code. Phones paired with the old code are signed out. */
      async setDavidCode(hash) {
        const old = await db.collection('davids').get();
        const b = db.batch();
        b.set(db.collection('davidCode').doc('main'), { codeHash: hash });
        b.set(db.collection('davidState').doc('main'), { ready: true, at: Date.now() });
        old.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
      },
      /** Everything about the journey, as plain data (Admin backup). */
      async exportAll() {
        const coll = async (n) => Object.fromEntries((await col(n).get()).docs.map((d) => [d.id, d.data()]));
        const prof = await root.get();
        return { profile: prof.exists ? prof.data() : null, days: await coll('days'), awards: await coll('awards'), plans: await coll('plans'),
          overrides: await coll('overrides'), targets: await coll('targets'), config: await coll('config'),
          quests: await coll('quests'), rewards: await coll('rewards'), requests: await coll('requests'), messages: await coll('messages'), tests: await coll('tests') };
      },
      /** Replace the journey with a backup (Admin restore). */
      async importAll(data) {
        const names = ['days', 'awards', 'plans', 'overrides', 'targets', 'quests', 'rewards', 'requests', 'messages', 'tests'];
        const dels = (await Promise.all(names.map((n) => col(n).get()))).flatMap((q) => q.docs.map((d) => d.ref));
        const sets = [];
        names.forEach((n) => Object.entries(data[n] || {}).forEach(([id, v]) => sets.push([col(n).doc(id), v])));
        Object.entries(data.config || {}).forEach(([id, v]) => sets.push([col('config').doc(id), v]));
        const ops = dels.map((r) => ['del', r]).concat(sets.map(([r, v]) => ['set', r, v]));
        for (let i = 0; i < ops.length; i += 400) {
          const b = db.batch();
          ops.slice(i, i + 400).forEach(([k, r, v]) => (k === 'del' ? b.delete(r) : b.set(r, v)));
          await b.commit();
        }
        if (data.profile) await root.set({ ...data.profile, resetAt: Date.now() });
      },
    };
  }

  function newProfile(today) {
    return { name: 'David', avatarPhoto: null, score: 0, currentStreak: 0, bestStreak: 0, daysDone: 0, daysLost: 0, startDate: today, lastEvaluated: null };
  }

  /* ============================ VERSION & UPDATES ============================ */

  const APP_VERSION = '6.0';
  /** Register the service worker; when a newer version takes over, offer a one-tap update. */
  function watchUpdates() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const check = () => reg.update().catch(() => {});
      setInterval(check, 20 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBar(); });
  }
  function showUpdateBar() {
    if (document.getElementById('update-bar')) return;
    const b = document.createElement('button');
    b.id = 'update-bar';
    b.innerHTML = '✨ A new version is ready — <b>tap to update</b>';
    b.onclick = () => location.reload();
    document.body.appendChild(b);
  }
  const versionHTML = () => `<p class="version-line">Path to Olympus · v${APP_VERSION}</p>`;

  /* ================================ START ================================ */

  let backend = null;
  let unlisten = null;
  const isConfigured = () => !!(CFG.firebase && CFG.firebase.apiKey && !/PASTE/i.test(CFG.firebase.apiKey));

  function demoOffset() { return S.demo ? n0(localStorage.getItem('olympus_demo_offset')) : 0; }
  function computeToday() { return E.addDays(E.todayISO(), demoOffset()); }

  async function start(role) {
    S.role = role;
    if (role === 'david') applySettings();
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
      else await refreshDavid();
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

  /** David: this phone must be paired with the code from the Council before it can see or write the journey. */
  async function refreshDavid() {
    try { S.pair = await backend.davidState(S.user.uid); }
    catch (e) { S.pair = { ready: true, registered: false, error: e.message }; }
    if (S.pair.registered) subscribe('david');
    emit();
  }
  async function pairDevice(code) {
    await backend.registerDavid(S.user.uid, await sha('olympus-david:' + code));
    await refreshDavid();
  }
  const davidCodeHash = (code) => sha('olympus-david:' + code);

  function subscribe(role) {
    if (unlisten) return;
        unlisten = backend.listen({
          profile: (p) => {
            if (S.profile && p && p.resetAt && p.resetAt !== S.profile.resetAt) { queued.clear(); S.draft = null; lastEvalDay = null; }
            S.profile = p; S.got.profile = true; emit();
          },
          plans: (v) => { S.plans = v; S.got.plans = true; emit(); },
          overrides: (v) => { S.overrides = v; emit(); },
          days: (v) => { S.logs = v; S.got.logs = true; emit(); },
          targets: (v) => { S.targets = v; emit(); },
          awards: (v) => { S.awards = v.sort((a, b) => n0(a.earnedAt) - n0(b.earnedAt)); emit(); },
          media: (v) => { S.media = { slots: (v && v.slots) || {} }; emit(); },
          scoring: (v) => { S.scoring = E.scoring(v); emit(); },
          guide: (v) => { S.guide = { texts: (v && v.texts) || {} }; emit(); },
          quests: (v) => { S.quests = v.sort((a, b) => (a.from < b.from ? 1 : -1)); emit(); },
          rewards: (v) => { S.rewards = v.sort((a, b) => n0(a.cost) - n0(b.cost)); emit(); },
          requests: (v) => { S.requests = v.sort((a, b) => n0(b.at) - n0(a.at)); emit(); },
          messages: (v) => { S.messages = v.sort((a, b) => n0(b.at) - n0(a.at)); emit(); },
          tests: (v) => { S.tests = v.sort((a, b) => (a.id < b.id ? -1 : 1)); emit(); },
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
    claimQuests();
    checkRank();
  }

  /** Finished quests: add the bonus once and celebrate. */
  const claiming = new Set();
  function claimQuests() {
    S.quests.forEach((q) => {
      if (q.claimedAt || claiming.has(q.id) || S.today < q.from) return;
      if (!E.questProgress(q, logsArr()).done) return;
      claiming.add(q.id);
      backend.claimQuest(q.id, n0(q.bonus)).then((ok) => {
        if (ok) enqueue({ type: 'quest', id: 'quest_' + q.id, quest: q });
      }).catch((e) => { console.warn('claimQuest (will retry)', e); claiming.delete(q.id); });
    });
  }
  /** A new rank: celebrate it once on this journey. */
  function checkRank() {
    const p = S.profile, r = rank();
    if (!p || queued.has('rank_' + r.idx)) return;
    if (r.idx > n0(p.rankSeen)) {
      queued.add('rank_' + r.idx);
      enqueue({ type: 'rank', id: 'rank_' + r.idx, idx: r.idx });
      backend.updateProfileNow({ rankSeen: r.idx });
    }
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
    if (log && (log.status === 'DONE' || log.status === 'LOST' || log.status === 'EXCUSED')) return;
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

  /** Admin: write one day (or remove it), then rebuild score, streaks and counters from all days. */
  async function adminSaveDay(date, log) {
    await backend.setDay(date, log);
    const logs = { ...S.logs };
    if (log) logs[date] = { ...log, date }; else delete logs[date];
    const p = E.recomputeProfile(startDate(), S.today, logs, planForDate);
    p.score += bonusTotal();
    await backend.updateProfile(p);
    return p;
  }
  /**
   * Admin: rebuild the score after a bonus changed. adj = { quest: {id, bonus|null}, test: {id, bonus|null} }
   * says what the just-saved/deleted doc is now (the live list may not have caught up yet).
   */
  async function adminRecompute(adj = {}) {
    const qs = S.quests.filter((q) => q.claimedAt).map((q) => [q.id, n0(q.bonus)]);
    const ts = S.tests.map((t) => [t.id, n0(t.bonus)]);
    const fix = (arr, a) => { if (!a) return arr; const o = arr.filter(([id]) => id !== a.id); if (a.bonus != null) o.push([a.id, n0(a.bonus)]); return o; };
    const bonus = E.sum(fix(qs, adj.quest), (x) => x[1]) + E.sum(fix(ts, adj.test), (x) => x[1]);
    const p = E.recomputeProfile(startDate(), S.today, S.logs, planForDate);
    p.score += bonus;
    await backend.updateProfile(p);
  }

  /* ------------------------------- v6 actions ------------------------------- */

  /** David asks for a reward from the shop (the Glory is reserved until the Council decides). */
  async function requestReward(rw) {
    if (treasury() < n0(rw.cost)) { toast('Not enough Glory in your treasury yet'); return false; }
    await backend.saveDoc('requests', null, { rewardId: rw.id, title: rw.title, emoji: rw.emoji || '', cost: n0(rw.cost), at: Date.now(), status: 'PENDING' });
    toast('Request sent to the Council');
    return true;
  }
  function reactMessage(id, reaction) { backend.patchDoc('messages', id, { reaction }).catch((e) => toast('Could not save: ' + e.message)); }
  function markMessageRead(id) { backend.patchDoc('messages', id, { readAt: Date.now() }).catch(() => {}); }
  /** Save this month's Trial of Heracles. results: { PUSH_UPS: 34, PLANK: 95, … } */
  function saveTest(results) {
    const id = E.testId(S.today);
    if (thisTest()) { toast('This month\'s Trial is already done'); return false; }
    const prev = S.tests.filter((t) => t.id < id).slice(-1)[0] || null;
    const bonus = n0(S.scoring.testBonus);
    Promise.resolve(backend.saveTest(id, { date: S.today, results, at: Date.now(), bonus }, bonus)).catch((e) => toast(e.message));
    enqueue({ type: 'test', id: 'test_' + id, results, prev, bonus });
    return true;
  }
  /** Admin: a closed-day record built from the given entries (same formula as David's close). */
  function adminDoneLog(date, entries) {
    const r = E.closeDay(date, startDate(), planForDate(date), entries, S.logs, planForDate, S.scoring);
    return r ? { ...r.log, editedByAdmin: Date.now() } : null;
  }
  /** Download data as a .json file. */
  function downloadJSON(obj, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function backupNow(tag = 'backup') {
    const data = await backend.exportAll();
    downloadJSON({ app: 'path-to-olympus', version: APP_VERSION, exportedAt: new Date().toISOString(), ...data }, `olympus-${tag}-${S.today}.json`);
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
    const recs = E.newRecords(E.records(Object.values(S.logs).filter((l) => l.date !== S.today)), r.log.entries);
    backend.closeDay(r, best, medals.concat(coats));
    queued.add('closed_' + S.today);
    const line = `+${r.points} points · ${r.pct}% of the plan · Streak ${r.newStreak} ${r.newStreak === 1 ? 'day' : 'days'}`;
    // every closed day gets its video, then the % ring. Below 100% it uses video_day_incomplete.mp4 if you add one, else day_passed.
    if (r.complete) enqueue({ type: 'video', id: 'closed_' + S.today, key: 'day_passed', title: 'Day Passed!', subtitle: line });
    else enqueue({ type: 'video', id: 'closed_' + S.today, key: 'day_incomplete', fallback: 'day_passed', title: 'Day Closed', subtitle: line });
    enqueue({ type: 'summary', id: 'ring_' + S.today, title: r.complete ? 'Day Passed!' : 'Day Closed', subtitle: line, pct: r.pct });
    if (recs.length) enqueue({ type: 'record', id: 'rec_' + S.today, recs });
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
  const MEDIA_V = 3;
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
  /** File names that differ from video_<key>.mp4 */
  const VIDEO_FILE = { hero: 'home_screen' };
  const videoFile = (key) => `media/${VIDEO_FILE[key] || 'video_' + key}.mp4`;
  const videoURL = (key) => (S.media.slots['video_' + key] ? rawUrl(S.media.slots['video_' + key]) : videoFile(key));

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
  function setsEditorHTML(exId, list, attrs = '', opts = {}) {
    const info = E.EX[exId], timed = E.isTimed(exId), step = info.step || 1;
    const withTimer = !!(opts.timer && timed);
    const f = (v) => (timed ? E.fmtSecs(v) : v);
    const rows = list.map((v, i) => {
      const run = withTimer && opts.running === i;
      return `<div class="set-row${withTimer ? ' timed' : ''}${run ? ' running' : ''}"><span class="set-no">SET ${i + 1}</span>
      <button class="sb" data-act="sl-step" ${attrs} data-i="${i}" data-d="${-step}" ${v <= 0 || run ? 'disabled' : ''} aria-label="Less">−</button>
      <b class="set-v"${run ? ' id="timer-live"' : ''}>${run ? '0 s' : f(v)}${timed ? '' : `<small>${info.unit}</small>`}</b>
      <button class="sb" data-act="sl-step" ${attrs} data-i="${i}" data-d="${step}" ${run ? 'disabled' : ''} aria-label="More">+</button>
      ${withTimer ? `<button class="st${run ? ' on' : ''}" data-act="sl-timer" ${attrs} data-i="${i}" aria-label="${run ? 'Stop' : 'Time this set'}">${run ? '■' : '▶'}</button>` : ''}
      <button class="sx" data-act="sl-del" ${attrs} data-i="${i}" aria-label="Remove set ${i + 1}">✕</button></div>`;
    }).join('');
    return `<div class="sets-ed">${rows || '<p class="muted small center">No sets yet.</p>'}
      ${list.length < 20 ? `<div class="row add-row"><button class="btn-line add-set grow" data-act="sl-add" ${attrs}>＋ Add a set</button>${withTimer ? `<button class="btn-gold add-timed" data-act="sl-timed-new" ${attrs}>▶ Start a timed set</button>` : ''}</div>` : ''}</div>`;
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

  /** Points and big numbers: 950 · 3.96K · 24.5K · 290K · 1.25M */
  function fmtNum(v) {
    const n = Math.round(n0(v)), a = Math.abs(n);
    if (a < 1000) return String(n);
    const [d, unit] = a < 999500 ? [1e3, 'K'] : [1e6, 'M'];
    const x = n / d, ax = Math.abs(x);
    let t = x.toFixed(ax < 10 ? 2 : ax < 100 ? 1 : 0);
    if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
    return t + unit;
  }
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

  /** Home: just this month's target and the next medal — the full list lives in the Chronicle. */
  function homeGoalsCard() {
    const t = target('MONTH'), { idx, tot } = currentBlock('MONTH');
    const [, to] = E.blockRange(startDate(), E.HZ.MONTH, idx);
    const left = Math.max(0, E.diffDays(S.today, to) + 1);
    const value = n0(t.points) ? `${fmtNum(tot.points)} / ${fmtNum(t.points)} pts` : `${fmtNum(tot.minutes)} / ${fmtNum(t.minutes)} min`;
    let out = `<div class="card">${section('This month')}${labeled(`Month ${E.roman(idx + 1)}${t.state === 'GHOST' ? ' · ghost' : ''} · ${left} day${left === 1 ? '' : 's'} left`, value, E.progress(t, tot), t.state === 'GHOST')}`;
    const p = profile();
    const nm = E.nextMedal({ streak: n0(p.currentStreak), bestStreak: n0(p.bestStreak), doneLogs: Object.values(S.logs).filter((l) => l.status === 'DONE') }, earnedIds());
    if (nm) {
      const u = nm.unit + (nm.left === 1 ? '' : 's');
      out += `<div class="next-medal" data-act="tab" data-tab="hall"><span class="nm-art">${awardArt('MEDAL', nm.medal.id, false, 56, E.MEDALS.indexOf(nm.medal))}</span>
        <div class="grow"><div class="eyebrow-dark">NEXT MEDAL</div><b>${esc(nm.medal.title)}</b><div class="muted small">${nm.left} ${u} to go</div>${bar(nm.have / nm.need)}</div></div>`;
    }
    return out + '</div>';
  }

  /** Chronicle: best set and best day for each exercise. */
  function recordsCard() {
    const r = E.records(Object.values(S.logs));
    const ids = E.EXERCISES.map((e) => e.id).filter((id) => r[id]);
    if (!ids.length) return '';
    const rows = ids.map((id) => {
      const x = r[id], info = E.EX[id], t = E.isTimed(id);
      const f = (v) => (t ? E.fmtSecs(v) : `${v} ${info.unit}`);
      return `<div class="rec-row"><b>${esc(info.name)}</b><span>Best set <b>${f(x.bestSet)}</b><small>${fmtDate(x.bestSetDate, 'dm')}</small></span><span>Best day <b>${f(x.bestDay)}</b><small>${fmtDate(x.bestDayDate, 'dm')}</small></span></div>`;
    }).join('');
    return `<div class="card">${section('Personal records')}${rows}</div>`;
  }

  /* ============================== v6 cards ============================== */

  /** Rank badge: the Admin's picture (media/rank_<id>) or a drawn laurel shield with the rank number. */
  function rankBadgeHTML(idx, size) {
    const r = E.RANKS[idx], url = mediaURL('rank_' + r.id);
    if (url) return `<span class="art" style="width:${size}px;height:${size}px"><img src="${esc(url)}" alt="${esc(r.title)}"></span>`;
    return `<svg class="rank-badge" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="${esc(r.title)}">
      <circle cx="50" cy="50" r="46" fill="${r.color}" stroke="${C.gold}" stroke-width="3"/>
      ${laurelLeaves(50, 52, 34, C.goldLight, 7, 0.9)}
      <text x="50" y="61" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="700" font-size="30" fill="${C.goldLight}">${E.roman(idx + 1)}</text></svg>`;
  }
  /** Avatar inside a frame that shows David's rank (media/frame_<rank id> overlays it when present). */
  function avatarFramed(p, size) {
    const r = rank(), url = mediaURL('frame_' + r.rank.id);
    return `<span class="av-frame r${r.idx}" style="--rc:${r.rank.color};width:${size}px;height:${size}px">${avatarHTML(p, size)}${url ? `<img class="frame-img" src="${esc(url)}" alt="">` : ''}</span>`;
  }
  /** Home: rank line under the Glory number. */
  function rankLineHTML() {
    const r = rank();
    return `<span class="rank-name" style="--rc:${r.rank.color}" title="${r.next ? fmtNum(r.next.min - n0(profile().score)) + ' to ' + esc(r.next.title) : ''}">${esc(r.rank.title)}</span>`;
  }
  /** Hall: the ladder of ranks. */
  function ranksCard() {
    const r = rank();
    const rows = E.RANKS.map((x, i) => `<div class="rank-row ${i <= r.idx ? 'got' : ''} ${i === r.idx ? 'now' : ''}">${rankBadgeHTML(i, 48)}<div class="grow"><b>${esc(x.title)}</b>
      <div class="muted small">${i === 0 ? 'Where every hero begins' : fmtNum(x.min) + ' Glory'}</div>${i === r.idx + 1 ? bar(r.frac, false, 'thin') : ''}</div>${i === r.idx ? '<span class="tag active">YOU</span>' : i < r.idx ? '<span class="ok">✓</span>' : ''}</div>`).join('');
    return `<div class="card">${section('Ranks')}${rows}</div>`;
  }

  /** Quests for David's home: active ones, upcoming ones, and those finished in the last 3 days. */
  function questsCard() {
    const la = logsArr();
    const show = S.quests.filter((q) => {
      const st = E.questState(q, S.today, la);
      return st === 'active' || st === 'upcoming' || (st === 'done' && q.to >= E.addDays(S.today, -3));
    }).sort((a, b) => (a.to < b.to ? -1 : 1));
    if (!show.length) return '';
    const rows = show.map((q) => {
      const st = E.questState(q, S.today, la), pr = E.questProgress(q, la);
      const left = E.diffDays(S.today, q.to) + 1;
      const timedReps = q.kind === 'reps' && E.isTimed(q.exercise);
      const nums = timedReps ? `${E.fmtSecs(pr.have)} / ${E.fmtSecs(pr.goal)}` : `${fmtNum(pr.have)} / ${fmtNum(pr.goal)}`;
      const when = st === 'upcoming' ? `starts ${fmtDate(q.from, 'day')}` : st === 'done' ? 'complete ✓' : `${left} day${left === 1 ? '' : 's'} left`;
      return `<div class="quest ${st}"><div class="row"><b class="grow">${esc(q.title || E.questGoalText(q))}</b>${n0(q.bonus) ? `<span class="q-bonus">+${fmtNum(q.bonus)}</span>` : ''}</div>
        <div class="muted small">${esc(E.questGoalText(q))} · ${when}</div>${bar(pr.frac, st === 'upcoming')}<div class="q-nums">${nums}</div></div>`;
    }).join('');
    return `<div class="card">${section('Quests')}${rows}</div>`;
  }

  /** Home: the treasury (Glory to spend) and a button to the shop. */
  function treasuryCard() {
    if (!S.rewards.some((r) => r.active !== false)) return '';
    const pend = S.requests.filter((r) => r.status === 'PENDING').length;
    return `<div class="card treasury" data-act="tab" data-tab="shop"><div class="row"><span class="t-coin">◎</span><div class="grow"><div class="eyebrow-dark">TREASURY</div>
      <b class="t-sum">${fmtNum(treasury())} Glory</b><div class="muted small">${pend ? `${pend} request${pend === 1 ? '' : 's'} waiting for the Council` : 'Spend your Glory on real rewards'}</div></div><span class="t-go">Shop ›</span></div></div>`;
  }

  const REACTIONS = ['🔥', '💪', '👍', '❤️', '🙏'];
  /** Home: the newest message from the Council, with reaction buttons. */
  function messageCard() {
    const m = S.messages[0];
    if (!m || E.diffDays(new Date(n0(m.at)).toISOString().slice(0, 10), S.today) > 14) return '';
    const more = S.messages.length > 1 ? `<button class="btn-text" data-act="msgs-all">Older messages (${S.messages.length - 1})</button>` : '';
    return `<div class="card message"><div class="eyebrow-dark">📜 FROM THE COUNCIL · ${esc(fmtMillis(m.at))}</div><p class="msg-text">${esc(m.text)}</p>
      <div class="reactions">${REACTIONS.map((r) => `<button class="${m.reaction === r ? 'on' : ''}" data-act="react" data-id="${m.id}" data-r="${r}">${r}</button>`).join('')}</div>${more}</div>`;
  }
  function messagesListHTML() {
    return `<h3>Messages from the Council</h3>${S.messages.map((m) => `<div class="msg-old"><div class="muted tiny">${esc(fmtMillis(m.at))}${m.reaction ? ' · ' + m.reaction : ''}</div><p>${esc(m.text)}</p></div>`).join('')}`;
  }

  /** Home: this month's Trial of Heracles. */
  function testHomeCard() {
    const done = thisTest();
    const [y, m] = S.today.split('-').map(Number);
    const nextMonth = MONTHS_LONG[m % 12];
    if (done) return `<div class="card test-card done"><div class="row"><span class="t-ico">Ⅻ</span><div class="grow"><b>Trial of Heracles done</b><div class="muted small">The next one opens on 1 ${nextMonth}.</div></div><button class="btn-text" data-act="tab" data-tab="chronicle">Results</button></div></div>`;
    return `<div class="card test-card"><div class="row"><span class="t-ico">Ⅻ</span><div class="grow"><b>The Trial of Heracles is open</b><div class="muted small">Once a month: test your strength. ${n0(S.scoring.testBonus) ? `+${fmtNum(S.scoring.testBonus)} Glory.` : ''}</div></div></div>
      <button class="btn-gold" data-act="tab" data-tab="test" style="margin-top:10px">Take the Trial</button></div>`;
  }

  /** Chronicle / Admin: the monthly test results over time. */
  function testsCard() {
    if (!S.tests.length) return '';
    const months = S.tests.map((t) => t.id);
    const label = (id) => { const [y, m] = id.split('-').map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; };
    const colors = [C.bronze, C.aegean, C.laurel, C.lost];
    const reps = E.TESTS.filter((t) => t.mode !== 'hold' && S.tests.some((x) => E.testValue(x, t.id)));
    const hold = E.TESTS.find((t) => t.mode === 'hold');
    let html = `<div class="card">${section('Trial of Heracles · monthly tests')}`;
    if (reps.length) html += lineChartSVG(reps.map((t, i) => ({ label: t.title, values: S.tests.map((x) => E.testValue(x, t.id) || null), color: colors[i % colors.length] })), months.map(label), 170);
    if (S.tests.some((x) => E.testValue(x, hold.id))) html += lineChartSVG([{ label: hold.title + ' (seconds)', values: S.tests.map((x) => E.testValue(x, hold.id) || null), color: C.gold }], months.map(label), 140);
    const head = `<tr><th></th>${E.TESTS.map((t) => `<th>${esc(E.EX[t.id].name.split(' ')[0])}</th>`).join('')}</tr>`;
    const rows = S.tests.slice().reverse().map((x) => `<tr><td>${label(x.id)}</td>${E.TESTS.map((t) => `<td>${E.testValue(x, t.id) ? (t.mode === 'hold' ? E.fmtSecs(E.testValue(x, t.id)) : E.testValue(x, t.id)) : '–'}</td>`).join('')}</tr>`).join('');
    return html + `<table class="cmp tests-tbl">${head}${rows}</table></div>`;
  }

  /** Admin: closed share per weekday, so you can see which day he skips most. */
  function weekdayCard() {
    const rows = E.weekdayStats(startDate(), S.today, S.logs, planForDate);
    const rated = rows.filter((r) => r.planned >= 2);
    const worst = rated.length ? rated.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
    const html = rows.map((r) => `<div class="wd-row ${worst && r === worst && r.rate < 1 ? 'worst' : ''}"><span class="wd">${r.dow.slice(0, 3)}</span>
      <div class="grow">${bar(r.rate == null ? 0 : r.rate)}</div><span class="wd-n">${r.rate == null ? '–' : Math.round(r.rate * 100) + '%'}</span><span class="muted tiny wd-d">${r.closed}/${r.planned}${r.skipped ? ` · ${r.skipped} skip` : ''}</span></div>`).join('');
    return `<div class="card">${section('Consistency by weekday')}${html}
      <p class="muted small">${worst && worst.rate < 1 ? `Most skipped: <b>${DAYS_LONG[E.DOW.indexOf(worst.dow)]}</b> — maybe make that day lighter.` : 'Share of planned days that were closed, per weekday (from the start until yesterday).'}</p></div>`;
  }

  /** Admin: the last 53 weeks as a grid of small squares (GitHub style). */
  function heatmapCard() {
    const end = S.today, startMon = E.addDays(E.mondayOf(end), -52 * 7);
    let cols = '';
    for (let w = 0; w < 53; w++) {
      let cells = '';
      for (let i = 0; i < 7; i++) {
        const d = E.addDays(startMon, w * 7 + i);
        if (d > end) { cells += '<i class="hm none"></i>'; continue; }
        const mk = markFor(d);
        const lvl = mk === 'done' ? 'l4' : mk === 'incomplete' ? (n0(S.logs[d].pct) >= 60 ? 'l3' : 'l2') : mk === 'skipped' ? 'sk' : mk === 'excused' ? 'ex' : 'l0';
        cells += `<i class="hm ${lvl}" title="${d}"></i>`;
      }
      cols += `<div class="hm-col">${cells}</div>`;
    }
    return `<div class="card">${section('The year at a glance')}<div class="heatmap">${cols}</div>
      <div class="legend"><span class="lg"><i class="hm l4"></i>Completed</span><span class="lg"><i class="hm l3"></i>60–99%</span><span class="lg"><i class="hm l2"></i>under 60%</span><span class="lg"><i class="hm sk"></i>Skipped</span><span class="lg"><i class="hm ex"></i>Excused</span></div></div>`;
  }

  /** A printable monthly report (the Admin saves it as PDF from the print dialog). month = "YYYY-MM" */
  function reportHTML(month) {
    const [y, m] = month.split('-').map(Number);
    const from = `${month}-01`, to = E.addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
    const inM = logsArr().filter((l) => l.date >= from && l.date <= to);
    const t = E.totals(inM, [from, to]);
    const excused = inM.filter((l) => l.status === 'EXCUSED').length;
    const before = E.records(logsArr().filter((l) => l.date < from));
    const recs = [];
    inM.filter((l) => l.status === 'DONE').sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((l) => {
      E.newRecords(before, l.entries).forEach((x) => recs.push({ ...x, date: l.date }));
      E.logEntries(l).forEach((e) => {
        const b = before[e.exercise] || (before[e.exercise] = { bestSet: 0, bestDay: 0 });
        b.bestSet = Math.max(b.bestSet, ...E.setList(e)); b.bestDay = Math.max(b.bestDay, E.volume(e));
      });
    });
    const byEx = E.EXERCISES.map((x) => {
      const es = inM.filter((l) => l.status === 'DONE').flatMap((l) => E.logEntries(l).filter((e) => e.exercise === x.id));
      return es.length ? `<tr><td>${esc(x.name)}</td><td>${es.length}</td><td>${E.isTimed(x.id) ? E.fmtSecs(E.sum(es, E.volume)) : fmtNum(E.sum(es, E.volume)) + ' ' + x.unit}</td><td>${fmtNum(Math.round(E.sum(es, (e) => E.exercisePoints(e, S.scoring))))}</td></tr>` : '';
    }).join('');
    const quests = S.quests.filter((q) => q.to >= from && q.from <= to);
    const test = S.tests.find((x) => x.id === month);
    const p = profile();
    let cal = '';
    const len = E.diffDays(from, to) + 1, lead = E.DOW.indexOf(E.dowOf(from));
    for (let i = 0; i < lead; i++) cal += '<span></span>';
    for (let i = 0; i < len; i++) { const d = E.addDays(from, i); cal += `<span class="rc ${markFor(d)}">${i + 1}</span>`; }
    const st = (l, v) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="report"><div class="rp-head">${laurelSVG(54, C.gold)}<div><h1>Path to Olympus</h1><div>Monthly report · ${MONTHS_LONG[m - 1]} ${y} · ${esc(p.name)}</div></div></div>
      <div class="stats">${st('Completed', t.completeDays)}${st('Incomplete', t.days - t.completeDays)}${st('Skipped', t.skipped)}${st('Excused', excused)}</div>
      <div class="stats">${st('Points', fmtNum(t.points))}${st('Timed min', fmtNum(Math.round(t.minutes)))}${st('Reps', fmtNum(t.reps))}${st('Avg level', t.avgLevel ? t.avgLevel.toFixed(1) : '–')}</div>
      <p>Closed ${t.days} of ${t.judged} judged days (${t.judged ? Math.round((t.days * 100) / t.judged) : 0}%). Points vs plan: ${fmtNum(t.points)} / ${fmtNum(t.planned)}. Glory now ${fmtNum(p.score)} · rank ${esc(rank().rank.title)} · best streak ${n0(p.bestStreak)}.</p>
      <h2>Calendar</h2><div class="rp-cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<b>${x}</b>`).join('')}${cal}</div>
      ${byEx ? `<h2>Exercises</h2><table class="cmp"><tr><th>Exercise</th><th>Days</th><th>Total</th><th>Points</th></tr>${byEx}</table>` : ''}
      ${recs.length ? `<h2>Personal records</h2><ul>${recs.map((x) => `<li>${fmtDate(x.date, 'dm')} · ${esc(E.EX[x.exercise].name)} — ${x.kind === 'set' ? 'best set' : 'best day'} ${E.isTimed(x.exercise) ? E.fmtSecs(x.value) : x.value} (was ${E.isTimed(x.exercise) ? E.fmtSecs(x.was) : x.was})</li>`).join('')}</ul>` : ''}
      ${quests.length ? `<h2>Quests</h2><ul>${quests.map((q) => { const pr = E.questProgress(q, logsArr()); return `<li>${esc(q.title || E.questGoalText(q))} — ${q.claimedAt || pr.done ? 'completed ✓' : `${fmtNum(pr.have)} / ${fmtNum(pr.goal)}`}</li>`; }).join('')}</ul>` : ''}
      ${test ? `<h2>Trial of Heracles</h2><ul>${E.TESTS.filter((x) => E.testValue(test, x.id)).map((x) => `<li>${esc(x.title)}: ${x.mode === 'hold' ? E.fmtSecs(E.testValue(test, x.id)) : E.testValue(test, x.id)}</li>`).join('')}</ul>` : ''}
      <p class="rp-foot">“The road is mastered by the one who walks it.” · printed ${fmtDate(S.today)}</p></div>`;
  }

  /** How-to card for an exercise level: picture/GIF, what the level means, form tips. */
  function howToHTML(exId, level) {
    const info = E.EX[exId];
    const tips = guideText('tips_' + exId).split('\n').map((s) => s.trim()).filter(Boolean);
    return `<h3>${esc(info.name)} · ${E.lvl(level).label}</h3>${exerciseMediaHTML(exId, level)}
      <p>${esc(guideText(E.guideExKey(exId, level)))}</p><div class="muted small">${esc(info.focus)}</div>
      ${tips.length ? `<h4 style="margin:12px 0 4px">Good form</h4><ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="levels-mini">${[1, 2, 3].map((l) => `<button class="${l === level ? 'on' : ''}" data-act="howto" data-ex="${exId}" data-lv="${l}">${E.lvl(l).roman}</button>`).join('')}</div>`;
  }

  /** done (completed) · incomplete · skipped · today · planned · empty · before */
  function markFor(d) {
    const log = S.logs[d];
    if (log && log.status === 'DONE') return log.complete === false ? 'incomplete' : 'done';
    if (log && log.status === 'LOST') return 'skipped';
    if (log && log.status === 'EXCUSED') return 'excused';
    if (d === S.today) return 'today';
    if (d < startDate()) return 'before';
    if (d > S.today && !E.isRest(planForDate(d))) return 'planned';
    return 'empty';
  }
  const CIRCLE_SLOT = { done: 'circle_done', incomplete: 'circle_incomplete', skipped: 'circle_skipped', today: 'circle_today', planned: 'circle_planned', excused: 'circle_excused' };

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
      <div class="legend">${leg('done', 'Completed')}${leg('incomplete', 'Incomplete')}${leg('skipped', 'Skipped')}${Object.values(S.logs).some((l) => l.status === 'EXCUSED' && l.date.startsWith(month)) ? leg('excused', 'Excused') : ''}${leg('today', 'Today')}${leg('planned', 'Planned')}</div>
    </div>`;
  }

  function dayDetailHTML(date) {
    const log = S.logs[date];
    const plan = (log && log.plan) || planForDate(date);
    let status, cls;
    if (log && log.status === 'DONE') { status = `${log.complete === false ? 'INCOMPLETE' : 'COMPLETED'} · ${n0(log.pct)}% · +${fmtNum(log.points)} pts`; cls = log.complete === false ? 'warn' : 'ok'; }
    else if (log && log.status === 'LOST') { status = `SKIPPED · ${n0(log.points)} pts`; cls = 'bad'; }
    else if (log && log.status === 'EXCUSED') { status = `EXCUSED BY THE COUNCIL${log.reason ? ' · ' + esc(log.reason) : ''}`; cls = 'muted'; }
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
    const exId = String(metric).startsWith('EX:') ? metric.slice(3) : null;
    const pick = exId ? (l) => E.sum((l.entries || []).filter((e) => e.exercise === exId && E.isActive(e)), E.volume)
      : { POINTS: (l) => n0(l.points), MINUTES: E.logMinutes, REPS: E.logReps, SETS: E.logSets, LEVEL: E.logAvgLevel }[metric] || ((l) => n0(l.points));
    const values = days.map((d) => {
      const l = S.logs[d];
      if (!l || l.status === 'PENDING') return null;
      if (l.status === 'LOST') return 0;
      return pick(l);
    });
    const series = [{ label: exId ? `${E.EX[exId].name} (${E.isTimed(exId) ? 'seconds' : E.EX[exId].unit})` : (METRICS.find((m) => m[0] === metric) || METRICS[0])[1], values, color: C.bronze }];
    if (metric === 'POINTS') series.push({ label: 'Planned', values: days.map((d) => { const l = S.logs[d]; return l && l.status !== 'PENDING' ? n0(l.planned) : null; }), color: C.gold, dashed: true });
    const chips = METRICS.map(([k, l]) => `<button class="chip ${k === metric ? 'on' : ''}" data-act="metric" data-metric="${k}">${l}</button>`).join('');
    const used = new Set(Object.values(S.logs).flatMap((l) => (l.status === 'DONE' ? (l.entries || []).filter(E.isActive).map((e) => e.exercise) : [])));
    const exChips = E.EXERCISES.filter((e) => used.has(e.id)).map((e) => `<button class="chip ex ${metric === 'EX:' + e.id ? 'on' : ''}" data-act="metric" data-metric="EX:${e.id}">${esc(e.name)}</button>`).join('');
    return `<div class="card">${section('Trends · last 30 days')}<div class="chips">${chips}</div>${exChips ? `<div class="chips">${exChips}</div>` : ''}${lineChartSVG(series, days.map((d) => fmtDate(d, 'dm')))}</div>`;
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

    if (c.type === 'record') {
      const lines = c.recs.map((x) => {
        const info = E.EX[x.exercise], t = E.isTimed(x.exercise);
        const f = (v) => (t ? E.fmtSecs(v) : `${v} ${info.unit}`);
        return `<li><b>${esc(info.name)}</b> — ${x.kind === 'set' ? 'best set' : 'best day'}: <b>${f(x.value)}</b> <span class="was">(was ${f(x.was)})</span></li>`;
      }).join('');
      el.className = 'cel medal-reveal';
      el.innerHTML = `<div class="mr"><div class="eyebrow">NEW PERSONAL RECORD</div><div class="pop record-pop">${laurelSVG(150, C.gold)}<b>PR</b></div>
        <h2>Stronger than yesterday</h2><ul class="rec-list">${lines}</ul><button class="btn-gold" data-x="done">Continue</button></div>`;
      el.querySelector('[data-x="done"]').onclick = done;
      document.body.appendChild(el);
      return;
    }
    if (c.type === 'quest' || c.type === 'rank' || c.type === 'test') {
      let body;
      if (c.type === 'quest') {
        body = `<div class="eyebrow">QUEST COMPLETE</div><div class="pop record-pop">${laurelSVG(150, C.gold)}<b>⚔</b></div>
          <h2>${esc(c.quest.title || 'Quest complete')}</h2><p>${esc(E.questGoalText(c.quest))} — done!</p>${n0(c.quest.bonus) ? `<p class="bonus-line">+${fmtNum(c.quest.bonus)} Glory</p>` : ''}`;
      } else if (c.type === 'rank') {
        const r = E.RANKS[c.idx], next = E.RANKS[c.idx + 1];
        body = `<div class="eyebrow">NEW RANK</div><div class="pop rank-pop">${rankBadgeHTML(c.idx, 170)}</div>
          <h2>You are now a ${esc(r.title)}</h2><p>${fmtNum(r.min)} Glory earned on the road.</p>${next ? `<p class="muted-light">Next: ${esc(next.title)} at ${fmtNum(next.min)} Glory</p>` : '<p class="muted-light">The highest rank. Olympus is yours.</p>'}`;
      } else {
        const rows = E.TESTS.filter((t) => n0(c.results[t.id])).map((t) => {
          const v = n0(c.results[t.id]), was = E.testValue(c.prev, t.id), f = (x) => (t.mode === 'hold' ? E.fmtSecs(x) : x);
          return `<li><b>${esc(t.title)}</b>: <b>${f(v)}</b>${was ? ` <span class="was">(${v > was ? '▲' : v < was ? '▼' : '='} last time ${f(was)})</span>` : ''}</li>`;
        }).join('');
        body = `<div class="eyebrow">TRIAL OF HERACLES</div><div class="pop record-pop">${laurelSVG(150, C.gold)}<b>Ⅻ</b></div>
          <h2>The Trial is written in the Chronicle</h2><ul class="rec-list">${rows}</ul>${c.bonus ? `<p class="bonus-line">+${fmtNum(c.bonus)} Glory</p>` : ''}`;
      }
      el.className = 'cel medal-reveal';
      el.innerHTML = `<div class="mr">${body}<button class="btn-gold" data-x="done">Continue</button></div>`;
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
      if (!settings().sound) v.muted = true;
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
    if (key === 'warmup') return E.WARMUP_DEFAULT;
    if (key.startsWith('tips_')) return E.EX_TIPS[key.slice(5)] || '';
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
    APP_VERSION, watchUpdates, versionHTML, homeGoalsCard, recordsCard, adminSaveDay, adminDoneLog, backupNow, downloadJSON, pairDevice, davidCodeHash, refreshDavid,
    logsArr, bonusTotal, spent, treasury, rank, thisTest, syncHTML, settings, setSetting, applySettings, beep, adminRecompute, requestReward, reactMessage, markMessageRead, saveTest,
    rankBadgeHTML, avatarFramed, rankLineHTML, ranksCard, questsCard, treasuryCard, messageCard, messagesListHTML, testHomeCard, testsCard, weekdayCard, heatmapCard, reportHTML, howToHTML, REACTIONS,
    backend: () => backend,
    laurelSVG, avatarHTML, medalSVG, coatSVG, emblemSVG, lineChartSVG, rawUrl, mediaURL, awardArt, targetLine,
    bar, labeled, section, videoURL, videoFile, levelBadge, setsEditorHTML, setsEdit, horizonsCard, calendarCard, dayDetailHTML, totalsCard, trendsCard, trajectoryCard, exerciseMediaHTML, exerciseMediaURL, guideText,
    modal, closeModal, demoBarHTML, demoAction,
    MOTTO: 'The road is mastered by the one who walks it.',
  };
})();
