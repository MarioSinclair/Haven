import { useEffect, useRef, useState } from 'react';
import { createPatient, listPatients } from '../lib/api';
import type { PatientRecord, PatientSummary } from '../lib/apiTypes';
import { percentOf } from '../lib/baseline';
import { daysBetween } from '../lib/flags';
import { useReveal } from '../lib/motion';
import { DEFAULT_PROTOCOL, EXERCISES } from '../lib/protocol';
import { shortDay } from './charts';
import { PatientForm } from './PatientForm';

const REFERENCE_NAME = { clinician_goal: 'PT goal', pre_op: 'pre-op', contralateral: 'other arm', general_goal: 'general goal' } as const;

/** "Left side · Left mastectomy · day 19 after surgery" */
export function patientMeta(p: Pick<PatientRecord, 'affectedSide' | 'surgeryType' | 'surgeryDate'>): string {
  const parts = [p.affectedSide === 'both' ? 'Both sides' : `${p.affectedSide === 'left' ? 'Left' : 'Right'} side`];
  if (p.surgeryType) parts.push(p.surgeryType);
  if (p.surgeryDate) {
    const days = daysBetween(p.surgeryDate, new Date().toLocaleDateString('en-CA'));
    parts.push(days >= 0 ? `day ${days} after surgery` : `surgery in ${-days} day${days === -1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/** The clinician's home: every patient, the ones with urgent flags first. */
export function PatientsScreen({ onOpen }: { onOpen: (patientId: string) => void }) {
  const [list, setList] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  useEffect(() => {
    listPatients().then(setList, (err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="setup" ref={root}>
      <header className="setup-header" data-reveal>
        <div>
          <p className="eyebrow">Care team</p>
          <h1>Patients</h1>
          <p className="muted">Open a patient to set their phase, exercises and limits, or to see how they're doing.</p>
        </div>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add patient
          </button>
        )}
      </header>

      {adding && (
        <section className="card">
          <h2>New patient</h2>
          <PatientForm
            submitLabel="Add patient"
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => onOpen((await createPatient(input)).patient.id)}
          />
        </section>
      )}

      {error && <p className="notice">Could not load patients: {error}</p>}
      {!list && !error && <p className="loading">Loading patients…</p>}
      {list && <PatientList list={list} onOpen={onOpen} />}
    </div>
  );
}

function PatientList({ list, onOpen }: { list: PatientSummary[]; onOpen: (patientId: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  if (!list.length) return <p className="card muted">No patients yet. Add your first patient above.</p>;

  const sorted = [...list].sort(
    (a, b) => b.flags.urgent - a.flags.urgent || b.flags.warn - a.flags.warn || a.patient.displayName.localeCompare(b.patient.displayName),
  );

  return (
    <div className="patient-list" ref={root}>
      {sorted.map((s) => (
        <PatientRow key={s.patient.id} summary={s} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PatientRow({ summary, onOpen }: { summary: PatientSummary; onOpen: (patientId: string) => void }) {
  const { patient: p, flags, headline, lastSessionDay, sessionsLast7Days } = summary;
  return (
    <button className="patient-row" data-reveal onClick={() => onOpen(p.id)}>
      <span className="pr-name">
        <strong>{p.displayName}</strong>
        <span className="fine">{patientMeta(p)}</span>
      </span>
      <span className="pr-cell">
        <span className="pr-label">Phase</span>
        <span>Phase {p.currentPhase}</span>
        <span className="fine">{DEFAULT_PROTOCOL[p.currentPhase].label}</span>
      </span>
      <span className="pr-cell">
        <span className="pr-label">Last session</span>
        <span>{lastSessionDay ? shortDay(lastSessionDay) : 'None yet'}</span>
        {sessionsLast7Days > 0 && <span className="fine">{sessionsLast7Days} in the last 7 days</span>}
      </span>
      <span className="pr-cell">
        <span className="pr-label">Range</span>
        <span>{headline ? `${EXERCISES[headline.exerciseId].name} ${Math.round(headline.latestDeg)}°` : '—'}</span>
        {headline && (
          <span className="fine">
            {percentOf(headline.latestDeg, { deg: headline.referenceDeg, source: headline.reference })}% of {REFERENCE_NAME[headline.reference]}
          </span>
        )}
      </span>
      <span className="pr-flags">
        {flags.urgent > 0 && <span className="badge badge-danger">{flags.urgent} urgent</span>}
        {flags.warn > 0 && <span className="badge badge-warn">{flags.warn} to review</span>}
        {!flags.urgent && !flags.warn && <span className="badge badge-ok">No flags</span>}
      </span>
    </button>
  );
}
