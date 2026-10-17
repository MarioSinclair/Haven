import type { Cue } from '../session/engine';

const DEFAULT_COOLDOWN_MS = 2500;

/**
 * Speaks engine cues. Speech takes a few hundred ms to start, so limit alerts also get an
 * instant beep. Repeated cues are rate-limited by key so the patient isn't nagged.
 */
export class Coach {
  enabled = true;
  private lastSpoken = new Map<string, number>();
  private audio: AudioContext | null = null;

  /** Call from a click handler; browsers keep audio locked until the user interacts. */
  unlock() {
    this.audio ??= new AudioContext();
    void this.audio.resume();
  }

  say(cue: Cue) {
    if (!this.enabled) return;
    const now = performance.now();
    const last = this.lastSpoken.get(cue.key);
    const cooldown = cue.cooldownMs ?? (cue.key === 'count' ? 0 : DEFAULT_COOLDOWN_MS);
    if (last !== undefined && now - last < cooldown) return;
    this.lastSpoken.set(cue.key, now);

    if (cue.beep) this.beep();
    if (!('speechSynthesis' in window)) return;
    if (cue.interrupt) speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cue.text);
    utterance.rate = 1.05;
    speechSynthesis.speak(utterance);
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
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
