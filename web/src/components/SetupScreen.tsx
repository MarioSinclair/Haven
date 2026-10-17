import { useEffect, useRef, useState } from 'react';
import { WebBluetoothBand, type BandSource, type BandStatus } from '../lib/band/band';
import { Cmd, type BandSample } from '../lib/band/protocol';
import { uploadDailyUse, type PatientProfile } from '../lib/api';
import type { ProtocolByPhase } from '../lib/apiTypes';
import { phaseLimit, planRows, type PlanRow } from '../lib/carePlan';
import { daysBetween } from '../lib/flags';
import { affectedSides, buildExercisePlan, buildRangeCheckPlan, DEFAULT_PROTOCOL, EXERCISES, measuresRange, type SessionPlan } from '../lib/protocol';
import { useReveal } from '../lib/motion';
import { ExerciseDemo } from './ExerciseDemo';
import type { ExerciseId, Phase, Side } from '../lib/types';

interface Props {
  patient: PatientProfile;
  protocol: ProtocolByPhase;
  loadError?: string;
  online: boolean;
  /** A patient signed in: the PT's phase and limits are shown, not edited. */
  planLocked: boolean;
  band: BandSource | null;
  bandStatus: BandStatus;
  onConnectBand: (kind: 'ble' | 'simulated') => Promise<void>;
  onDisconnectBand: () => void;
  onStart: (plan: SessionPlan, opts: { skeletonOnly: boolean; voice: boolean }) => void;
  /** Opens the patient's progress. */
  onProgress?: () => void;
}

type Mode = 'exercise' | 'range';

