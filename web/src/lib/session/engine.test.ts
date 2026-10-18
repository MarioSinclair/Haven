import { describe, expect, it } from 'vitest';
import type { Block, SessionPlan } from '../protocol';
import type { ImuReading, PoseMetrics } from '../types';
import { SessionEngine, type EngineEvent, type StageName } from './engine';
import { buildExercisePlan, buildRangeCheckPlan, EXERCISES } from '../protocol';
import { allLines } from '../voice/lines';

const FRAME_MS = 33;

function frame(deg: number, over: Partial<PoseMetrics> = {}): PoseMetrics {
  return { elevationDeg: deg, elbowDeg: 175, trunkLeanDeg: 0, earLift: 0.3, facingRatio: 0.8, elbowSpread: 1.1, confidence: 0.9, ...over };
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
  /** One shoulder roll: the ear-to-shoulder gap closes by `closes` (0–1) and opens again, arm hanging. */
  roll(closes = 0.4) {
    const start = this.t;
    const dur = 1600;
    this.hold(dur + 400, (t) => frame(10, { earLift: 0.3 * (1 - (t - start <= dur ? (closes / 2) * (1 - Math.cos((2 * Math.PI * (t - start)) / dur)) : 0)) }));
  }
    /** One elbow-winging cycle with the hands behind the head: together, out wide, back together. */
  wing(closed = 0.5, open = 1.9, deg: (opened: number) => number = () => 120) {
    const start = this.t;
    const dur = 2400;
    const opened = (t: number) => (t - start <= dur ? (1 - Math.cos((2 * Math.PI * (t - start)) / dur)) / 2 : 0);
    this.hold(dur + 600, (t) => frame(deg(opened(t)), { elbowSpread: closed + (open - closed) * opened(t) }));
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

  it('only ever says lines the voice pack records', () => {
    const recorded = new Set(allLines());
    const spoken = new Set<string>();
    const run = (p: SessionPlan, peak: number) => {
      const d = new Driver(new SessionEngine(p));
      // Side-on exercises need the patient turned; rolls need the shoulder to lift.
      const pose = () => (d.engine.block && EXERCISES[d.engine.block.exerciseId].view === 'side' ? { facingRatio: 0.2 } : {});
      d.hold(4000, () => frame(10, pose())); // position and calibrate
      for (let i = 0; i < 60 && !d.stages().includes('done'); i++) {
        const stage = d.engine.getSnapshot().stage;
        if (stage === 'pain') d.engine.submitPain(2);
        else if (stage === 'symptoms') d.engine.submitSymptoms({ armHeaviness: false, armpitCord: false, note: '' });
        else if (stage === 'rest' || stage === 'position' || stage === 'calibrate') d.hold(p.restMs + 2600, () => frame(10, pose()));
        else if (EXERCISES[d.engine.block!.exerciseId].measure === 'roll') d.roll();
        else if (EXERCISES[d.engine.block!.exerciseId].measure === 'wing') d.wing();
        else d.rep(peak, (deg) => ({ ...pose(), ...(deg > 60 ? { earLift: 0.1, trunkLeanDeg: 20, elbowDeg: 120 } : {}) }));
      }
      expect(d.stages()).toContain('done');
      for (const e of d.events) if (e.type === 'cue') spoken.add(e.cue.text);
    };
    run({ ...buildExercisePlan(1, 'both', [{ exerciseId: 'side_raise', ceilingDeg: 90, goalDeg: null, reps: 3, sets: 2 }, { exerciseId: 'scaption', ceilingDeg: 97, goalDeg: null, reps: 2, sets: 1 }]), restMs: 500 }, 110);
    run(
      {
        ...buildExercisePlan(2, 'left', [
          { exerciseId: 'shoulder_roll', ceilingDeg: null, goalDeg: null, reps: 2, sets: 1 },
          { exerciseId: 'wall_walk', ceilingDeg: 120, goalDeg: null, reps: 2, sets: 1 },
          { exerciseId: 'elbow_wing', ceilingDeg: null, goalDeg: null, reps: 2, sets: 1 },
        ]),
        restMs: 500,
      },
      110,
    );
    run(buildRangeCheckPlan(1, ['left'], ['side_raise']), 120);
    expect([...spoken].filter((line) => !recorded.has(line))).toEqual([]);
    expect(spoken.size).toBeGreaterThan(10);
  });

  it('counts shoulder rolls from the shoulder lifting, with no limit or form flags', () => {
    const d = new Driver(new SessionEngine(plan({ exerciseId: 'shoulder_roll', ceilingDeg: null, reps: 3 })));
    d.hold(3000, () => frame(10));
    // Camera jitter isn't a roll.
    d.hold(3000, (t) => frame(10, { earLift: 0.3 * (1 + 0.015 * Math.sin(t / 37) * Math.cos(t / 91)) }));
    d.roll(0.04);
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(0);
    // A small, gentle roll counts, as does a fuller one.
    d.roll(0.12);
    d.roll(0.12);
    d.roll();
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(3);
    expect(d.engine.getSnapshot().stage).toBe('pain');
    expect(d.cues()).not.toContain('hike');
    expect(d.engine.result.sets[0].reps.every((r) => !r.overCeiling && !r.shoulderHike)).toBe(true);
  });

  it('counts elbow winging from together to wide and back, not lifting the hands into place', () => {
    const d = new Driver(new SessionEngine(plan({ exerciseId: 'elbow_wing', ceilingDeg: null, reps: 2 })));
    d.hold(3000, () => frame(10));
    // Lifting the hands behind the head swings the elbows wide on the way up.
    const start = d.t;
    d.hold(1500, (t) => frame(10 + Math.min(1, (t - start) / 1000) * 110, { elbowSpread: 1.8 }));
    d.hold(800, () => frame(120, { elbowSpread: 0.5 }));
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(0);
    d.wing();
    d.wing();
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(2);
    expect(d.engine.getSnapshot().stage).toBe('pain');
  });

  it("counts a stiff patient's smaller winging, with the elbows dropping as they come together", () => {
    const d = new Driver(new SessionEngine(plan({ exerciseId: 'elbow_wing', ceilingDeg: null, reps: 2 })));
    d.hold(3000, () => frame(10));
    const start = d.t;
    d.hold(1500, (t) => frame(10 + Math.min(1, (t - start) / 1000) * 85, { elbowSpread: 1.6 }));
    d.hold(800, () => frame(55, { elbowSpread: 1.05 }));
    // Camera jitter while holding still isn't a rep.
    d.hold(2000, (t) => frame(55, { elbowSpread: 1.05 + 0.1 * Math.sin(t / 50) }));
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(0);
    const elbowsLift = (opened: number) => 55 + 40 * opened;
    d.wing(1.05, 1.55, elbowsLift);
    d.wing(1.05, 1.55, elbowsLift);
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(2);
  });

  it("doesn't flag the bent elbow that walking the fingers up a wall needs", () => {
    const d = new Driver(new SessionEngine(plan({ exerciseId: 'wall_walk', ceilingDeg: null, reps: 2 })));
    d.hold(3000, () => frame(10));
    d.rep(130, () => ({ elbowDeg: 110 }));
    d.rep(130, () => ({ elbowDeg: 110 }));
    expect(d.events.filter((e) => e.type === 'rep')).toHaveLength(2);
    expect(d.cues()).not.toContain('elbow');
  });
});
