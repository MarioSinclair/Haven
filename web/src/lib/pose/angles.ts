import type { PoseMetrics, Side } from '../types';

export interface Vec2 {
  x: number;
  y: number;
}

export interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

// MediaPipe Pose indices. "Left" is the patient's left, regardless of how the video is displayed.
export const LM = {
  NOSE: 0,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export function sideLandmarks(side: Side) {
  return side === 'left'
    ? { shoulder: LM.LEFT_SHOULDER, elbow: LM.LEFT_ELBOW, wrist: LM.LEFT_WRIST, hip: LM.LEFT_HIP, ear: LM.LEFT_EAR, otherShoulder: LM.RIGHT_SHOULDER, otherHip: LM.RIGHT_HIP }
    : { shoulder: LM.RIGHT_SHOULDER, elbow: LM.RIGHT_ELBOW, wrist: LM.RIGHT_WRIST, hip: LM.RIGHT_HIP, ear: LM.RIGHT_EAR, otherShoulder: LM.LEFT_SHOULDER, otherHip: LM.LEFT_HIP };
}

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const DEG = 180 / Math.PI;

/** Unsigned angle between two vectors, 0–180°. */
export function angleBetweenDeg(u: Vec2, v: Vec2): number {
  const cross = u.x * v.y - u.y * v.x;
  const dot = u.x * v.x + u.y * v.y;
  return Math.abs(Math.atan2(cross, dot)) * DEG;
}

/**
 * Both vectors start at the shoulder, so a hanging arm reads ~0° and overhead reads ~180°.
 * Measured against the trunk, so leaning the whole body does not inflate the number.
 */
export function armElevationDeg(shoulder: Vec2, elbow: Vec2, hip: Vec2): number {
  return angleBetweenDeg(sub(hip, shoulder), sub(elbow, shoulder));
}

export function elbowAngleDeg(shoulder: Vec2, elbow: Vec2, wrist: Vec2): number {
  return angleBetweenDeg(sub(shoulder, elbow), sub(wrist, elbow));
}

/** Signed angle of the hip→shoulder midline from vertical; positive leans toward +x in the image. */
export function trunkLeanDeg(midShoulder: Vec2, midHip: Vec2): number {
  const up = sub(midShoulder, midHip);
  return Math.atan2(up.x, -up.y) * DEG;
}

const inFrame = (l: RawLandmark) => l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1;

/**
 * Landmarks are normalized separately on each axis, so they are scaled to pixels first;
 * otherwise every angle is skewed by the video's aspect ratio.
 */
export function computeMetrics(landmarks: RawLandmark[], side: Side, width: number, height: number): PoseMetrics | null {
  const ix = sideLandmarks(side);
  const px = (i: number): Vec2 => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });

  const shoulder = px(ix.shoulder);
  const elbow = px(ix.elbow);
  const wrist = px(ix.wrist);
  const hip = px(ix.hip);
  const ear = px(ix.ear);
  const midShoulder = mid(shoulder, px(ix.otherShoulder));
  const midHip = mid(hip, px(ix.otherHip));

  const torso = dist(midShoulder, midHip);
  if (torso < 1) return null;

  const tracked = [ix.shoulder, ix.elbow, ix.hip].map((i) => landmarks[i]);
  const confidence = tracked.every(inFrame) ? Math.min(...tracked.map((l) => l.visibility ?? 0)) : 0;

  return {
    elevationDeg: armElevationDeg(shoulder, elbow, hip),
    elbowDeg: elbowAngleDeg(shoulder, elbow, wrist),
    trunkLeanDeg: trunkLeanDeg(midShoulder, midHip),
    earLift: (shoulder.y - ear.y) / torso,
    facingRatio: dist(shoulder, px(ix.otherShoulder)) / torso,
    confidence,
  };
}

// Shoulder width ≈ 0.7–0.9 torso lengths when facing the camera, ≈ 0.1–0.3 side-on.
export const FACING_MIN_RATIO = 0.55;
export const SIDE_ON_MAX_RATIO = 0.35;

export function viewMatches(view: 'front' | 'side', facingRatio: number): boolean {
  return view === 'front' ? facingRatio >= FACING_MIN_RATIO : facingRatio <= SIDE_ON_MAX_RATIO;
}
