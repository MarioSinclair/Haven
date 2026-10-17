import type { AffectedSide, CameraView, ExerciseId, Phase, Side } from './types';

export interface Exercise {
  id: ExerciseId;
  name: string;
  view: CameraView;
  instruction: string;
}

export const EXERCISES: Record<ExerciseId, Exercise> = {
  side_raise: {
    id: 'side_raise',
    name: 'Side raise',
    view: 'front',
    instruction: 'Face the camera. Raise your arm out to the side with your thumb up, then lower slowly.',
  },
  scaption: {
    id: 'scaption',
    name: 'Scaption raise',
    view: 'front',
    instruction: 'Face the camera. Raise your arm slightly in front of your body, thumb up, then lower slowly.',
  },
  forward_raise: {
    id: 'forward_raise',
    name: 'Forward raise',
    view: 'side',
    instruction: 'Turn so your working arm is closest to the camera. Raise your arm straight in front of you, then lower slowly.',
  },
};

export interface Prescription {
  exerciseId: ExerciseId;
  /** null = as tolerated. */
  ceilingDeg: number | null;
  /** null = use the reference hierarchy in baseline.ts. */
  goalDeg: number | null;
  reps: number;
  sets: number;
}

// PLACEHOLDER protocol for the demo. Real limits come from the patient's surgeon or PT through
// the clinician view; the 90° drain-phase limit is common but not universal.
export const DEFAULT_PROTOCOL: Record<Phase, { label: string; prescriptions: Prescription[] }> = {
  1: {
    label: 'Drains in',
    prescriptions: [
      { exerciseId: 'side_raise', ceilingDeg: 90, goalDeg: null, reps: 10, sets: 2 },
      { exerciseId: 'scaption', ceilingDeg: 90, goalDeg: null, reps: 10, sets: 2 },
    ],
  },
  2: {
    label: 'Drains out, building range',
    prescriptions: [
      { exerciseId: 'side_raise', ceilingDeg: null, goalDeg: null, reps: 10, sets: 2 },
      { exerciseId: 'scaption', ceilingDeg: null, goalDeg: null, reps: 10, sets: 2 },
    ],
  },
  3: {
    label: 'Full range',
    prescriptions: [
      { exerciseId: 'side_raise', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
      { exerciseId: 'scaption', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
      { exerciseId: 'forward_raise', ceilingDeg: null, goalDeg: null, reps: 12, sets: 3 },
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
