// Checks that every number in model-written prose appears in the data the model was given.
// This is how "Gemini explains, never invents" is enforced rather than just requested.

/** Every number in a JSON value, including ones inside strings like "Oct 14" or "2026-10-14". */
export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (typeof value === 'string') for (const m of value.matchAll(NUMBER)) out.push(Number(m[0]));
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, out);
  return out;
}

/**
 * Numbers in `text` with no match in `allowed`. Integers may round from the data (104 from
 * 103.8); decimals must match to one place. "17%" counts as 17.
 */
export function unsupportedNumbers(text: string, allowed: number[]): string[] {
  const misses = new Set<string>();
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const n = Number(raw);
    const tolerance = raw.includes('.') ? 0.05 : 0.5;
    if (!allowed.some((a) => Math.abs(a - n) <= tolerance)) misses.add(raw);
  }
  return [...misses];
}

// Digits not glued to letters, so "3rd" or "v2" don't count but "17%" and "90°" do.
const NUMBER = /(?<![\w.])\d+(?:\.\d+)?(?![\w])/g;
