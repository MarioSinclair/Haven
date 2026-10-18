import { useEffect, useState } from 'react';
import { reducedMotion } from '../lib/motion';
import { EXERCISES } from '../lib/protocol';
import type { ExerciseId, Side } from '../lib/types';

interface Props {
  exerciseId: ExerciseId;
  /** The working arm. Shown as in a mirror, the way the camera shows the patient. */
  side?: Side;
  /** The PT's limit: the figure raises only this far, and a dashed line marks it. */
  limitDeg?: number | null;
  size?: number;
}

const INK = '#0b0b0b';
const PINK = '#d6336c';
const GUIDE = '#d9cfd3';
const ARM = 36;
const DEFAULT_PEAK = 150;

/**
 * A figure doing the exercise on a loop, with the working arm in pink, so the patient can see the
 * movement instead of reading it. A still frame at the top of the movement under reduced motion.
 */
export function ExerciseDemo({ exerciseId, side = 'left', limitDeg = null, size = 96 }: Props) {
  const ex = EXERCISES[exerciseId];
  const cycleMs = exerciseId === 'wall_walk' ? 6400 : exerciseId === 'shoulder_roll' ? 2600 : 4200;
  const p = useLoop(cycleMs, exerciseId === 'shoulder_roll' ? 0.25 : 0.44);
  const peak = Math.min(DEFAULT_PEAK, limitDeg ?? DEFAULT_PEAK);

  return (
    <svg className="demo" viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`How to do the ${ex.name.toLowerCase()}`}>
      {exerciseId === 'forward_raise' && <SideFigure elevation={peak * raiseProfile(p)} peak={peak} limit={limitDeg} />}
      {exerciseId === 'wall_walk' && <WallWalk p={p} side={side} peak={peak} limit={limitDeg} />}
      {exerciseId === 'elbow_wing' && <ElbowWing p={p} side={side} />}
      {exerciseId === 'shoulder_roll' && <FrontFigure side={side} elevation={4} roll={p} />}
      {(exerciseId === 'side_raise' || exerciseId === 'scaption') && (
        // Scaption raises the arm 30° in front of the side plane, so seen from the front it reaches out less.
        <FrontFigure side={side} elevation={peak * raiseProfile(p)} peak={peak} limit={limitDeg} spread={exerciseId === 'scaption' ? Math.cos(Math.PI / 6) : 1} />
      )}
    </svg>
  );
}

/** Raise to the top, pause, lower slowly, rest: 0–1 of the way up. */
function raiseProfile(p: number): number {
  if (p < 0.38) return ease(p / 0.38);
  if (p < 0.5) return 1;
  if (p < 0.88) return 1 - ease((p - 0.5) / 0.38);
  return 0;
}

const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
const rad = (deg: number) => (deg * Math.PI) / 180;

function useLoop(cycleMs: number, still: number): number {
  const [phase, setPhase] = useState(still);
  useEffect(() => {
    if (reducedMotion()) return;
    const start = performance.now();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      setPhase(((now - start) % cycleMs) / cycleMs);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycleMs]);
  return phase;
}

/** Facing the viewer. The patient's left arm is on the viewer's left, as in a mirror. */
function FrontFigure({ side, elevation, peak, limit, spread = 1, roll }: { side: Side; elevation: number; peak?: number; limit?: number | null; spread?: number; roll?: number }) {
  // A shoulder roll lifts both shoulders toward the ears and draws them back, which reads as a
  // small rise and a slight narrowing from the front.
  const a = roll === undefined ? 0 : 2 * Math.PI * roll;
  const lift = roll === undefined ? 0 : 4 * (0.5 - 0.5 * Math.cos(a));
  const narrow = roll === undefined ? 0 : 1.2 * Math.max(0, Math.sin(a));
  const left = { x: 45 + narrow, y: 37 - lift };
  const right = { x: 75 - narrow, y: 37 - lift };
  const working = side === 'left' ? left : right;
  const dir = side === 'left' ? -1 : 1;
  const hand = (s: { x: number; y: number }, d: number, deg: number, k = 1) => ({ x: s.x + d * Math.sin(rad(deg)) * ARM * k, y: s.y + Math.cos(rad(deg)) * ARM });
  const rest = 7;
  const otherHand = hand(side === 'left' ? right : left, -dir, rest);
  const workHand = hand(working, dir, Math.max(rest, elevation), spread);

  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      {peak !== undefined && <Guides origin={working} dir={dir} peak={peak} limit={limit ?? null} spread={spread} />}
      <FrontBody left={left} right={right} lift={lift} />
      <line x1={(side === 'left' ? right : left).x} y1={(side === 'left' ? right : left).y} x2={otherHand.x} y2={otherHand.y} stroke={INK} strokeWidth="2.6" />
      <line x1={working.x} y1={working.y} x2={workHand.x} y2={workHand.y} stroke={PINK} strokeWidth="3.4" />
      <circle cx={workHand.x} cy={workHand.y} r="2.6" fill={PINK} />
      {roll !== undefined && (
        // Little arrows over each shoulder: up, back and down.
        <g stroke={PINK} strokeWidth="1.6">
          <path d="M34 34 A7 7 0 1 1 39 25" />
          <path d="M39 25 l-3.6 -0.4 M39 25 l-1.2 3.4" />
          <path d="M86 34 A7 7 0 1 0 81 25" />
          <path d="M81 25 l3.6 -0.4 M81 25 l1.2 3.4" />
        </g>
      )}
    </g>
  );
}

