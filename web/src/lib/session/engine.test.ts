import { describe, expect, it } from 'vitest';
import type { Block, SessionPlan } from '../protocol';
import type { ImuReading, PoseMetrics } from '../types';
import { SessionEngine, type EngineEvent, type StageName } from './engine';

const FRAME_MS = 33;

function frame(deg: number, over: Partial<PoseMetrics> = {}): PoseMetrics {
  return { elevationDeg: deg, elbowDeg: 175, trunkLeanDeg: 0, earLift: 0.3, facingRatio: 0.8, confidence: 0.9, ...over };
}

function plan(block: Partial<Block> = {}, kind: SessionPlan['kind'] = 'exercise'): SessionPlan {
  return {
    kind,
    phase: 1,
    restMs: 1000,
    blocks: [{ exerciseId: 'side_raise', side: 'left', kind, ceilingDeg: 90, reps: 2, sets: 1, ...block }],
  };
}

class Driver {
  t = 0;
  events: EngineEvent[] = [];
  constructor(readonly engine: SessionEngine) {
    engine.onEvent((e) => this.events.push(e));
  }
  hold(ms: number, make: (t: number) => PoseMetrics | null, imu?: (t: number) => number | null) {
    const end = this.t + ms;
    for (; this.t < end; this.t += FRAME_MS) {
      const imuDeg = imu?.(this.t) ?? null;
      const reading: ImuReading | null = imuDeg === null ? null : { deg: imuDeg, t: this.t };
      this.engine.tick(this.t, make(this.t), reading);
    }
  }
  /** One slow raise from rest up to `peak` and back down. */
  rep(peak: number, over: (deg: number) => Partial<PoseMetrics> = () => ({}), imuOffset: number | null = null) {
    const start = this.t;
    const dur = 2400;
    const at = (t: number) => 10 + ((peak - 10) * (1 - Math.cos((2 * Math.PI * (t - start)) / dur))) / 2;
    this.hold(dur + 600, (t) => (t - start <= dur ? frame(at(t), over(at(t))) : frame(10)), imuOffset === null ? undefined : (t) => (t - start <= dur ? at(t) + imuOffset : 10 + imuOffset));
  }
  stages(): StageName[] {
    return this.events.filter((e) => e.type === 'stage').map((e) => (e as { stage: StageName }).stage);
  }
  cues(): string[] {
    return this.events.filter((e) => e.type === 'cue').map((e) => (e as { cue: { key: string } }).cue.key);
  }
}