export function SetupScreen({ patient, protocol, loadError, online, planLocked, band, bandStatus, onConnectBand, onDisconnectBand, onStart, onProgress }: Props) {
  // After surgery a patient range-checks only the healthy arm: a check has no limit, so on the
  // surgery side it would sidestep the PT's.
  const postOp = !!patient.surgeryDate && daysBetween(patient.surgeryDate, new Date().toLocaleDateString('en-CA')) >= 0;
  const blockedSides: Side[] = planLocked && postOp ? affectedSides(patient.affectedSide) : [];

  const [phase, setPhase] = useState<Phase>(patient.currentPhase);
  const [rows, setRows] = useState<PlanRow[]>(() => planRows(protocol, patient.currentPhase));
  const [mode, setMode] = useState<Mode>('exercise');
  const [rangeSides, setRangeSides] = useState<Side[]>(() => (['left', 'right'] as Side[]).filter((s) => !blockedSides.includes(s)));
  const [restSec, setRestSec] = useState(30);
  const [skeletonOnly, setSkeletonOnly] = useState(false);
  const [voice, setVoice] = useState(true);
  const [bandMessage, setBandMessage] = useState<string | null>(null);

  // A range check measures the highest comfortable raise, so it only uses exercises that measure range.
  const included = rows.filter((r) => r.included && (mode === 'exercise' || measuresRange(r.exerciseId)));
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const changePhase = (p: Phase) => {
    setPhase(p);
    setRows(planRows(protocol, p));
  };

  const updateRow = (id: ExerciseId, patch: Partial<PlanRow>) => setRows((rs) => rs.map((r) => (r.exerciseId === id ? { ...r, ...patch } : r)));

  const toggleSide = (side: Side) => setRangeSides((s) => (s.includes(side) ? s.filter((x) => x !== side) : [...s, side]));

  const bandAction = async (label: string, fn: () => Promise<string | void>) => {
    setBandMessage(`${label}…`);
    try {
      setBandMessage((await fn()) || `${label}: done`);
    } catch (err) {
      setBandMessage(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const syncDaily = () =>
    bandAction('Syncing daily use', async () => {
      const records = await band!.dumpDaily();
      if (!patient.id) return `Got ${records.length} minutes of daily use (not saved: offline)`;
      const n = await uploadDailyUse(patient.id, records);
      return `Saved ${n} minutes of daily use`;
    });

  const canStart = included.length > 0 && (mode === 'exercise' || rangeSides.length > 0);

  const start = () => {
    const plan =
      mode === 'exercise'
        ? buildExercisePlan(phase, patient.affectedSide, included, restSec * 1000)
        : buildRangeCheckPlan(phase, rangeSides, included.map((r) => r.exerciseId));
    onStart(plan, { skeletonOnly, voice });
  };

  return (
    <div className="setup" ref={root}>
      <header className="setup-header" data-reveal>
        <div>
          <p className="eyebrow">Your rehab session</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">
            {patient.affectedSide === 'both' ? 'Both sides' : `${patient.affectedSide === 'left' ? 'Left' : 'Right'} side`}
            {patient.surgeryType ? ` · ${patient.surgeryType}` : ''}
            {patient.surgeryDate ? ` · surgery ${new Date(patient.surgeryDate + 'T00:00').toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="inline">
          <span className={`badge ${online ? 'badge-ok' : loadError ? 'badge-warn' : ''}`}>{online ? 'Saving to your record' : loadError ? 'Server error' : 'Offline: not saving'}</span>
          {onProgress && (
            <button className="secondary" onClick={onProgress}>
              Your progress
            </button>
          )}
        </div>
      </header>
      {loadError && <p className="notice">Could not load the patient record ({loadError}). Using the default protocol.</p>}

      {patient.planNote && (
        <section className="card pt-note" data-reveal>
          <h2>From your physical therapist</h2>
          <p>{patient.planNote}</p>
        </section>
      )}

      <section className="card" data-reveal>
        <h2>Session</h2>
        <div className="segmented" role="radiogroup" aria-label="Session type">
          <button role="radio" aria-checked={mode === 'exercise'} className={mode === 'exercise' ? 'selected' : ''} onClick={() => setMode('exercise')}>
            Exercises
          </button>
          <button role="radio" aria-checked={mode === 'range'} className={mode === 'range' ? 'selected' : ''} onClick={() => setMode('range')}>
            Range check
          </button>
        </div>

        {mode === 'exercise' && planLocked ? (
          <p className="muted">
            Phase {phase}: {DEFAULT_PROTOCOL[phase].label}. Your physical therapist sets your phase and limits.
          </p>
        ) : mode === 'exercise' ? (
          <div className="segmented" role="radiogroup" aria-label="Recovery phase">
            {([1, 2, 3] as Phase[]).map((p) => (
              <button key={p} role="radio" aria-checked={phase === p} className={phase === p ? 'selected' : ''} onClick={() => changePhase(p)}>
                Phase {p}: {DEFAULT_PROTOCOL[p].label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="muted">
              Measures the best comfortable range with no limit. Before surgery, check both arms. After surgery, check the healthy arm. Progress is measured against these.
            </p>
            <div className="inline">
              {(['left', 'right'] as Side[]).map((side) => (
                <label key={side} className="toggle">
                  <input type="checkbox" checked={rangeSides.includes(side)} disabled={blockedSides.includes(side)} onChange={() => toggleSide(side)} />
                  {side === 'left' ? 'Left' : 'Right'} arm
                  {patient.affectedSide === side || patient.affectedSide === 'both' ? ' (surgery side)' : ''}
                </label>
              ))}
            </div>
            {blockedSides.length > 0 && <p className="fine">Your physical therapist checks the range on your surgery side after the operation.</p>}
          </>
        )}

        <div className="table-scroll">
          <table className="rx">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Camera</th>
                {mode === 'exercise' && (
                  <>
                    <th>Limit°</th>
                    <th>Reps</th>
                    <th>Sets</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(planLocked ? included : rows.filter((r) => mode === 'exercise' || measuresRange(r.exerciseId))).map((r) => (
                <tr key={r.exerciseId} className={r.included ? '' : 'excluded'}>
                  <td>
                    <span className="demo-cell">
                      <ExerciseDemo exerciseId={r.exerciseId} side={affectedSides(patient.affectedSide)[0]} limitDeg={mode === 'exercise' ? r.ceilingDeg : null} size={56} />
                      {planLocked ? (
                        EXERCISES[r.exerciseId].name
                      ) : (
                        <label className="toggle">
                          <input type="checkbox" checked={r.included} onChange={(e) => updateRow(r.exerciseId, { included: e.target.checked })} />
                          {EXERCISES[r.exerciseId].name}
                        </label>
                      )}
                    </span>
                  </td>
                  <td className="muted">{EXERCISES[r.exerciseId].view === 'front' ? 'Facing' : 'Side-on'}</td>
                  {mode === 'exercise' && planLocked && (
                    <>
                      <td>{!measuresRange(r.exerciseId) ? '—' : r.ceilingDeg === null ? 'None' : `${r.ceilingDeg}°`}</td>
                      <td>{r.reps}</td>
                      <td>{r.sets}</td>
                    </>
                  )}
                  {mode === 'exercise' && !planLocked && (
                    <>
                      <td>
                        {measuresRange(r.exerciseId) ? (
                          <input
                            type="number"
                            min={30}
                            max={180}
                            placeholder="none"
                            value={r.ceilingDeg ?? ''}
                            onChange={(e) => updateRow(r.exerciseId, { ceilingDeg: e.target.value === '' ? null : Number(e.target.value) })}
                            aria-label={`${EXERCISES[r.exerciseId].name} limit in degrees`}
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <input type="number" min={1} max={30} value={r.reps} onChange={(e) => updateRow(r.exerciseId, { reps: Math.max(1, Number(e.target.value)) })} aria-label="Reps" />
                      </td>
                      <td>
                        <input type="number" min={1} max={5} value={r.sets} onChange={(e) => updateRow(r.exerciseId, { sets: Math.max(1, Number(e.target.value)) })} aria-label="Sets" />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">
          {planLocked
            ? 'Set by your physical therapist. Ask them before doing more than this.'
            : "Limits shown are demo placeholders. A patient's real limits come from their surgeon or physical therapist."}
        </p>
      </section>

      <section className="card" data-reveal>
        <h2>Armband</h2>
        <p className="muted">
          {bandStatus === 'connected'
            ? `Connected${band?.kind === 'simulated' ? ' (simulated)' : ''}${band?.lastSample?.batteryPct != null ? ` · battery ${band.lastSample.batteryPct}%` : ''}`
            : bandStatus === 'connecting'
              ? 'Connecting…'
              : 'Optional. The band keeps tracking when the camera loses your arm, and can warn you near your limit between sessions.'}
        </p>
        {bandStatus === 'connected' && band && <BandReadout band={band} limitDeg={online ? phaseLimit(protocol[patient.currentPhase]) : undefined} />}
        <div className="inline">
          {bandStatus !== 'connected' ? (
            <>
              <button className="secondary" disabled={!WebBluetoothBand.supported || bandStatus === 'connecting'} onClick={() => bandAction('Connecting', () => onConnectBand('ble'))}>
                Connect band
              </button>
              <button className="secondary" onClick={() => bandAction('Starting simulator', () => onConnectBand('simulated'))}>
                Simulate band
              </button>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => bandAction('Zeroing', async () => band!.send(Cmd.ZERO))}>
                Zero (arm hanging)
              </button>
              {band?.hasDailyLog && (
                <button className="secondary" onClick={syncDaily}>
                  Sync daily use
                </button>
              )}
              <button className="secondary" onClick={onDisconnectBand}>
                Disconnect
              </button>
            </>
          )}
        </div>
        {!WebBluetoothBand.supported && <p className="fine">Web Bluetooth needs Chrome or Edge on desktop.</p>}
        {bandMessage && <p className="fine">{bandMessage}</p>}
      </section>

      <section className="card" data-reveal>
        <h2>Comfort</h2>
        <div className="inline">
          <label className="toggle">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
            Voice coaching
          </label>
          <label className="toggle">
            <input type="checkbox" checked={skeletonOnly} onChange={(e) => setSkeletonOnly(e.target.checked)} />
            Hide camera image (show outline only)
          </label>
          {mode === 'exercise' && (
            <label className="toggle">
              Rest
              <input type="number" min={5} max={120} value={restSec} onChange={(e) => setRestSec(Math.max(5, Number(e.target.value)))} aria-label="Rest seconds" />
              seconds
            </label>
          )}
        </div>
        <p className="fine">Video stays on this computer. Only angles and counts are saved.</p>
      </section>

      <button className="primary start" data-reveal disabled={!canStart} onClick={start}>
        Start {mode === 'exercise' ? 'session' : 'range check'}
      </button>
    </div>
  );
}

/**
 * The band's live angle, so you can see it working before a session, and the limit it reports
 * back, so the PT's limit is confirmed by the band itself. Redraws about 10 times a second.
 * `limitDeg` is the limit the app sent: null for none, undefined when it sent nothing.
 */
function BandReadout({ band, limitDeg }: { band: BandSource; limitDeg: number | null | undefined }) {
  const [sample, setSample] = useState<BandSample | null>(band.lastSample);
  useEffect(() => {
    let shownAt = 0;
    return band.onSample((s, t) => {
      if (t - shownAt < 100) return;
      shownAt = t;
      setSample(s);
    });
  }, [band]);

  if (!sample) return <p className="fine">Waiting for the band…</p>;
  // Older firmware has no buzzer and reports no limit.
  const hasLimit = sample.limitDeg !== undefined;
  const confirmed = hasLimit && (limitDeg === undefined || sample.limitDeg === limitDeg);
  return (
    <div className="band-readout">
      <strong>{Math.round(sample.elevationDeg)}°</strong>
      <div className="band-status">
        <span className="fine">{sample.calibrated ? 'Arm angle from the band' : 'Not zeroed yet: let your arm hang relaxed, then press Zero.'}</span>
        {hasLimit && (
          <span className={sample.overLimit ? 'band-over' : 'fine'}>
            {sample.overLimit
              ? `Above your ${sample.limitDeg}° limit: lower your arm.`
              : !confirmed
                ? `Sending your ${limitDeg === null ? 'settings' : `${limitDeg}° limit`} to the band…`
                : sample.limitDeg === null
                  ? 'No limit on the band.'
                  : `The band warns at ${sample.limitDeg}°${limitDeg !== undefined ? ', set by your physical therapist' : ''}${sample.calibrated ? '.' : ', once zeroed.'}`}
          </span>
        )}
      </div>
      {hasLimit && band.kind === 'ble' && (
        <button className="secondary" onClick={() => void band.beep().catch(() => undefined)}>
          Test beep
        </button>
      )}
    </div>
  );
}
