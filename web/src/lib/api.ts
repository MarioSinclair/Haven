// Client for the server in /server. When the server is unreachable the app runs offline:
// sessions still work, they just aren't saved.
import type { BandTracePoint, Me, PatientBundle, Progress, ProtocolByPhase, Report, SessionPayload } from './apiTypes';
import type { DailyRecord } from './band/protocol';
import { DEFAULT_PROTOCOL, type Prescription } from './protocol';
import type { SessionResult } from './session/engine';
import type { AffectedSide, Phase } from './types';

export const DEMO_PATIENT_ID = import.meta.env.VITE_PATIENT_ID || '00000000-0000-4000-8000-000000000001';

/** The patient shown in the app. `id` is null when offline. */
export interface PatientProfile {
  id: string | null;
  displayName: string;
  affectedSide: AffectedSide;
  surgeryType: string | null;
  surgeryDate: string | null;
  currentPhase: Phase;
}

export const OFFLINE_PATIENT: PatientProfile = {
  id: null,
  displayName: 'Demo patient (offline)',
  affectedSide: 'left',
  surgeryType: null,
  surgeryDate: null,
  currentPhase: 1,
};

export const defaultProtocolByPhase = (): ProtocolByPhase => ({
  1: DEFAULT_PROTOCOL[1].prescriptions,
  2: DEFAULT_PROTOCOL[2].prescriptions,
  3: DEFAULT_PROTOCOL[3].prescriptions,
});

let getToken: (() => Promise<string>) | null = null;

/** Set by the Auth0 gate once the user is signed in. */
export function setTokenGetter(fn: (() => Promise<string>) | null) {
  getToken = fn;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (getToken) headers.set('authorization', `Bearer ${await getToken()}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`);
  return body as T;
}

export interface ServerStatus {
  reachable: boolean;
  database: boolean;
  timescale: boolean;
  gemini: boolean;
}

export async function serverStatus(): Promise<ServerStatus> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error();
    const h = await res.json();
    return { reachable: true, database: !!h.database, timescale: !!h.timescale, gemini: !!h.gemini };
  } catch {
    return { reachable: false, database: false, timescale: false, gemini: false };
  }
}

export const getMe = () => call<Me>('/me');

export async function loadPatient(patientId: string): Promise<{ patient: PatientProfile; protocol: ProtocolByPhase }> {
  const bundle = await call<PatientBundle>(`/patients/${patientId}`);
  return { patient: bundle.patient, protocol: bundle.protocol };
}

export async function saveSession(patientId: string, result: SessionResult, bandTrace: BandTracePoint[]) {
  const payload: SessionPayload = {
    result: { ...result, startedAt: result.startedAt.toISOString(), endedAt: result.endedAt.toISOString() },
    bandTrace,
  };
  return call<{ sessionId: string }>(`/patients/${patientId}/sessions`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function uploadDailyUse(patientId: string, records: DailyRecord[]): Promise<number> {
  const body = { records: records.map((r) => ({ ...r, minuteStart: r.minuteStart.toISOString() })) };
  return (await call<{ saved: number }>(`/patients/${patientId}/daily-use`, { method: 'POST', body: JSON.stringify(body) })).saved;
}

export const savePrescriptions = (patientId: string, phase: Phase, prescriptions: Prescription[]) =>
  call<{ saved: number }>(`/patients/${patientId}/prescriptions/${phase}`, { method: 'PUT', body: JSON.stringify({ prescriptions }) });

export const getProgress = (patientId: string) => call<Progress>(`/patients/${patientId}/progress`);

export const latestReport = async (patientId: string) => (await call<{ report: Report | null }>(`/patients/${patientId}/reports/latest`)).report;

export const generateReport = async (patientId: string) => (await call<{ report: Report }>(`/patients/${patientId}/reports`, { method: 'POST' })).report;
