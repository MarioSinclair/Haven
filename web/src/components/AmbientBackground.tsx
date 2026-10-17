import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

const POINTS = 150;

/**
 * Stacked ridgelines in perspective, like a pulsar plot: each line a signal, each peak a rep.
 * Nearer lines hide the ones behind them. Peaks glow pink toward the middle, the cursor lifts
 * the lines under it, and a click sends a pulse back through the stack. Fixed behind the page,
 * paused in background tabs, a still frame under reduced motion.
 */
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let rows = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rows = Math.round(Math.min(38, Math.max(22, h / 24)));
    };
    resize();

    const still = reducedMotion();
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    const pulses: number[] = [];
    let now = 0;
    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
    };
    const onLeave = () => {
      pointer.tx = pointer.ty = -9999;
    };
    const onDown = () => {
      pulses.push(now);
      if (pulses.length > 3) pulses.shift();
    };

    // Stable pseudo-random per row and bump.
    const rnd = (a: number, b: number) => {
      const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };

    const xs = new Float32Array(POINTS + 1);
    const ys = new Float32Array(POINTS + 1);

    const draw = (ms: number) => {
      now = ms / 1000;
      const t = now + window.scrollY * 0.002;
      pointer.x += (pointer.tx - pointer.x) * 0.1;
      pointer.y += (pointer.ty - pointer.y) * 0.1;
      while (pulses.length && now - pulses[0] > 2.4) pulses.shift();

      ctx.clearRect(0, 0, w, h);
      const top = h * 0.4;
      const bottom = h * 1.04;

      for (let r = 0; r < rows; r++) {
        const u = r / (rows - 1); // 0 far → 1 near
        // Perspective: rows spread out and widen as they come forward.
        const yBase = top + (bottom - top) * (u * 0.55 + u * u * 0.45);
        const scale = 0.5 + 0.5 * u;
        const halfW = (w / 2) * (0.62 + 0.5 * u);
        const amp = h * 0.075 * scale;
        const alpha = 0.18 + 0.5 * u;

        // A pulse travels from the front row to the back after a click.
        let boost = 0;
        for (const p0 of pulses) {
          const front = 1 - (now - p0) / 1.4;
          boost += Math.exp(-((u - front) ** 2) / 0.006) * Math.max(0, 1 - (now - p0) / 2.4);
        }

        for (let i = 0; i <= POINTS; i++) {
          const nx = i / POINTS - 0.5; // -0.5 … 0.5
          const sx = w / 2 + nx * 2 * halfW;
          // Flat edges, active middle.
          const env = Math.exp(-Math.pow(Math.abs(nx) / 0.24, 3));
          let sig = 0;
          for (let k = 0; k < 4; k++) {
            const center = 0.18 * Math.sin(rnd(r, k) * 6.28 + t * (0.18 + 0.12 * k));
            const width = 0.018 + 0.03 * rnd(k, r);
            const height = 0.35 + 0.65 * rnd(r + 7, k);
            sig += height * Math.exp(-((nx - center) ** 2) / (2 * width * width));
          }
          sig += 0.12 * Math.sin(nx * 60 + r * 1.3 + t * 1.6) * Math.sin(nx * 23 - t);
          let y = yBase - amp * env * (sig * (1 + boost * 1.6));

          // The cursor lifts nearby lines.
          const dx = sx - pointer.x;
          const dy = yBase - pointer.y;
          const near = Math.exp(-(dx * dx) / (2 * 90 * 90) - (dy * dy) / (2 * 70 * 70));
          if (near > 0.01) y -= near * 46 * scale * (0.6 + 0.4 * Math.abs(Math.sin(nx * 30 + t * 3)));

          xs[i] = sx;
          ys[i] = y;
        }

        // Fill under the line with white so nearer rows hide the ones behind.
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i <= POINTS; i++) ctx.lineTo(xs[i], ys[i]);
        ctx.lineTo(xs[POINTS], h + 10);
        ctx.lineTo(xs[0], h + 10);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Gray at the edges, pink where the signal lives.
        const grad = ctx.createLinearGradient(xs[0], 0, xs[POINTS], 0);
        grad.addColorStop(0, `rgba(150, 140, 144, ${alpha * 0.45})`);
        grad.addColorStop(0.35, `rgba(150, 140, 144, ${alpha * 0.8})`);
        grad.addColorStop(0.5, `rgba(214, 51, 108, ${Math.min(1, alpha * (1.1 + boost))})`);
        grad.addColorStop(0.65, `rgba(150, 140, 144, ${alpha * 0.8})`);
        grad.addColorStop(1, `rgba(150, 140, 144, ${alpha * 0.45})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2 + 0.6 * u;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i <= POINTS; i++) ctx.lineTo(xs[i], ys[i]);
        ctx.stroke();
      }
    };

    // Full strength at the top of the page, dimming as you scroll into the content.
    let shownOpacity = -1;
    const onScroll = () => {
      const k = Math.min(1, window.scrollY / (h * 0.9));
      const opacity = 1 - 0.72 * k * k * (3 - 2 * k);
      if (Math.abs(opacity - shownOpacity) > 0.01) {
        canvas.style.opacity = opacity.toFixed(2);
        shownOpacity = opacity;
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const onResize = () => {
      resize();
      onScroll();
      if (still) draw(0);
    };
    window.addEventListener('resize', onResize);

    if (still) {
      draw(0);
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll);
      };
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    let raf = 0;
    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (!document.hidden) draw(ms);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
