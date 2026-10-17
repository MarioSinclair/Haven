// Shapes that cross the wire between the app and the server.
import type { BaselineRow, Reference, ReferenceSource } from './baseline';
import type { Flag, SessionDay, Severity, UseDay } from './flags';
import type { Prescription } from './protocol';
import type { SessionResult } from './session/engine';
import type { AffectedSide, ExerciseId, Phase, Side } from './types';

/** SessionResult after JSON: dates become ISO strings. */
export type SessionResultJson = Omit<SessionResult, 'startedAt' | 'endedAt'> & { startedAt: string; endedAt: string };

export interface BandTracePoint {
  /** Unix ms. */
  t: number;
  deg: number;
  rate: number;
}

export interface SessionPayload {
  result: SessionResultJson;
  bandTrace: BandTracePoint[];
}

export interface ClinicianReport {
  overview: string;
  flag_notes: { rule: string; note: string }[];
  questions_for_visit: string[];
}

export interface Report {
  id: string;
  periodStart: string;
  periodEnd: string;
  /** The deterministic numbers the model was given; the report template renders these directly. */
  stats: ReportStats;
  patientSummary: string;
  clinician: ClinicianReport;
  model: string;
  unverifiedNumbers: string[];
  createdAt: string;
}

export interface ReportStats {
  patient: { name: string; affected_side: string; surgery: string | null; surgery_date: string | null; days_since_surgery: number | null; phase: number; phase_label: string };
  period: { start: string; end: string; days: number };
  sessions_completed: number;
  exercises: {
    exercise: string;
    side: string;
    reference_deg: number;
    reference: string;
    start_deg: number | null;
    best_deg: number;
    best_day: string;
    latest_deg: number;
    latest_day: string;
    latest_pct_of_reference: number;
    gained_since_start_deg: number | null;
  }[];
  pain: { day: string; max_pain: number }[];
  symptoms_reported: { day: string; arm_heaviness: boolean; armpit_cord: boolean; note: string | null }[];
  daily_use: { day: string; active_min: number; raises_over_90: number }[];
  camera_band_gap_deg: number | null;
  flags: { rule: string; severity: string; title: string; detail: string; evidence: Record<string, number | string | null> }[];
}

export interface PatientRecord {
  id: string;
  displayName: string;
  affectedSide: AffectedSide;
  surgeryType: string | null;
  surgeryDate: string | null;
  currentPhase: Phase;
  /** The address the patient signs in with. */
  email: string | null;
  /** From the PT, shown to the patient before each session. */
  planNote: string | null;
  /** Armband movement reminder in minutes; 0 = off. */
  reminderMinutes: number;
}

export type ProtocolByPhase = Record<Phase, Prescription[]>;

/** Who last saved a phase's plan. */
export interface PlanStamp {
  setBy: string | null;
  updatedAt: string;
}

export interface PatientBundle {
  patient: PatientRecord;
  protocol: ProtocolByPhase;
  baselines: BaselineRow[];
  /** null while a phase still runs the placeholder protocol. */
  planSaved: Record<Phase, PlanStamp | null>;
}

/** One row of the clinician's patient list. */
export interface PatientSummary {
  patient: PatientRecord;
  lastSessionDay: string | null;
  sessionsLast7Days: number;
  flags: Record<Severity, number>;
  /** Latest best on the surgery side for the first exercise in the plan, against its reference. */
  headline: { exerciseId: ExerciseId; side: Side; latestDeg: number; referenceDeg: number; reference: ReferenceSource } | null;
}

export interface Me {
  sub: string;
  email: string | null;
  role: 'patient' | 'clinician';
  patientId: string | null;
}

export interface ExerciseProgress {
  exerciseId: ExerciseId;
  side: Side;
  reference: Reference;
  /** First post-surgery best, for "gained X° since you started". */
  startDeg: number | null;
  days: { day: string; bestPeakDeg: number; reps: number; repsOverCeiling: number; repsWithCompensation: number; cameraBandGapDeg: number | null }[];
}

export interface Progress {
  asOf: string;
  patient: PatientRecord;
  protocol: ProtocolByPhase;
  exercises: ExerciseProgress[];
  sessions: (SessionDay & { notes: string | null })[];
  dailyUse: (UseDay & { maxElevDeg: number })[];
  flags: Flag[];
}

/** The band's raw stream from one session, downsampled for display. */
export interface BandTrace {
  sessionId: string;
  startedAt: string;
  /** Rows stored for this session at 20 Hz. */
  rawSamples: number;
  /** Display rate after downsampling. */
  hz: number;
  points: { s: number; deg: number }[];
}

export interface SystemStats {
  engine: string;
  timescale: boolean;
  tables: {
    name: string;
    rows: number;
    hypertable: boolean;
    chunks: number | null;
    compressedChunks: number | null;
    beforeBytes: number | null;
    afterBytes: number | null;
  }[];
  continuousAggregates: string[];
}

/** Everything the judges page shows, for the simulated demo patient. */
export interface DemoBundle {
  progress: Progress;
  bandTrace: BandTrace | null;
  system: SystemStats;
  report: Report | null;
}
