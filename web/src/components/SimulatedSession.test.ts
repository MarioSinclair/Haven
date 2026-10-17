import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../lib/pose/angles';
import { SessionEngine, type EngineEvent } from '../lib/session/engine';
import { PLAN, poseAt, scenario, TOTAL } from './SimulatedSession';

// The judges-page replay claims each chapter; this runs it headless and checks the engine agrees.
describe('judges replay scenario', () => {
  const engine = new SessionEngine(PLAN);
  const events: EngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  for (let t = 0; t < TOTAL; t += 1 / 30) {
    const m = scenario(t);
    engine.tick(t * 1000, computeMetrics(poseAt(m), 'left', 1280, 720), { deg: m.theta + 2, t: t * 1000 });
  }
  const reps = engine.result.sets[0]?.reps ?? [];

  it('counts all five reps and ends on the pain prompt', () => {
    expect(reps).toHaveLength(5);
    expect(engine.getSnapshot().stage).toBe('pain');
  });

  it('flags only rep 3 as past the 90° limit, with a beep cue', () => {
    expect(reps.map((r) => r.overCeiling)).toEqual([false, false, true, false, false]);
    expect(events.some((e) => e.type === 'cue' && e.cue.key === 'over' && e.cue.beep)).toBe(true);
  });

  it('catches the shrug on rep 4 and nowhere else', () => {
    expect(reps.map((r) => r.shoulderHike)).toEqual([false, false, false, true, false]);
  });

  it('counts rep 5 from the band after the camera loses the arm', () => {
    expect(reps[4].source).toBe('imu');
    expect(reps.slice(0, 4).every((r) => r.source === 'camera')).toBe(true);
  });
});
