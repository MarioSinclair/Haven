import { useEffect, useRef, useState } from 'react';
import type { Symptoms } from '../lib/session/engine';
import { listenForPain, voiceInputSupported } from '../lib/voice/painVoice';

export function PainPrompt({ onSubmit }: { onSubmit: (rating: number) => void }) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const listen = () => {
    setHint(null);
    setListening(true);
    stop.current = listenForPain(
      (n) => {
        setListening(false);
        onSubmit(n);
      },
      (reason) => {
        setListening(false);
        setHint(reason);
      },
    );
  };

  return (
    <div className="modal" role="dialog" aria-labelledby="pain-title">
      <h2 id="pain-title">How much pain did you feel during that set?</h2>
      <div className="pain-grid">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} className={`pain-btn pain-${n <= 3 ? 'low' : n <= 6 ? 'mid' : 'high'}`} onClick={() => onSubmit(n)}>
            {n}
          </button>
        ))}
      </div>
      <div className="pain-scale">
        <span>No pain</span>
        <span>Worst imaginable</span>
      </div>
      {voiceInputSupported() && (
        <button className="secondary" onClick={listen} disabled={listening}>
          {listening ? 'Listening…' : 'Answer by voice'}
        </button>
      )}
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

export function SymptomPrompt({ onSubmit }: { onSubmit: (s: Symptoms) => void }) {
  const [armHeaviness, setHeaviness] = useState<boolean | null>(null);
  const [armpitCord, setCord] = useState<boolean | null>(null);
  const [note, setNote] = useState('');

  return (
    <div className="modal" role="dialog" aria-labelledby="symptom-title">
      <h2 id="symptom-title">One last check</h2>
      <YesNo label="Does your arm, hand or chest feel heavy, tight or swollen?" value={armHeaviness} onChange={setHeaviness} />
      <YesNo label="Do you feel a tight, cord-like pull under your arm or down the inside of your arm?" value={armpitCord} onChange={setCord} />
      <label className="field">
        <span>Anything else for your care team? (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </label>
      <button
        className="primary"
        disabled={armHeaviness === null || armpitCord === null}
        onClick={() => onSubmit({ armHeaviness: !!armHeaviness, armpitCord: !!armpitCord, note: note.trim() })}
      >
        Finish session
      </button>
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="yesno">
      <legend>{label}</legend>
      <button className={value === true ? 'selected' : ''} onClick={() => onChange(true)}>
        Yes
      </button>
      <button className={value === false ? 'selected' : ''} onClick={() => onChange(false)}>
        No
      </button>
    </fieldset>
  );
}

export function RestOverlay({ progress, restMs, nextLabel, onSkip }: { progress: number; restMs: number; nextLabel: string; onSkip: () => void }) {
  const remaining = Math.max(0, Math.ceil(((1 - progress) * restMs) / 1000));
  return (
    <div className="modal rest" role="status">
      <p className="muted">Rest</p>
      <p className="rest-count">{remaining}s</p>
      <p>Next: {nextLabel}</p>
      <button className="secondary" onClick={onSkip}>
        I'm ready
      </button>
    </div>
  );
}
