// One Euro filter (Casiez et al., 2012): smooths jitter at rest without lagging fast movements.
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(
    private minCutoffHz = 1.5,
    private beta = 0.02,
    private dCutoffHz = 1.0,
  ) {}

  reset() {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }

  filter(value: number, tMs: number): number {
    if (this.x === null || this.lastT === null || tMs <= this.lastT) {
      this.x = value;
      this.lastT = tMs;
      return value;
    }
    const dt = (tMs - this.lastT) / 1000;
    this.lastT = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoffHz, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoffHz + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}
