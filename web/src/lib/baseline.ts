import type { AffectedSide, ExerciseId, Side } from './types';

export type BaselineSource = 'pre_op' | 'contralateral' | 'first_session' | 'normative';

export interface BaselineRow {
  exerciseId: ExerciseId;
  side: Side;
  source: BaselineSource;
  peakDeg: number;
  measuredAt: string;
}

export type ReferenceSource = 'clinician_goal' | 'pre_op' | 'contralateral' | 'general_goal';

export interface Reference {
  deg: number;
  source: ReferenceSource;
}

/**
 * What progress is measured against, best evidence first: a goal the PT set, the same arm before
 * surgery, the healthy arm, then a general goal. Patients who start tracking after surgery still
 * get a target, and their first session becomes the starting point (see startingPoint).
 */
export function resolveReference(
  baselines: BaselineRow[],
  exerciseId: ExerciseId,
  side: Side,
  affected: AffectedSide,
  generalGoalDeg: number,
  clinicianGoalDeg: number | null = null,
): Reference {
  if (clinicianGoalDeg !== null) return { deg: clinicianGoalDeg, source: 'clinician_goal' };

  const forExercise = baselines.filter((b) => b.exerciseId === exerciseId);
  const preOp = latest(forExercise.filter((b) => b.side === side && b.source === 'pre_op'));
  if (preOp) return { deg: preOp.peakDeg, source: 'pre_op' };

  const other: Side = side === 'left' ? 'right' : 'left';
  const otherIsHealthy = affected !== 'both' && affected !== other;
  const healthy = otherIsHealthy ? latest(forExercise.filter((b) => b.side === other)) : undefined;
  if (healthy) return { deg: healthy.peakDeg, source: 'contralateral' };

  return { deg: generalGoalDeg, source: 'general_goal' };
}

/** Earliest post-surgery measurement on this arm, used for "gained X° since you started". */
export function startingPoint(baselines: BaselineRow[], exerciseId: ExerciseId, side: Side): BaselineRow | undefined {
  const rows = baselines.filter((b) => b.exerciseId === exerciseId && b.side === side && b.source === 'first_session');
  return rows.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))[0];
}

/** Labels a range check so the reference hierarchy above can find it later. */
export function baselineSourceFor(measuredOn: Date, surgeryDate: Date | null, side: Side, affected: AffectedSide): BaselineSource {
  if (surgeryDate && measuredOn < surgeryDate) return 'pre_op';
  if (affected !== 'both' && side !== affected) return 'contralateral';
  return 'first_session';
}

export function percentOf(currentDeg: number, ref: Reference): number {
  return Math.round((currentDeg / ref.deg) * 100);
}

function latest(rows: BaselineRow[]): BaselineRow | undefined {
  return rows.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
}
