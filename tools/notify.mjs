// Path to Olympus — Telegram messenger. Runs every hour on GitHub Actions (.github/workflows/notify.yml).
//  • reminds David in the evening if today's planned day is not closed yet
//  • tells the Admin when David closes a day, and warns late in the evening if he has not
// Secrets (GitHub → Settings → Secrets and variables → Actions):
//   TG_TOKEN       bot token from @BotFather
//   TG_DAVID_CHAT  David's chat id with the bot     (optional — no reminders without it)
//   TG_ADMIN_CHAT  your chat id with the bot        (optional — no alerts without it)
//   DAVID_CODE     the code you set in Admin → Settings → David's phone
// Optional variables: TZ_NAME (default Asia/Ho_Chi_Minh), REMIND_HOURS (default "19,21"), WARN_HOUR (default 23)
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const E = require('../PathToOlympus_Site/engine.js');

const env = process.env;
const cfgSrc = readFileSync(new URL('../PathToOlympus_Site/config.js', import.meta.url), 'utf8');
const API_KEY = (cfgSrc.match(/apiKey:\s*'([^']+)'/) || [])[1];
const PROJECT = (cfgSrc.match(/projectId:\s*'([^']+)'/) || [])[1];
const ATHLETE = (cfgSrc.match(/athleteId:\s*'([^']+)'/) || [])[1] || 'david';
const TZ = env.TZ_NAME || 'Asia/Ho_Chi_Minh';
const REMIND = (env.REMIND_HOURS || '19,21').split(',').map(Number);
const WARN = Number(env.WARN_HOUR || 23);
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

/* ---------------- Telegram ---------------- */
async function tg(chat, text) {
  if (!env.TG_TOKEN || !chat) return;
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML' }),
  });
  if (!r.ok) console.log('telegram', r.status, await r.text());
}
/** Setup help: print the chats that wrote to the bot, so you can copy their ids. */
async function listChats() {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getUpdates`);
  const j = await r.json();
  const seen = new Map();
  (j.result || []).forEach((u) => { const c = (u.message || u.my_chat_member || {}).chat; if (c) seen.set(c.id, `${c.first_name || ''} ${c.last_name || ''} @${c.username || ''}`.trim()); });
  console.log(seen.size ? 'Chats that wrote to the bot:' : 'Nobody has written to the bot yet — send it any message first.');
  seen.forEach((n, id) => console.log(`  ${id}   ${n}`));
}

/* ---------------- Firebase (REST, as a paired David device that cleans up after itself) ---------------- */
let ID = null, UID = null;
const auth = () => ({ authorization: `Bearer ${ID}`, 'content-type': 'application/json' });
async function signIn() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ returnSecureToken: true }) });
  const j = await r.json(); if (!r.ok) throw new Error('sign-in failed: ' + JSON.stringify(j));
  ID = j.idToken; UID = j.localId;
  const hash = createHash('sha256').update('olympus-david:' + env.DAVID_CODE).digest('hex');
  const p = await fetch(`${DB}/davids/${UID}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ fields: { codeHash: { stringValue: hash }, at: { integerValue: String(Date.now()) } } }) });
  if (!p.ok) throw new Error('pairing failed (is DAVID_CODE right?): ' + (await p.text()));
}
async function signOut() {
  if (!ID) return;
  await fetch(`${DB}/davids/${UID}`, { method: 'DELETE', headers: auth() }).catch(() => {});
  await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ idToken: ID }) }).catch(() => {});
}
const dec = (v) => {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return obj(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
};
const obj = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
async function getDoc(path) { const r = await fetch(`${DB}/${path}`, { headers: auth() }); return r.ok ? obj((await r.json()).fields) : null; }
async function list(path) {
  const r = await fetch(`${DB}/${path}?pageSize=300`, { headers: auth() });
  if (!r.ok) return [];
  return ((await r.json()).documents || []).map((d) => ({ ...obj(d.fields), id: d.name.split('/').pop() }));
}
async function mark(path, field) {
  await fetch(`${DB}/${path}?updateMask.fieldPaths=${field}`, { method: 'PATCH', headers: auth(), body: JSON.stringify({ fields: { [field]: { booleanValue: true } } }) });
}

/* ---------------- the hourly check ---------------- */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const REMINDERS = [
  '⚔️ <b>The Trial awaits, {name}.</b> Today\'s plan is still open — walk the road and close the day.',
  '🏛 Olympus is watching, {name}. One more step today keeps the streak alive. 🔥 {streak}',
  '🌄 The road is mastered by the one who walks it. Your plan for today is waiting.',
];
async function main() {
  if (!env.TG_TOKEN) { console.log('TG_TOKEN is not set — nothing to do.'); return; }
  if (process.argv.includes('--chats')) { await listChats(); return; }
  if (!env.DAVID_CODE) { console.log('DAVID_CODE is not set.'); return; }
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now)) % 24;
  await signIn();
  try {
    const root = `athletes/${ATHLETE}`;
    const p = (await getDoc(root)) || {};
    const plans = await list(`${root}/plans`);
    const overrides = Object.fromEntries((await list(`${root}/overrides`)).map((o) => [o.id, o]));
    const plan = E.planFor(today, plans, overrides);
    const planned = !E.isRest(plan) && (!p.startDate || today >= p.startDate);
    const days = await list(`${root}/days`);
    const todayLog = days.find((d) => d.id === today);
    const closed = todayLog && (todayLog.status === 'DONE' || todayLog.status === 'EXCUSED');
    const name = p.name || 'David';

    // 1) Admin: every closed day not announced yet (closed in the last 3 days)
    for (const d of days.filter((x) => x.status === 'DONE' && !x.adminNotified && x.id >= E.addDays(today, -3))) {
      await tg(env.TG_ADMIN_CHAT, `🏛 <b>${name} closed ${d.id}</b>\n${d.complete === false ? '◐ Incomplete' : '✅ Completed'} · ${d.pct || 0}% of the plan · +${d.points || 0} pts\n🔥 Streak ${p.currentStreak || 0} · Glory ${p.score || 0}`);
      await mark(`${root}/days/${d.id}`, 'adminNotified');
    }
    // 2) David: evening reminders
    if (planned && !closed && REMIND.includes(hour)) {
      await tg(env.TG_DAVID_CHAT, pick(REMINDERS).replace('{name}', name).replace('{streak}', p.currentStreak || 0) + '\n👉 https://niksky1984.github.io/path-to-olympus/');
    }
    // 3) Admin: late warning
    if (planned && !closed && hour === WARN) {
      await tg(env.TG_ADMIN_CHAT, `⚠️ ${name} has not closed today's planned day yet (${today}). Streak at risk: 🔥 ${p.currentStreak || 0}`);
    }
    console.log(`checked ${today} ${hour}:00 — planned=${planned} closed=${!!closed}`);
  } finally { await signOut(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
