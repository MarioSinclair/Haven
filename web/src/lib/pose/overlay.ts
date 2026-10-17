import type { CeilingState } from '../session/ceiling';
import type { CameraView, Side } from '../types';
import { dist, LM, sideLandmarks, sub, type RawLandmark, type Vec2 } from './angles';

const UPPER_BODY: [number, number][] = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW, LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW, LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
];

// Bright enough to read on top of live video.
const STATE_COLOR: Record<CeilingState, string> = { ok: '#ff6ea1', near: '#fbbf24', over: '#ff4d4d' };

export interface OverlayOptions {
  side: Side;
  view: CameraView;
  ceilingDeg: number | null;
  state: CeilingState;
}

/**
 * Draws in raw camera coordinates. The canvas is mirrored with CSS along with the video,
 * which is why all text lives in the HTML layer instead of on the canvas.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, lm: RawLandmark[] | null, w: number, h: number, opts: OverlayOptions) {
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const p = (i: number): Vec2 => ({ x: lm[i].x * w, y: lm[i].y * h });
  const unit = Math.max(2, w / 320);
  const ix = sideLandmarks(opts.side);

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = unit;
  for (const [a, b] of UPPER_BODY) line(ctx, p(a), p(b));

  const shoulder = p(ix.shoulder);
  const elbow = p(ix.elbow);
  const wrist = p(ix.wrist);

  if (opts.ceilingDeg !== null) {
    const down = normalize(sub(p(ix.hip), shoulder));
    // Rotate the trunk-down direction toward the side the arm rises on.
    const theta = -raiseDirection(lm, opts.side, opts.view) * ((opts.ceilingDeg * Math.PI) / 180);
    const dir = { x: down.x * Math.cos(theta) - down.y * Math.sin(theta), y: down.x * Math.sin(theta) + down.y * Math.cos(theta) };
    const len = (dist(shoulder, elbow) + dist(elbow, wrist)) * 1.15;
    ctx.save();
    ctx.setLineDash([unit * 4, unit * 3]);
    ctx.strokeStyle = STATE_COLOR.over;
    ctx.lineWidth = unit * 1.5;
    line(ctx, shoulder, { x: shoulder.x + dir.x * len, y: shoulder.y + dir.y * len });
    ctx.restore();
  }

  ctx.strokeStyle = STATE_COLOR[opts.state];
  ctx.lineWidth = unit * 3;
  line(ctx, shoulder, elbow);
  line(ctx, elbow, wrist);

  ctx.fillStyle = '#ffffff';
  for (const pt of [shoulder, elbow, wrist]) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, unit * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** +1 if the arm rises toward +x in the raw image, -1 otherwise. */
function raiseDirection(lm: RawLandmark[], side: Side, view: CameraView): number {
  const ix = sideLandmarks(side);
  const dx = view === 'front' ? lm[ix.shoulder].x - lm[ix.otherShoulder].x : lm[LM.NOSE].x - lm[ix.shoulder].x;
  return dx >= 0 ? 1 : -1;
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
