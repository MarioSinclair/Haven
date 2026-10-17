import { describe, expect, it } from 'vitest';
import { computeFlags, daysBetween, type FlagInput, type RomDay, type SessionDay, type UseDay } from './flags';
import { collectNumbers, unsupportedNumbers } from './numberGuard';

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10); // Oct 1 + n

function rom(n: number, best: number, extra: Partial<RomDay> = {}): RomDay {
  return { day: day(n), exerciseId: 'side_raise', side: 'left', bestPeakDeg: best, reps: 20, repsOverCeiling: 0, repsWithCompensation: 2, ...extra };
}
function session(n: number, pain: number | null, extra: Partial<SessionDay> = {}): SessionDay {
  return { day: day(n), phase: 2, maxPain: pain, armHeaviness: false, armpitCord: false, ...extra };
}
function use(n: number, minutes: number, raises = 0): UseDay {
  return { day: day(n), activeMinutes: minutes, raisesOver90: raises };
}

const steady: FlagInput = {
  asOf: day(10),
  rom: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => rom(n, 90 + n * 3)),
  sessions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => session(n, 3)),
  dailyUse: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => use(n, 300)),
  limitByPhase: { 1: 90, 2: null, 3: null },
};

const rules = (input: FlagInput) => computeFlags(input).map((f) => f.rule);

describe('computeFlags', () => {
  it('raises nothing for a patient who is steadily improving', () => {
    expect(computeFlags(steady)).toEqual([]);
  });

  it('flags a range drop against the best of the previous week', () => {
    const flags = computeFlags({ ...steady, rom: [...steady.rom.slice(0, 9), rom(10, 100)] });
    const drop = flags.find((f) => f.rule === 'rom_drop:side_raise:left')!;
    expect(drop.evidence).toMatchObject({ from_deg: 117, to_deg: 100, drop_pct: 14.5 });
    expect(drop.title).toBe('Side raise range down 15%');
  });

  it('gives each arm its own range-drop flag', () => {
    const right = steady.rom.map((r) => ({ ...r, side: 'right' as const }));
    const dropped = (rows: RomDay[]) => [...rows.slice(0, 9), { ...rows[9], bestPeakDeg: 100 }];
    expect(rules({ ...steady, rom: [...dropped(steady.rom), ...dropped(right)] })).toEqual(['rom_drop:side_raise:left', 'rom_drop:side_raise:right']);
  });

  it('ignores a small dip', () => {
    expect(rules({ ...steady, rom: [...steady.rom.slice(0, 9), rom(10, 112)] })).toEqual([]);
  });

  it('flags rising pain and a high pain score', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => session(n, n > 7 ? 7 : 3));
    expect(rules({ ...steady, sessions })).toEqual(expect.arrayContaining(['pain_rising', 'pain_high']));
  });

  it('treats reported swelling as urgent and lists it first', () => {
    const sessions = steady.sessions.map((s, i) => (i === 9 ? { ...s, armHeaviness: true, armpitCord: true } : s));
    const flags = computeFlags({ ...steady, sessions });
    expect(flags[0].rule).toBe('possible_swelling');
    expect(flags[0].severity).toBe('urgent');
    expect(flags.map((f) => f.rule)).toContain('cording_reported');
  });

  it('flags a drop in daily arm use from the band', () => {
    const dailyUse = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => use(n, n > 7 ? 180 : 300));
    const f = computeFlags({ ...steady, dailyUse }).find((x) => x.rule === 'low_daily_use')!;
    expect(f.evidence).toMatchObject({ recent_active_min: 180, earlier_active_min: 300, drop_pct: 40 });
  });

  it('flags raises above 90° at home only while the phase limits the arm to 90°', () => {
    const sessions = steady.sessions.map((s) => ({ ...s, phase: s.day <= day(5) ? 1 : 2 }));
    const dailyUse = steady.dailyUse.map((u) => (u.day === day(4) || u.day === day(8) ? { ...u, raisesOver90: 3 } : u));
    const f = computeFlags({ ...steady, sessions, dailyUse }).find((x) => x.rule === 'limit_exceeded_daily')!;
    expect(f.evidence).toMatchObject({ raises_over_90: 3, days: day(4) });
    expect(f.title).toBe('Arm raised above 90° 3 times at home while limited to 90°');
    const strict = computeFlags({ ...steady, sessions, dailyUse, limitByPhase: { 1: 60, 2: null, 3: null } }).find((x) => x.rule === 'limit_exceeded_daily')!;
    expect(strict.title).toBe('Arm raised above 90° 3 times at home while limited to 60°');
  });

  it('flags reps past the limit in sessions', () => {
    const r = steady.rom.map((x) => (x.day === day(6) ? { ...x, repsOverCeiling: 2 } : x));
    expect(computeFlags({ ...steady, rom: r }).find((f) => f.rule === 'limit_exceeded_session')!.title).toBe('2 reps past the range limit');
  });

  it('notes missed sessions', () => {
    expect(rules({ ...steady, asOf: day(14) })).toContain('missed_sessions');
  });

  it('ignores data after the as-of date', () => {
    expect(computeFlags({ ...steady, asOf: day(9), rom: [...steady.rom, rom(11, 50)] })).toEqual([]);
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
  });
});

describe('number guard', () => {
  const stats = { best: 103.8, from_day: '2026-10-11', drop_pct: 17.5, pain: [2, 6] };
  const allowed = collectNumbers(stats);

  it('collects numbers from values and strings', () => {
    expect(allowed).toEqual(expect.arrayContaining([103.8, 2026, 10, 11, 17.5, 2, 6]));
  });

  it('accepts numbers from the data, including rounded integers and percents', () => {
    expect(unsupportedNumbers('Range fell 17.5% to 104° on Oct 11, and pain rose from 2 to 6.', allowed)).toEqual([]);
  });

  it('catches numbers the model made up', () => {
    expect(unsupportedNumbers('Range fell 25% and pain hit 9.', allowed)).toEqual(['25', '9']);
  });

  it('ignores digits inside words', () => {
    expect(unsupportedNumbers('Her 3rd week on Gemini v4.', allowed)).toEqual([]);
  });
});
