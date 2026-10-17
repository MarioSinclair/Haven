import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EASE, gsap, pop, reducedMotion, shake, useGSAP } from '../lib/motion';
import type { BandSource } from '../lib/band/band';
import { cameraTruth } from '../lib/band/simTruth';
import { computeMetrics } from '../lib/pose/angles';
import { drawOverlay } from '../lib/pose/overlay';
import { EXERCISES, type SessionPlan } from '../lib/protocol';
import { SessionEngine, type SessionResult } from '../lib/session/engine';
import { MIN_CAMERA_CONFIDENCE } from '../lib/session/fusion';
import type { BandTracePoint } from '../lib/apiTypes';
import type { ImuReading } from '../lib/types';
import type { Coach } from '../lib/voice/coach';
import { usePoseCamera } from '../hooks/usePoseCamera';
import { Gauge } from './Gauge';
import { PainPrompt, RestOverlay, SymptomPrompt } from './Prompts';

const FORM_CHECKS = [
  { key: 'shoulderHike', ok: 'Shoulder relaxed', warn: 'Shoulder hiking' },
  { key: 'trunkLean', ok: 'Body upright', warn: 'Leaning' },
  { key: 'elbowBend', ok: 'Elbow straight', warn: 'Elbow bending' },
] as const;

interface Props {
  plan: SessionPlan;
  band: BandSource | null;
  coach: Coach;
  skeletonOnly: boolean;
  onFinish: (result: SessionResult, bandTrace: BandTracePoint[]) => void;
}

