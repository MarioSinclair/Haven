import { describe, expect, it } from 'vitest';
import type { SessionResultJson } from './apiTypes';
import { checkSession, includedPrescriptions, parsePatientInput, parsePrescriptions, phaseLimit, planRows } from './carePlan';
import { DEFAULT_PROTOCOL } from './protocol';
import type { RepResult, SetResult } from './session/engine';

const valid = {
  displayName: '  Ana  ',
  affectedSide: 'right',
  surgeryType: '',
  surgeryDate: '2026-10-02',
  currentPhase: 2,
  email: ' Ana@Example.com ',
  planNote: '',
};

describe('patient input', () => {
  it('trims text, lowercases the email and turns blanks into null', () => {
    expect(parsePatientInput(valid)).toEqual({
      displayName: 'Ana',
      affectedSide: 'right',
      surgeryType: null,
      surgeryDate: '2026-10-02',
      currentPhase: 2,
      email: 'ana@example.com',
      planNote: null,
      reminderMinutes: 0,
    });
  });

  it('takes the armband reminder in whole minutes, off by default', () => {
    expect(parsePatientInput({ ...valid, reminderMinutes: '45' }).reminderMinutes).toBe(45);
    expect(() => parsePatientInput({ ...valid, reminderMinutes: 500 })).toThrow(/Reminder/);
    expect(() => parsePatientInput({ ...valid, reminderMinutes: -5 })).toThrow(/Reminder/);
  });

  it('rejects a missing name, a bad side, phase, date or email', () => {
    expect(() => parsePatientInput({ ...valid, displayName: ' ' })).toThrow(/name/);
    expect(() => parsePatientInput({ ...valid, affectedSide: 'up' })).toThrow(/side/);
    expect(() => parsePatientInput({ ...valid, currentPhase: 4 })).toThrow(/Phase/);
    expect(() => parsePatientInput({ ...valid, surgeryDate: '10/02/2026' })).toThrow(/date/);
    expect(() => parsePatientInput({ ...valid, surgeryDate: '2026-02-31' })).toThrow(/date/);
    expect(parsePatientInput({ ...valid, surgeryDate: '2028-02-29' }).surgeryDate).toBe('2028-02-29');
    expect(() => parsePatientInput({ ...valid, email: 'ana@' })).toThrow(/email/);
  });
});

describe('phase plans', () => {
  it('accepts a plan and keeps blank limits as "as tolerated"', () => {
    expect(parsePrescriptions([{ exerciseId: 'side_raise', ceilingDeg: '', goalDeg: 140, reps: '10', sets: 2 }])).toEqual([
      { exerciseId: 'side_raise', ceilingDeg: null, goalDeg: 140, reps: 10, sets: 2 },
    ]);
  });

  it('refuses an empty plan, which would silently fall back to the placeholder', () => {
    expect(() => parsePrescriptions([])).toThrow(/at least one/);
  });

  it('refuses unknown or repeated exercises and out-of-range numbers', () => {
    expect(() => parsePrescriptions([{ exerciseId: 'toString', reps: 10, sets: 2 }])).toThrow(/Unknown/);
    const rx = { exerciseId: 'scaption', ceilingDeg: 90, goalDeg: null, reps: 10, sets: 2 };
    expect(() => parsePrescriptions([rx, rx])).toThrow(/twice/);
    expect(() => parsePrescriptions([{ ...rx, ceilingDeg: 900 }])).toThrow(/limit/);
    expect(() => parsePrescriptions([{ ...rx, reps: 0 }])).toThrow(/reps/);
    expect(() => parsePrescriptions([{ ...rx, sets: 1.5 }])).toThrow(/sets/);
  });

  it('takes no limit or goal for shoulder rolls, which are counted rather than measured', () => {
    expect(() => parsePrescriptions([{ exerciseId: 'shoulder_roll', ceilingDeg: 90, reps: 10, sets: 1 }])).toThrow(/no limit or goal/);
    expect(parsePrescriptions([{ exerciseId: 'shoulder_roll', ceilingDeg: null, goalDeg: null, reps: 10, sets: 1 }])).toEqual([
      { exerciseId: 'shoulder_roll', ceilingDeg: null, goalDeg: null, reps: 10, sets: 1 },
    ]);
  });

  it("gives the band the phase's strictest limit, or none", () => {
    expect(phaseLimit(DEFAULT_PROTOCOL[1].prescriptions)).toBe(90);
    expect(phaseLimit([{ exerciseId: 'side_raise', ceilingDeg: 120, goalDeg: null, reps: 10, sets: 2 }, { exerciseId: 'scaption', ceilingDeg: 100, goalDeg: null, reps: 10, sets: 2 }])).toBe(100);
    expect(phaseLimit(DEFAULT_PROTOCOL[2].prescriptions)).toBeNull();
  });

  it('round-trips a phase through the editable rows', () => {
    const protocol = { 1: DEFAULT_PROTOCOL[1].prescriptions, 2: DEFAULT_PROTOCOL[2].prescriptions, 3: DEFAULT_PROTOCOL[3].prescriptions };
    const rows = planRows(protocol, 1);
    expect(rows.find((r) => r.exerciseId === 'forward_raise')?.included).toBe(false);
    expect(includedPrescriptions(rows)).toEqual(expect.arrayContaining(DEFAULT_PROTOCOL[1].prescriptions));
    expect(includedPrescriptions(rows)).toHaveLength(DEFAULT_PROTOCOL[1].prescriptions.length);
  });
});

