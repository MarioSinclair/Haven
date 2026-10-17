// What a clinician sets for a patient: their details and the exercise plan for each phase.
// Shared so the form and the server reject the same things with the same words.
import type { PatientRecord, ProtocolByPhase, SessionResultJson } from './apiTypes';
import { baselineSourceFor } from './baseline';
import { EXERCISES, measuresRange, type Prescription } from './protocol';
import type { AffectedSide, ExerciseId, Phase } from './types';

export interface PatientInput {
  displayName: string;
  affectedSide: AffectedSide;
  surgeryType: string | null;
  surgeryDate: string | null;
  currentPhase: Phase;
  /** The address the patient signs in with; their login lands on this record. */
  email: string | null;
  /** From the PT, shown to the patient before each session. */
  planNote: string | null;
  /** The armband chirps after this many minutes without the arm going above 60°; 0 = off. */
  reminderMinutes: number;
}

/**
 * The one limit the armband warns at between sessions: the strictest in the phase, or null
 * when every exercise is as tolerated.
 */
export function phaseLimit(prescriptions: Prescription[]): number | null {
  const limits = prescriptions.map((p) => p.ceilingDeg).filter((d): d is number => d !== null);
  return limits.length ? Math.min(...limits) : null;
}

/** Every exercise as an editable row, ticked when it's in this phase's plan. */
export type PlanRow = Prescription & { included: boolean };

export function planRows(protocol: ProtocolByPhase, phase: Phase): PlanRow[] {
  return (Object.keys(EXERCISES) as ExerciseId[]).map((id) => {
    const rx = protocol[phase].find((p) => p.exerciseId === id);
    return rx ? { ...rx, included: true } : { exerciseId: id, ceilingDeg: null, goalDeg: null, reps: 10, sets: 2, included: false };
  });
}

export const includedPrescriptions = (rows: PlanRow[]): Prescription[] => rows.filter((r) => r.included).map(({ included: _included, ...p }) => p);

export function toPatientInput(p: PatientRecord): PatientInput {
  return {
    displayName: p.displayName,
    affectedSide: p.affectedSide,
    surgeryType: p.surgeryType,
    surgeryDate: p.surgeryDate,
    currentPhase: p.currentPhase,
    email: p.email,
    planNote: p.planNote,
    reminderMinutes: p.reminderMinutes,
  };
}

/** Limits outside this range are almost certainly typos. */
export const LIMIT_RANGE = { min: 30, max: 180 } as const;
export const REPS_RANGE = { min: 1, max: 30 } as const;
export const SETS_RANGE = { min: 1, max: 5 } as const;
export const REMINDER_RANGE = { min: 0, max: 240 } as const;

export function parsePatientInput(body: unknown): PatientInput {
  const b = (body ?? {}) as Record<string, unknown>;

  const displayName = text(b.displayName, 'Name', 80);
  if (!displayName) throw new Error('Enter the patient’s name.');

  const affectedSide = b.affectedSide;
  if (affectedSide !== 'left' && affectedSide !== 'right' && affectedSide !== 'both') throw new Error('Choose the surgery side.');

  const surgeryDate = text(b.surgeryDate, 'Surgery date', 10);
  if (surgeryDate && !isCalendarDate(surgeryDate)) throw new Error('Surgery date must be a date.');

  const currentPhase = Number(b.currentPhase);
  if (currentPhase !== 1 && currentPhase !== 2 && currentPhase !== 3) throw new Error('Phase must be 1, 2 or 3.');

  const email = text(b.email, 'Email', 254)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address doesn’t look right.');

  return {
    displayName,
    affectedSide,
    surgeryType: text(b.surgeryType, 'Surgery', 200),
    surgeryDate,
    currentPhase,
    email,
    planNote: text(b.planNote, 'Note', 1000),
    reminderMinutes: optionalInt(b.reminderMinutes, 'Reminder', REMINDER_RANGE) ?? 0,
  };
}

/**
 * A phase plan must name at least one exercise: an empty plan would fall back to the
 * placeholder protocol, which the PT never chose.
 */