/** Side-on, facing right; the working arm is the near one. */
function SideFigure({ elevation, peak, limit }: { elevation: number; peak: number; limit: number | null }) {
  const shoulder = { x: 58, y: 38 };
  const hand = { x: shoulder.x + Math.sin(rad(Math.max(5, elevation))) * ARM, y: shoulder.y + Math.cos(rad(Math.max(5, elevation))) * ARM };
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      <Guides origin={shoulder} dir={1} peak={peak} limit={limit} />
      <SideBody />
      <line x1={shoulder.x} y1={shoulder.y} x2={hand.x} y2={hand.y} stroke={PINK} strokeWidth="3.4" />
      <circle cx={hand.x} cy={hand.y} r="2.6" fill={PINK} />
    </g>
  );
}

/** Side-on to the wall, facing the viewer: fingers walk up the wall in steps to the limit, pause, and slide down. */
function WallWalk({ p, side, peak, limit }: { p: number; side: Side; peak: number; limit: number | null }) {
  const left = { x: 45, y: 37 };
  const right = { x: 75, y: 37 };
  const dir = side === 'left' ? -1 : 1;
  const shoulder = side === 'left' ? left : right;
  const other = side === 'left' ? right : left;
  const wallX = dir < 0 ? 12 : 108;
  const handX = wallX - dir * 2;
  const dx = Math.abs(shoulder.x - handX);
  // Highest point on the wall for this angle (measured from the arm hanging down).
  const topY = Math.max(6, shoulder.y + dx / Math.tan(rad(Math.max(91, peak))));
  const startY = shoulder.y + 8;
  let y: number;
  if (p < 0.5) {
    const steps = 7;
    const q = (p / 0.5) * steps;
    y = startY + (topY - startY) * ((Math.floor(q) + ease(q - Math.floor(q))) / steps);
  } else if (p < 0.62) y = topY;
  else if (p < 0.9) y = topY + (startY - topY) * ease((p - 0.62) / 0.28);
  else y = startY;
  const hand = { x: handX, y };
  const elbow = bentElbow(shoulder, hand, 22);
  const otherHand = { x: other.x - dir * Math.sin(rad(7)) * ARM, y: other.y + Math.cos(rad(7)) * ARM };
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      <line x1={wallX} y1="4" x2={wallX} y2="114" stroke={INK} strokeWidth="2.2" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={wallX} y1={8 + i * 10} x2={wallX + dir * 6} y2={2 + i * 10} stroke={GUIDE} strokeWidth="1.4" />
      ))}
      {limit !== null && <line x1={wallX - dir * 10} y1={topY} x2={wallX} y2={topY} stroke={PINK} strokeWidth="1.6" strokeDasharray="3 2.5" />}
      <FrontBody left={left} right={right} />
      <line x1={other.x} y1={other.y} x2={otherHand.x} y2={otherHand.y} stroke={INK} strokeWidth="2.6" />
      <path d={`M${shoulder.x} ${shoulder.y} L${elbow.x} ${elbow.y} L${hand.x} ${hand.y}`} stroke={PINK} strokeWidth="3.4" />
      <circle cx={hand.x} cy={hand.y} r="2.6" fill={PINK} />
    </g>
  );
}

