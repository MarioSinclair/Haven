import { useEffect, useRef } from 'react';
import { reducedMotion } from '../lib/motion';

const GAP = 28; // grid spacing, px
const REACH = 190; // how far the cursor's pull reaches, px
const PUSH = 16; // how far a dot right by the cursor drifts aside, px
const DOT = 1.25; // resting radius, px
const GROW = 2; // extra radius right by the cursor, px
const EASE = 0.16; // per-frame easing, so the field trails the cursor instead of snapping
const INK = [11, 11, 11];
const PINK = [214, 51, 108];
const REST_ALPHA = 0.2;

/**
 * A faint dot grid behind the page. Dots near the cursor drift aside, swell and turn pink, then
 * ease back as it moves on. Fixed behind the page, it only draws while something is moving, and
 * it's a still grid under reduced motion.
 */
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let x0 = 0;
    let y0 = 0;
    // Each dot's eased offset and glow, so dots settle smoothly rather than jumping back.
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let glow = new Float32Array(0);
    let hot = new Int32Array(0);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(w / GAP) + 2;
      rows = Math.floor(h / GAP) + 2;
      x0 = (w - (cols - 1) * GAP) / 2;
      y0 = (h - (rows - 1) * GAP) / 2;
      ox = new Float32Array(cols * rows);
      oy = new Float32Array(cols * rows);
      glow = new Float32Array(cols * rows);
      hot = new Int32Array(cols * rows);
    };

    // The cursor, eased; `presence` fades the effect in and out as it enters and leaves the window.
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, presence: 0, target: 0 };

    /** Draws one frame; returns whether anything is still moving. */
    const frame = () => {
      pointer.x += (pointer.tx - pointer.x) * 0.22;
      pointer.y += (pointer.ty - pointer.y) * 0.22;
      pointer.presence += (pointer.target - pointer.presence) * 0.12;
      let moving = Math.abs(pointer.tx - pointer.x) > 0.1 || Math.abs(pointer.ty - pointer.y) > 0.1 || Math.abs(pointer.target - pointer.presence) > 0.003;

      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      let hotCount = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const x = x0 + c * GAP;
          const y = y0 + r * GAP;
          let gx = 0;
          let gy = 0;
          let gk = 0;
          if (pointer.presence > 0.003) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < REACH * REACH) {
              const d = Math.sqrt(d2) || 1;
              const f = 1 - d / REACH;
              gk = f * f * pointer.presence;
              gx = (dx / d) * PUSH * gk;
              gy = (dy / d) * PUSH * gk;
            }
          }
          ox[i] += (gx - ox[i]) * EASE;
          oy[i] += (gy - oy[i]) * EASE;
          glow[i] += (gk - glow[i]) * EASE;
          if (!moving && (Math.abs(gx - ox[i]) > 0.02 || Math.abs(gy - oy[i]) > 0.02 || Math.abs(gk - glow[i]) > 0.002)) moving = true;

          if (glow[i] > 0.02) {
            hot[hotCount++] = i;
          } else {
            ctx.moveTo(x + ox[i] + DOT, y + oy[i]);
            ctx.arc(x + ox[i], y + oy[i], DOT, 0, Math.PI * 2);
          }
        }
      }
      ctx.fillStyle = `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${REST_ALPHA})`;
      ctx.fill();

      // Dots near the cursor, drawn one by one: each blends from ink to pink as it glows.
      for (let n = 0; n < hotCount; n++) {
        const i = hot[n];
        const k = glow[i];
        const x = x0 + (i % cols) * GAP + ox[i];
        const y = y0 + Math.floor(i / cols) * GAP + oy[i];
        const mix = (a: number, b: number) => Math.round(a + (b - a) * Math.min(1, k * 1.6));
        ctx.fillStyle = `rgba(${mix(INK[0], PINK[0])}, ${mix(INK[1], PINK[1])}, ${mix(INK[2], PINK[2])}, ${REST_ALPHA + (0.85 - REST_ALPHA) * k})`;
        ctx.beginPath();
        ctx.arc(x, y, DOT + GROW * k, 0, Math.PI * 2);
        ctx.fill();
      }
      return moving;
    };

    const still = reducedMotion();
    let raf = 0;
    const tick = () => {
      raf = frame() ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    resize();
    frame();
    // Resizing resets every dot, so let the field ease back in rather than freeze mid-way.
    const onResize = () => {
      resize();
      if (still) frame();
      else wake();
    };
    window.addEventListener('resize', onResize);
    if (still) return () => window.removeEventListener('resize', onResize);

    const onMove = (e: PointerEvent) => {
      // Arriving from outside the window, start at the cursor instead of sweeping in from afar.
      if (pointer.presence < 0.01) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
      }
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      pointer.target = 1;
      wake();
    };
    const onLeave = () => {
      pointer.target = 0;
      wake();
    };
    const onOut = (e: MouseEvent) => {
      if (!e.relatedTarget) onLeave();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') onLeave();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('mouseout', onOut);
    window.addEventListener('blur', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseout', onOut);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  return <canvas ref={ref} className="ambient" aria-hidden="true" />;
}
