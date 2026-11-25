/* =============================================================================
 * Path to Olympus — rules engine (pure JavaScript, no Firebase, no DOM).
 * Shared by index.html (David) and admin.html (Admin); unit-tested with node.
 * Dates are ISO strings "YYYY-MM-DD" (they also sort correctly as text).
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------- constants ------------------------------- */

  const RULES = {
    MAX_LOOKBACK_DAYS: 400,        // safety cap for missed-day evaluation
    CALIBRATION_DAYS: 30,          // ghost-target calibration window
  };

  const LEVELS = {
    1: { n: 1, points: 10, roman: 'I', label: 'Level I' },
    2: { n: 2, points: 20, roman: 'II', label: 'Level II' },
    3: { n: 3, points: 30, roman: 'III', label: 'Level III' },
  };
  const lvl = (n) => LEVELS[n] || LEVELS[1];

  const EXERCISES = [
    { id: 'PULL_UPS', name: 'Pull-ups', unit: 'reps', kind: 'reps', step: 1, dflt: 8, focus: 'Back & arms', levels: {
      1: 'Negative or band-assisted pull-ups — lower slowly over 3 seconds',
      2: 'Strict pull-ups from a full hang, chin over the bar',
      3: 'Pull-ups with a 2-second pause at the top, or chest-to-bar' } },
    { id: 'PUSH_UPS', name: 'Push-ups', unit: 'reps', kind: 'reps', step: 1, dflt: 12, focus: 'Chest & triceps', levels: {
      1: 'Incline push-ups, hands on a bench',
      2: 'Full push-ups, body in one straight line',
      3: 'Decline or clap push-ups' } },
    { id: 'PLANK', name: 'Plank', unit: 'seconds', kind: 'time', step: 5, dflt: 30, focus: 'Core', levels: {
      1: 'Knee plank',
      2: 'Forearm plank',
      3: 'Plank with alternating arm / leg lift' } },
    { id: 'JUMP_ROPE', name: 'Jump rope', unit: 'seconds', kind: 'time', step: 15, dflt: 60, focus: 'Legs & stamina', levels: {
      1: 'Basic two-foot bounce',
      2: 'Alternate-foot running step, no stops',
      3: 'High knees or double-unders' } },
    { id: 'DIPS', name: 'Dips on parallel bars', unit: 'reps', kind: 'reps', step: 1, dflt: 8, focus: 'Chest, shoulders & triceps', levels: {
      1: 'Bench dips or slow negative dips',
      2: 'Full dips on the parallel bars',
      3: 'Slow-tempo dips with a pause at the bottom' } },
    { id: 'AB_WHEEL', name: "Koshperovsky's wheel", unit: 'reps', kind: 'reps', step: 1, dflt: 10, focus: 'Core', levels: {
      1: 'Kneeling roll-outs, short range',
      2: 'Kneeling roll-outs, full range',
      3: 'Standing roll-outs' } },
    { id: 'ABS', name: 'Abdominal exercises', unit: 'reps', kind: 'reps', step: 1, dflt: 15, focus: 'Core', levels: {
      1: 'Crunches',
      2: 'Full sit-ups',
      3: 'Hanging knee raises or V-ups' } },
    { id: 'SWIMMING', name: 'Swimming', unit: 'lengths', kind: 'reps', step: 1, dflt: 4, focus: 'Whole body', levels: {
      1: 'Easy lengths with rests',
      2: 'Continuous lengths',
      3: 'Interval sprints' } },
  ];
  const EX = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
  /** Media slot keys: exercise image and demo GIF, e.g. "img_pull_ups_l2", "gif_pull_ups_l2". */
  const imgKey = (exId, level) => `img_${exId.toLowerCase()}_l${level}`;
  const gifKey = (exId, level) => `gif_${exId.toLowerCase()}_l${level}`;

  const HORIZONS = [
    { id: 'MONTH', days: 30, title: 'Monthly', master: false, repeats: true, video: 'target_month', coat: 'Laurel of the Moon', emblem: 'STAR', field: '#27496D' },
    { id: 'HALF_YEAR', days: 182, title: 'Half-Year', master: false, repeats: true, video: 'target_half_year', coat: 'Shield of Athena', emblem: 'OWL', field: '#5B7A3A' },
    { id: 'YEAR', days: 365, title: 'Yearly', master: false, repeats: true, video: 'target_year', coat: 'Crest of Apollo', emblem: 'SUN', field: '#8E2A24' },
    { id: 'FIVE_YEAR', days: 1826, title: '5-Year', master: true, repeats: true, video: 'target_five_year', coat: 'Aegis of Zeus', emblem: 'LIGHTNING', field: '#5B2A6E' },
    { id: 'TEN_YEAR', days: 3652, title: '10-Year Master', master: true, repeats: false, video: 'target_ten_year', coat: 'Crown of Olympus', emblem: 'CLUB', field: '#2A1F14' },
  ];
  const HZ = Object.fromEntries(HORIZONS.map((h) => [h.id, h]));

  const VIDEO_KEYS = ['day_passed', 'day_failed', 'target_month', 'target_half_year', 'target_year', 'target_five_year', 'target_ten_year'];
  /** Every other media slot (images or GIFs) the Admin can fill. */
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const UI_SLOTS = {
    circles: [['circle_done', 'Completed day'], ['circle_incomplete', 'Incomplete day'], ['circle_skipped', 'Skipped day'], ['circle_today', 'Today'], ['circle_planned', 'Planned (future) day']],
    months: [['month_bg', 'Default month background (any month without its own)']].concat(MONTH_NAMES.map((m, i) => [`month_${String(i + 1).padStart(2, '0')}`, `${m} background`])),
    nav: [['nav_home', 'Agora button'], ['nav_trial', 'Trial button'], ['nav_chronicle', 'Chronicle button'], ['nav_hall', 'Hall button'], ['nav_codex', 'Codex (guide) button'], ['nav_bg', 'Navigation bar background']],
    hall: [['hall_bg', 'Hall of Glory background (9:16)']],
  };

  /** The Codex (guide) page: sections with default text; the Admin can rewrite every text and add an image to each. */
  const GUIDE_SECTIONS = [
    ['intro', 'Welcome to the Path', 'Ten years. One road. Every day you train, you climb a little higher toward Olympus. The road is mastered by the one who walks it — not by the one who only dreams of it.'],
    ['day', 'How a day works', 'At the top of the Trial page you see one square for every exercise in today\'s plan. Tap a square, enter what you really did — the level and every set (reps, or seconds for the plank and jump rope) — and tap OK. You can change it again until you close the day. You may do more than the plan, less, or something different: tap “+” to add another exercise. When you are finished, tap “Close the day” and confirm.'],
    ['points', 'How points are counted', 'Every exercise has a hardness. Harder exercises and higher levels give more points. Points = Hardness × Level × (5 + all your reps × unit value). For timed exercises (plank, jump rope) every second counts instead, plus a bonus per minute. Your day score is compared with the points the plan asks for: that is your day percentage.'],
    ['circles', 'The calendar circles', 'Completed: you reached 100% of the plan. Incomplete: you closed the day below 100% — it still counts, your streak continues. Skipped: the day was not closed by midnight — you lose points and your streak goes back to zero.'],
    ['streak', 'Streaks and skipped days', 'Your streak counts the days in a row you closed. Close every planned day — even a small one — and the streak keeps growing. Skip one, and it starts again from zero.'],
    ['targets', 'Milestones and targets', 'Your training is measured over a month, half a year, a year, five years and ten years. Each milestone has targets: points, reps, sets, timed minutes, level, and how few days and minutes you may miss. Reach them to earn a coat of arms.'],
    ['hall', 'Medals and coats of arms', 'Medals are won for special deeds — your first day, your first week in a row, a thousand minutes and more. Coats of arms are won by reaching milestone targets. All of them wait for you in the Hall of Glory.'],
  ];
  const guideExKey = (exId, level) => `ex_${exId}_${level}`;

  const DOW = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  /* --------------------------------- dates --------------------------------- */

  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (s, n) => new Date(toUTC(s) + n * 86400000).toISOString().slice(0, 10);
  /** b − a in days. */
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  const dowOf = (s) => DOW[(new Date(toUTC(s)).getUTCDay() + 6) % 7];
  const mondayOf = (s) => addDays(s, -((new Date(toUTC(s)).getUTCDay() + 6) % 7));
  const isValidISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  /* --------------------------------- plans --------------------------------- */

  const isRest = (plan) => !plan || !plan.exercises || plan.exercises.length === 0;
  const planEnd = (p) => addDays(p.startDate, 7 * Math.max(1, p.repeatWeeks || 1)); // exclusive
  const planCovers = (p, date) => date >= p.startDate && date < planEnd(p);

  /** Override for that date → newest weekly plan covering it → null (never penalised). */
  function planFor(date, plans, overrides) {
    if (overrides && overrides[date]) return overrides[date];
    let best = null;
    for (const p of plans || []) {
      if (planCovers(p, date) && (!best || (p.createdAt || 0) > (best.createdAt || 0))) best = p;
    }
    return best ? (best.days || {})[dowOf(date)] || null : null;
  }

  /* ------------------------------ points formula ------------------------------ */

  /**
   * Exercise points = Hardness × LevelMultiplier × (Base + total × UnitValue + minutes × PerMinute)
   *   total   = all reps of all sets (rep exercises) or all seconds (timed: plank, jump rope)
   *   minutes = only for timed exercises (seconds ÷ 60)
   * Day points      = Σ exercise points (rounded).  Planned points use the same formula on the plan.
   * Every number is editable in Admin → Scoring (stored in config/scoring).
   */
  const DEFAULT_SCORING = {
    hardness: { PULL_UPS: 2.6, PUSH_UPS: 1.8, PLANK: 3.1, JUMP_ROPE: 1.2, DIPS: 2.4, AB_WHEEL: 2.8, ABS: 1.5, SWIMMING: 2.2 },
    // what one rep (or one second for timed exercises / one length) is worth compared with one pull-up rep
    unitValue: { PULL_UPS: 1, PUSH_UPS: 1, PLANK: 0.1, JUMP_ROPE: 0.1, DIPS: 1, AB_WHEEL: 1, ABS: 1, SWIMMING: 4 },
    levelMult: { 1: 1, 2: 2, 3: 3 },
    base: 5,          // points for doing an exercise at all
    perMinute: 1,     // points per minute of training
    penalty: 50,      // points lost for a skipped day
    completeAt: 100,  // % of planned points needed for a "Completed" day
  };
  function scoring(sc) {
    sc = sc || {};
    return {
      ...DEFAULT_SCORING, ...sc,
      hardness: { ...DEFAULT_SCORING.hardness, ...(sc.hardness || {}) },
      unitValue: { ...DEFAULT_SCORING.unitValue, ...(sc.unitValue || {}) },
      levelMult: { ...DEFAULT_SCORING.levelMult, ...(sc.levelMult || {}) },
    };
  }
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const isTimed = (exId) => !!(EX[exId] && EX[exId].kind === 'time');
  /**
   * The sets of an entry: one number per set — reps, or seconds for timed exercises.
   * Each set can differ (e.g. 10 · 8 · 6). Older records stored "reps × sets" instead.
   */
  function setList(e) {
    if (!e) return [];
    if (Array.isArray(e.perSet)) return e.perSet.map(num).filter((v) => v > 0);
    const per = num(e.reps);
    return per > 0 ? Array(Math.max(1, num(e.sets))).fill(per) : [];
  }
  const isActive = (e) => setList(e).length > 0;
  /** All reps (or all seconds for timed exercises). */
  const volume = (e) => sum(setList(e), (v) => v);
  const setsOf = (e) => setList(e).length;
  const repsOf = (e) => (e && isTimed(e.exercise) ? 0 : volume(e));
  const minutesOf = (e) => (e && isTimed(e.exercise) ? volume(e) / 60 : 0);
  /** "10 · 8 · 6 reps", "3 × 10 reps", "2 × 0:45" */
  const fmtSecs = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`);
  function fmtSets(e) {
    const l = setList(e);
    if (!l.length) return '—';
    const timed = isTimed(e.exercise), unit = (EX[e.exercise] || { unit: 'reps' }).unit;
    const f = (v) => (timed ? fmtSecs(v) : String(v));
    const body = l.every((v) => v === l[0]) ? (l.length > 1 ? `${l.length} × ${f(l[0])}` : f(l[0])) : l.map(f).join(' · ');
    return timed ? body : `${body} ${unit}`;
  }

  function exercisePoints(e, sc) {
    if (!isActive(e)) return 0;
    sc = sc || DEFAULT_SCORING;
    const H = num(sc.hardness[e.exercise] != null ? sc.hardness[e.exercise] : 1);
    const L = num(sc.levelMult[e.level] != null ? sc.levelMult[e.level] : e.level || 1);
    const U = num(sc.unitValue[e.exercise] != null ? sc.unitValue[e.exercise] : 1);
    return H * L * (num(sc.base) + volume(e) * U + minutesOf(e) * num(sc.perMinute));
  }
  const dayPoints = (entries, sc) => Math.round(sum(entries || [], (e) => exercisePoints(e, sc)));

  /** The plan's numbers expressed as entries. */
  const planEntries = (plan) => (plan && plan.exercises ? plan.exercises : []).map(planEntry);
  function planEntry(p) {
    return Array.isArray(p.targetPerSet) ? { exercise: p.exercise, level: p.level || 1, perSet: p.targetPerSet }
      : { exercise: p.exercise, level: p.level || 1, reps: num(p.targetReps), sets: num(p.targetSets) };
  }
  const plannedPoints = (plan, sc) => dayPoints(planEntries(plan), sc);
  function plannedMinutes(plan) {
    if (!plan) return 0;
    return Math.round(sum(planEntries(plan), minutesOf) * 10) / 10;
  }

  /* -------------------------------- day logs -------------------------------- */

  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const logEntries = (log) => (log.entries || []).filter(isActive);
  const logMinutes = (log) => sum(logEntries(log), minutesOf);
  const logReps = (log) => sum(logEntries(log), repsOf);
  const logSets = (log) => sum(logEntries(log), setsOf);
  function logAvgLevel(log) {
    const a = logEntries(log);
    return a.length ? sum(a, (e) => num(e.level)) / a.length : 0;
  }

  /* --------------------------------- the day --------------------------------- */

  /** Live numbers for a day: earned vs planned. */
  function dayStats(plan, entries, sc) {
    sc = sc || DEFAULT_SCORING;
    const points = dayPoints(entries, sc);
    const planned = plannedPoints(plan, sc);
    const pct = planned > 0 ? Math.round((points * 100) / planned) : points > 0 ? 100 : 0;
    const active = (entries || []).filter(isActive);
    return {
      points, planned, pct,
      complete: pct >= num(sc.completeAt),
      minutes: Math.round(sum(active, minutesOf) * 10) / 10,
      plannedMinutes: plannedMinutes(plan),
      exercisesDone: active.length,
      exercisesPlanned: plan && plan.exercises ? plan.exercises.length : 0,
      canClose: active.length > 0,
    };
  }

  /**
   * Consecutive closed days ending at `date`, walking back. Days with no plan / rest
   * plan are skipped over; a LOST (skipped) day or an unclosed planned day breaks it.
   */
  function streakEndingAt(date, start, logs, planForFn) {
    let count = 0;
    let d = date;
    for (let guard = 0; d >= start && guard < 5000; guard++) {
      const st = logs[d] && logs[d].status;
      if (st === 'DONE') count++;
      else if (st === 'LOST') return count;
      else if (!isRest(planForFn(d))) return count;
      d = addDays(d, -1);
    }
    return count;
  }

  /** Close a day with whatever was done. Returns null if nothing was logged. */
  function closeDay(date, start, plan, entries, logs, planForFn, sc, now = Date.now()) {
    sc = sc || DEFAULT_SCORING;
    const st = dayStats(plan, entries, sc);
    if (!st.canClose) return null;
    const log = {
      date, status: 'DONE', entries: (entries || []).filter(isActive),
      points: st.points, planned: st.planned, pct: st.pct, complete: st.complete,
      plannedMinutes: st.plannedMinutes, plan: plan || null, closedAt: now, celebrated: true,
    };
    const newStreak = streakEndingAt(date, start, { ...logs, [date]: log }, planForFn);
    return { ...st, newStreak, log };
  }

  /** Every past planned day (after lastEvaluated, up to yesterday) that wasn't closed becomes LOST (skipped). */
  function evaluate(start, lastEvaluated, today, logs, planForFn, sc) {
    sc = sc || DEFAULT_SCORING;
    const through = addDays(today, -1);
    let from = lastEvaluated ? addDays(lastEvaluated, 1) : start;
    if (from < start) from = start;
    const earliest = addDays(through, -RULES.MAX_LOOKBACK_DAYS);
    if (from < earliest) from = earliest;
    if (from > through) return null;

    const lostDates = [];
    const lostLogs = {};
    for (let d = from; d <= through; d = addDays(d, 1)) {
      const plan = planForFn(d);
      const st = logs[d] && logs[d].status;
      if (!isRest(plan) && st !== 'DONE' && st !== 'LOST') {
        lostDates.push(d);
        lostLogs[d] = { date: d, status: 'LOST', entries: (logs[d] && logs[d].entries) || [], points: -num(sc.penalty), planned: plannedPoints(plan, sc), pct: 0, complete: false, plannedMinutes: plannedMinutes(plan), plan, celebrated: false };
      }
    }
    const merged = { ...logs, ...lostLogs };
    const streakDate = merged[today] && merged[today].status === 'DONE' ? today : through;
    return {
      lostDates,
      lostLogs,
      penalty: lostDates.length * num(sc.penalty),
      evaluatedThrough: through,
      newStreak: streakEndingAt(streakDate, start, merged, planForFn),
    };
  }

  /* ------------------------------- milestones ------------------------------- */

  const blockIndex = (start, date, h) => Math.floor(Math.max(0, diffDays(start, date)) / h.days);
  const blockRange = (start, h, idx) => { const from = addDays(start, idx * h.days); return [from, addDays(from, h.days - 1)]; };

  /** Statistics of judged days (closed or skipped) in [from, to], or all. */
  function totals(logsArr, range) {
    const judged = logsArr.filter((l) => (l.status === 'DONE' || l.status === 'LOST') && (!range || (l.date >= range[0] && l.date <= range[1])));
    const done = judged.filter((l) => l.status === 'DONE');
    const entries = done.flatMap(logEntries);
    const plannedMin = sum(judged, (l) => num(l.plannedMinutes));
    const missed = sum(judged, (l) => Math.max(0, num(l.plannedMinutes) - (l.status === 'DONE' ? logMinutes(l) : 0)));
    return {
      judged: judged.length,
      days: done.length,
      completeDays: done.filter((l) => l.complete).length,
      skipped: judged.length - done.length,
      skippedPct: judged.length ? ((judged.length - done.length) * 100) / judged.length : 0,
      points: sum(done, (l) => num(l.points)),
      planned: sum(judged, (l) => num(l.planned)),
      minutes: sum(done, logMinutes),
      plannedMinutes: plannedMin,
      missedMinutes: missed,
      missedPct: plannedMin ? (missed * 100) / plannedMin : 0,
      reps: sum(entries, repsOf),
      sets: sum(entries, setsOf),
      avgLevel: entries.length ? sum(entries, (e) => num(e.level)) / entries.length : 0,
    };
  }

  /** David's real pace during the calibration window (first 30 days). */
  function baseline(start, today, logs) {
    const windowEnd = addDays(start, RULES.CALIBRATION_DAYS - 1);
    let elapsed = 0;
    const judged = [];
    for (let d = start; d <= windowEnd && d <= today; d = addDays(d, 1)) {
      const log = logs[d];
      if (d < today || (log && log.status === 'DONE')) {
        elapsed++;
        if (log && (log.status === 'DONE' || log.status === 'LOST')) judged.push(log);
      }
    }
    const t = totals(judged);
    const n = Math.max(1, t.judged);
    return {
      elapsedDays: elapsed,
      judgedDays: t.judged,
      calibrated: elapsed >= RULES.CALIBRATION_DAYS,
      pointsPerDay: t.points / n,
      minutesPerDay: t.minutes / n,
      repsPerDay: t.reps / n,
      setsPerDay: t.sets / n,
      avgLevel: t.avgLevel,
      skippedPct: t.skippedPct,
      missedPct: t.missedPct,
    };
  }

  const round1 = (v) => Math.round(v * 10) / 10;

  /**
   * What the PLAN asks for in one block of a horizon (the "real" target).
   * Days without a plan yet are filled with the average planned day.
   */
  function planTarget(h, blockStart, planForFn, sc) {
    let pts = 0, min = 0, reps = 0, sets = 0, lvlSum = 0, lvlN = 0, known = 0;
    for (let i = 0; i < h.days; i++) {
      const p = planForFn(addDays(blockStart, i));
      if (!p || isRest(p)) { if (p) known++; continue; }
      known++;
      const es = planEntries(p);
      pts += dayPoints(es, sc); min += plannedMinutes(p);
      reps += sum(es, repsOf); sets += sum(es, setsOf);
      es.forEach((e) => { lvlSum += e.level; lvlN++; });
    }
    const scale = known > 0 ? h.days / known : 0;
    return {
      horizon: h.id, state: 'PLAN',
      points: Math.round(pts * scale), minutes: Math.round(min * scale), reps: Math.round(reps * scale), sets: Math.round(sets * scale),
      avgLevel: lvlN ? round1(lvlSum / lvlN) : 0, maxSkippedPct: 0, maxMissedPct: 10,
    };
  }

  /** Tentative target projected from David's real pace (falls back to the plan before any data). */
  function ghostProposal(h, b, planT) {
    if (!b || b.judgedDays === 0) return { ...planT, state: 'GHOST' };
    return {
      horizon: h.id, state: 'GHOST',
      points: Math.round(b.pointsPerDay * h.days), minutes: Math.round(b.minutesPerDay * h.days),
      reps: Math.round(b.repsPerDay * h.days), sets: Math.round(b.setsPerDay * h.days),
      avgLevel: round1(b.avgLevel), maxSkippedPct: Math.ceil(b.skippedPct), maxMissedPct: Math.ceil(b.missedPct),
    };
  }

  const hasMax = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
  const isEmptyTarget = (t) => !t || (!num(t.points) && !num(t.minutes) && !num(t.reps) && !num(t.sets) && !num(t.avgLevel) && !hasMax(t.maxSkippedPct) && !hasMax(t.maxMissedPct));

  function meets(t, s) {
    if (isEmptyTarget(t) || s.days === 0) return false;
    return s.points >= num(t.points) && s.minutes >= num(t.minutes) && s.reps >= num(t.reps) && s.sets >= num(t.sets) &&
      s.avgLevel + 1e-9 >= num(t.avgLevel) &&
      (!hasMax(t.maxSkippedPct) || s.skippedPct <= +t.maxSkippedPct + 1e-9) &&
      (!hasMax(t.maxMissedPct) || s.missedPct <= +t.maxMissedPct + 1e-9);
  }
  const awardId = (h, idx) => `target_${h.id.toLowerCase()}_${idx + 1}`;

  function newlyAchieved(start, date, targets, logsArr, earned) {
    const out = [];
    for (const t of targets) {
      if (t.state !== 'OFFICIAL') continue;
      const h = HZ[t.horizon];
      const idx = blockIndex(start, date, h);
      if (!h.repeats && idx > 0) continue;
      if (earned.has(awardId(h, idx))) continue;
      if (meets(t, totals(logsArr, blockRange(start, h, idx)))) out.push({ h, idx });
    }
    return out;
  }

  /** 0..1 — the weakest "at least" metric decides; broken limits scale it down. */
  function progress(t, s) {
    if (isEmptyTarget(t)) return 0;
    const parts = [];
    [['points', 'points'], ['minutes', 'minutes'], ['reps', 'reps'], ['sets', 'sets'], ['avgLevel', 'avgLevel']].forEach(([k, sk]) => {
      if (num(t[k]) > 0) parts.push(s[sk] / num(t[k]));
    });
    let p = parts.length ? Math.min(...parts) : (s.days > 0 ? 1 : 0);
    if (hasMax(t.maxSkippedPct) && s.skippedPct > +t.maxSkippedPct) p *= +t.maxSkippedPct > 0 ? +t.maxSkippedPct / s.skippedPct : 0;
    if (hasMax(t.maxMissedPct) && s.missedPct > +t.maxMissedPct) p *= +t.maxMissedPct > 0 ? +t.maxMissedPct / s.missedPct : 0;
    return Math.max(0, Math.min(1, p));
  }

  /* --------------------------------- awards --------------------------------- */

  const MEDALS = [
    { id: 'first_step', title: 'The First Step', subtitle: 'Sealed your very first day', check: (c) => c.doneLogs.length >= 1 },
    { id: 'first_week', title: "I've Done My First Week", subtitle: '7 days in a row without skipping', check: (c) => c.bestStreak >= 7 },
    { id: 'twelve_labours', title: 'The Twelve Labours', subtitle: '12 days completed — like Hercules', check: (c) => c.doneLogs.length >= 12 },
    { id: 'titan_strength', title: 'Strength of a Titan', subtitle: 'Completed an exercise at Level III', check: (c) => c.doneLogs.some((l) => (l.entries || []).some((e) => isActive(e) && e.level === 3)) },
    { id: 'master_of_eight', title: 'Master of the Eight', subtitle: 'Completed all 8 exercises at least once', check: (c) => new Set(c.doneLogs.flatMap((l) => (l.entries || []).filter(isActive).map((e) => e.exercise))).size === EXERCISES.length },
    { id: 'thirty_suns', title: 'Thirty Suns', subtitle: 'A 30-day streak', check: (c) => c.bestStreak >= 30 },
    { id: 'thousand_minutes', title: 'A Thousand Minutes', subtitle: '1,000 minutes of training', check: (c) => sum(c.doneLogs, logMinutes) >= 1000 },
    { id: 'hundred_days', title: 'Hundred Days of Bronze', subtitle: 'A 100-day streak', check: (c) => c.bestStreak >= 100 },
    { id: 'unbroken_year', title: 'The Unbroken Year', subtitle: 'A 365-day streak', check: (c) => c.bestStreak >= 365 },
  ];

  const newlyEarned = (ctx, earned) => MEDALS.filter((m) => !earned.has(m.id) && m.check(ctx));
  const medalAward = (m, now) => ({ id: m.id, title: m.title, subtitle: m.subtitle, kind: 'MEDAL', horizon: null, earnedAt: now, celebrated: false });

  function roman(n) {
    if (n <= 0) return String(n);
    const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let out = '';
    v.forEach((x, i) => { while (n >= x) { out += s[i]; n -= x; } });
    return out;
  }

  function milestoneAward(h, idx, now) {
    const n = idx + 1;
    const sub = {
      MONTH: `Monthly target reached · Month ${n}`,
      HALF_YEAR: `Half-Year target reached · Half ${n}`,
      YEAR: `Yearly target reached · Year ${n}`,
      FIVE_YEAR: `5-Year target reached · Era ${n}`,
      TEN_YEAR: 'The 10-Year Master Target — Olympus reached',
    }[h.id];
    return { id: awardId(h, idx), title: h.repeats ? `${h.coat} ${roman(n)}` : h.coat, subtitle: sub, kind: 'COAT_OF_ARMS', horizon: h.id, earnedAt: now, celebrated: false };
  }

  /* -------------------------------- exports -------------------------------- */

  const Engine = {
    RULES, LEVELS, lvl, EXERCISES, EX, imgKey, gifKey, HORIZONS, HZ, VIDEO_KEYS, UI_SLOTS, MONTH_NAMES, GUIDE_SECTIONS, guideExKey, DOW,
    todayISO, addDays, diffDays, dowOf, mondayOf, isValidISO,
    isRest, planEnd, planCovers, planFor,
    DEFAULT_SCORING, scoring, isTimed, setList, fmtSets, fmtSecs, repsOf, minutesOf, planEntry, isActive, volume, setsOf, exercisePoints, dayPoints, planEntries, plannedPoints, plannedMinutes,
    logEntries, logMinutes, logReps, logSets, logAvgLevel,
    dayStats, streakEndingAt, closeDay, evaluate,
    blockIndex, blockRange, totals, baseline, planTarget, ghostProposal, hasMax, isEmptyTarget, meets, awardId, newlyAchieved, progress, round1,
    MEDALS, newlyEarned, medalAward, milestoneAward, roman,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
