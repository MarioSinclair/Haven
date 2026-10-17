import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

/**
 * Soft color fields that drift and swirl. `home` is a spot on the screen (0–1), `orbit` how far
 * the blob wanders from it, `speed` in radians a second, and `depth` how much it leans toward
 * the cursor. They live near the edges, so most of the page stays white.
 */
const BLOBS = [
  { rgb: [251, 182, 211], alpha: 0.55, radius: 0.36, home: [0.94, 0.06], orbit: 0.08, speed: 0.21, phase: 0, depth: 0.04 },
  { rgb: [249, 168, 212], alpha: 0.3, radius: 0.3, home: [0.98, 0.64], orbit: 0.1, speed: 0.16, phase: 2.1, depth: 0.06 },
  { rgb: [221, 211, 255], alpha: 0.4, radius: 0.34, home: [0.04, 0.94], orbit: 0.08, speed: 0.18, phase: 4.2, depth: 0.04 },
  { rgb: [253, 214, 230], alpha: 0.5, radius: 0.28, home: [0.16, 0.05], orbit: 0.1, speed: 0.26, phase: 1.3, depth: 0.05 },
] as const;

/** Drawn at a sixth of the screen's resolution: the browser's upscaling softens it for free. */
const SCALE = 6;
const FRAME_MS = 33;

/**
 * A soft pink gradient behind the page: color fields drift and slowly swirl, lean toward the
 * cursor, and a faint glow follows it. Fixed behind the content, about 30 frames a second,
 * paused in background tabs, and a still frame under reduced motion.
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
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.ceil(w / SCALE);
      canvas.height = Math.ceil(h / SCALE);
      ctx.setTransform(1 / SCALE, 0, 0, 1 / SCALE, 0, 0);
    };
    resize();

    const pointer = { x: 0, y: 0, tx: 0, ty: 0, presence: 0, target: 0 };
    const rgba = ([r, g, b]: readonly number[], a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

    const glow = (x: number, y: number, radius: number, rgb: readonly number[], alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, rgba(rgb, alpha));
      g.addColorStop(0.45, rgba(rgb, alpha * 0.55));
      g.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };

    const draw = (seconds: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      pointer.presence += (pointer.target - pointer.presence) * 0.05;

      const size = Math.max(w, h);
      const cx = w / 2;
      const cy = h / 2;
      // The whole field turns once every five minutes or so; each blob loops on its own.
      const swirl = seconds * 0.02;
      const leanX = (pointer.x - cx) * pointer.presence;
      const leanY = (pointer.y - cy) * pointer.presence;

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      for (const b of BLOBS) {
        const a = b.phase + seconds * b.speed;
        const hx = (b.home[0] - 0.5) * w;
        const hy = (b.home[1] - 0.5) * h;
        const x = cx + hx * Math.cos(swirl) - hy * Math.sin(swirl) + Math.cos(a) * b.orbit * size + leanX * b.depth;
        const y = cy + hx * Math.sin(swirl) + hy * Math.cos(swirl) + Math.sin(a * 1.3) * b.orbit * size * 0.7 + leanY * b.depth;
        glow(x, y, b.radius * size * (1 + 0.06 * Math.sin(a * 0.7)), b.rgb, b.alpha);
      }
      if (pointer.presence > 0.01) glow(pointer.x, pointer.y, size * 0.16, [244, 132, 190], 0.14 * pointer.presence);

      // Two faint diagonal sheens, like light across glass.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.55);
      for (const [offset, width] of [
        [-0.18, 0.16],
        [0.22, 0.09],
      ]) {
        const x0 = (offset + Math.sin(seconds * 0.05 + offset * 9) * 0.04) * size;
        const sheen = ctx.createLinearGradient(x0 - (width * size) / 2, 0, x0 + (width * size) / 2, 0);
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0)');
        sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
        sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(x0 - (width * size) / 2, -size, width * size, size * 2);
      }
      ctx.restore();
    };

    const start = performance.now();
    draw(0);
    const onResize = () => {
      resize();
      draw((performance.now() - start) / 1000);
    };
    window.addEventListener('resize', onResize);
    if (reducedMotion()) return () => window.removeEventListener('resize', onResize);

    const onMove = (e: PointerEvent) => {
      // Arriving from outside the window, start at the cursor instead of sweeping in from the middle.
      if (pointer.presence < 0.01) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
      }
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      pointer.target = 1;
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) onLeave();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', onLeave);

    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw((now - start) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
