import { describe, expect, it } from 'vitest';
import { CeilingMonitor } from './ceiling';
import { Debounce, fuseAngle } from './fusion';
import { RepCounter } from './repCounter';

/** Smooth rep from rest up to rest+amp and back, sampled every 33 ms. */
function repWave(rest: number, amp: number, periodMs: number, reps: number, jitter = 0) {
  const out: [number, number][] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let t = 0; t <= periodMs * reps; t += 33) {
    const phase = (t % periodMs) / periodMs;
    out.push([t, rest + (amp * (1 - Math.cos(2 * Math.PI * phase))) / 2 + rand() * jitter]);
  }
  return out;
}

describe('RepCounter', () => {
  it('counts each rise-and-return once, even with jitter', () => {
    const counter = new RepCounter({ restDeg: 10 });
    const events = repWave(10, 80, 2500, 5, 3)
      .map(([t, deg]) => counter.update(deg, t))
      .filter((e) => e !== null);
    expect(events).toHaveLength(5);
    for (const e of events) expect(e!.peakDeg).toBeGreaterThan(85);
  });

  it('ignores fidgeting near the start threshold', () => {
    const counter = new RepCounter({ restDeg: 10 });
    // Crosses the 30° start threshold but never reaches the 35° minimum peak.
    const events = repWave(10, 22, 800, 6, 2)
      .map(([t, deg]) => counter.update(deg, t))
      .filter(Boolean);
    expect(events).toHaveLength(0);
  });
});

describe('CeilingMonitor', () => {
  it('warns near the limit, alerts past it, and only clears after dropping past the hysteresis', () => {
    const m = new CeilingMonitor(90, 8, 3);
    expect(m.update(70)).toBeNull();
    expect(m.update(83)).toBe('near');
    expect(m.update(91)).toBe('over');
    expect(m.update(88.5)).toBeNull(); // still over: inside hysteresis
    expect(m.update(86)).toBe('near');
    expect(m.update(80)).toBeNull(); // still near: inside hysteresis
    expect(m.update(78)).toBe('ok');
  });

  it('never alerts without a limit', () => {
    const m = new CeilingMonitor(null);
    expect(m.update(170)).toBeNull();
    expect(m.state).toBe('ok');
  });
});

describe('fuseAngle', () => {
  const rest = { cameraDeg: 12, imuDeg: 2 };

  it('trusts a confident camera', () => {
    expect(fuseAngle(1000, { deg: 80, confidence: 0.9 }, { deg: 75, t: 990 }, rest)).toEqual({ deg: 80, source: 'camera' });
  });

  it('maps the band into the camera frame when the camera loses the arm', () => {
    expect(fuseAngle(1000, { deg: 80, confidence: 0.2 }, { deg: 72, t: 990 }, rest)).toEqual({ deg: 82, source: 'imu' });
  });

  it('gives up when both sources are stale or missing', () => {
    expect(fuseAngle(1000, null, { deg: 72, t: 500 }, rest)).toBeNull();
    expect(fuseAngle(1000, null, { deg: 72, t: 990 }, { cameraDeg: 12, imuDeg: null })).toBeNull();
  });
});

describe('Debounce', () => {
  it('needs the condition to hold before switching on or off', () => {
    const d = new Debounce(200, 400);
    expect(d.update(true, 0)).toBe(false);
    expect(d.update(true, 150)).toBe(false);
    expect(d.update(true, 210)).toBe(true);
    expect(d.update(false, 300)).toBe(true);
    expect(d.update(true, 350)).toBe(true); // blip back resets the off timer
    expect(d.update(false, 400)).toBe(true);
    expect(d.update(false, 810)).toBe(false);
  });
});
