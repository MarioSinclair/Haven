import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { daysBetween } from '../lib/flags';
import { gsap, reducedMotion, useGSAP } from '../lib/motion';

// Validated (dataviz validator, light mode on #ffffff): brand pink, blue.
export const SERIES_COLORS = ['#d6336c', '#2a78d6'];
const LIMIT_COLOR = '#d03b3b';

const M = { top: 14, right: 96, bottom: 28, left: 40 };

export interface Series {
  id: string;
  label: string;
  color: string;
  points: { day: string; value: number }[];
}

interface Frame {
  w: number;
  days: string[];
  x: (day: string) => number;
  y: (v: number) => number;
  height: number;
}

function frame(w: number, allDays: string[], yMax: number, height: number): Frame {
  const days = [...new Set(allDays)].sort();
  const span = Math.max(1, daysBetween(days[0], days[days.length - 1]));
  const innerW = w - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  return {
    w,
    days,
    x: (day) => M.left + (daysBetween(days[0], day) / span) * innerW,
    y: (v) => M.top + innerH - (v / yMax) * innerH,
    height,
  };
}

export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}

function Axes({ f, yTicks, unit }: { f: Frame; yTicks: number[]; unit: string }) {
  const step = Math.max(1, Math.ceil(f.days.length / Math.max(2, Math.floor(f.w / 110))));
  return (
    <g className="axes">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={f.w - M.right} y1={f.y(t)} y2={f.y(t)} className="grid" />
          <text x={M.left - 6} y={f.y(t)} dy="0.32em" textAnchor="end">
            {t}
            {unit}
          </text>
        </g>
      ))}
      {f.days
        .filter((_, i) => i % step === 0)
        .map((d) => (
          <text key={d} x={f.x(d)} y={f.height - 8} textAnchor="middle">
            {shortDay(d)}
          </text>
        ))}
    </g>
  );
}

/** The plot's rendered width, so the SVG is drawn at 1:1 and text stays its real size. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** Hover layer: nearest day under the pointer, a crosshair, and an HTML tooltip. */
function useHover(f: Frame) {
  const ref = useRef<SVGSVGElement>(null);
  const [day, setDay] = useState<string | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * f.w;
    let best = f.days[0];
    for (const d of f.days) if (Math.abs(f.x(d) - vx) < Math.abs(f.x(best) - vx)) best = d;
    setDay(best);
  };
  return { ref, day, onMove, onLeave: () => setDay(null) };
}

function Tooltip({ f, day, children }: { f: Frame; day: string; children: ReactNode }) {
  const left = (f.x(day) / f.w) * 100;
  return (
    <div className="chart-tip" style={{ left: `${left}%`, transform: `translateX(${left > 60 ? '-105%' : '5%'})` }}>
      <strong>{shortDay(day)}</strong>
      {children}
    </div>
  );
}

