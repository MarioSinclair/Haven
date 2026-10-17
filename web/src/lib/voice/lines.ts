// Every line the voice coach can say. The session engine builds its cues from here, and the voice
// pack (`npm run voice-pack` in server/) records each one in a warm voice. A line written anywhere
// else has no recording and falls back to the browser's voice.
import { LIMIT_RANGE, REPS_RANGE, SETS_RANGE } from '../carePlan';
import { EXERCISES, RANGE_CHECK_REPS } from '../protocol';
import type { ExerciseId, Side } from '../types';

export const LINES = {
  calibrate: 'Stand tall and let your arms rest at your sides. Hold still for a moment.',
  calibrateStill: 'Nice. Just hold still a little longer.',
  lost: "I've lost sight of your arm. Try a small step back.",
  uncounted: "I lost sight of your arm, so that one didn't count. Try a small step back.",
  near: "You're close to your limit. Nice and easy.",
  over: "That's a little past your limit. Lower slowly, you're doing fine.",
  hike: 'Let your shoulder soften down, away from your ear.',
  lean: 'Stand nice and tall, and keep your body still.',
  elbow: 'Keep your elbow long and straight.',
  limitGeneral: "Stay under your limit today. I'll let you know if you get close.",
  rangeCheckDone: 'Got it, thank you.',
  painQuestion: 'Nicely done. How much pain did you feel during that set, from zero to ten?',
  symptoms: 'One last question. Have you noticed any heaviness or swelling in your arm, or a tight cord under your arm?',
  rest: 'Take a rest, and let your arm hang loose.',
  done: 'Wonderful work today. Your session is complete.',
} as const;

export const positionLine = (first: boolean, exerciseId: ExerciseId, side: Side) =>
  `${first ? "Let's begin." : 'Nice work. Next exercise.'} ${EXERCISES[exerciseId].name}, ${side} arm. ${EXERCISES[exerciseId].instruction}`;

export const rangeCheckLine = (reps: number) => `Raise your arm as high as feels comfortable, ${reps} times. No need to push.`;

export const firstSetLine = (reps: number) => `Whenever you're ready. ${reps} ${reps === 1 ? 'rep' : 'reps'}.`;

export const nextSetLine = (set: number, sets: number) => `Set ${set} of ${sets}. You've got this.`;

/** Limits are usually round numbers, so those get spoken; any other limit gets the general reminder. */
export const limitLine = (deg: number) => (deg % 5 === 0 ? `Your limit today is ${deg} degrees. I'll let you know if you get close.` : LINES.limitGeneral);

export const countLine = (n: number) => String(n);

/** Everything above, with every number a plan can produce, for the voice pack. */
export function allLines(): string[] {
  const lines = new Set<string>(Object.values(LINES));
  for (const id of Object.keys(EXERCISES) as ExerciseId[]) {
    for (const side of ['left', 'right'] as Side[]) {
      lines.add(positionLine(true, id, side));
      lines.add(positionLine(false, id, side));
    }
  }
  lines.add(rangeCheckLine(RANGE_CHECK_REPS));
  for (let n = REPS_RANGE.min; n <= REPS_RANGE.max; n++) {
    lines.add(firstSetLine(n));
    lines.add(countLine(n));
  }
  for (let sets = 2; sets <= SETS_RANGE.max; sets++) for (let set = 2; set <= sets; set++) lines.add(nextSetLine(set, sets));
  for (let deg = LIMIT_RANGE.min; deg <= LIMIT_RANGE.max; deg++) lines.add(limitLine(deg));
  return [...lines];
}
