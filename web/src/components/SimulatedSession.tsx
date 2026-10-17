import { useEffect, useRef, useState } from 'react';
import { computeMetrics, LM, type RawLandmark } from '../lib/pose/angles';
import type { SessionPlan } from '../lib/protocol';
import type { CeilingState } from '../lib/session/ceiling';
import { SessionEngine, type EngineSnapshot } from '../lib/session/engine';
import { reducedMotion } from '../lib/motion';

// Camera frame the synthetic pose lives in, like a 720p webcam.
const W = 1280;
const H = 720;
const CEILING = 90;

export const PLAN: SessionPlan = {
  kind: 'exercise',
  phase: 1,
  restMs: 5000,
  blocks: [{ exerciseId: 'side_raise', side: 'left', kind: 'exercise', ceilingDeg: CEILING, reps: 5, sets: 1 }],
};

/** True arm angle for each rep; measured against the trunk midline, the camera reads it as is. */
const REPS = [
  { peak: 70, label: 'Rep 1' },
  { peak: 78, label: 'Rep 2' },
  { peak: 92, label: 'Past the limit', over: true },
  { peak: 76, label: 'Shrug caught', shrug: true },
  { peak: 80, label: 'Camera loses the arm', camLost: true },
];
const LEAD = 3.6;
const REP_DUR = 2.8;
const GAP = 0.8;
const TAIL = 3;
export const TOTAL = LEAD + REPS.length * (REP_DUR + GAP) + TAIL;
const REST_ANGLE = 4;

interface Moment {
  theta: number;
  shrug: number;
  camLost: boolean;
  chapter: string;
}

export function scenario(t: number): Moment {
  if (t < LEAD) return { theta: REST_ANGLE, shrug: 0, camLost: false, chapter: t < 1 ? 'Get in position' : 'Calibrating' };
  const k = Math.floor((t - LEAD) / (REP_DUR + GAP));
  if (k >= REPS.length) return { theta: REST_ANGLE, shrug: 0, camLost: false, chapter: 'Set complete' };
  const rep = REPS[k];
  const local = t - LEAD - k * (REP_DUR + GAP);
  const p = Math.min(1, local / REP_DUR);
  const theta = REST_ANGLE + ((rep.peak - REST_ANGLE) * (1 - Math.cos(2 * Math.PI * p))) / 2;
  const high = theta > 42;
  return { theta, shrug: rep.shrug && high ? 1 : 0, camLost: !!rep.camLost && high, chapter: rep.label };
}

/** A front-facing pose in raw camera coordinates (the patient's left is on the image's right). */
export function poseAt(m: Moment): RawLandmark[] {
  const pts: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.95 }));
  const set = (i: number, x: number, y: number, visibility = 0.95) => (pts[i] = { x: x / W, y: y / H, visibility });
  const shoulderL = { x: 0.565 * W, y: (0.4 - 0.045 * m.shrug) * H };
  const shoulderR = { x: 0.435 * W, y: 0.4 * H };
  const a = (m.theta * Math.PI) / 180;
  const elbowL = { x: shoulderL.x + 0.19 * H * Math.sin(a), y: shoulderL.y + 0.19 * H * Math.cos(a) };
  const wristL = { x: elbowL.x + 0.17 * H * Math.sin(a), y: elbowL.y + 0.17 * H * Math.cos(a) };
  const r = (-6 * Math.PI) / 180;
  const elbowR = { x: shoulderR.x + 0.19 * H * Math.sin(r), y: shoulderR.y + 0.19 * H * Math.cos(r) };
  const wristR = { x: elbowR.x + 0.17 * H * Math.sin(r), y: elbowR.y + 0.17 * H * Math.cos(r) };
  set(LM.NOSE, 0.5 * W, 0.29 * H);
  set(LM.LEFT_EAR, 0.535 * W, 0.27 * H);
  set(LM.RIGHT_EAR, 0.465 * W, 0.27 * H);
  set(LM.LEFT_SHOULDER, shoulderL.x, shoulderL.y);
  set(LM.RIGHT_SHOULDER, shoulderR.x, shoulderR.y);
  set(LM.LEFT_ELBOW, elbowL.x, elbowL.y, m.camLost ? 0.1 : 0.95);
  set(LM.LEFT_WRIST, wristL.x, wristL.y, m.camLost ? 0.1 : 0.95);
  set(LM.RIGHT_ELBOW, elbowR.x, elbowR.y);
  set(LM.RIGHT_WRIST, wristR.x, wristR.y);
  set(LM.LEFT_HIP, 0.545 * W, 0.74 * H);
  set(LM.RIGHT_HIP, 0.455 * W, 0.74 * H);
  return pts;
}

function newRun() {
  const r = { engine: new SessionEngine(PLAN), simT: 0, cue: null as string | null, history: [] as View['history'] };
  // The engine speaks through cues; here they become captions. Rep counts are shown elsewhere.
  r.engine.onEvent((e) => {
    if (e.type === 'cue' && e.cue.key !== 'count') r.cue = e.cue.text;
  });
  return r;
}

