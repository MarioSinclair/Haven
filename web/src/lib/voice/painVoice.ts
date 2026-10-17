const WORDS: Record<string, number> = {
  zero: 0, none: 0, nothing: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Pulls a 0–10 rating out of a transcript like "about a 4" or "seven". */
export function parsePainRating(transcript: string): number | null {
  const text = transcript.toLowerCase();
  if (/\bno pain\b/.test(text)) return 0;
  const digits = text.match(/\b(10|[0-9])\b/);
  if (digits) return Number(digits[1]);
  for (const word of text.split(/[^a-z]+/)) {
    if (word in WORDS) return WORDS[word];
  }
  return null;
}

// Chrome ships this prefixed and TypeScript's DOM types don't include it.
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceInputSupported = () => typeof window !== 'undefined' && recognitionCtor() !== null;

/**
 * Listens once for a spoken rating. Chrome sends this audio to Google's speech service; the
 * camera video never leaves the laptop, but voice answers do. Tap buttons are the primary input.
 */
export function listenForPain(onRating: (n: number) => void, onFail: (reason: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onFail('Voice input is not supported in this browser');
    return () => undefined;
  }
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 3;
  let settled = false;
  rec.onresult = (e) => {
    const alternatives = Array.from(e.results[0] ?? []).map((a) => a.transcript);
    for (const alt of alternatives) {
      const n = parsePainRating(alt);
      if (n !== null) {
        settled = true;
        onRating(n);
        return;
      }
    }
    settled = true;
    onFail(`Didn't catch a number in "${alternatives[0] ?? ''}"`);
  };
  rec.onerror = (e) => {
    if (settled) return;
    settled = true;
    onFail(e.error === 'not-allowed' ? 'Microphone permission denied' : `Voice input error: ${e.error}`);
  };
  rec.onend = () => {
    if (!settled) onFail("Didn't hear anything");
  };
  rec.start();
  return () => {
    settled = true;
    rec.abort();
  };
}
