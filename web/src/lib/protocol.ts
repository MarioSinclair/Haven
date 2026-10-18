import type { AffectedSide, CameraView, ExerciseId, Phase, Side } from './types';

/**
 * How the camera counts an exercise: each raise and its peak angle (the only kind that measures
 * range, so the only kind with a limit or goal), each shoulder roll, or each elbow-winging cycle.
 * Rolls and winging are camera only: the band measures one upper arm, not shoulders or elbows.
 */
export type Measure = 'raise' | 'roll' | 'wing';

export interface Exercise {
  id: ExerciseId;
  name: string;
  /** For charts and other tight spots. */
  short: string;
  view: CameraView;
  /** Spoken when the exercise starts. */
  instruction: string;
  /** On screen during the exercise, beside the animated demo. */
  brief: string;
  measure: Measure;
  /** The elbow bends as part of the move, so the straight-elbow check is off. */
  elbowMayBend?: boolean;
}

export const EXERCISES: Record<ExerciseId, Exercise> = {
  side_raise: {
    id: 'side_raise',
    name: 'Side raise',
    short: 'Side raise',
    view: 'front',
    measure: 'raise',
    instruction: 'Face the camera. Raise your arm out to the side with your thumb up, then lower slowly.',
    brief: 'Out to the side, thumb up. Lower slowly.',
  },
  scaption: {
    id: 'scaption',
    name: 'Scaption raise',
    short: 'Scaption',
    view: 'front',
    measure: 'raise',
    instruction: 'Face the camera. Raise your arm slightly in front of your body, thumb up, then lower slowly.',
    brief: 'Slightly in front, thumb up. Lower slowly.',
  },
  forward_raise: {
    id: 'forward_raise',
    name: 'Forward raise',
    short: 'Forward',
    view: 'side',
    measure: 'raise',
    instruction: 'Turn so your working arm is closest to the camera. Raise your arm straight in front of you, then lower slowly.',
    brief: 'Straight in front of you. Lower slowly.',
  },
  // Side-on to the wall and facing the camera, the camera's best angle for measuring the arm.
  wall_walk: {
    id: 'wall_walk',
    name: 'Wall walk',
    short: 'Wall walk',
    view: 'front',
    measure: 'raise',
    elbowMayBend: true,
    instruction: 'Stand side-on to a wall with your working arm next to it, facing the camera. Walk your fingers up the wall as high as is comfortable, then walk them back down.',
    brief: 'Walk your fingers up the wall beside you, then back down.',
  },
  shoulder_roll: {
    id: 'shoulder_roll',
    name: 'Shoulder rolls',
    short: 'Rolls',
    view: 'front',
    measure: 'roll',
    instruction: 'Face the camera with your arms relaxed. Gently roll your shoulders up, back and down. Small rolls are fine.',
    brief: 'Gently up, back and down. Small rolls are fine.',
  },
  elbow_wing: {
    id: 'elbow_wing',
    name: 'Elbow winging',
    short: 'Winging',
    view: 'front',
    measure: 'wing',
    instruction: 'Face the camera and clasp your hands behind your head, elbows together in front. Open your elbows out wide, then bring them back together.',
    brief: 'Hands behind your head. Elbows out wide, then back together.',
  },
};

/** Only raises measure range, so only they take a limit or goal, feed range charts or make a range check. */
export const measuresRange = (id: ExerciseId) => EXERCISES[id].measure === 'raise';

export interface Prescription {
  exerciseId: ExerciseId;
  /** null = as tolerated. */
  ceilingDeg: number | null;
  /** null = use the reference hierarchy in baseline.ts. */
  goalDeg: number | null;
  reps: number;
  sets: number;
}

// PLACEHOLDER protocol for the demo. Real limits and exercises come from the patient's surgeon or
// PT through the clinician view; the 90° drain-phase limit is common but not universal.
export const DEFAULT_PROTOCOL: Record<Phase, { label: string; prescriptions: Prescription[] }> = {
  1: {
    label: 'Drains in',
    prescriptions: [
      { exerciseId: 'shoulder_roll', ceilingDeg: null, goalDeg: null, reps: 10, sets: 1 },
      { exerciseId: 'side_raise', ceilingDeg: 90, goalDeg: null, reps: 10, sets: 2 },
      { exerciseId: 'scaption', ceilingDeg: 90, goalDeg: null, reps: 10, sets: 2 },
    ],
  },
  2: {
    label: 'Drains out, building range',
    prescriptions: [
      { exerciseId: 'shoulder_roll', ceilingDeg: null, goalDeg: null, reps: 10, sets: 1 },
      { exerciseId: 'side_raise', ceilingDeg: null, goalDeg: null, reps: 10, sets: 2 },
      { exerciseId: 'scaption', ceilingDeg: null, goalDeg: null, reps: 10, sets: 2 },
      { exerciseId: 'wall_walk', ceilingDeg: null, goalDeg: null, reps: 5, sets: 2 },
      { exerciseId: 'elbow_wing', ceilingDeg: null, goalDeg: null, reps: 8, sets: 1 },
    ],
  },
  3: {
    label: 'Full range',
    prescriptions: [
      { exerciseId: 'side_raise', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
      { exerciseId: 'scaption', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
      { exerciseId: 'forward_raise', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
      { exerciseId: 'wall_walk', ceilingDeg: null, goalDeg: null, reps: 8, sets: 2 },
      { exerciseId: 'elbow_wing', ceilingDeg: null, goalDeg: null, reps: 10, sets: 2 },
    ],
  },
};

/** Used when there is no pre-op or healthy-arm baseline. Placeholder; the PT can override per exercise. */
export const GENERAL_GOAL_DEG = 150;

export const RANGE_CHECK_REPS = 3;

export type SessionKind = 'exercise' | 'assessment';

export interface Block {
  exerciseId: ExerciseId;
  side: Side;
  kind: SessionKind;
  ceilingDeg: number | null;
  reps: number;
  sets: number;
}

export interface SessionPlan {
  kind: SessionKind;
  phase: Phase;
  blocks: Block[];
  restMs: number;
}

export function affectedSides(affected: AffectedSide): Side[] {
  return affected === 'both' ? ['left', 'right'] : [affected];
}

export function buildExercisePlan(phase: Phase, affected: AffectedSide, prescriptions: Prescription[], restMs = 30_000): SessionPlan {
  const blocks = prescriptions.flatMap((p) =>
    affectedSides(affected).map((side): Block => ({ exerciseId: p.exerciseId, side, kind: 'exercise', ceilingDeg: p.ceilingDeg, reps: p.reps, sets: p.sets })),
  );
  return { kind: 'exercise', phase, blocks, restMs };
}

/** Range check: a few reps as high as comfortable, no limit. Used before surgery and for the healthy arm. */
export function buildRangeCheckPlan(phase: Phase, sides: Side[], exerciseIds: ExerciseId[]): SessionPlan {
  const blocks = exerciseIds.flatMap((exerciseId) =>
    sides.map((side): Block => ({ exerciseId, side, kind: 'assessment', ceilingDeg: null, reps: RANGE_CHECK_REPS, sets: 1 })),
  );
  return { kind: 'assessment', phase, blocks, restMs: 10_000 };
}