export function parsePrescriptions(body: unknown): Prescription[] {
  if (!Array.isArray(body) || body.length === 0) throw new Error('Choose at least one exercise for this phase.');
  const seen = new Set<ExerciseId>();
  return body.map((raw: Record<string, unknown>) => {
    const exerciseId = raw?.exerciseId as ExerciseId;
    if (!Object.hasOwn(EXERCISES, exerciseId)) throw new Error(`Unknown exercise ${String(exerciseId)}.`);
    if (seen.has(exerciseId)) throw new Error(`${EXERCISES[exerciseId].name} is listed twice.`);
    seen.add(exerciseId);
    const name = EXERCISES[exerciseId].name;
    const ceilingDeg = optionalInt(raw.ceilingDeg, `${name} limit`, LIMIT_RANGE);
    const goalDeg = optionalInt(raw.goalDeg, `${name} goal`, LIMIT_RANGE);
    // Only raises measure range; a limit on anything else would never be checked.
    if (!measuresRange(exerciseId) && (ceilingDeg !== null || goalDeg !== null)) throw new Error(`${name} doesn't measure range, so it has no limit or goal.`);
    return {
      exerciseId,
      ceilingDeg,
      goalDeg,
      reps: requiredInt(raw.reps, `${name} reps`, REPS_RANGE),
      sets: requiredInt(raw.sets, `${name} sets`, SETS_RANGE),
    };
  });
}

/**
 * A finished session as the server stores it. The phase, each set's limit and every over-limit
 * mark come from the PT's plan, not from the app, so an edited request can't hide a limit break.
 * Throws when the session doesn't fit the plan.
 */
export function checkSession(
  result: SessionResultJson,
  patient: Pick<PatientRecord, 'currentPhase' | 'affectedSide' | 'surgeryDate'>,
  protocol: ProtocolByPhase,
): SessionResultJson {
  if (result.kind !== 'exercise' && result.kind !== 'assessment') throw new Error('Unknown session kind.');
  const phase = patient.currentPhase;
  const surgery = patient.surgeryDate ? new Date(`${patient.surgeryDate}T00:00:00`) : null;
  const sets = result.sets.map((s) => {
    if (!Object.hasOwn(EXERCISES, s.exerciseId)) throw new Error(`Unknown exercise ${String(s.exerciseId)}.`);
    const name = EXERCISES[s.exerciseId].name;
    if (s.side !== 'left' && s.side !== 'right') throw new Error(`${name} needs a side.`);
    if (s.kind !== result.kind) throw new Error(`${name} doesn't match the session kind.`);
    let ceilingDeg: number | null = null;
    if (s.kind === 'assessment' && !measuresRange(s.exerciseId)) throw new Error(`${name} isn't a range check exercise.`);
    if (s.kind === 'exercise') {
      const rx = protocol[phase].find((p) => p.exerciseId === s.exerciseId);
      if (!rx) throw new Error(`${name} isn't in the phase ${phase} plan.`);
      ceilingDeg = rx.ceilingDeg;
    } else if (baselineSourceFor(new Date(result.startedAt), surgery, s.side, patient.affectedSide) === 'first_session') {
      // A range check has no limit, so after surgery it's for the other arm only.
      throw new Error('After surgery, range checks are for the other arm only.');
    }
    if (s.pain !== null && !(Number.isInteger(s.pain) && s.pain >= 0 && s.pain <= 10)) throw new Error('Pain must be a whole number from 0 to 10.');
    const reps = s.reps.map((r) => {
      if (!Number.isFinite(r.peakDeg)) throw new Error(`${name} has a rep with no peak angle.`);
      return { ...r, overCeiling: ceilingDeg !== null && r.peakDeg > ceilingDeg };
    });
    return { ...s, ceilingDeg, reps };
  });
  return { ...result, phase, sets };
}

/** Date.parse rolls 2026-02-31 over to March 3, so a real date must survive the round trip. */
function isCalendarDate(s: string): boolean {
  const t = Date.parse(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function text(v: unknown, label: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Error(`${label} must be text.`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${label} is too long (${max} characters at most).`);
  return t || null;
}

function optionalInt(v: unknown, label: string, range: { min: number; max: number }): number | null {
  if (v === null || v === undefined || v === '') return null;
  return requiredInt(v, label, range);
}

function requiredInt(v: unknown, label: string, { min, max }: { min: number; max: number }): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}
