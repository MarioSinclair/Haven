import type { AngleSource, ImuReading } from '../types';

export interface FusedAngle {
  deg: number;
  source: AngleSource;
}

export const MIN_CAMERA_CONFIDENCE = 0.6;
const IMU_MAX_AGE_MS = 300;

/**
 * Camera first; the band fills in when the camera can't see the arm. The band measures the arm
 * against gravity and the camera against the trunk, so the band's reading is mapped through the
 * rest pose captured at calibration: camera rest + (band now − band rest).
 */
export function fuseAngle(
  t: number,
  camera: { deg: number; confidence: number } | null,
  imu: ImuReading | null,
  rest: { cameraDeg: number; imuDeg: number | null } | null,
): FusedAngle | null {
  if (camera && camera.confidence >= MIN_CAMERA_CONFIDENCE) return { deg: camera.deg, source: 'camera' };
  if (imu && t - imu.t <= IMU_MAX_AGE_MS && rest && rest.imuDeg !== null) {
    return { deg: rest.cameraDeg + (imu.deg - rest.imuDeg), source: 'imu' };
  }
  return null;
}

/** Holds a boolean until the raw condition has been stable for a while, so one noisy frame can't trigger a cue. */
export class Debounce {
  private value = false;
  private since: number | null = null;

  constructor(
    private onMs: number,
    private offMs: number,
  ) {}

  get active() {
    return this.value;
  }

  update(raw: boolean, t: number): boolean {
    if (raw === this.value) {
      this.since = null;
      return this.value;
    }
    this.since ??= t;
    if (t - this.since >= (raw ? this.onMs : this.offMs)) {
      this.value = raw;
      this.since = null;
    }
    return this.value;
  }

  reset() {
    this.value = false;
    this.since = null;
  }
}