export function SessionScreen({ plan, band, coach, skeletonOnly: initialSkeletonOnly, onFinish }: Props) {
  const engine = useMemo(() => new SessionEngine(plan), [plan]);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imuRef = useRef<ImuReading | null>(null);
  // The band's raw stream for this session, stored as a time series (capped at 30 min of 20 Hz).
  const traceRef = useRef<BandTracePoint[]>([]);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const [skeletonOnly, setSkeletonOnly] = useState(initialSkeletonOnly);
  const stageRef = useRef<HTMLDivElement>(null);
  const repsRef = useRef<HTMLSpanElement>(null);
  const angleRef = useRef<HTMLSpanElement>(null);
  const [voiceOn, setVoiceOn] = useState(coach.enabled);

  useEffect(
    () =>
      engine.onEvent((e) => {
        if (e.type === 'cue') coach.say(e.cue);
        if (e.type === 'rep') pop(repsRef.current);
        if (e.type === 'done') finishRef.current(e.result, traceRef.current);
      }),
    [engine, coach],
  );

  useEffect(() => {
    if (!band) return;
    return band.onSample((s, t) => {
      imuRef.current = { deg: s.elevationDeg, t };
      if (traceRef.current.length < 36_000) traceRef.current.push({ t: Date.now(), deg: s.elevationDeg, rate: s.rateDps });
    });
  }, [band]);

  const camera = usePoseCamera(videoRef, (landmarks, t, w, h) => {
    const side = engine.side;
    const metrics = landmarks ? computeMetrics(landmarks, side, w, h) : null;
    cameraTruth.deg = metrics && metrics.confidence >= MIN_CAMERA_CONFIDENCE ? metrics.elevationDeg : null;
    engine.tick(t, metrics, imuRef.current);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const s = engine.getSnapshot();
    const block = s.block ?? plan.blocks[0];
    drawOverlay(ctx, landmarks, w, h, {
      side,
      view: EXERCISES[block.exerciseId].view,
      ceilingDeg: s.stage === 'active' ? block.ceilingDeg : null,
      state: s.ceilingState,
    });
  });

  useEffect(() => {
    if (snap.ceilingState === 'over') shake(angleRef.current);
  }, [snap.ceilingState]);

  // Prompts slide up as they appear.
  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.from('.modal', { autoAlpha: 0, y: 28, scale: 0.97, duration: 0.55, ease: EASE });
    },
    { scope: stageRef, dependencies: [snap.stage] },
  );

  const block = snap.block ?? plan.blocks[0];
  const exercise = EXERCISES[block.exerciseId];
  const lostCamera = snap.stage === 'active' && snap.angleSource === 'imu';

  const toggleVoice = () => {
    coach.enabled = !voiceOn;
    if (voiceOn) coach.silence();
    setVoiceOn(!voiceOn);
  };

  return (
    <div className="session">
      <div className="stage-area" ref={stageRef}>
        <div className={`camera ${skeletonOnly ? 'skeleton-only' : ''}`}>
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />
        </div>

        {camera.status === 'starting' && <div className="camera-status">Starting camera and pose model…</div>}
        {camera.status === 'error' && (
          <div className="camera-status error">
            Camera unavailable: {camera.error}. Allow camera access in Chrome and reload.
          </div>
        )}

        <div className={`banner ${snap.ceilingState === 'over' && snap.stage === 'active' ? 'banner-alert' : ''}`}>
          {snap.message}
          {snap.stage === 'calibrate' && (
            <div className="progress">
              <div style={{ width: `${snap.progress * 100}%` }} />
            </div>
          )}
        </div>

        {lostCamera && <div className="source-pill">Camera lost your arm, using the band</div>}

        {snap.stage === 'pain' && <PainPrompt onSubmit={(n) => engine.submitPain(n)} />}
        {snap.stage === 'rest' && (
          <RestOverlay
            progress={snap.progress}
            restMs={plan.restMs}
            nextLabel={`${exercise.name}, ${block.side} arm, set ${snap.setIndex + 1} of ${block.sets}`}
            onSkip={() => engine.skipRest()}
          />
        )}
        {snap.stage === 'symptoms' && <SymptomPrompt onSubmit={(s) => engine.submitSymptoms(s)} />}
      </div>

      <aside className="hud">
        <div>
          <p className="eyebrow">
            {plan.kind === 'assessment' ? 'Range check' : `Phase ${plan.phase}`} · exercise {snap.blockIndex + 1} of {plan.blocks.length}
          </p>
          <h1>{exercise.name}</h1>
          <p className="muted">
            {block.side === 'left' ? 'Left' : 'Right'} arm · set {snap.setIndex + 1} of {block.sets}
          </p>
        </div>

        <div className="hud-row">
          <div className="stat">
            <span className="stat-label">Reps</span>
            <span className="stat-value" ref={repsRef}>
              {snap.repsDone}
              <small>/{block.reps}</small>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Arm angle</span>
            <span className={`stat-value angle-${snap.ceilingState}`} ref={angleRef}>
              {snap.angleDeg === null ? '–' : `${Math.round(snap.angleDeg)}°`}
            </span>
            <span className="stat-sub">{snap.angleSource === 'imu' ? 'from band' : snap.angleSource === 'camera' ? 'from camera' : 'not tracking'}</span>
          </div>
        </div>

        <div className="gauge-row">
          <Gauge deg={snap.angleDeg} ceilingDeg={block.ceilingDeg} state={snap.ceilingState} />
          <dl className="facts">
            <dt>Limit</dt>
            <dd>{block.ceilingDeg === null ? 'As tolerated' : `${block.ceilingDeg}°`}</dd>
            <dt>Best this set</dt>
            <dd>{snap.bestThisSet === null ? '–' : `${Math.round(snap.bestThisSet)}°`}</dd>
            <dt>Band</dt>
            <dd>{band ? (snap.imuDeg === null ? band.status : `${Math.round(snap.imuDeg)}°`) : 'not connected'}</dd>
            <dt>Tracking</dt>
            <dd>{Math.round(snap.cameraConfidence * 100)}%</dd>
          </dl>
        </div>

        <ul className="chips" aria-label="Form checks">
          {FORM_CHECKS.map((c) => {
            const off = snap.compensation[c.key];
            return (
              <li key={c.key} className={off ? 'chip-warn' : ''}>
                {off ? c.warn : c.ok}
              </li>
            );
          })}
        </ul>

        <div className="hud-controls">
          <label className="toggle">
            <input type="checkbox" checked={skeletonOnly} onChange={(e) => setSkeletonOnly(e.target.checked)} />
            Hide camera image
          </label>
          <label className="toggle">
            <input type="checkbox" checked={voiceOn} onChange={toggleVoice} />
            Voice coaching
          </label>
          <button className="secondary" onClick={() => engine.stop()}>
            End session
          </button>
        </div>
      </aside>
    </div>
  );
}