/** Hands behind the head: elbows together in front of the chin, out wide, and back together. */
function ElbowWing({ p, side }: { p: number; side: Side }) {
  const left = { x: 45, y: 37 };
  const right = { x: 75, y: 37 };
  const open = raiseProfile(p);
  const elbowL = { x: 52 - 30 * open, y: 31 - 2 * open };
  const elbowR = { x: 68 + 30 * open, y: 31 - 2 * open };
  const handL = { x: 55, y: 15 };
  const handR = { x: 65, y: 15 };
  const color = (s: Side) => (s === side ? PINK : INK);
  const width = (s: Side) => (s === side ? 3.4 : 2.6);
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      {/* Forearms first, so the head hides the hands clasped behind it. */}
      <line x1={elbowL.x} y1={elbowL.y} x2={handL.x} y2={handL.y} stroke={color('left')} strokeWidth={width('left')} />
      <line x1={elbowR.x} y1={elbowR.y} x2={handR.x} y2={handR.y} stroke={color('right')} strokeWidth={width('right')} />
      <FrontBody left={left} right={right} />
      <line x1={left.x} y1={left.y} x2={elbowL.x} y2={elbowL.y} stroke={color('left')} strokeWidth={width('left')} />
      <line x1={right.x} y1={right.y} x2={elbowR.x} y2={elbowR.y} stroke={color('right')} strokeWidth={width('right')} />
      <circle cx={side === 'left' ? elbowL.x : elbowR.x} cy={side === 'left' ? elbowL.y : elbowR.y} r="2.6" fill={PINK} />
    </g>
  );
}

/** Head, torso and legs, facing the viewer. */
function FrontBody({ left, right, lift = 0 }: { left: { x: number; y: number }; right: { x: number; y: number }; lift?: number }) {
  return (
    <g>
      <circle cx="60" cy="19" r="9" stroke={INK} strokeWidth="2.2" fill="#fff" />
      <path d={`M${left.x} ${left.y} Q60 ${31 - lift} ${right.x} ${right.y} L72 75 L48 75 Z`} stroke={INK} strokeWidth="2.2" fill="#fff" />
      <path d="M52 75 L50 111 M68 75 L70 111" stroke={INK} strokeWidth="2.2" />
    </g>
  );
}

/** Where the elbow sits for a two-part arm reaching from shoulder to hand: below the line between them. */
function bentElbow(shoulder: { x: number; y: number }, hand: { x: number; y: number }, seg: number) {
  const d = Math.min(2 * seg - 0.01, Math.hypot(hand.x - shoulder.x, hand.y - shoulder.y));
  const mx = (shoulder.x + hand.x) / 2;
  const my = (shoulder.y + hand.y) / 2;
  const h = Math.sqrt(Math.max(0, seg * seg - (d / 2) ** 2));
  const ux = (hand.x - shoulder.x) / d;
  const uy = (hand.y - shoulder.y) / d;
  const a = { x: mx - uy * h, y: my + ux * h };
  const b = { x: mx + uy * h, y: my - ux * h };
  return a.y >= b.y ? a : b;
}

function SideBody({ x = 0 }: { x?: number }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <circle cx="56" cy="19" r="9" stroke={INK} strokeWidth="2.2" fill="#fff" />
      <path d="M64.5 18 L68 21 L64.5 22" stroke={INK} strokeWidth="1.8" />
      <path d="M52 33 L63 33 L62 75 L53 75 Z" stroke={INK} strokeWidth="2.2" fill="#fff" />
      <path d="M56 75 L54 111 M60 75 L63 111" stroke={INK} strokeWidth="2.2" />
    </g>
  );
}

/** The path the hand travels, and the PT's limit as a dashed pink line. */
function Guides({ origin, dir, peak, limit, spread = 1 }: { origin: { x: number; y: number }; dir: number; peak: number; limit: number | null; spread?: number }) {
  const r = ARM + 7;
  const at = (deg: number) => ({ x: origin.x + dir * Math.sin(rad(deg)) * r * spread, y: origin.y + Math.cos(rad(deg)) * r });
  const points = Array.from({ length: 24 }, (_, i) => at(8 + ((peak - 8) * i) / 23));
  const limitEnd = limit === null ? null : at(limit);
  return (
    <g>
      <polyline points={points.map((q) => `${q.x},${q.y}`).join(' ')} stroke={GUIDE} strokeWidth="1.5" strokeDasharray="2 3" fill="none" />
      {limitEnd && <line x1={origin.x} y1={origin.y} x2={limitEnd.x} y2={limitEnd.y} stroke={PINK} strokeWidth="1.6" strokeDasharray="3 2.5" />}
    </g>
  );
}
