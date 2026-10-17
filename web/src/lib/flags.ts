// Deterministic rules that decide what a clinician should look at. Gemini explains these flags
// in the report; it never creates, removes or re-grades one. Shared by the server and the app.
import type { ExerciseId, Side } from './types';

export type Severity = 'info' | 'warn' | 'urgent';

export interface Flag {
  /** Unique per flag: the rule's name, plus the exercise and arm for a rule that fires per arm (rom_drop:side_raise:left). */
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The numbers behind the flag, passed to the report so every claim can be checked. */
  evidence: Record<string, number | string | null>;
}

export interface RomDay {
  day: string; // YYYY-MM-DD, patient's local date
  exerciseId: ExerciseId;
  side: Side;
  bestPeakDeg: number;
  reps: number;
  repsOverCeiling: number;
  repsWithCompensation: number;
}

export interface SessionDay {
  day: string;
  phase: number;
  maxPain: number | null;
  armHeaviness: boolean;
  armpitCord: boolean;
}

export interface UseDay {
  day: string;
  activeMinutes: number;
  raisesOver90: number;
}

export interface FlagInput {
  /** Last day the rules consider; usually today, so a session counts as soon as it's saved. */
  asOf: string;
  rom: RomDay[];
  sessions: SessionDay[];
  dailyUse: UseDay[];
  /** Range limit in force for each phase; null = as tolerated. */
  limitByPhase: Record<number, number | null>;
}

export const DEFAULT_THRESHOLDS = {
  /** Best peak vs the best of the previous `romLookbackDays`. */
  romDropPct: 10,
  romLookbackDays: 7,
  /** Mean max pain of the last 3 sessions vs the 3 before. */
  painRisePoints: 2,
  painHigh: 7,
  symptomDays: 7,
  /** Mean active minutes of the last 3 days vs the 7 days before. */
  lowUseDropPct: 30,
  limitWindowDays: 14,
  compensationRate: 0.3,
  compensationRise: 0.1,
  missedDays: 3,
};

export type Thresholds = typeof DEFAULT_THRESHOLDS;

const EXERCISE_NAMES: Record<ExerciseId, string> = { side_raise: 'Side raise', scaption: 'Scaption raise', forward_raise: 'Forward raise' };
const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };

