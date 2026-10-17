import type { Cue } from '../session/engine';

const DEFAULT_COOLDOWN_MS = 2500;

/** Natural-sounding English female voices, best first, for lines the voice pack doesn't have. */
const FALLBACK_VOICES = ['Ava', 'Zoe', 'Samantha', 'Allison', 'Serena', 'Karen', 'Moira', 'Tessa', 'Microsoft Aria', 'Microsoft Jenny', 'Google UK English Female', 'Google US English', 'Microsoft Zira'];

type Utterance = { clip: AudioBuffer } | { text: string };

/**
 * Speaks engine cues: recorded clips from the voice pack (web/public/voice) where there is one,
 * the browser's best female voice otherwise. Cues play in order unless one interrupts, limit
 * alerts also get an instant beep, and repeated cues are rate-limited by key so the patient
 * isn't nagged.
 */
export class Coach {
  enabled = true;
  private lastSpoken = new Map<string, number>();
  private audio: AudioContext | null = null;
  private clips = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private queue: Utterance[] = [];
  private playing: AudioBufferSourceNode | SpeechSynthesisUtterance | null = null;

  /** Fetches and decodes the voice pack once. Call it early, so the first line already has a voice. */
  preload(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const res = await fetch('/voice/manifest.json');
        if (!res.ok) return;
        const { clips } = (await res.json()) as { clips: Record<string, string> };
        // An offline context decodes without the user gesture a live one needs.
        const decoder = new OfflineAudioContext(1, 1, 24000);
        await Promise.all(
          Object.entries(clips).map(async ([text, file]) => {
            try {
              this.clips.set(text, await decoder.decodeAudioData(await (await fetch(`/voice/${file}`)).arrayBuffer()));
            } catch {
              // That line falls back to the browser's voice.
            }
          }),
        );
      } catch {
        // No voice pack: every line uses the browser's voice.
      }
    })();
    return this.loading;
  }

  /** Call from a click handler; browsers keep audio locked until the user interacts. */
  unlock() {
    this.audio ??= new AudioContext();
    void this.audio.resume();
    void this.preload();
  }

  say(cue: Cue) {
    if (!this.enabled) return;
    const now = performance.now();
    const last = this.lastSpoken.get(cue.key);
    const cooldown = cue.cooldownMs ?? (cue.key === 'count' ? 0 : DEFAULT_COOLDOWN_MS);
    if (last !== undefined && now - last < cooldown) return;
    this.lastSpoken.set(cue.key, now);

    if (cue.beep) this.beep();
    if (cue.interrupt) this.silence();
    const clip = this.clips.get(cue.text);
    this.queue.push(clip && this.audio ? { clip } : { text: cue.text });
    if (!this.playing) this.next();
  }

  beep(freqHz = 880, ms = 140) {
    if (!this.audio) return;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0.2, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + ms / 1000);
    osc.connect(gain).connect(this.audio.destination);
    osc.start();
    osc.stop(this.audio.currentTime + ms / 1000);
  }

  silence() {
    this.queue = [];
    const playing = this.playing;
    this.playing = null;
    if (playing instanceof AudioBufferSourceNode) {
      playing.onended = null;
      playing.stop();
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  private next() {
    const item = this.queue.shift();
    this.playing = null;
    if (!item) return;
    if ('clip' in item) {
      const source = this.audio!.createBufferSource();
      source.buffer = item.clip;
      source.connect(this.audio!.destination);
      source.onended = () => this.playing === source && this.next();
      this.playing = source;
      source.start();
    } else if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(item.text);
      const voice = fallbackVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 0.98;
      utterance.pitch = 1.05;
      utterance.onend = utterance.onerror = () => this.playing === utterance && this.next();
      this.playing = utterance;
      speechSynthesis.speak(utterance);
    } else {
      this.next();
    }
  }
}

/** The first preferred voice the browser has, premium or natural versions first. */
function fallbackVoice(): SpeechSynthesisVoice | null {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const quality = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) ? 2 : /enhanced|natural|online/i.test(v.name) ? 1 : 0);
  for (const name of FALLBACK_VOICES) {
    const matches = english.filter((v) => v.name.includes(name)).sort((a, b) => quality(b) - quality(a));
    if (matches.length) return matches[0];
  }
  return english.find((v) => /female/i.test(v.name)) ?? null;
}