function TableToggle({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="link chart-table-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide table' : 'Show table'}
      </button>
      {open && (
        <table className="rx chart-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function LineChart({
  title,
  series,
  yMax,
  yTicks,
  unit,
  band,
  limit,
  height = 260,
}: {
  title: string;
  series: Series[];
  yMax: number;
  yTicks: number[];
  unit: string;
  /** Shaded reference range, e.g. range before surgery. */
  band?: { from: number; to: number; label: string };
  /** Horizontal limit drawn only across the days it applied. */
  limit?: { value: number; fromDay: string; toDay: string; label: string };
  height?: number;
}) {
  const size = useWidth();
  const f = frame(
    size.w,
    series.flatMap((s) => s.points.map((p) => p.day)),
    yMax,
    height,
  );
  const hover = useHover(f);
  const valueAt = (s: Series, day: string) => s.points.find((p) => p.day === day)?.value;
  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.from('.series-line', { drawSVG: '0%', duration: 1.6, ease: 'power2.out', stagger: 0.2 });
      gsap.from('.dot, .end-label', { autoAlpha: 0, duration: 0.4, delay: 1.2 });
    },
    { scope: hover.ref },
  );

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
        {series.length > 1 && (
          <span className="legend">
            {series.map((s) => (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div className="chart-plot" ref={size.ref}>
        <svg ref={hover.ref} viewBox={`0 0 ${f.w} ${height}`} onPointerMove={hover.onMove} onPointerLeave={hover.onLeave} role="img" aria-label={title}>
          <Axes f={f} yTicks={yTicks} unit={unit} />
          {band && (
            <g className="ref-band">
              <rect x={M.left} width={f.w - M.left - M.right} y={f.y(band.to)} height={Math.max(2, f.y(band.from) - f.y(band.to))} />
              <text x={f.w - M.right + 8} y={f.y((band.from + band.to) / 2)}>
                {band.label.split('\n').map((line, i) => (
                  <tspan key={i} x={f.w - M.right + 8} dy={i === 0 ? '-0.2em' : '1.2em'}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          )}
          {limit && (
            <g className="limit">
              <line x1={f.x(limit.fromDay)} x2={f.x(limit.toDay)} y1={f.y(limit.value)} y2={f.y(limit.value)} stroke={LIMIT_COLOR} />
              {/* Above the line at its left end, where the range is still below the limit. */}
              <text x={f.x(limit.fromDay) + 4} y={f.y(limit.value) - 7}>
                {limit.label}
              </text>
            </g>
          )}
          {hover.day && <line className="crosshair" x1={f.x(hover.day)} x2={f.x(hover.day)} y1={M.top} y2={height - M.bottom} />}
          {series.map((s) => {
            const last = s.points[s.points.length - 1];
            return (
              <g key={s.id}>
                <path d={s.points.map((p, i) => `${i ? 'L' : 'M'}${f.x(p.day)},${f.y(p.value)}`).join('')} stroke={s.color} className="series-line" />
                {hover.day && valueAt(s, hover.day) !== undefined && <circle cx={f.x(hover.day)} cy={f.y(valueAt(s, hover.day)!)} r={4.5} fill={s.color} className="dot" />}
                {last && <circle cx={f.x(last.day)} cy={f.y(last.value)} r={4} fill={s.color} className="dot" />}
              </g>
            );
          })}
          {series.length <= 4 &&
            endLabels(series, f, unit).map((l) => (
              <text key={l.id} x={f.w - M.right + 10} y={l.y} dy="0.32em" className="end-label">
                {l.text}
              </text>
            ))}
        </svg>
        {hover.day && (
          <Tooltip f={f} day={hover.day}>
            {series.map((s) => {
              const v = valueAt(s, hover.day!);
              return (
                <span key={s.id}>
                  <i style={{ background: s.color }} />
                  {s.label}: {v === undefined ? 'no session' : `${Math.round(v)}${unit}`}
                </span>
              );
            })}
          </Tooltip>
        )}
      </div>
      <TableToggle
        caption={title}
        head={['Day', ...series.map((s) => s.label)]}
        rows={f.days.map((d) => [shortDay(d), ...series.map((s) => (valueAt(s, d) === undefined ? '–' : `${Math.round(valueAt(s, d)!)}${unit}`))])}
      />
    </figure>
  );
}

/** End labels sit beside the last point; if two would overlap, the lower one moves down. */
function endLabels(series: Series[], f: Frame, unit: string) {
  const labels = series
    .filter((s) => s.points.length)
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { id: s.id, y: f.y(last.value), text: `${Math.round(last.value)}${unit}` };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  return labels;
}

export function BarChart({
  title,
  points,
  color,
  yMax,
  yTicks,
  unit,
  detail,
  height = 200,
}: {
  title: string;
  points: { day: string; value: number }[];
  color: string;
  yMax: number;
  yTicks: number[];
  unit: string;
  detail?: (day: string) => string | null;
  height?: number;
}) {
  const size = useWidth();
  const f = frame(
    size.w,
    points.map((p) => p.day),
    yMax,
    height,
  );
  const hover = useHover(f);
  const slot = (f.w - M.left - M.right) / Math.max(1, f.days.length);
  const barW = Math.min(24, slot - 2);
  const r = Math.min(4, barW / 2);
  const hovered = hover.day ? points.find((p) => p.day === hover.day) : undefined;
  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.from('.bar', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.9, ease: 'expo.out', stagger: 0.025 });
    },
    { scope: hover.ref },
  );

  return (
    <figure className="chart">
      <figcaption>
        <span className="chart-title">{title}</span>
      </figcaption>
      <div className="chart-plot" ref={size.ref}>
        <svg ref={hover.ref} viewBox={`0 0 ${f.w} ${height}`} onPointerMove={hover.onMove} onPointerLeave={hover.onLeave} role="img" aria-label={title}>
          {/* The title names the unit; a word-long unit on every tick would crowd the bars. */}
          <Axes f={f} yTicks={yTicks} unit="" />
          {points.map((p) => {
            const x = f.x(p.day) - barW / 2;
            const top = f.y(p.value);
            const base = f.y(0);
            const h = Math.max(0, base - top);
            // Rounded data end, square at the baseline.
            const d = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
            return <path key={p.day} className="bar" d={h > r ? d : `M${x},${base} h${barW} v${-h} h${-barW} Z`} fill={color} opacity={hover.day && hover.day !== p.day ? 0.55 : 1} />;
          })}
        </svg>
        {hover.day && hovered && (
          <Tooltip f={f} day={hover.day}>
            <span>
              {Math.round(hovered.value)} {unit.trim()}
            </span>
            {detail?.(hover.day) && <span>{detail(hover.day)}</span>}
          </Tooltip>
        )}
      </div>
      <TableToggle
        caption={title}
        head={['Day', title]}
        rows={points.map((p) => [shortDay(p.day), `${Math.round(p.value)} ${unit.trim()}`])}
      />
    </figure>
  );
}
