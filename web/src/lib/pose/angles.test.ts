import { describe, expect, it } from 'vitest';
import { armElevationDeg, computeMetrics, elbowAngleDeg, LM, trunkLeanDeg, viewMatches, type RawLandmark } from './angles';

const W = 1280;
const H = 720;

/** Builds a 33-point pose from pixel coordinates, normalized the way MediaPipe returns them. */
function pose(px: Partial<Record<number, [number, number]>>, visibility = 0.95): RawLandmark[] {
  const lms: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility }));
  for (const [i, [x, y]] of Object.entries(px) as [string, [number, number]][]) {
    lms[Number(i)] = { x: x / W, y: y / H, visibility };
  }
  return lms;
}

// Patient facing the camera: their left side appears on the image's right.
const standing = {
  [LM.LEFT_SHOULDER]: [760, 250],
  [LM.RIGHT_SHOULDER]: [520, 250],
  [LM.LEFT_HIP]: [730, 550],
  [LM.RIGHT_HIP]: [550, 550],
  [LM.LEFT_EAR]: [690, 160],
  [LM.RIGHT_EAR]: [590, 160],
} satisfies Partial<Record<number, [number, number]>>;

describe('armElevationDeg', () => {
  const shoulder = { x: 0, y: 0 };
  const hip = { x: 0, y: 10 };
  it.each([
    [{ x: 0, y: 5 }, 0],
    [{ x: 5, y: 5 }, 45],
    [{ x: 5, y: 0 }, 90],
    [{ x: -5, y: 0 }, 90],
    [{ x: 0, y: -5 }, 180],
  ])('elbow at %o reads %d°', (elbow, expected) => {
    expect(armElevationDeg(shoulder, elbow, hip)).toBeCloseTo(expected, 5);
  });
});

describe('elbowAngleDeg', () => {
  it('reads 180° for a straight arm and 90° for a right angle', () => {
    expect(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 10 })).toBeCloseTo(180, 5);
    expect(elbowAngleDeg({ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 })).toBeCloseTo(90, 5);
  });
});

describe('trunkLeanDeg', () => {
  it('is 0 upright and signed when leaning', () => {
    expect(trunkLeanDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0, 5);
    expect(trunkLeanDeg({ x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(45, 5);
    expect(trunkLeanDeg({ x: -10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(-45, 5);
  });
});

describe('computeMetrics', () => {
  it('measures in pixels, not normalized units, so a 16:9 frame does not skew the angle', () => {
    const shoulder = { x: 760, y: 250 };
    const elbow = { x: 910, y: 400 };
    const hip = { x: 730, y: 550 };
    const norm = (p: { x: number; y: number }) => ({ x: p.x / W, y: p.y / H });
    const truth = armElevationDeg(shoulder, elbow, hip);
    const skewed = armElevationDeg(norm(shoulder), norm(elbow), norm(hip));
    expect(Math.abs(truth - skewed)).toBeGreaterThan(10);

    const m = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [elbow.x, elbow.y], [LM.LEFT_WRIST]: [1060, 550] }), 'left', W, H)!;
    expect(m.elevationDeg).toBeCloseTo(truth, 5);
    expect(m.elbowDeg).toBeCloseTo(180, 0);
  });

  it('reads the patient-left arm from the left landmarks', () => {
    const m = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [1000, 250], [LM.RIGHT_ELBOW]: [520, 400] }), 'left', W, H)!;
    expect(m.elevationDeg).toBeGreaterThan(80);
    const right = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [1000, 250], [LM.RIGHT_ELBOW]: [520, 400] }), 'right', W, H)!;
    expect(right.elevationDeg).toBeLessThan(10);
  });

  it('distinguishes facing the camera from standing side-on', () => {
    const facing = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [770, 400] }), 'left', W, H)!;
    expect(viewMatches('front', facing.facingRatio)).toBe(true);
    const sideOn = computeMetrics(
      pose({ ...standing, [LM.LEFT_SHOULDER]: [650, 250], [LM.RIGHT_SHOULDER]: [630, 250], [LM.LEFT_HIP]: [645, 550], [LM.RIGHT_HIP]: [635, 550], [LM.LEFT_ELBOW]: [650, 400] }),
      'left',
      W,
      H,
    )!;
    expect(viewMatches('side', sideOn.facingRatio)).toBe(true);
    expect(viewMatches('front', sideOn.facingRatio)).toBe(false);
  });

  it('reports zero confidence when the elbow leaves the frame', () => {
    const m = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [1400, 250] }), 'left', W, H)!;
    expect(m.confidence).toBe(0);
  });

  it('shrinks earLift when the shoulder hikes toward the ear', () => {
    const relaxed = computeMetrics(pose({ ...standing, [LM.LEFT_ELBOW]: [770, 400] }), 'left', W, H)!;
    const shrug = computeMetrics(pose({ ...standing, [LM.LEFT_SHOULDER]: [760, 215], [LM.LEFT_ELBOW]: [770, 365] }), 'left', W, H)!;
    expect(shrug.earLift).toBeLessThan(relaxed.earLift * 0.75);
  });
});
