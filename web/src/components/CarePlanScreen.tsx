import { useRef, useState } from 'react';
import { DEMO_PATIENT_ID, deletePatient, loadPatient, savePrescriptions, updatePatient } from '../lib/api';
import type { PatientBundle, PatientRecord } from '../lib/apiTypes';
import { includedPrescriptions, LIMIT_RANGE, parsePatientInput, type PatientInput, parsePrescriptions, phaseLimit, planRows, REMINDER_RANGE, REPS_RANGE, SETS_RANGE, toPatientInput, type PlanRow } from '../lib/carePlan';
import { useReveal } from '../lib/motion';
import { DEFAULT_PROTOCOL, EXERCISES, type Prescription } from '../lib/protocol';
import type { ExerciseId, Phase } from '../lib/types';
import { PatientForm } from './PatientForm';
import { patientMeta } from './PatientsScreen';

interface Props {
  bundle: PatientBundle;
  onChange: (bundle: PatientBundle) => void;
  onBack: () => void;
  onProgress: () => void;
  onDeleted: () => void;
}

/** Where the PT decides what a patient does: their phase, and each phase's exercises and limits. */
export function CarePlanScreen({ bundle, onChange, onBack, onProgress, onDeleted }: Props) {
  const { patient } = bundle;
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  return (
    <div className="setup" ref={root}>
      <button className="link back" onClick={onBack}>
        ← All patients
      </button>
      <header className="setup-header" data-reveal>
        <div>
          <p className="eyebrow">Care plan</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">{patientMeta(patient)}</p>
        </div>
        <button className="primary" onClick={onProgress}>
          View progress
        </button>
      </header>

      <PhaseCard bundle={bundle} onChange={onChange} />
      <PlanCard bundle={bundle} onChange={onChange} />
      <BandCard bundle={bundle} onChange={onChange} />

      <section className="card" data-reveal>
        <h2>Patient details</h2>
        {/* Phase and reminder come from the saved record, so changes above are never undone here. */}
        <PatientForm
          initial={patient}
          submitLabel="Save details"
          onSubmit={async (input) =>
            onChange(await updatePatient(patient.id, { ...input, currentPhase: bundle.patient.currentPhase, reminderMinutes: bundle.patient.reminderMinutes }))
          }
        />
      </section>

      {/* The judges page and unlinked sign-ins rely on the demo patient; the server refuses it too. */}
      {patient.id !== DEMO_PATIENT_ID && <DeleteCard patient={patient} onDeleted={onDeleted} />}
    </div>
  );
}