describe('saved sessions', () => {
  const protocol = { 1: DEFAULT_PROTOCOL[1].prescriptions, 2: DEFAULT_PROTOCOL[2].prescriptions, 3: DEFAULT_PROTOCOL[3].prescriptions };
  const patient = { currentPhase: 1 as const, affectedSide: 'left' as const, surgeryDate: '2026-10-02' };
  const rep = (peakDeg: number): RepResult => ({
    index: 0,
    peakDeg,
    durationMs: 3000,
    source: 'camera',
    overCeiling: false,
    shoulderHike: false,
    trunkLean: false,
    elbowBend: false,
    imuPeakDeg: null,
    endedAt: '2026-10-10T14:00:00Z',
  });
  const set = (over: Partial<SetResult> = {}): SetResult => ({ exerciseId: 'side_raise', side: 'left', kind: 'exercise', setIndex: 0, ceilingDeg: null, repsTarget: 10, reps: [rep(80), rep(100)], pain: 2, ...over });
  const session = (over: Partial<SessionResultJson> = {}): SessionResultJson => ({
    kind: 'exercise',
    phase: 3,
    startedAt: '2026-10-10T14:00:00Z',
    endedAt: '2026-10-10T14:10:00Z',
    sets: [set()],
    symptoms: null,
    ...over,
  });

  it("takes the phase, limit and over-limit marks from the PT's plan, not the app", () => {
    const saved = checkSession(session(), patient, protocol);
    expect(saved.phase).toBe(1);
    expect(saved.sets[0].ceilingDeg).toBe(90);
    expect(saved.sets[0].reps.map((r) => r.overCeiling)).toEqual([false, true]);
  });

  it('rejects an exercise outside the plan, a bad pain score or a mixed-up set', () => {
    expect(() => checkSession(session({ sets: [set({ exerciseId: 'forward_raise' })] }), patient, protocol)).toThrow(/plan/);
    expect(() => checkSession(session({ sets: [set({ pain: 11 })] }), patient, protocol)).toThrow(/Pain/);
    expect(() => checkSession(session({ sets: [set({ kind: 'assessment' })] }), patient, protocol)).toThrow(/kind/);
  });

  it('allows range checks before surgery or on the other arm, never on the surgery side after it', () => {
    const check = (side: 'left' | 'right', startedAt: string) =>
      checkSession(session({ kind: 'assessment', startedAt, sets: [set({ kind: 'assessment', side })] }), patient, protocol);
    expect(check('left', '2026-09-20T14:00:00Z').sets[0].ceilingDeg).toBeNull();
    expect(check('right', '2026-10-10T14:00:00Z').sets[0].reps.every((r) => !r.overCeiling)).toBe(true);
    expect(() => check('left', '2026-10-10T14:00:00Z')).toThrow(/other arm/);
  });
});
