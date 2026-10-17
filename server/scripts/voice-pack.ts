// Records every coaching line in web/src/lib/voice/lines.ts with a Gemini voice, so sessions play
// natural speech instantly and offline. Each clip is transcribed back and re-recorded if the words
// don't match. Re-run after changing the lines; clips for unchanged lines are kept.
//   npm run voice-pack                    # record new or changed lines
//   npm run voice-pack -- --force         # re-record everything
//   npm run voice-pack -- --voice Kore    # another Gemini voice (re-records everything)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allLines } from '../../web/src/lib/voice/lines';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
// Sulafat is the voice Google describes as warm. This model takes a tone instruction without
// reading it aloud; the newer TTS models speak it.
const VOICE = option('voice') ?? 'Sulafat';
const MODEL = option('model') ?? 'gemini-2.5-flash-preview-tts';
const STYLE = 'Say warmly and encouragingly: ';
const CHECK_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ATTEMPTS = 3;
const WORKERS = 3;

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('Set GEMINI_API_KEY in server/.env first');

const out = join(dirname(fileURLToPath(import.meta.url)), '../../web/public/voice');
const manifestPath = join(out, 'manifest.json');
// AAC is a tenth the size of WAV; afconvert ships with macOS. Elsewhere the clips stay WAV.
const aac = existsSync('/usr/bin/afconvert');

interface Manifest {
  voice: string;
  model: string;
  clips: Record<string, string>;
}

mkdirSync(out, { recursive: true });
const previous: Manifest | null = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const fresh = args.includes('--force') || !previous || previous.voice !== VOICE || previous.model !== MODEL;
const manifest: Manifest = { voice: VOICE, model: MODEL, clips: fresh ? {} : { ...previous!.clips } };

const lines = allLines();
for (const text of Object.keys(manifest.clips)) if (!lines.includes(text)) delete manifest.clips[text];
const todo = lines.filter((text) => !manifest.clips[text] || !existsSync(join(out, manifest.clips[text])));
console.log(`${lines.length} lines, ${todo.length} to record with ${VOICE} (${MODEL})${aac ? '' : ', saved as WAV'}`);

const mismatches: string[] = [];
const failed: string[] = [];
let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
      let wav: Buffer | null = null;
      let heard = '';
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          const take = await speak(text);
          heard = await transcribe(take);
          wav = take;
          if (normalize(heard) === normalize(text)) break;
        } catch (err) {
          heard = err instanceof Error ? err.message : String(err);
        }
      }
      // A line that never records keeps the browser's voice; the next run tries it again.
      if (!wav) {
        failed.push(`"${text}": ${heard}`);
        continue;
      }
      if (normalize(heard) !== normalize(text)) mismatches.push(`"${text}" was heard as "${heard}"`);
      const file = `${createHash('sha1').update(`${VOICE}|${MODEL}|${text}`).digest('hex').slice(0, 12)}.${aac ? 'm4a' : 'wav'}`;
      writeFileSync(join(out, file), aac ? toAac(wav) : wav);
      manifest.clips[text] = file;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`  ${++done}/${todo.length} ${text.length > 70 ? `${text.slice(0, 67)}...` : text}`);
    }
  }),
);

// Clips for lines that no longer exist.
const keep = new Set(Object.values(manifest.clips));
for (const file of readdirSync(out)) if (/\.(m4a|wav)$/.test(file) && !keep.has(file)) rmSync(join(out, file));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`done: ${Object.keys(manifest.clips).length} clips in web/public/voice`);
if (mismatches.length) console.log(`kept after ${ATTEMPTS} tries, check by ear:\n  ${mismatches.join('\n  ')}`);
if (failed.length) console.log(`not recorded (run again to retry):\n  ${failed.join('\n  ')}`);

async function gemini(model: string, body: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key!, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    // Rate limits and hiccups: back off and try again.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = 5000 * 2 ** attempt;
      console.log(`    ${model} answered ${res.status}; waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${model}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

async function speak(text: string): Promise<Buffer> {
  const json = await gemini(MODEL, {
    contents: [{ parts: [{ text: STYLE + speakable(text) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
  });
  const audio = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!audio) throw new Error(`No audio for "${text}"`);
  const bytes = Buffer.from(audio.data, 'base64');
  if (/wav/i.test(audio.mimeType)) return bytes;
  // Raw 16-bit mono PCM: wrap it in a WAV header.
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24000);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

async function transcribe(wav: Buffer): Promise<string> {
  const json = await gemini(CHECK_MODEL, {
    contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: 'Transcribe this audio exactly. Reply with the words only.' }] }],
  });
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

/** A bare count like "3" gets no audio back; "Three." does. */
function speakable(text: string): string {
  if (!/^\d+$/.test(text)) return text;
  const small = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const n = Number(text);
  if (n < 20) return `${small[n]}.`;
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? `-${small[n % 10].toLowerCase()}` : ''}.`;
  return `${text}.`;
}

function toAac(wav: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  try {
    writeFileSync(join(dir, 'in.wav'), wav);
    execFileSync('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '48000', join(dir, 'in.wav'), join(dir, 'out.m4a')]);
    return readFileSync(join(dir, 'out.m4a'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Lowercase words with numbers as digits, so "Seven." matches "7". */
function normalize(text: string): string {
  const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const words = text.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  const outWords: string[] = [];
  let n: number | null = null;
  const flush = () => {
    if (n !== null) outWords.push(String(n));
    n = null;
  };
  for (const w of words) {
    if (small.includes(w)) n = (n ?? 0) + small.indexOf(w);
    else if (tens.includes(w) && w) n = (n ?? 0) + tens.indexOf(w) * 10;
    else if (w === 'hundred' && n !== null) n *= 100;
    else if (w === 'and' && n !== null) continue;
    else {
      flush();
      outWords.push(w);
    }
  }
  flush();
  return outWords.join(' ');
}
