import { useRef, useState } from 'react';
import { WebBluetoothBand, type BandSource, type BandStatus } from '../lib/band/band';
import { Cmd } from '../lib/band/protocol';
import { savePrescriptions, uploadDailyUse, type PatientProfile } from '../lib/api';
import type { ProtocolByPhase } from '../lib/apiTypes';
import { buildExercisePlan, buildRangeCheckPlan, DEFAULT_PROTOCOL, EXERCISES, type Prescription, type SessionPlan } from '../lib/protocol';
import { useReveal } from '../lib/motion';
import type { ExerciseId, Phase, Side } from '../lib/types';

interface Props {
  patient: PatientProfile;
  protocol: ProtocolByPhase;
  loadError?: string;
  online: boolean;
  isClinician: boolean;
  band: BandSource | null;
  bandStatus: BandStatus;
  onConnectBand: (kind: 'ble' | 'simulated') => Promise<void>;
  onDisconnectBand: () => void;
  onStart: (plan: SessionPlan, opts: { skeletonOnly: boolean; voice: boolean }) => void;
}

type Mode = 'exercise' | 'range';
type Row = Prescription & { included: boolean };

const ALL_EXERCISES = Object.keys(EXERCISES) as ExerciseId[];

function rowsFor(protocol: ProtocolByPhase, phase: Phase): Row[] {
  return ALL_EXERCISES.map((id) => {
    const rx = protocol[phase].find((p) => p.exerciseId === id);
    return rx ? { ...rx, included: true } : { exerciseId: id, ceilingDeg: null, goalDeg: null, reps: 10, sets: 2, included: false };
  });
}

export function SetupScreen({ patient, protocol, loadError, online, isClinician, band, bandStatus, onConnectBand, onDisconnectBand, onStart }: Props) {
  const [phase, setPhase] = useState<Phase>(patient.currentPhase);
  const [rows, setRows] = useState<Row[]>(() => rowsFor(protocol, patient.currentPhase));
  const [mode, setMode] = useState<Mode>('exercise');
  const [rangeSides, setRangeSides] = useState<Side[]>(['left', 'right']);
  const [restSec, setRestSec] = useState(30);
  const [skeletonOnly, setSkeletonOnly] = useState(false);
  const [voice, setVoice] = useState(true);
  const [bandMessage, setBandMessage] = useState<string | null>(null);
  const [rxMessage, setRxMessage] = useState<string | null>(null);

  const included = rows.filter((r) => r.included);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const changePhase = (p: Phase) => {
    setPhase(p);
    setRows(rowsFor(protocol, p));
  };

  const updateRow = (id: ExerciseId, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.exerciseId === id ? { ...r, ...patch } : r)));

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

  const saveRx = async () => {
    setRxMessage('Saving…');
    try {
      const rx = included.map(({ included: _included, ...p }) => p);
      await savePrescriptions(patient.id!, phase, rx);
      setRxMessage(`Saved phase ${phase} for ${patient.displayName}.`);
    } catch (err) {
      setRxMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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
          <p className="eyebrow">Shoulder recovery session</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">
            {patient.affectedSide === 'both' ? 'Both sides' : `${patient.affectedSide === 'left' ? 'Left' : 'Right'} side`}
            {patient.surgeryType ? ` · ${patient.surgeryType}` : ''}
            {patient.surgeryDate ? ` · surgery ${new Date(patient.surgeryDate + 'T00:00').toLocaleDateString()}` : ''}
          </p>
        </div>
        <span className={`badge ${online ? 'badge-ok' : loadError ? 'badge-warn' : ''}`}>{online ? 'Saving to your record' : loadError ? 'Server error' : 'Offline: not saving'}</span>
      </header>
      {loadError && <p className="notice">Could not load the patient record ({loadError}). Using the default protocol.</p>}

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

        {mode === 'exercise' ? (
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
                  <input type="checkbox" checked={rangeSides.includes(side)} onChange={() => toggleSide(side)} />
                  {side === 'left' ? 'Left' : 'Right'} arm
                  {patient.affectedSide === side || patient.affectedSide === 'both' ? ' (surgery side)' : ''}
                </label>
              ))}
            </div>
          </>
        )}

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
            {rows.map((r) => (
              <tr key={r.exerciseId} className={r.included ? '' : 'excluded'}>
                <td>
                  <label className="toggle">
                    <input type="checkbox" checked={r.included} onChange={(e) => updateRow(r.exerciseId, { included: e.target.checked })} />
                    {EXERCISES[r.exerciseId].name}
                  </label>
                </td>
                <td className="muted">{EXERCISES[r.exerciseId].view === 'front' ? 'Facing' : 'Side-on'}</td>
                {mode === 'exercise' && (
                  <>
                    <td>
                      <input
                        type="number"
                        min={30}
                        max={180}
                        placeholder="none"
                        value={r.ceilingDeg ?? ''}
                        onChange={(e) => updateRow(r.exerciseId, { ceilingDeg: e.target.value === '' ? null : Number(e.target.value) })}
                        aria-label={`${EXERCISES[r.exerciseId].name} limit in degrees`}
                      />
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
        <div className="inline">
          <p className="fine">Limits shown are demo placeholders. A patient's real limits come from their surgeon or physical therapist.</p>
          {isClinician && online && mode === 'exercise' && (
            <button className="secondary" onClick={saveRx}>
              Save as phase {phase} plan
            </button>
          )}
        </div>
        {rxMessage && <p className="fine">{rxMessage}</p>}
      </section>

      <section className="card" data-reveal>
        <h2>Armband</h2>
        <p className="muted">
          {bandStatus === 'connected'
            ? `Connected${band?.kind === 'simulated' ? ' (simulated)' : ''}${band?.lastSample?.batteryPct != null ? ` · battery ${band.lastSample.batteryPct}%` : ''}`
            : bandStatus === 'connecting'
              ? 'Connecting…'
              : 'Optional. The band keeps tracking when the camera loses your arm, and logs daily arm use.'}
        </p>
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
              {band?.kind === 'ble' && (
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
