export interface RepEvent {
  index: number;
  startT: number;
  peakT: number;
  endT: number;
  peakDeg: number;
}

export interface RepCounterOptions {
  /** Angle measured during calibration with the arm relaxed. */
  restDeg: number;
  /** A rep starts once the arm rises this far above rest. */
  startAbove?: number;
  /** ...and ends when it comes back below this. The gap between the two is the hysteresis. */
  endBelow?: number;
  /** Peaks that rise less than this above rest are fidgets, not reps. */
  minRise?: number;
}

export class RepCounter {
  private up = false;
  private startT = 0;
  private peakDeg = -Infinity;
  private peakT = 0;
  private count = 0;
  private readonly startDeg: number;
  private readonly endDeg: number;
  private readonly minPeak: number;

  constructor(opts: RepCounterOptions) {
    this.startDeg = opts.restDeg + (opts.startAbove ?? 20);
    this.endDeg = opts.restDeg + (opts.endBelow ?? 12);
    this.minPeak = opts.restDeg + (opts.minRise ?? 25);
  }

  get isUp() {
    return this.up;
  }

  get reps() {
    return this.count;
  }

  /** Highest angle so far in the rep in progress, or null between reps. */
  get currentPeak(): number | null {
    return this.up ? this.peakDeg : null;
  }

  update(deg: number, t: number): RepEvent | null {
    if (!this.up) {
      if (deg > this.startDeg) {
        this.up = true;
        this.startT = t;
        this.peakDeg = deg;
        this.peakT = t;
      }
      return null;
    }
    if (deg > this.peakDeg) {
      this.peakDeg = deg;
      this.peakT = t;
    }
    if (deg >= this.endDeg) return null;

    this.up = false;
    if (this.peakDeg < this.minPeak) return null;
    this.count += 1;
    return { index: this.count, startT: this.startT, peakT: this.peakT, endT: t, peakDeg: this.peakDeg };
  }
}