interface View {
  t: number;
  moment: Moment;
  pose: RawLandmark[];
  snap: EngineSnapshot;
  cue: string | null;
  history: { t: number; cam: number | null; band: number | null }[];
}

/**
 * Plays a scripted set through the real pipeline: synthetic landmarks → computeMetrics →
 * SessionEngine, with a simulated armband alongside. Nothing here is pre-rendered; every
 * count, alert and cue is the engine's own output.
 */
export function SimulatedSession() {
  const [view, setView] = useState<View | null>(null);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const run = useRef<ReturnType<typeof newRun> | null>(null);
  run.current ??= newRun();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const restart = () => {
    run.current = newRun();
  };

  useEffect(() => {
    if (!playing || !visible) {
      if (!view) step(0);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, visible]);

  function step(dt: number) {
    if (run.current!.simT + dt > TOTAL) restart();
    const r = run.current!;
    r.simT += dt;
    const t = r.simT;
    const moment = scenario(t);
    const pose = poseAt(moment);
    const metrics = computeMetrics(pose, 'left', 'front', W, H);
    const bandDeg = moment.theta + 2 + Math.sin(t * 9) * 0.6;
    r.engine.tick(t * 1000, metrics, { deg: bandDeg, t: t * 1000 });
    const snap = r.engine.getSnapshot();
    r.history.push({ t, cam: metrics && metrics.confidence >= 0.6 ? metrics.elevationDeg : null, band: snap.imuDeg });
    r.history = r.history.filter((p) => p.t > t - 12);
    setView({ t, moment, pose, snap, cue: r.cue, history: r.history });
  }

  const snap = view?.snap;
  const chapterIndex = view ? Math.max(0, Math.min(REPS.length + 1, view.t < LEAD ? 0 : Math.floor((view.t - LEAD) / (REP_DUR + GAP)) + 1)) : 0;
  const chapters = ['Calibrate', ...REPS.map((r) => r.label), 'Done'];

  return (
    <div className="sim" ref={box}>
      <div className="sim-stage">
        <span className="sim-tag">SIMULATED · REAL ENGINE</span>
        {view && <Figure pose={view.pose} state={snap?.stage === 'active' ? snap.ceilingState : 'ok'} camLost={view.moment.camLost} showLimit={snap?.stage === 'active'} />}
        <div className={`sim-banner ${snap?.ceilingState === 'over' && snap.stage === 'active' ? 'over' : ''}`}>{snap?.message ?? 'Starting…'}</div>
      </div>

      <div className="sim-hud">
        <div className="sim-stats">
          <div>
            <span className="kpi-label">Reps</span>
            <span className="kpi-value">
              {snap?.repsDone ?? 0}
              <small>/5</small>
            </span>
          </div>
          <div>
            <span className="kpi-label">Arm angle</span>
            <span className={`kpi-value angle-${snap?.ceilingState ?? 'ok'}`}>{snap?.angleDeg === null || !snap ? '–' : `${Math.round(snap.angleDeg)}°`}</span>
            <span className={`src src-${snap?.angleSource ?? 'none'}`}>{snap?.angleSource === 'imu' ? 'FROM BAND' : snap?.angleSource === 'camera' ? 'FROM CAMERA' : '—'}</span>
          </div>
          <div>
            <span className="kpi-label">Limit</span>
            <span className="kpi-value">
              {CEILING}
              <small>°</small>
            </span>
          </div>
        </div>

        <ul className="chips" aria-label="Form checks">
          <li className={snap?.compensation.shoulderHike ? 'chip-warn' : ''}>{snap?.compensation.shoulderHike ? 'Shoulder hiking' : 'Shoulder relaxed'}</li>
          <li className={snap?.compensation.trunkLean ? 'chip-warn' : ''}>{snap?.compensation.trunkLean ? 'Leaning' : 'Body upright'}</li>
          <li className={snap?.compensation.elbowBend ? 'chip-warn' : ''}>{snap?.compensation.elbowBend ? 'Elbow bending' : 'Elbow straight'}</li>
        </ul>

        <div className="sim-cue" aria-live="polite">
          <span className="kpi-label">Voice coach says</span>
          <p>{view?.cue ? `“${view.cue}”` : '…'}</p>
        </div>

        {view && <DualTrace history={view.history} now={view.t} />}
      </div>

      <div className="sim-timeline">
        <button className="secondary" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="secondary" onClick={() => { restart(); setPlaying(true); }}>
          Restart
        </button>
        <ol className="sim-chapters">
          {chapters.map((c, i) => (
            <li key={c} className={i === chapterIndex ? 'now' : i < chapterIndex ? 'done' : ''}>
              {c}
            </li>
          ))}
        </ol>
        <div className="sim-progress">
          <div style={{ width: `${((view?.t ?? 0) / TOTAL) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

const ARM_COLOR: Record<CeilingState, string> = { ok: '#d6336c', near: '#e09a00', over: '#d03b3b' };

/** The pose, mirrored like the app's camera view, with the limit ray. */
function Figure({ pose, state, camLost, showLimit }: { pose: RawLandmark[]; state: CeilingState; camLost: boolean; showLimit: boolean }) {
  const p = (i: number) => ({ x: (1 - pose[i].x) * W, y: pose[i].y * H });
  const line = (a: number, b: number, cls: string) => <line className={cls} x1={p(a).x} y1={p(a).y} x2={p(b).x} y2={p(b).y} />;
  const sL = p(LM.LEFT_SHOULDER);
  const hipL = p(LM.LEFT_HIP);
  // Limit ray: trunk-down rotated by the ceiling toward the arm's side (left on screen after mirroring).
  const down = { x: hipL.x - sL.x, y: hipL.y - sL.y };
  const len = Math.hypot(down.x, down.y);
  const ang = (CEILING * Math.PI) / 180;
  const d = { x: down.x / len, y: down.y / len };
  const ray = { x: d.x * Math.cos(ang) - d.y * Math.sin(ang), y: d.x * Math.sin(ang) + d.y * Math.cos(ang) };
  const nose = p(LM.NOSE);

  return (
    <svg className="sim-figure" viewBox={`${W * 0.1} ${H * 0.06} ${W * 0.8} ${H * 1.02}`} aria-label="Simulated patient doing a side raise">
      {showLimit && (
        <g className="sim-limit">
          <line x1={sL.x} y1={sL.y} x2={sL.x + ray.x * 0.42 * H} y2={sL.y + ray.y * 0.42 * H} />
          <text x={sL.x + ray.x * 0.42 * H - 6} y={sL.y + ray.y * 0.42 * H - 10} textAnchor="end">
            {CEILING}° limit
          </text>
        </g>
      )}
      <circle className="sim-head" cx={nose.x} cy={nose.y - 0.02 * H} r={0.065 * H} />
      {line(LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, 'sim-bone')}
      {line(LM.LEFT_SHOULDER, LM.LEFT_HIP, 'sim-bone')}
      {line(LM.RIGHT_SHOULDER, LM.RIGHT_HIP, 'sim-bone')}
      {line(LM.LEFT_HIP, LM.RIGHT_HIP, 'sim-bone')}
      <line className="sim-bone" x1={p(LM.LEFT_HIP).x} y1={p(LM.LEFT_HIP).y} x2={p(LM.LEFT_HIP).x - 0.01 * W} y2={1.04 * H} />
      <line className="sim-bone" x1={p(LM.RIGHT_HIP).x} y1={p(LM.RIGHT_HIP).y} x2={p(LM.RIGHT_HIP).x + 0.01 * W} y2={1.04 * H} />
      {line(LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, 'sim-bone')}
      {line(LM.RIGHT_ELBOW, LM.RIGHT_WRIST, 'sim-bone')}
      <g className={camLost ? 'sim-arm lost' : 'sim-arm'} style={{ stroke: camLost ? undefined : ARM_COLOR[state] }}>
        {line(LM.LEFT_SHOULDER, LM.LEFT_ELBOW, '')}
        {line(LM.LEFT_ELBOW, LM.LEFT_WRIST, '')}
      </g>
      {[LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST, LM.LEFT_HIP, LM.RIGHT_HIP].map((i) => (
        <circle key={i} className="sim-joint" cx={p(i).x} cy={p(i).y} r={7} opacity={camLost && (i === LM.LEFT_ELBOW || i === LM.LEFT_WRIST) ? 0.25 : 1} />
      ))}
      {camLost && (
        <text className="sim-lost" x={p(LM.LEFT_WRIST).x} y={p(LM.LEFT_WRIST).y + 34} textAnchor="middle">
          camera lost the arm
        </text>
      )}
    </svg>
  );
}

/** Last 12 seconds of the camera's angle and the band's, on one axis. */
function DualTrace({ history, now }: { history: View['history']; now: number }) {
  const w = 320;
  const h = 96;
  const x = (t: number) => ((t - (now - 12)) / 12) * w;
  const y = (deg: number) => h - 6 - (Math.min(deg, 120) / 120) * (h - 12);
  const path = (key: 'cam' | 'band') => {
    let d = '';
    let pen = false;
    for (const p of history) {
      const v = p[key];
      if (v === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  return (
    <figure className="sim-trace">
      <figcaption>
        <span className="kpi-label">Last 12 s</span>
        <span className="legend">
          <span>
            <i style={{ background: '#d6336c' }} />
            Camera
          </span>
          <span>
            <i style={{ background: '#2a78d6' }} />
            Band
          </span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={0} x2={w} y1={y(CEILING)} y2={y(CEILING)} className="sim-trace-limit" />
        {/* Camera underneath and wide, band on top and thin: where they agree you see both. */}
        <path d={path('cam')} stroke="#d6336c" className="cam" />
        <path d={path('band')} stroke="#2a78d6" className="band" />
      </svg>
    </figure>
  );
}
