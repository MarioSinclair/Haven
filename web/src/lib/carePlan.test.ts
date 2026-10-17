import { describe, expect, it } from 'vitest';
import { includedPrescriptions, parsePatientInput, parsePrescriptions, phaseLimit, planRows } from './carePlan';
import { DEFAULT_PROTOCOL } from './protocol';

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
