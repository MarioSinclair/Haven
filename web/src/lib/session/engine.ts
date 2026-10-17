import { viewMatches } from '../pose/angles';
import { OneEuroFilter } from '../pose/oneEuro';
import { EXERCISES, type Block, type SessionKind, type SessionPlan } from '../protocol';
import type { AngleSource, CompensationFlags, ExerciseId, ImuReading, Phase, PoseMetrics, Side } from '../types';
import { CeilingMonitor, type CeilingState } from './ceiling';
import { Debounce, fuseAngle, MIN_CAMERA_CONFIDENCE, type FusedAngle } from './fusion';
import { RepCounter } from './repCounter';

export type StageName = 'position' | 'calibrate' | 'active' | 'pain' | 'rest' | 'symptoms' | 'done';

export interface Cue {
  /** Cues with the same key share a cooldown. */
  key: string;
  text: string;
  interrupt?: boolean;
  beep?: boolean;
  cooldownMs?: number;
}

export interface RepResult {
  index: number;
  peakDeg: number;
  durationMs: number;
  /** Whichever source supplied most of the rep's frames. */
  source: AngleSource;
  overCeiling: boolean;
  shoulderHike: boolean;
  trunkLean: boolean;
  elbowBend: boolean;
  /** The band's peak mapped into the camera's frame, so it compares directly with peakDeg. */
  imuPeakDeg: number | null;
  /** Wall-clock time the rep finished, ISO 8601. */
  endedAt: string;
}

export interface SetResult {
  exerciseId: ExerciseId;
  side: Side;
  kind: SessionKind;
  setIndex: number;
  /** The limit in force during this set, kept so later protocol changes don't rewrite history. */
  ceilingDeg: number | null;
  repsTarget: number;
  reps: RepResult[];
  pain: number | null;
}

export interface Symptoms {
  /** Possible early lymphedema sign. */
  armHeaviness: boolean;
  /** Possible axillary web syndrome (cording). */
  armpitCord: boolean;
  note: string;
}

export interface SessionResult {
  kind: SessionKind;
  phase: Phase;
  startedAt: Date;
  endedAt: Date;
  sets: SetResult[];
  symptoms: Symptoms | null;
}

export type EngineEvent =
  | { type: 'cue'; cue: Cue }
  | { type: 'rep'; rep: RepResult }
  | { type: 'stage'; stage: StageName }
  | { type: 'done'; result: SessionResult };

export interface EngineSnapshot {
  stage: StageName;
  block: Block | null;
  blockIndex: number;
  setIndex: number;
  repsDone: number;
  angleDeg: number | null;
  angleSource: AngleSource | null;
  imuDeg: number | null;
  cameraConfidence: number;
  ceilingState: CeilingState;
  compensation: CompensationFlags;
  bestThisSet: number | null;
  /** 0–1 progress through calibration or rest. */
  progress: number;
  message: string;
}

interface RestPose {
  cameraDeg: number;
  imuDeg: number | null;
  earLift: number;
  trunkLeanDeg: number;
}

interface RepAccumulator {
  cameraFrames: number;
  imuFrames: number;
  hike: boolean;
  lean: boolean;
  elbow: boolean;
  imuPeak: number | null;
  /** The arm went out of sight mid-rep, or came back already raised, so its true top is unknown. */
  unseen: boolean;
}

const POSITION_HOLD_MS = 800;
const CALIBRATE_MS = 1500;
const CALIBRATE_MAX_STD_DEG = 4;
const REST_POSE_MAX_DEG = 35;
const IMU_FRESH_MS = 300;
const LOST_CUE_AFTER_MS = 1000;
/** Shorter tracking dropouts during a rep are a dropped frame or two, not a missed top. */
const UNSEEN_GAP_MS = 200;
const UNCOUNTED_NOTICE_MS = 2500;
const UNCOUNTED_MESSAGE = "Lost sight of your arm, so that one didn't count. Try stepping back a little.";
// Compensation thresholds. Tune these against real recordings before the demo.
const COMP_MIN_RISE_DEG = 30;
const HIKE_EAR_GAP_DROP = 0.25;
const LEAN_DEG = 10;
const ELBOW_MIN_DEG = 145;

const NO_COMPENSATION: CompensationFlags = { shoulderHike: false, trunkLean: false, elbowBend: false };

