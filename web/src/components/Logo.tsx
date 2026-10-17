import { useRef } from 'react';
import { gsap, reducedMotion, useGSAP } from '../lib/motion';

/** Set by the ribbon gate when its ribbon lands in this spot, so the logo doesn't redraw itself. */
export const LANDED_KEY = 'ribbon-landed';

/** A single-stroke awareness ribbon, drawn on when it first appears. */
export function Logo({ size = 22, animate = true }: { size?: number; animate?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  useGSAP(
    () => {
      let landed = false;
      try {
        landed = sessionStorage.getItem(LANDED_KEY) === '1';
        sessionStorage.removeItem(LANDED_KEY);
      } catch {
        // Storage can be unavailable (private mode); just animate.
      }
      if (!animate || landed || reducedMotion()) return;
      gsap.fromTo('path', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.4, ease: 'power2.inOut', delay: 0.15 });
    },
    { scope: ref },
  );
  return (
    <svg ref={ref} className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.2 21.5 L13.6 11.2 C15.4 7.8 15.2 4.6 12 4.4 C8.8 4.6 8.6 7.8 10.4 11.2 L15.8 21.5"
        fill="none"
        stroke="var(--pink)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
