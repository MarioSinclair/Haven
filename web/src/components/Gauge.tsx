import type { CeilingState } from '../lib/session/ceiling';

const CX = 12;
const CY = 100;
const R = 84;

/** 0° points down, 90° out, 180° up, mirroring how the arm actually moves. */
function point(deg: number, r = R) {
  const a = (Math.max(0, Math.min(180, deg)) * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY + r * Math.cos(a) };
}

function arc(toDeg: number) {
  const start = point(0);
  const end = point(toDeg);
  return `M ${start.x} ${start.y} A ${R} ${R} 0 0 0 ${end.x} ${end.y}`;
}

export function Gauge({ deg, ceilingDeg, state }: { deg: number | null; ceilingDeg: number | null; state: CeilingState }) {
  const tickIn = ceilingDeg !== null ? point(ceilingDeg, R - 14) : null;
  const tickOut = ceilingDeg !== null ? point(ceilingDeg, R + 10) : null;
  return (
    <svg className="gauge" viewBox="0 0 110 200" role="img" aria-label={deg === null ? 'No arm angle' : `Arm at ${Math.round(deg)} degrees`}>
      <path d={arc(180)} className="gauge-track" />
      {deg !== null && deg > 0.5 && <path d={arc(deg)} className={`gauge-fill gauge-${state}`} />}
      {tickIn && tickOut && <line x1={tickIn.x} y1={tickIn.y} x2={tickOut.x} y2={tickOut.y} className="gauge-limit" />}
    </svg>
  );
}
