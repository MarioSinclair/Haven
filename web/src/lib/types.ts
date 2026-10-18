export type Side = 'left' | 'right';
export type AffectedSide = Side | 'both';
export type AngleSource = 'camera' | 'imu';
export type CameraView = 'front' | 'side';
export type ExerciseId = 'side_raise' | 'scaption' | 'forward_raise' | 'wall_walk' | 'shoulder_roll' | 'elbow_wing';
export type Phase = 1 | 2 | 3;

/** Everything the session needs from one camera frame, in degrees and torso-normalized units. */
export interface PoseMetrics {
  /** Upper arm relative to the trunk: 0 hanging at the side, 90 horizontal, 180 overhead. */
  elevationDeg: number;
  /** Shoulder–elbow–wrist angle: 180 is a straight arm. */
  elbowDeg: number;
  /** Signed tilt of the hip→shoulder midline from vertical. */
  trunkLeanDeg: number;
  /** Vertical ear-to-shoulder gap divided by torso length; shrinks when the patient shrugs. */
  earLift: number;
  /** Shoulder width divided by torso length; high when facing the camera, low when side-on. */
  facingRatio: number;
  /** Horizontal gap between the elbows divided by shoulder width: ~0.5 together in front, ~2 wide open. */
  elbowSpread: number;
  /** Lowest landmark visibility among shoulder, elbow and hip, zeroed if any is out of frame. */
  confidence: number;
}

export interface ImuReading {
  deg: number;
  /** performance.now() when the packet arrived. */
  t: number;
}

export interface CompensationFlags {
  shoulderHike: boolean;
  trunkLean: boolean;
  elbowBend: boolean;
}