export function computeFlags(input: FlagInput, t: Thresholds = DEFAULT_THRESHOLDS): Flag[] {
  const asOf = input.asOf;
  const upTo = <T extends { day: string }>(rows: T[]) => rows.filter((r) => r.day <= asOf).sort((a, b) => a.day.localeCompare(b.day));
  const rom = upTo(input.rom);
  const sessions = upTo(input.sessions);
  const use = upTo(input.dailyUse);
  const flags: Flag[] = [];

  // Range loss, per exercise and arm.
  const groups = new Map<string, RomDay[]>();
  for (const r of rom) groups.set(`${r.exerciseId}:${r.side}`, [...(groups.get(`${r.exerciseId}:${r.side}`) ?? []), r]);
  for (const rows of groups.values()) {
    const latest = rows[rows.length - 1];
    const prior = rows.filter((r) => r.day < latest.day && daysBetween(r.day, latest.day) <= t.romLookbackDays);
    if (!prior.length) continue;
    const best = prior.reduce((a, b) => (b.bestPeakDeg > a.bestPeakDeg ? b : a));
    const dropPct = round1(((best.bestPeakDeg - latest.bestPeakDeg) / best.bestPeakDeg) * 100);
    if (dropPct < t.romDropPct) continue;
    const name = EXERCISE_NAMES[latest.exerciseId];
    flags.push({
      rule: `rom_drop:${latest.exerciseId}:${latest.side}`,
      severity: 'warn',
      title: `${name} range down ${Math.round(dropPct)}%`,
      detail: `Best ${round0(latest.bestPeakDeg)}° on ${fmt(latest.day)}, down from ${round0(best.bestPeakDeg)}° on ${fmt(best.day)} (${latest.side} arm).`,
      evidence: { exercise: latest.exerciseId, side: latest.side, from_deg: round1(best.bestPeakDeg), from_day: best.day, to_deg: round1(latest.bestPeakDeg), to_day: latest.day, drop_pct: dropPct },
    });
  }

  // Pain.
  const pained = sessions.filter((s) => s.maxPain !== null);
  if (pained.length >= 6) {
    const last3 = pained.slice(-3);
    const prev3 = pained.slice(-6, -3);
    const lastMean = round1(mean(last3.map((s) => s.maxPain!)));
    const prevMean = round1(mean(prev3.map((s) => s.maxPain!)));
    if (lastMean - prevMean >= t.painRisePoints) {
      flags.push({
        rule: 'pain_rising',
        severity: 'warn',
        title: 'Pain is rising',
        detail: `Average peak pain ${lastMean}/10 over the last 3 sessions, up from ${prevMean}/10 over the 3 before.`,
        evidence: { recent_mean_pain: lastMean, earlier_mean_pain: prevMean, rise: round1(lastMean - prevMean) },
      });
    }
  }
  const highPain = pained.filter((s) => daysBetween(s.day, asOf) < t.symptomDays && s.maxPain! >= t.painHigh);
  if (highPain.length) {
    const worst = highPain.reduce((a, b) => (b.maxPain! > a.maxPain! ? b : a));
    flags.push({
      rule: 'pain_high',
      severity: 'warn',
      title: `Pain reached ${worst.maxPain}/10`,
      detail: `Peak pain of ${worst.maxPain}/10 during the session on ${fmt(worst.day)}.`,
      evidence: { max_pain: worst.maxPain, day: worst.day, sessions_at_or_above: highPain.length, threshold: t.painHigh },
    });
  }

  // Symptoms the patient reported.
  const recent = sessions.filter((s) => daysBetween(s.day, asOf) < t.symptomDays);
  const heavy = recent.filter((s) => s.armHeaviness);
  if (heavy.length) {
    flags.push({
      rule: 'possible_swelling',
      severity: 'urgent',
      title: 'Arm heaviness or swelling reported',
      detail: `Reported on ${heavy.length} of the last ${recent.length} sessions, first on ${fmt(heavy[0].day)}. Swelling after lymph node removal should be checked by the care team.`,
      evidence: { sessions_reported: heavy.length, sessions_in_window: recent.length, first_day: heavy[0].day },
    });
  }
  const cord = recent.filter((s) => s.armpitCord);
  if (cord.length) {
    flags.push({
      rule: 'cording_reported',
      severity: 'warn',
      title: 'Cord-like pull under the arm reported',
      detail: `Reported on ${cord.length} of the last ${recent.length} sessions, first on ${fmt(cord[0].day)}.`,
      evidence: { sessions_reported: cord.length, sessions_in_window: recent.length, first_day: cord[0].day },
    });
  }

  // Daily arm use from the band.
  if (use.length >= 6) {
    const last3 = use.slice(-3);
    const before = use.slice(-10, -3);
    const lastMean = round0(mean(last3.map((u) => u.activeMinutes)));
    const beforeMean = round0(mean(before.map((u) => u.activeMinutes)));
    const dropPct = beforeMean > 0 ? round0(((beforeMean - lastMean) / beforeMean) * 100) : 0;
    if (dropPct >= t.lowUseDropPct) {
      flags.push({
        rule: 'low_daily_use',
        severity: 'warn',
        title: `Daily arm use down ${dropPct}%`,
        detail: `${lastMean} active minutes a day over the last 3 days, down from ${beforeMean} over the ${before.length} days before.`,
        evidence: { recent_active_min: lastMean, earlier_active_min: beforeMean, drop_pct: dropPct, earlier_days: before.length },
      });
    }
  }

  // Limit breaks, in sessions and in daily life.
  const inWindow = (day: string) => daysBetween(day, asOf) < t.limitWindowDays;
  const sessionBreaks = rom.filter((r) => inWindow(r.day) && r.repsOverCeiling > 0);
  if (sessionBreaks.length) {
    const reps = sessionBreaks.reduce((n, r) => n + r.repsOverCeiling, 0);
    const days = [...new Set(sessionBreaks.map((r) => r.day))];
    flags.push({
      rule: 'limit_exceeded_session',
      severity: 'warn',
      title: `${reps} ${reps === 1 ? 'rep' : 'reps'} past the range limit`,
      detail: `During sessions on ${days.map(fmt).join(', ')}.`,
      evidence: { reps_over_limit: reps, days: days.join(', ') },
    });
  }
  const phaseOn = (day: string) => [...sessions].reverse().find((s) => s.day <= day)?.phase ?? sessions[0]?.phase ?? 1;
  const dailyBreaks = use.filter((u) => {
    const limit = input.limitByPhase[phaseOn(u.day)];
    return inWindow(u.day) && u.raisesOver90 > 0 && limit !== null && limit !== undefined && limit <= 90;
  });
  if (dailyBreaks.length) {
    const raises = dailyBreaks.reduce((n, u) => n + u.raisesOver90, 0);
    const limits = [...new Set(dailyBreaks.map((u) => input.limitByPhase[phaseOn(u.day)]!))].sort((a, b) => a - b);
    const limitText = limits.length === 1 ? `${limits[0]}°` : `${limits[0]}–${limits[limits.length - 1]}°`;
    flags.push({
      rule: 'limit_exceeded_daily',
      severity: 'warn',
      title: `Arm raised above 90° ${raises} ${raises === 1 ? 'time' : 'times'} at home while limited to ${limitText}`,
      detail: `Logged by the armband on ${dailyBreaks.map((u) => fmt(u.day)).join(', ')}.`,
      evidence: { raises_over_90: raises, days: dailyBreaks.map((u) => u.day).join(', ') },
    });
  }

  // Form, per session across exercises.
  const byDay = new Map<string, { reps: number; comp: number }>();
  for (const r of rom) {
    const d = byDay.get(r.day) ?? { reps: 0, comp: 0 };
    byDay.set(r.day, { reps: d.reps + r.reps, comp: d.comp + r.repsWithCompensation });
  }
  const formDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  if (formDays.length >= 6) {
    const rate = (xs: { reps: number; comp: number }[]) => xs.reduce((n, x) => n + x.comp, 0) / Math.max(1, xs.reduce((n, x) => n + x.reps, 0));
    const recentRate = rate(formDays.slice(-3));
    const earlierRate = rate(formDays.slice(-6, -3));
    if (recentRate >= t.compensationRate && recentRate - earlierRate >= t.compensationRise) {
      flags.push({
        rule: 'compensation_rising',
        severity: 'info',
        title: 'More compensation in recent sessions',
        detail: `Shrugging, leaning or a bent elbow on ${round0(recentRate * 100)}% of reps over the last 3 sessions, up from ${round0(earlierRate * 100)}%.`,
        evidence: { recent_pct: round0(recentRate * 100), earlier_pct: round0(earlierRate * 100) },
      });
    }
  }

  // Adherence.
  const lastSession = sessions[sessions.length - 1];
  if (lastSession && daysBetween(lastSession.day, asOf) >= t.missedDays) {
    const gap = daysBetween(lastSession.day, asOf);
    flags.push({
      rule: 'missed_sessions',
      severity: 'info',
      title: `No session in ${gap} days`,
      detail: `Last session was on ${fmt(lastSession.day)}.`,
      evidence: { days_since_last: gap, last_day: lastSession.day },
    });
  }

  return flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

const round0 = (x: number) => Math.round(x);
const round1 = (x: number) => Math.round(x * 10) / 10;
