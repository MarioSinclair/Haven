import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

/**
 * A faint monitor behind the page: a dot grid with arm-angle traces drifting across it, each a
 * run of reps of varying height, with a live cursor near the right edge. Fixed, non-interactive,
 * capped at 30 fps, paused in background tabs, and a still frame under reduced motion.
 */
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const traces = [
      { y: 0.22, amp: 38, period: 260, speed: 22, alpha: 0.3, seed: 1 },
      { y: 0.48, amp: 52, period: 330, speed: 15, alpha: 0.18, seed: 7 },
      { y: 0.74, amp: 32, period: 210, speed: 28, alpha: 0.24, seed: 3 },
      { y: 0.95, amp: 44, period: 290, speed: 18, alpha: 0.15, seed: 5 },
    ];

    // Height of rep n, between 0.55 and 1, stable for a given n.
    const repHeight = (n: number, seed: number) => 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(n * 2.399 + seed * 1.7));
    // One rep: rest, smooth rise, brief hold, smooth return.
    const repShape = (p: number) => {
      const rise = Math.min(1, Math.max(0, (p - 0.08) / 0.84));
      return (1 - Math.cos(2 * Math.PI * rise)) / 2;
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(11, 11, 11, 0.1)';
      const gap = 28;
      for (let x = gap / 2; x < w; x += gap) for (let y = gap / 2; y < h; y += gap) ctx.fillRect(x, y, 1.2, 1.2);

      const cursorX = w * 0.84;
      for (const t of traces) {
        const base = h * t.y;
        const shift = (time / 1000) * t.speed;
        ctx.beginPath();
        for (let x = 0; x <= cursorX; x += 3) {
          const u = (x + shift) / t.period;
          const n = Math.floor(u);
          const y = base - t.amp * repHeight(n, t.seed) * repShape(u - n);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(214, 51, 108, ${t.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        const u = (cursorX + shift) / t.period;
        const n = Math.floor(u);
        const cy = base - t.amp * repHeight(n, t.seed) * repShape(u - n);
        ctx.fillStyle = `rgba(214, 51, 108, ${Math.min(0.6, t.alpha * 3)})`;
        ctx.beginPath();
        ctx.arc(cursorX, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // The sweep line every monitor has.
      ctx.fillStyle = 'rgba(11, 11, 11, 0.05)';
      ctx.fillRect(cursorX, 0, 1, h);
    };

    if (reducedMotion()) {
      draw(0);
      return () => window.removeEventListener('resize', resize);
    }

    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < 33) return;
      last = now;
      draw(now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
