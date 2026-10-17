import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import type { RefObject } from 'react';

gsap.registerPlugin(useGSAP, DrawSVGPlugin, MotionPathPlugin, ScrollTrigger, SplitText);

// Use fromTo with explicit end values, not from(): when data loads twice (React StrictMode, a
// refetch), a second from() reads the half-faded state as its end value and freezes there.

/** Matches the CSS --ease, cubic-bezier(0.22, 1, 0.36, 1). */
export const EASE = 'expo.out';

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Lets CSS pre-hide [data-reveal] elements so they don't flash before GSAP fades them in.
if (typeof document !== 'undefined') document.documentElement.classList.add('js-motion');

/** Fades and lifts every [data-reveal] element inside `scope`, in document order. */
export function useReveal(scope: RefObject<HTMLElement | null>, dependencies: unknown[] = []) {
  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', scope.current);
      if (!items.length) return;
      if (reducedMotion()) {
        gsap.set(items, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(items, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.07, clearProps: 'transform' });
    },
    { scope, dependencies },
  );
}

/** Counts every [data-count] element up from zero. Suffix and decimals come from data attributes. */
export function countUp(scope: Element | null) {
  if (!scope || reducedMotion()) return;
  for (const el of gsap.utils.toArray<HTMLElement>('[data-count]', scope)) {
    const to = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals ?? 0);
    const suffix = el.dataset.suffix ?? '';
    const state = { v: 0 };
    gsap.to(state, {
      v: to,
      duration: 1.4,
      ease: EASE,
      onUpdate: () => {
        el.textContent = `${state.v.toFixed(decimals)}${suffix}`;
      },
    });
  }
}

/** A quick pink pulse, for each completed rep. */
export function pop(el: Element | null) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(el, { scale: 1.28, color: '#d6336c' }, { scale: 1, color: '#0b0b0b', duration: 0.6, ease: 'back.out(3)', overwrite: true });
}

/** A short horizontal shake, for passing the limit. */
export function shake(el: Element | null) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(el, { x: -10 }, { x: 0, duration: 0.6, ease: 'elastic.out(1.1, 0.3)', overwrite: true });
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
