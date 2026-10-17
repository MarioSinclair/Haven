#!/usr/bin/env node
// Generates db/seed.sql: one demo patient's recovery after a left mastectomy with axillary
// node dissection. Deterministic for a given end date. Re-run on demo day so the data ends yesterday:
//
//   node db/scripts/generate-seed.mjs              # last session = yesterday (New York time)
//   node db/scripts/generate-seed.mjs --end 2026-10-20
//
// The story, so the deterministic flag rules have something real to find:
//   day -6      pre-op range check on both arms (the reference for progress)
//   days 0–9    phase 1, drains in, 90° limit; a few reps creep past it, and on day 6 the band
//               logs reaches above 90° in daily life
//   day 10      drains out → phase 2, range climbs quickly
//   days 15–17  axillary cording: side-raise range drops ~17%, pain rises, daily arm use falls
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATIENT_ID = '00000000-0000-4000-8000-000000000001';
const TZ = 'America/New_York';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed.sql');

// ---- deterministic randomness ----
let state = 20261015;
function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rand() * (b - a);
const chance = (p) => rand() < p;
function gauss(mean = 0, sd = 1) {
  const u = Math.max(rand(), 1e-9);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function uuid() {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- calendar helpers (pure date strings; timezone applied by Postgres) ----
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function ts(date, minutesAfterMidnight) {
  const total = Math.round(minutesAfterMidnight * 60);
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss} ${TZ}`;
}
function yesterdayInNewYork() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return addDays(today, -1);
}

const endArg = process.argv.indexOf('--end');
const END = endArg > 0 ? process.argv[endArg + 1] : yesterdayInNewYork();
if (!/^\d{4}-\d{2}-\d{2}$/.test(END)) throw new Error(`--end must be YYYY-MM-DD, got ${END}`);
const LAST_DAY = 17;
const SURGERY = addDays(END, -LAST_DAY);
const DRAINS_OUT_DAY = 10;
const day = (n) => addDays(SURGERY, n);

// ---- SQL helpers ----
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v));
const r1 = (x) => Math.round(x * 10) / 10;
const rows = { sessions: [], sets: [], reps: [], symptom_logs: [], baselines: [], daily_use: [] };
const insert = (table, cols, list) =>
  list.length ? `insert into ${table} (${cols.join(', ')}) values\n${list.map((r) => `  (${r.map(q).join(', ')})`).join(',\n')};\n` : '';

// ---- the recovery curve: best side-raise peak per session day ----
const SIDE_RAISE_BEST = { 2: 58, 3: 63, 4: 68, 6: 76, 7: 83, 8: 87, 9: 89, 10: 98, 11: 106, 13: 118, 14: 126, 15: 113, 16: 107, 17: 104 };
const SESSION_DAYS = Object.keys(SIDE_RAISE_BEST).map(Number);
const CORDING_FROM = 15;
const PRE_OP = { left: { side_raise: 172, scaption: 168 }, right: { side_raise: 176, scaption: 171 } };

function painFor(d) {
  if (d >= CORDING_FROM) return 4.5 + (d - CORDING_FROM) * 0.6;
  if (d < DRAINS_OUT_DAY) return 5 - (d - 2) * 0.3;
  return 2.8 - (d - DRAINS_OUT_DAY) * 0.2;
}
function hikeRate(d) {
  if (d >= CORDING_FROM) return 0.3;
  return Math.max(0.08, 0.38 - d * 0.022);
}

// ---- sessions ----
function addSession({ dayIndex, kind, phase, blocks, painBase, bandOn }) {
  const id = uuid();
  const date = day(dayIndex);
  const start = between(17.5, 19.5) * 60;
  let clock = start; // minutes after midnight
  for (const b of blocks) {
    for (let setIndex = 0; setIndex < b.sets; setIndex++) {
      const setId = uuid();
      const pain = painBase === null ? null : Math.max(0, Math.min(10, Math.round(painBase + gauss(0, 0.6) + setIndex * 0.3)));
      rows.sets.push([setId, id, b.exerciseId, b.side, setIndex, b.ceiling, b.reps, pain]);
      for (let i = 1; i <= b.reps; i++) {
        // Rep 3 of the first set is the session best (sometimes just past the limit in phase 1);
        // the rest fall a little short of the usual best, and second sets tire.
        const peak = i === 3 && setIndex === 0 ? (b.topRep ?? b.best) : b.best - Math.abs(gauss(0, 3.5)) - setIndex * 1.5;
        const fromBand = bandOn && chance(0.05);
        const imuPeak = bandOn ? peak + gauss(-1.2, 2.2) : null;
        clock += between(3, 4.5) / 60;
        rows.reps.push([
          setId,
          PATIENT_ID,
          b.exerciseId,
          b.side,
          kind,
          ts(date, clock),
          i,
          r1(fromBand ? imuPeak : peak),
          Math.round(between(2600, 4200)),
          fromBand ? 'imu' : 'camera',
          b.ceiling !== null && peak > b.ceiling,
          kind === 'exercise' && chance(hikeRate(dayIndex)),
          kind === 'exercise' && chance(dayIndex >= CORDING_FROM ? 0.15 : 0.06),
          kind === 'exercise' && chance(0.05),
          imuPeak === null ? null : r1(imuPeak),
        ]);
      }
      clock += 0.75; // pain prompt + rest
    }
  }
  rows.sessions.push([id, PATIENT_ID, kind, phase, ts(date, start), ts(date, clock + 1)]);
  return { id, date, end: clock + 1 };
}

// Pre-op range check: both arms, no limit, three reps each.
const preOp = addSession({
  dayIndex: -6,
  kind: 'assessment',
  phase: 1,
  painBase: null,
  bandOn: true,
  blocks: ['side_raise', 'scaption'].flatMap((exerciseId) =>
    ['left', 'right'].map((side) => ({ exerciseId, side, sets: 1, reps: 3, ceiling: null, best: PRE_OP[side][exerciseId] })),
  ),
});
for (const side of ['left', 'right']) {
  for (const exerciseId of ['side_raise', 'scaption']) {
    rows.baselines.push([PATIENT_ID, exerciseId, side, 'pre_op', PRE_OP[side][exerciseId], ts(preOp.date, preOp.end)]);
  }
}

for (const d of SESSION_DAYS) {
  const phase = d < DRAINS_OUT_DAY ? 1 : 2;
  const ceiling = phase === 1 ? 90 : null;
  const sideBest = SIDE_RAISE_BEST[d];
  // Cording limits abduction most; scaption drops less during the setback.
  const scapBest = d >= CORDING_FROM ? SIDE_RAISE_BEST[14] + 4 - (d - 14) * 4 : sideBest + 4;
  // In phase 1 the patient stays just under the limit, but late in the phase one rep sometimes slips past it.
  const block = (exerciseId, target) => {
    const best = ceiling === null ? target : Math.min(target, ceiling - 1);
    const topRep = ceiling !== null && target > 84 && chance(0.6) ? ceiling + between(0.5, 3) : null;
    return { exerciseId, side: 'left', sets: 2, reps: 10, ceiling, best, topRep };
  };
  const session = addSession({
    dayIndex: d,
    kind: 'exercise',
    phase,
    painBase: painFor(d),
    bandOn: !chance(0.1),
    blocks: [block('side_raise', sideBest), block('scaption', scapBest)],
  });
  if (d === SESSION_DAYS[0]) {
    rows.baselines.push([PATIENT_ID, 'side_raise', 'left', 'first_session', sideBest, ts(session.date, session.end)]);
    rows.baselines.push([PATIENT_ID, 'scaption', 'left', 'first_session', scapBest, ts(session.date, session.end)]);
  }
  rows.symptom_logs.push([session.id, ts(session.date, session.end), false, d >= CORDING_FROM, d === CORDING_FROM ? 'Pulling feeling under my arm when I reach out to the side' : null]);
}

// ---- daily use from the band, hourly buckets 08:00–21:00 ----
function activeMinutesBase(d) {
  if (d >= CORDING_FROM) return 16;
  if (d < 5) return 13;
  if (d < DRAINS_OUT_DAY) return 21;
  return 29;
}
for (let d = 1; d <= LAST_DAY; d++) {
  for (let hour = 8; hour <= 21; hour++) {
    const evening = hour >= 19 ? 0.7 : 1;
    const active = Math.max(2, Math.min(60, activeMinutesBase(d) * evening + gauss(0, 4)));
    let maxElev;
    let raises = 0;
    if (d < DRAINS_OUT_DAY) {
      maxElev = Math.min(88, between(50, 84) + d);
      // Day 6 afternoon: reached up to a kitchen shelf during the 90° limit phase.
      if (d === 6 && hour === 15) [maxElev, raises] = [104, 3];
      if (d === 7 && hour === 11) [maxElev, raises] = [95, 1];
    } else if (d < CORDING_FROM) {
      maxElev = r1(between(85, 108) + (d - DRAINS_OUT_DAY) * 2.5);
      raises = maxElev > 90 ? 1 + Math.floor(between(0, 3)) : 0;
    } else {
      maxElev = r1(between(78, 98));
      raises = maxElev > 90 ? 1 : 0;
    }
    rows.daily_use.push([PATIENT_ID, ts(day(d), hour * 60), 60, r1(maxElev), raises, r1(active)]);
  }
}

// ---- write ----
const sql = `-- Generated by supabase/scripts/generate-seed.mjs (end date ${END}). Do not edit by hand.
-- Demo patient: surgery ${SURGERY}, drains out ${day(DRAINS_OUT_DAY)}, cording from ${day(CORDING_FROM)}.
begin;

delete from patients where id = ${q(PATIENT_ID)};

insert into patients (id, display_name, affected_side, surgery_type, surgery_date, current_phase) values
  (${q(PATIENT_ID)}, 'Maya (demo)', 'left', 'Left mastectomy with axillary lymph node dissection', ${q(SURGERY)}, 2);

${insert('prescriptions', ['patient_id', 'phase', 'exercise_id', 'ceiling_deg', 'goal_deg', 'reps_target', 'sets_target', 'set_by'], [
  [PATIENT_ID, 1, 'side_raise', 90, null, 10, 2, 'Demo PT'],
  [PATIENT_ID, 1, 'scaption', 90, null, 10, 2, 'Demo PT'],
  [PATIENT_ID, 2, 'side_raise', null, null, 10, 2, 'Demo PT'],
  [PATIENT_ID, 2, 'scaption', null, null, 10, 2, 'Demo PT'],
])}
${insert('baselines', ['patient_id', 'exercise_id', 'side', 'source', 'peak_deg', 'measured_at'], rows.baselines)}
${insert('sessions', ['id', 'patient_id', 'kind', 'phase', 'started_at', 'ended_at'], rows.sessions)}
${insert('sets', ['id', 'session_id', 'exercise_id', 'side', 'set_index', 'ceiling_deg', 'reps_target', 'pain'], rows.sets)}
${insert('reps', ['set_id', 'patient_id', 'exercise_id', 'side', 'kind', 'performed_at', 'rep_index', 'peak_deg', 'duration_ms', 'source', 'over_ceiling', 'shoulder_hike', 'trunk_lean', 'elbow_bend', 'imu_peak_deg'], rows.reps)}
${insert('symptom_logs', ['session_id', 'logged_at', 'arm_heaviness', 'armpit_cord', 'note'], rows.symptom_logs)}
${insert('daily_use', ['patient_id', 'bucket_start', 'bucket_minutes', 'max_elev_deg', 'raises_over_90', 'active_minutes'], rows.daily_use)}
-- The band's 20 Hz stream for each exercise session, synthesized in the database so this file
-- stays small: smooth reps (one every ~3.6 s) up to that session's best peak, plus sensor noise.
insert into band_samples (patient_id, session_id, t, elevation_deg, rate_dps)
select
  s.patient_id,
  s.id,
  gt.t,
  round((6 + (best.peak - 10) * (1 - cos(2 * pi() * phase.x)) / 2 + 1.2 * sin(g.n * 1.7))::numeric, 2),
  round((pi() / 3.6 * (best.peak - 10) * sin(2 * pi() * phase.x))::numeric, 1)
from sessions s
join lateral (select max(r.peak_deg) as peak from reps r join sets st on st.id = r.set_id where st.session_id = s.id) best on true
cross join lateral generate_series(0, (extract(epoch from s.ended_at - s.started_at) * 20)::int) as g(n)
cross join lateral (select s.started_at + g.n * interval '50 milliseconds' as t) gt
cross join lateral (select (g.n / 20.0 / 3.6) % 1 as x) phase
where s.patient_id = ${q(PATIENT_ID)} and s.kind = 'exercise';

commit;
`;
writeFileSync(out, sql);
console.log(
  `Wrote ${out}: ${rows.sessions.length} sessions, ${rows.sets.length} sets, ${rows.reps.length} reps, ${rows.daily_use.length} daily-use buckets (surgery ${SURGERY}, last session ${END})`,
);