export class SessionEngine {
  private stage: StageName = 'position';
  private started = false;
  private blockIndex = 0;
  private setIndex = 0;
  private nextIsNewBlock = false;
  private lastT = 0;
  private positionOkSince: number | null = null;
  private calibStart = 0;
  private calibSamples: { metrics: PoseMetrics; imu: number | null }[] = [];
  private rest: RestPose | null = null;
  private filter = new OneEuroFilter();
  private reps: RepCounter | null = null;
  private ceiling: CeilingMonitor | null = null;
  private hike = new Debounce(200, 400);
  private lean = new Debounce(250, 400);
  private elbow = new Debounce(250, 400);
  private acc: RepAccumulator = freshAccumulator();
  private currentSet: SetResult | null = null;
  private results: SetResult[] = [];
  private symptoms: Symptoms | null = null;
  private restUntil = 0;
  private lostSince: number | null = null;
  private uncountedUntil = 0;
  private lastCam: PoseMetrics | null = null;
  private lastCamDeg: number | null = null;
  private lastImu: ImuReading | null = null;
  private lastFused: FusedAngle | null = null;
  private message = '';
  private readonly startedAt: Date;
  private endedAt: Date | null = null;
  private snap: EngineSnapshot;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: EngineEvent) => void>();

  constructor(
    readonly plan: SessionPlan,
    private clock: () => Date = () => new Date(),
  ) {
    if (plan.blocks.length === 0) throw new Error('Session plan has no exercises');
    this.startedAt = clock();
    this.snap = this.buildSnapshot();
  }

  // Arrow properties so React's useSyncExternalStore gets stable references.
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  onEvent(fn: (e: EngineEvent) => void) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  get block(): Block | null {
    return this.plan.blocks[this.blockIndex] ?? null;
  }

  /** The arm being measured right now, so the camera loop knows which landmarks to read. */
  get side(): Side {
    return (this.block ?? this.plan.blocks[0]).side;
  }

  get result(): SessionResult {
    return {
      kind: this.plan.kind,
      phase: this.plan.phase,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? this.clock(),
      sets: this.results,
      symptoms: this.symptoms,
    };
  }

  /** Feed one camera frame (null when no pose was found) plus the latest band reading. */
  tick(t: number, cam: PoseMetrics | null, imu: ImuReading | null) {
    this.lastT = t;
    this.lastCam = cam;
    this.lastImu = imu;
    this.lastCamDeg = cam ? this.filter.filter(cam.elevationDeg, t) : null;
    if (!this.started) {
      this.started = true;
      this.enterPosition();
    }

    switch (this.stage) {
      case 'position':
        this.tickPosition(t, cam);
        break;
      case 'calibrate':
        this.tickCalibrate(t, cam, imu);
        break;
      case 'active':
        this.tickActive(t, cam, imu);
        break;
      case 'rest':
        if (t >= this.restUntil) this.afterRest();
        break;
      default:
        break;
    }
    this.publish();
  }

  submitPain(rating: number) {
    if (this.stage !== 'pain') return;
    this.results[this.results.length - 1].pain = Math.max(0, Math.min(10, Math.round(rating)));
    this.advance();
    this.publish();
  }

  skipRest() {
    if (this.stage !== 'rest') return;
    this.afterRest();
    this.publish();
  }

  submitSymptoms(symptoms: Symptoms) {
    if (this.stage !== 'symptoms') return;
    this.symptoms = symptoms;
    this.finish();
    this.publish();
  }

  /** End now, keeping any reps already done in the current set. */
  stop() {
    if (this.stage === 'done') return;
    if (this.currentSet && this.currentSet.reps.length > 0) this.results.push(this.currentSet);
    this.currentSet = null;
    this.finish();
    this.publish();
  }

  // ---- stages ----

  private enterPosition() {
    const block = this.block!;
    const ex = EXERCISES[block.exerciseId];
    this.setStage('position');
    this.positionOkSince = null;
    const lead = this.blockIndex === 0 ? "Let's begin." : 'Next exercise.';
    this.cue({ key: 'position', text: `${lead} ${ex.name}, ${block.side} arm. ${ex.instruction}`, interrupt: true });
  }

  private positionReady(cam: PoseMetrics | null): cam is PoseMetrics {
    const view = EXERCISES[this.block!.exerciseId].view;
    return !!cam && cam.confidence >= MIN_CAMERA_CONFIDENCE && viewMatches(view, cam.facingRatio) && cam.elevationDeg < REST_POSE_MAX_DEG;
  }

  private tickPosition(t: number, cam: PoseMetrics | null) {
    if (!this.positionReady(cam)) {
      this.positionOkSince = null;
      this.message = this.positionHint(cam);
      return;
    }
    this.positionOkSince ??= t;
    this.message = 'Hold still…';
    if (t - this.positionOkSince >= POSITION_HOLD_MS) this.enterCalibrate(t);
  }

  private positionHint(cam: PoseMetrics | null): string {
    const block = this.block!;
    if (!cam || cam.confidence < MIN_CAMERA_CONFIDENCE) return 'Step back until your head, arms and hips are in view.';
    if (!viewMatches(EXERCISES[block.exerciseId].view, cam.facingRatio)) {
      return EXERCISES[block.exerciseId].view === 'front' ? 'Face the camera square on.' : `Turn so your ${block.side} side faces the camera.`;
    }
    return 'Let your arms relax at your sides.';
  }

  private enterCalibrate(t: number) {
    this.setStage('calibrate');
    this.calibStart = t;
    this.calibSamples = [];
    this.message = 'Stand tall, arms relaxed. Hold still…';
    this.cue({ key: 'calibrate', text: 'Stand tall with your arms relaxed. Hold still.' });
  }

  private tickCalibrate(t: number, cam: PoseMetrics | null, imu: ImuReading | null) {
    if (!this.positionReady(cam)) {
      this.setStage('position');
      this.positionOkSince = null;
      this.message = this.positionHint(cam);
      return;
    }
    this.calibSamples.push({ metrics: cam, imu: imu && t - imu.t <= IMU_FRESH_MS ? imu.deg : null });
    if (t - this.calibStart < CALIBRATE_MS) return;

    const elevations = this.calibSamples.map((s) => s.metrics.elevationDeg);
    if (stdDev(elevations) > CALIBRATE_MAX_STD_DEG) {
      this.calibStart = t;
      this.calibSamples = [];
      this.cue({ key: 'calibrate-still', text: 'Try to hold still.', cooldownMs: 3000 });
      return;
    }
    const imuValues = this.calibSamples.map((s) => s.imu).filter((v): v is number => v !== null);
    this.rest = {
      cameraDeg: mean(elevations),
      imuDeg: imuValues.length >= this.calibSamples.length / 2 ? mean(imuValues) : null,
      earLift: mean(this.calibSamples.map((s) => s.metrics.earLift)),
      trunkLeanDeg: mean(this.calibSamples.map((s) => s.metrics.trunkLeanDeg)),
    };
    this.startSet();
  }

  private startSet() {
    const block = this.block!;
    this.reps = new RepCounter({ restDeg: this.rest!.cameraDeg });
    this.ceiling = new CeilingMonitor(block.ceilingDeg);
    this.hike.reset();
    this.lean.reset();
    this.elbow.reset();
    this.lostSince = null;
    this.currentSet = {
      exerciseId: block.exerciseId,
      side: block.side,
      kind: block.kind,
      setIndex: this.setIndex,
      ceilingDeg: block.ceilingDeg,
      repsTarget: block.reps,
      reps: [],
      pain: null,
    };
    this.setStage('active');

    let text: string;
    if (block.kind === 'assessment') text = `Raise your arm as high as is comfortable, ${block.reps} times.`;
    else if (this.setIndex === 0) text = `Go ahead. ${block.reps} reps.`;
    else text = `Set ${this.setIndex + 1} of ${block.sets}. Go ahead.`;
    if (block.ceilingDeg !== null && this.setIndex === 0) text += ` Your limit today is ${block.ceilingDeg} degrees.`;
    this.cue({ key: 'start', text, interrupt: true });
  }

  private tickActive(t: number, cam: PoseMetrics | null, imu: ImuReading | null) {
    const rest = this.rest!;
    const reps = this.reps!;
    const ceiling = this.ceiling!;
    const camInput = cam && this.lastCamDeg !== null ? { deg: this.lastCamDeg, confidence: cam.confidence } : null;
    const fused = fuseAngle(t, camInput, imu, rest);
    this.lastFused = fused;

    if (!fused) {
      this.lostSince ??= t;
      this.message = "Can't see your arm. Step back or improve the lighting.";
      if (t - this.lostSince > LOST_CUE_AFTER_MS) {
        this.cue({ key: 'lost', text: "I can't see your arm. Try stepping back a little.", cooldownMs: 8000 });
      }
      return;
    }
    const gapMs = this.lostSince === null ? 0 : t - this.lostSince;
    this.lostSince = null;

    const wasUp = reps.isUp;
    const rep = reps.update(fused.deg, t);
    if (!wasUp && reps.isUp) this.acc = freshAccumulator();
    if (gapMs > UNSEEN_GAP_MS && (wasUp || reps.isUp)) this.acc.unseen = true;

    const state = ceiling.update(fused.deg);
    if (state === 'near') this.cue({ key: 'near', text: 'Nearly at your limit.', cooldownMs: 5000 });
    if (state === 'over') this.cue({ key: 'over', text: "That's past your limit for now. Lower slowly.", interrupt: true, beep: true, cooldownMs: 3000 });

    const comp = this.updateCompensation(t, cam, fused);

    if (reps.isUp || rep) {
      if (fused.source === 'camera') this.acc.cameraFrames += 1;
      else this.acc.imuFrames += 1;
      this.acc.hike ||= comp.shoulderHike;
      this.acc.lean ||= comp.trunkLean;
      this.acc.elbow ||= comp.elbowBend;
      const imuMapped = this.mappedImu(t, imu);
      if (imuMapped !== null) this.acc.imuPeak = Math.max(this.acc.imuPeak ?? -Infinity, imuMapped);
    }

    // A rep whose top went unseen can't be checked against the limit, so it isn't counted or saved.
    if (rep && this.acc.unseen) {
      this.uncountedUntil = t + UNCOUNTED_NOTICE_MS;
      this.cue({ key: 'uncounted', text: UNCOUNTED_MESSAGE, interrupt: true, cooldownMs: 4000 });
    }
    this.message =
      ceiling.state === 'over' ? 'Past your limit. Lower slowly.' : t < this.uncountedUntil ? UNCOUNTED_MESSAGE : EXERCISES[this.block!.exerciseId].instruction;
    if (rep && !this.acc.unseen) this.completeRep(rep.peakDeg, rep.endT - rep.startT);
  }

  private updateCompensation(t: number, cam: PoseMetrics | null, fused: FusedAngle): CompensationFlags {
    const rest = this.rest!;
    const watch = !!cam && fused.source === 'camera' && fused.deg > rest.cameraDeg + COMP_MIN_RISE_DEG;
    const before = { shoulderHike: this.hike.active, trunkLean: this.lean.active, elbowBend: this.elbow.active };
    const now: CompensationFlags = {
      shoulderHike: this.hike.update(watch && cam!.earLift < rest.earLift * (1 - HIKE_EAR_GAP_DROP), t),
      trunkLean: this.lean.update(watch && Math.abs(cam!.trunkLeanDeg - rest.trunkLeanDeg) > LEAN_DEG, t),
      elbowBend: this.elbow.update(watch && cam!.elbowDeg < ELBOW_MIN_DEG, t),
    };
    if (now.shoulderHike && !before.shoulderHike) this.cue({ key: 'hike', text: 'Relax your shoulder down, away from your ear.', cooldownMs: 6000 });
    if (now.trunkLean && !before.trunkLean) this.cue({ key: 'lean', text: 'Keep your body upright.', cooldownMs: 6000 });
    if (now.elbowBend && !before.elbowBend) this.cue({ key: 'elbow', text: 'Keep your elbow straight.', cooldownMs: 6000 });
    return now;
  }

  private completeRep(peakDeg: number, durationMs: number) {
    const set = this.currentSet!;
    const acc = this.acc;
    const result: RepResult = {
      index: set.reps.length + 1,
      peakDeg: round1(peakDeg),
      durationMs: Math.round(durationMs),
      source: acc.imuFrames > acc.cameraFrames ? 'imu' : 'camera',
      overCeiling: set.ceilingDeg !== null && peakDeg > set.ceilingDeg,
      shoulderHike: acc.hike,
      trunkLean: acc.lean,
      elbowBend: acc.elbow,
      imuPeakDeg: acc.imuPeak === null ? null : round1(acc.imuPeak),
      endedAt: this.clock().toISOString(),
    };
    set.reps.push(result);
    this.emit({ type: 'rep', rep: result });

    if (set.reps.length >= set.repsTarget) this.finishSet();
    else this.cue({ key: 'count', text: String(set.reps.length), interrupt: true });
  }

  private finishSet() {
    this.results.push(this.currentSet!);
    this.currentSet = null;
    if (this.block!.kind === 'assessment') {
      this.cue({ key: 'set-done', text: 'Got it.', interrupt: true });
      this.advance();
      return;
    }
    this.setStage('pain');
    this.message = 'How much pain did you feel during that set?';
    this.cue({ key: 'set-done', text: 'Set complete. How much pain did you feel, from zero to ten?', interrupt: true });
  }

  private advance() {
    const block = this.block!;
    if (this.setIndex + 1 < block.sets) {
      this.setIndex += 1;
      this.enterRest(false);
    } else if (this.blockIndex + 1 < this.plan.blocks.length) {
      this.blockIndex += 1;
      this.setIndex = 0;
      this.enterRest(true);
    } else if (this.plan.kind === 'exercise') {
      this.setStage('symptoms');
      this.message = 'One last check before you finish.';
      this.cue({ key: 'symptoms', text: 'Last question. Have you noticed any heaviness or swelling in your arm, or a tight cord under your arm?' });
    } else {
      this.finish();
    }
  }

  private enterRest(newBlock: boolean) {
    this.nextIsNewBlock = newBlock;
    this.restUntil = this.lastT + this.plan.restMs;
    this.setStage('rest');
    this.message = 'Rest. Let your arm hang loose.';
    this.cue({ key: 'rest', text: `Rest for ${Math.round(this.plan.restMs / 1000)} seconds.` });
  }

  private afterRest() {
    if (this.nextIsNewBlock) this.enterPosition();
    else this.startSet();
  }

  private finish() {
    this.endedAt = this.clock();
    this.setStage('done');
    this.message = 'Session complete.';
    this.cue({ key: 'done', text: 'Great work. Session complete.', interrupt: true });
    this.emit({ type: 'done', result: this.result });
  }

  // ---- plumbing ----

  private mappedImu(t: number, imu: ImuReading | null): number | null {
    if (!imu || t - imu.t > IMU_FRESH_MS || !this.rest || this.rest.imuDeg === null) return null;
    return this.rest.cameraDeg + (imu.deg - this.rest.imuDeg);
  }

  private setStage(stage: StageName) {
    if (this.stage === stage) return;
    this.stage = stage;
    this.emit({ type: 'stage', stage });
  }

  private cue(cue: Cue) {
    this.emit({ type: 'cue', cue });
  }

  private emit(e: EngineEvent) {
    for (const fn of this.eventListeners) fn(e);
  }

  private publish() {
    this.snap = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  private buildSnapshot(): EngineSnapshot {
    const cam = this.lastCam;
    const camVisible = !!cam && cam.confidence >= MIN_CAMERA_CONFIDENCE && this.lastCamDeg !== null;
    const live = this.stage === 'active' ? this.lastFused : camVisible ? { deg: this.lastCamDeg!, source: 'camera' as const } : null;
    const imuMapped = this.mappedImu(this.lastT, this.lastImu);
    const imuFresh = this.lastImu && this.lastT - this.lastImu.t <= IMU_FRESH_MS ? this.lastImu.deg : null;
    // While asking about pain, keep showing the set that just finished.
    const reps = this.currentSet?.reps ?? (this.stage === 'pain' ? (this.results.at(-1)?.reps ?? []) : []);

    let progress = 0;
    if (this.stage === 'calibrate') progress = Math.min(1, (this.lastT - this.calibStart) / CALIBRATE_MS);
    if (this.stage === 'rest') progress = Math.min(1, 1 - (this.restUntil - this.lastT) / this.plan.restMs);

    return {
      stage: this.stage,
      block: this.block,
      blockIndex: this.blockIndex,
      setIndex: this.setIndex,
      repsDone: reps.length,
      angleDeg: live ? round1(live.deg) : null,
      angleSource: live?.source ?? null,
      imuDeg: imuMapped !== null ? round1(imuMapped) : imuFresh !== null ? round1(imuFresh) : null,
      cameraConfidence: cam?.confidence ?? 0,
      ceilingState: this.stage === 'active' && this.ceiling ? this.ceiling.state : 'ok',
      compensation: this.stage === 'active' ? { shoulderHike: this.hike.active, trunkLean: this.lean.active, elbowBend: this.elbow.active } : NO_COMPENSATION,
      bestThisSet: reps.length ? Math.max(...reps.map((r) => r.peakDeg)) : null,
      progress,
      message: this.message,
    };
  }
}

function freshAccumulator(): RepAccumulator {
  return { cameraFrames: 0, imuFrames: 0, hike: false, lean: false, elbow: false, imuPeak: null, unseen: false };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
