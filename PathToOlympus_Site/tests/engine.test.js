// Run with:  node tests/engine.test.js
const E = require('../engine.js');
const assert = require('assert');
const SC = E.scoring();

const start = '2026-11-30'; // Monday
const dayPlan = { note: '', exercises: [
  { exercise: 'PULL_UPS', level: 1, targetReps: 8, targetSets: 3, targetMinutes: 5 },
  { exercise: 'ABS', level: 2, targetReps: 20, targetSets: 2, targetMinutes: 5 },
] };
const weekly = { id: 'p1', name: 'w', startDate: start, repeatWeeks: 8, createdAt: 1, days: Object.fromEntries(E.DOW.map((d) => [d, dayPlan])) };
const pf = (d) => E.planFor(d, [weekly], {});
const asPlanned = () => E.planEntries(dayPlan);
const d = (n) => E.addDays(start, n);
const closed = (n, entries = asPlanned()) => E.closeDay(d(n), start, dayPlan, entries, {}, pf, SC).log;

const tests = {
  dates() {
    assert.strictEqual(E.dowOf('2026-11-30'), 'MONDAY');
    assert.strictEqual(E.addDays('2026-12-31', 1), '2027-01-01');
    assert.strictEqual(E.diffDays('2026-03-28', '2026-03-30'), 2);
    assert.strictEqual(E.mondayOf('2026-12-06'), '2026-11-30');
  },
  formula() {
    // pull-ups L1: 2.6 × 1 × (5 + 8×3×1 + 5×1) = 88.4
    assert.strictEqual(E.exercisePoints({ exercise: 'PULL_UPS', level: 1, reps: 8, sets: 3, minutes: 5 }, SC), 2.6 * 34);
    // plank L2: 3.1 × 2 × (5 + 60×3×0.1 + 3) = 161.2
    assert.ok(Math.abs(E.exercisePoints({ exercise: 'PLANK', level: 2, reps: 60, sets: 3, minutes: 3 }, SC) - 161.2) < 1e-9);
    // sets left at 0 count as one set; nothing logged = 0
    assert.strictEqual(E.volume({ reps: 10, sets: 0 }), 10);
    assert.strictEqual(E.exercisePoints({ exercise: 'ABS', level: 1, reps: 0, sets: 0, minutes: 0 }, SC), 0);
    // planned: 88.4 + 1.5×2×(5+40+5)=150 → 238
    assert.strictEqual(E.plannedPoints(dayPlan, SC), 238);
    assert.strictEqual(E.plannedMinutes(dayPlan), 10);
    // custom scoring is merged over the defaults
    assert.strictEqual(E.scoring({ hardness: { PULL_UPS: 3 } }).hardness.PUSH_UPS, 1.8);
  },
  closeAnyDay() {
    assert.strictEqual(E.closeDay(d(0), start, dayPlan, [], {}, pf, SC), null); // nothing logged
    const half = [{ exercise: 'PULL_UPS', level: 1, reps: 8, sets: 3, minutes: 5 }];
    const r = E.closeDay(d(0), start, dayPlan, half, {}, pf, SC);
    assert.strictEqual(r.points, 88);
    assert.strictEqual(r.pct, 37);
    assert.strictEqual(r.complete, false);
    assert.strictEqual(r.newStreak, 1);
    // something different from the plan, more than planned → complete
    const other = [{ exercise: 'SWIMMING', level: 3, reps: 10, sets: 2, minutes: 30 }];
    const r2 = E.closeDay(d(0), start, dayPlan, other, {}, pf, SC);
    assert.ok(r2.complete && r2.pct > 100);
    // no plan at all: closing anything counts as complete
    assert.strictEqual(E.closeDay(d(-5), d(-5), null, half, {}, () => null, SC).complete, true);
  },
  streakAndSkips() {
    const logs = { [d(0)]: closed(0), [d(1)]: closed(1, [{ exercise: 'ABS', level: 1, reps: 5, sets: 1, minutes: 1 }]) };
    assert.strictEqual(E.streakEndingAt(d(1), start, logs, pf), 2); // incomplete days keep the streak
    const e = E.evaluate(start, d(1), d(4), logs, pf, SC);
    assert.deepStrictEqual(e.lostDates, [d(2), d(3)]);
    assert.strictEqual(e.penalty, 100);
    assert.strictEqual(e.newStreak, 0);
    assert.strictEqual(e.lostLogs[d(2)].planned, 238);
    assert.strictEqual(E.evaluate(start, e.evaluatedThrough, d(4), logs, pf, SC), null);
    const withLost = { ...logs, ...e.lostLogs };
    assert.strictEqual(E.closeDay(d(4), start, dayPlan, asPlanned(), withLost, pf, SC).newStreak, 1);
  },
  unplannedNeverPenalised() {
    const gap = { ...weekly, days: { ...weekly.days } };
    delete gap.days.WEDNESDAY;
    const pf2 = (x) => E.planFor(x, [gap], {});
    const logs = { [d(0)]: closed(0), [d(1)]: closed(1), [d(3)]: closed(3) };
    const e = E.evaluate(start, null, d(4), logs, pf2, SC);
    assert.deepStrictEqual(e.lostDates, []);
    assert.strictEqual(e.newStreak, 3);
  },
  totalsAndTargets() {
    const logs = {};
    for (let i = 0; i < 30; i++) logs[d(i)] = closed(i);
    const lost = E.evaluate(start, d(29), d(31), logs, pf, SC); // day 30 skipped
    Object.assign(logs, lost.lostLogs);
    const t = E.totals(Object.values(logs));
    assert.strictEqual(t.days, 30);
    assert.strictEqual(t.skipped, 1);
    assert.ok(Math.abs(t.skippedPct - 100 / 31) < 1e-9);
    assert.strictEqual(t.points, 30 * 238);
    assert.strictEqual(t.missedMinutes, 10);
    assert.strictEqual(t.reps, 30 * (24 + 40));
    assert.strictEqual(t.sets, 30 * 5);
    assert.strictEqual(t.avgLevel, 1.5);

    const plan = E.planTarget(E.HZ.MONTH, start, pf, SC);
    assert.strictEqual(plan.points, 30 * 238);
    assert.strictEqual(plan.minutes, 300);

    const b = E.baseline(start, d(31), logs);
    assert.ok(b.calibrated);
    const g = E.ghostProposal(E.HZ.YEAR, b, plan);
    assert.strictEqual(g.points, 238 * 365);
    assert.strictEqual(g.maxSkippedPct, 0);

    const month = { horizon: 'MONTH', state: 'OFFICIAL', points: 7000, minutes: 290, avgLevel: 1.5, maxSkippedPct: 0, maxMissedPct: 5 };
    const arr = Object.values(logs);
    assert.deepStrictEqual(E.newlyAchieved(start, d(29), [month], arr, new Set()).map((x) => [x.h.id, x.idx]), [['MONTH', 0]]);
    assert.strictEqual(E.newlyAchieved(start, d(29), [{ ...month, points: 9000 }], arr, new Set()).length, 0);
    assert.strictEqual(E.newlyAchieved(start, d(29), [{ ...month, state: 'GHOST' }], arr, new Set()).length, 0);
    assert.ok(E.progress({ points: 14280 }, E.totals(arr)) - 0.5 < 1e-9);
  },
  medals() {
    const logs = [0, 1, 2, 3, 4, 5, 6].map((i) => closed(i));
    logs[0].entries.push({ exercise: 'DIPS', level: 3, reps: 5, sets: 1, minutes: 2 });
    const ids = E.newlyEarned({ streak: 7, bestStreak: 7, doneLogs: logs }, new Set()).map((m) => m.id);
    assert.ok(ids.includes('first_step'));
    assert.ok(ids.includes('first_week'));
    assert.ok(ids.includes('titan_strength'));
    assert.ok(!ids.includes('twelve_labours'));
    assert.strictEqual(E.roman(12), 'XII');
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); }
}
process.exit(failed ? 1 : 0);
