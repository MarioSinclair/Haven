import { useEffect, useRef, useState } from 'react';
import { saveSession, type PatientProfile } from '../lib/api';
import type { BandTracePoint } from '../lib/apiTypes';
import { useReveal } from '../lib/motion';
import { EXERCISES } from '../lib/protocol';
import type { SessionResult, SetResult } from '../lib/session/engine';

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'offline' } | { status: 'error'; message: string };

export function SummaryScreen({ result, trace, patient, onDone }: { result: SessionResult; trace: BandTracePoint[]; patient: PatientProfile; onDone: () => void }) {
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const doSave = async () => {
    if (!patient.id) {
      setSave({ status: 'offline' });
      return;
    }
    setSave({ status: 'saving' });
    try {
      await saveSession(patient.id, result, trace);
      setSave({ status: 'saved' });
    } catch (err) {
      setSave({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  // StrictMode runs effects twice in development; without this guard every session would be saved twice.
  const savedFor = useRef<SessionResult | null>(null);
  useEffect(() => {
    if (savedFor.current === result) return;
    savedFor.current = result;
    void doSave();
  });

  const download = () => {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `session-${result.startedAt.toISOString().slice(0, 16).replace(':', '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const agreement = cameraBandAgreement(result.sets);
  const minutes = Math.max(1, Math.round((result.endedAt.getTime() - result.startedAt.getTime()) / 60000));

  return (
    <div className="setup" ref={root}>
      <header className="setup-header" data-reveal>
        <div>
          <p className="eyebrow">{result.kind === 'assessment' ? 'Range check complete' : 'Session complete'}</p>
          <h1>Nice work</h1>
          <p className="muted">
            {result.sets.reduce((n, s) => n + s.reps.length, 0)} reps in {minutes} min
          </p>
        </div>
        <span className={`badge ${save.status === 'saved' ? 'badge-ok' : save.status === 'error' ? 'badge-warn' : ''}`}>
          {save.status === 'saving' && 'Saving…'}
          {save.status === 'saved' && 'Saved'}
          {save.status === 'offline' && 'Offline: not saved'}
          {save.status === 'error' && 'Save failed'}
        </span>
      </header>
      {save.status === 'error' && (
        <p className="notice">
          {save.message}{' '}
          <button className="link" onClick={doSave}>
            Retry
          </button>
        </p>
      )}

      <section className="card" data-reveal>
        <table className="rx">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Set</th>
              <th>Reps</th>
              <th>Best</th>
              <th>Average</th>
              <th>Past limit</th>
              <th>Form flags</th>
              <th>Pain</th>
            </tr>
          </thead>
          <tbody>
            {result.sets.map((s, i) => (
              <SetRow key={i} set={s} />
            ))}
          </tbody>
        </table>
      </section>

      {(result.symptoms || agreement) && (
        <section className="card" data-reveal>
          {result.symptoms && (
            <p>
              Heaviness or swelling: <strong>{result.symptoms.armHeaviness ? 'yes' : 'no'}</strong> · Cord under the arm:{' '}
              <strong>{result.symptoms.armpitCord ? 'yes' : 'no'}</strong>
              {result.symptoms.note && <> · “{result.symptoms.note}”</>}
            </p>
          )}
          {agreement && (
            <p className="muted">
              Camera and band agreed within {agreement.meanDeg.toFixed(1)}° on average over {agreement.reps} reps.
            </p>
          )}
        </section>
      )}

      <div className="inline" data-reveal>
        <button className="primary" onClick={onDone}>
          Back to start
        </button>
        <button className="secondary" onClick={download}>
          Download data
        </button>
      </div>
    </div>
  );
}

function SetRow({ set }: { set: SetResult }) {
  const peaks = set.reps.map((r) => r.peakDeg);
  const flags = set.reps.filter((r) => r.shoulderHike || r.trunkLean || r.elbowBend).length;
  return (
    <tr>
      <td>
        {EXERCISES[set.exerciseId].name} <span className="muted">({set.side})</span>
      </td>
      <td>{set.setIndex + 1}</td>
      <td>
        {set.reps.length}/{set.repsTarget}
      </td>
      <td>{peaks.length ? `${Math.round(Math.max(...peaks))}°` : '–'}</td>
      <td>{peaks.length ? `${Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length)}°` : '–'}</td>
      <td>{set.ceilingDeg === null ? '–' : set.reps.filter((r) => r.overCeiling).length}</td>
      <td>{flags}</td>
      <td>{set.pain ?? '–'}</td>
    </tr>
  );
}

/** Mean gap between camera and band peaks on reps where both saw the top. Headline number for the hardware pitch. */
function cameraBandAgreement(sets: SetResult[]) {
  const gaps = sets.flatMap((s) => s.reps).filter((r) => r.source === 'camera' && r.imuPeakDeg !== null).map((r) => Math.abs(r.peakDeg - r.imuPeakDeg!));
  if (!gaps.length) return null;
  return { meanDeg: gaps.reduce((a, b) => a + b, 0) / gaps.length, reps: gaps.length };
}
