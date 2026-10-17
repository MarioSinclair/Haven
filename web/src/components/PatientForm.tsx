import { useId, useState, type FormEvent } from 'react';
import type { PatientRecord } from '../lib/apiTypes';
import { parsePatientInput, type PatientInput } from '../lib/carePlan';
import { DEFAULT_PROTOCOL } from '../lib/protocol';
import type { AffectedSide, Phase } from '../lib/types';

interface Props {
  /** The patient being edited; omit to add a new one. */
  initial?: PatientRecord;
  submitLabel: string;
  onSubmit: (input: PatientInput) => Promise<void>;
  onCancel?: () => void;
}

const SIDES: { value: AffectedSide; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
];

/** Who the patient is and how they sign in. The phase plan is edited on the care plan screen. */
export function PatientForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState({
    displayName: initial?.displayName ?? '',
    affectedSide: initial?.affectedSide ?? ('left' as AffectedSide),
    surgeryType: initial?.surgeryType ?? '',
    surgeryDate: initial?.surgeryDate ?? '',
    currentPhase: initial?.currentPhase ?? (1 as Phase),
    email: initial?.email ?? '',
    planNote: initial?.planNote ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    let input: PatientInput;
    try {
      input = parsePatientInput(form);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(input);
      if (initial) setMessage('Saved.');
    } catch (err) {
      setMessage(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <label className="field">
        <span>Name</span>
        <input type="text" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} autoComplete="off" required />
      </label>

      <div className="field">
        <span id={`${id}-side`}>Surgery side</span>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-side`}>
          {SIDES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={form.affectedSide === s.value}
              className={form.affectedSide === s.value ? 'selected' : ''}
              onClick={() => set('affectedSide', s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Surgery</span>
        <input type="text" value={form.surgeryType} onChange={(e) => set('surgeryType', e.target.value)} placeholder="e.g. Left mastectomy with sentinel node biopsy" />
      </label>

      <label className="field">
        <span>Surgery date</span>
        <input type="date" value={form.surgeryDate} onChange={(e) => set('surgeryDate', e.target.value)} />
      </label>

      {!initial && (
        <div className="field wide">
          <span id={`${id}-phase`}>Starting phase</span>
          <div className="segmented" role="radiogroup" aria-labelledby={`${id}-phase`}>
            {([1, 2, 3] as Phase[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={form.currentPhase === p}
                className={form.currentPhase === p ? 'selected' : ''}
                onClick={() => set('currentPhase', p)}
              >
                Phase {p}: {DEFAULT_PROTOCOL[p].label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field wide">
        <span>Sign-in email</span>
        <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />
        <small className="fine">The patient signs in with this address and lands on this record. You can add it later.</small>
      </label>

      <label className="field wide">
        <span>Note to the patient</span>
        <textarea rows={3} value={form.planNote} onChange={(e) => set('planNote', e.target.value)} placeholder="Shown before every session." />
      </label>

      <div className="inline wide">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        {message && (
          <p className="fine" role="status">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
