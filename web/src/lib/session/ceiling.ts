export type CeilingState = 'ok' | 'near' | 'over';

/**
 * Tracks the arm against the clinician's limit. Leaving a state needs the angle to drop an extra
 * `hysteresisDeg`, so jitter at the boundary doesn't fire a stream of alerts.
 */
export class CeilingMonitor {
  private current: CeilingState = 'ok';

  constructor(
    readonly ceilingDeg: number | null,
    private warnMarginDeg = 8,
    private hysteresisDeg = 3,
  ) {}

  get state() {
    return this.current;
  }

  /** Returns the new state when it changes, otherwise null. */
  update(deg: number): CeilingState | null {
    if (this.ceilingDeg === null) return null;
    const over = this.ceilingDeg;
    const near = this.ceilingDeg - this.warnMarginDeg;
    const h = this.hysteresisDeg;

    let next = this.current;
    if (deg > over) next = 'over';
    else if (this.current === 'over' && deg > over - h) next = 'over';
    else if (deg >= near) next = 'near';
    else if (this.current !== 'ok' && deg > near - h) next = 'near';
    else next = 'ok';

    if (next === this.current) return null;
    this.current = next;
    return next;
  }
}