function DeleteCard({ patient, onDeleted }: { patient: PatientRecord; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const remove = async () => {
    if (!window.confirm(`Delete ${patient.displayName} and all their sessions? This can't be undone.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deletePatient(patient.id);
      onDeleted();
    } catch (err) {
      setMessage(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  };

  return (
    <section className="card" data-reveal>
      <h2>Delete patient</h2>
      <p className="muted">
        Permanently removes {patient.displayName}'s record with every session, rep, armband reading, flag and report. If they sign in again, they'll see the demo
        patient.
      </p>
      <div className="inline">
        <button className="danger" disabled={busy} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete patient'}
        </button>
        {message && (
          <p className="fine" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

function PhaseCard({ bundle, onChange }: { bundle: PatientBundle; onChange: (b: PatientBundle) => void }) {
  const { patient } = bundle;
  const [phase, setPhase] = useState<Phase>(patient.currentPhase);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const move = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onChange(await updatePatient(patient.id, { ...toPatientInput(patient), currentPhase: phase }));
      setMessage(`Moved to phase ${phase}. The next session uses that plan.`);
    } catch (err) {
      setMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" data-reveal>
      <h2>Current phase</h2>
      <p className="muted">The patient's sessions use this phase's exercises and limits. They can't change it themselves.</p>
      <div className="segmented" role="radiogroup" aria-label="Current phase">
        {([1, 2, 3] as Phase[]).map((p) => (
          <button key={p} role="radio" aria-checked={phase === p} className={phase === p ? 'selected' : ''} onClick={() => setPhase(p)}>
            Phase {p}: {DEFAULT_PROTOCOL[p].label}
            {p === patient.currentPhase && <span className="fine"> (current)</span>}
          </button>
        ))}
      </div>
      {phase !== patient.currentPhase && (
        <div className="inline">
          <button className="primary" disabled={busy} onClick={move}>
            {busy ? 'Saving…' : `Move to phase ${phase}`}
          </button>
          <button className="link" onClick={() => setPhase(patient.currentPhase)}>
            Keep phase {patient.currentPhase}
          </button>
        </div>
      )}
      {message && (
        <p className="fine" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function PlanCard({ bundle, onChange }: { bundle: PatientBundle; onChange: (b: PatientBundle) => void }) {
  const { patient, protocol, planSaved } = bundle;
  const [phase, setPhase] = useState<Phase>(patient.currentPhase);
  const [rows, setRows] = useState<PlanRow[]>(() => planRows(protocol, patient.currentPhase));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const changePhase = (p: Phase) => {
    if (dirty && !window.confirm(`Discard your changes to the phase ${phase} plan?`)) return;
    setPhase(p);
    setRows(planRows(protocol, p));
    setDirty(false);
    setMessage(null);
  };

  const updateRow = (id: ExerciseId, patch: Partial<PlanRow>) => {
    setRows((rs) => rs.map((r) => (r.exerciseId === id ? { ...r, ...patch } : r)));
    setDirty(true);
    setMessage(null);
  };

  const save = async () => {
    setMessage(null);
    let rx: Prescription[];
    try {
      rx = parsePrescriptions(includedPrescriptions(rows));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      await savePrescriptions(patient.id, phase, rx);
      onChange(await loadPatient(patient.id));
      setDirty(false);
      setMessage(`Saved the phase ${phase} plan.`);
    } catch (err) {
      setMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const stamp = planSaved[phase];
  const num = (v: string) => (v === '' ? null : Number(v));

  return (
    <section className="card" data-reveal>
      <h2>Exercise plan</h2>
      <div className="segmented" role="radiogroup" aria-label="Phase to edit">
        {([1, 2, 3] as Phase[]).map((p) => (
          <button key={p} role="radio" aria-checked={phase === p} className={phase === p ? 'selected' : ''} onClick={() => changePhase(p)}>
            Phase {p}
            {!planSaved[p] && (
              <>
                <span className="dot-warn" aria-hidden />
                <span className="sr-only"> (not reviewed)</span>
              </>
            )}
          </button>
        ))}
      </div>

      {stamp ? (
        <p className="fine">
          Set by {stamp.setBy ?? 'a clinician'} on {new Date(stamp.updatedAt).toLocaleDateString()}.
        </p>
      ) : (
        <p className="notice">This phase still uses the placeholder plan. Check the limits and save it before the patient reaches this phase.</p>
      )}

      <div className="table-scroll">
        <table className="rx">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Limit°</th>
              <th>Goal°</th>
              <th>Reps</th>
              <th>Sets</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = EXERCISES[r.exerciseId].name;
              return (
                <tr key={r.exerciseId} className={r.included ? '' : 'excluded'}>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={r.included} onChange={(e) => updateRow(r.exerciseId, { included: e.target.checked })} />
                      {name}
                    </label>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={LIMIT_RANGE.min}
                      max={LIMIT_RANGE.max}
                      placeholder="none"
                      value={r.ceilingDeg ?? ''}
                      onChange={(e) => updateRow(r.exerciseId, { ceilingDeg: num(e.target.value) })}
                      aria-label={`${name} limit in degrees`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={LIMIT_RANGE.min}
                      max={LIMIT_RANGE.max}
                      placeholder="auto"
                      value={r.goalDeg ?? ''}
                      onChange={(e) => updateRow(r.exerciseId, { goalDeg: num(e.target.value) })}
                      aria-label={`${name} goal in degrees`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={REPS_RANGE.min}
                      max={REPS_RANGE.max}
                      value={r.reps}
                      onChange={(e) => updateRow(r.exerciseId, { reps: Number(e.target.value) })}
                      aria-label={`${name} reps`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={SETS_RANGE.min}
                      max={SETS_RANGE.max}
                      value={r.sets}
                      onChange={(e) => updateRow(r.exerciseId, { sets: Number(e.target.value) })}
                      aria-label={`${name} sets`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fine">
        <strong>Limit:</strong> the coach warns as the arm nears it and beeps past it, and reps over it are flagged to you. Blank means as tolerated.{' '}
        <strong>Goal:</strong> blank measures against the pre-op range, then the other arm, then a general goal.
      </p>
      <div className="inline">
        <button className="primary" disabled={busy || (!dirty && !!stamp)} onClick={save}>
          {busy ? 'Saving…' : `Save phase ${phase} plan`}
        </button>
        {message && (
          <p className="fine" role="status">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

/** What the patient's armband enforces on its own, between sessions. */
function BandCard({ bundle, onChange }: { bundle: PatientBundle; onChange: (b: PatientBundle) => void }) {
  const { patient, protocol } = bundle;
  const limit = phaseLimit(protocol[patient.currentPhase]);
  const [minutes, setMinutes] = useState(String(patient.reminderMinutes));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setMessage(null);
    let input: PatientInput;
    try {
      input = parsePatientInput({ ...toPatientInput(patient), reminderMinutes: minutes });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      onChange(await updatePatient(patient.id, input));
      setMessage(input.reminderMinutes ? `Saved. The band reminds after ${input.reminderMinutes} minutes.` : 'Saved. The reminder is off.');
    } catch (err) {
      setMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" data-reveal>
      <h2>Armband</h2>
      <p className="muted">The patient's band gets these whenever it connects, and keeps them when it's switched off.</p>
      <p>
        Warns at <strong>{limit === null ? 'no limit' : `${limit}°`}</strong>
        <span className="fine">
          {' '}
          · {limit === null ? 'every exercise in this phase is as tolerated' : `the lowest limit in phase ${patient.currentPhase}`}. It beeps faster from 10° below
          and alarms above it, all day. Change it in the exercise plan.
        </span>
      </p>
      <div className="inline">
        <label className="toggle">
          Remind after
          <input
            type="number"
            min={REMINDER_RANGE.min}
            max={REMINDER_RANGE.max}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setMessage(null);
            }}
            aria-label="Reminder minutes"
          />
          minutes without raising the arm above 60°
        </label>
        <button className="primary" disabled={busy || Number(minutes) === patient.reminderMinutes} onClick={save}>
          {busy ? 'Saving…' : 'Save reminder'}
        </button>
      </div>
      <p className="fine">0 turns the reminder off.</p>
      {message && (
        <p className="fine" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