describe('SessionEngine', () => {
  it('runs position → calibrate → reps → pain → symptoms → done', () => {
    const d = new Driver(new SessionEngine(plan()));
    d.hold(3000, () => frame(10));
    expect(d.engine.getSnapshot().stage).toBe('active');

    d.rep(80);
    d.rep(85);
    expect(d.engine.getSnapshot().stage).toBe('pain');

    d.engine.submitPain(3);
    expect(d.engine.getSnapshot().stage).toBe('symptoms');
    d.engine.submitSymptoms({ armHeaviness: false, armpitCord: true, note: '' });

    expect(d.stages()).toEqual(['calibrate', 'active', 'pain', 'symptoms', 'done']);
    const result = d.engine.result;
    expect(result.sets).toHaveLength(1);
    expect(result.sets[0].reps.map((r) => Math.round(r.peakDeg / 5) * 5)).toEqual([80, 85]);
    expect(result.sets[0].pain).toBe(3);
    expect(result.symptoms?.armpitCord).toBe(true);
  });

  it('waits for the patient to face the camera before calibrating', () => {
    const d = new Driver(new SessionEngine(plan()));
    d.hold(3000, () => frame(10, { facingRatio: 0.2 }));
    expect(d.engine.getSnapshot().stage).toBe('position');
    expect(d.engine.getSnapshot().message).toMatch(/face the camera/i);
  });

  it('flags reps past the limit and cues with a beep', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1 })));
    d.hold(3000, () => frame(10));
    d.rep(100);
    const rep = d.engine.result.sets[0].reps[0];
    expect(rep.overCeiling).toBe(true);
    const over = d.events.find((e) => e.type === 'cue' && e.cue.key === 'over');
    expect(over && over.type === 'cue' && over.cue.beep).toBe(true);
  });

  it('flags a shoulder hike during the rep', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1, ceilingDeg: null })));
    d.hold(3000, () => frame(10));
    d.rep(120, (deg) => (deg > 60 ? { earLift: 0.15 } : {}));
    const rep = d.engine.result.sets[0].reps[0];
    expect(rep.shoulderHike).toBe(true);
    expect(rep.trunkLean).toBe(false);
    expect(d.cues()).toContain('hike');
  });

  it('keeps counting on the band when the camera loses the arm, and records the band peak', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1, ceilingDeg: null })));
    d.hold(3000, () => frame(10), () => 4);
    // Camera confidence collapses for the top of the rep; the band reads 6° below the camera throughout.
    d.rep(110, (deg) => (deg > 40 ? { confidence: 0.1 } : {}), -6);
    const rep = d.engine.result.sets[0].reps[0];
    expect(rep.source).toBe('imu');
    expect(rep.peakDeg).toBeGreaterThan(105);
    expect(rep.imuPeakDeg).toBeGreaterThan(105);
  });

  it('rests between sets and keeps the calibration', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1, sets: 2 })));
    d.hold(3000, () => frame(10));
    d.rep(80);
    d.engine.submitPain(2);
    expect(d.engine.getSnapshot().stage).toBe('rest');
    d.hold(1100, () => frame(10));
    expect(d.engine.getSnapshot().stage).toBe('active');
    expect(d.engine.getSnapshot().setIndex).toBe(1);
  });

  it('skips pain and symptom prompts for a range check', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1, ceilingDeg: null, kind: 'assessment' }, 'assessment')));
    d.hold(3000, () => frame(10));
    d.rep(150);
    expect(d.engine.getSnapshot().stage).toBe('done');
    expect(d.engine.result.sets[0].pain).toBeNull();
  });

  it('keeps partial work when stopped early', () => {
    const d = new Driver(new SessionEngine(plan({ reps: 5 })));
    d.hold(3000, () => frame(10));
    d.rep(70);
    d.engine.stop();
    expect(d.engine.getSnapshot().stage).toBe('done');
    expect(d.engine.result.sets[0].reps).toHaveLength(1);
  });

  it("doesn't count a rep whose top the camera lost, but shrugs off a dropped frame", () => {
    const d = new Driver(new SessionEngine(plan({ reps: 1 })));
    d.hold(3000, () => frame(10));
    /** A raise like Driver.rep, with the camera seeing nothing whenever `hidden` says so. */
    const raise = (peak: number, hidden: (deg: number, elapsed: number) => boolean) => {
      const start = d.t;
      const dur = 2400;
      const at = (t: number) => 10 + ((peak - 10) * (1 - Math.cos((2 * Math.PI * (t - start)) / dur))) / 2;
      d.hold(dur + 600, (t) => (t - start > dur ? frame(10) : hidden(at(t), t - start) ? null : frame(at(t))));
    };
    const repEvents = () => d.events.filter((e) => e.type === 'rep');

    // A true 120° rep, lost above 70° with no band: it used to save as a clean ~70° rep.
    raise(120, (deg) => deg > 70);
    expect(repEvents()).toHaveLength(0);
    expect(d.cues()).toContain('uncounted');
    expect(d.engine.getSnapshot().message).toMatch(/didn't count/);

    raise(80, (_deg, elapsed) => elapsed >= 1200 && elapsed < 1200 + FRAME_MS);
    expect(repEvents()).toHaveLength(1);
    expect(d.engine.getSnapshot().stage).toBe('pain');
  });
});
