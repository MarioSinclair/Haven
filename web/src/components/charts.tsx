import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  phases,
  markers,
  showTitle = true,
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
  /** Shaded spans behind the data, e.g. recovery phases. */
  phases?: { fromDay: string; toDay: string; label: string }[];
  /** Pins along the top edge, e.g. days a symptom was reported. */
  markers?: { day: string; label: string }[];
  /** Panels already show a title in their header. */
  showTitle?: boolean;
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
      gsap.fromTo('.series-line', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.6, ease: 'power2.out', stagger: 0.2 });
      gsap.fromTo('.dot, .end-label', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, delay: 1.2 });
    },
    { scope: hover.ref },
  );

  return (
    <figure className="chart">
      <figcaption>
        {showTitle && <span className="chart-title">{title}</span>}
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
          {phases?.map((p, i) => {
            const half = f.days.length > 1 ? (f.x(f.days[1]) - f.x(f.days[0])) / 2 : 8;
            const x0 = Math.max(M.left, f.x(p.fromDay) - half);
            const x1 = Math.min(f.w - M.right, f.x(p.toDay) + half);
            return (
              <g key={p.label} className={`phase phase-${i % 2}`}>
                <rect x={x0} width={Math.max(0, x1 - x0)} y={M.top} height={height - M.top - M.bottom} />
                <text x={x0 + 6} y={M.top + 12}>
                  {p.label}
                </text>
              </g>
            );
          })}
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
          {markers?.map((m) => (
            <g key={m.day} className="marker">
              <line x1={f.x(m.day)} x2={f.x(m.day)} y1={M.top} y2={height - M.bottom - 9} />
              <path d={`M${f.x(m.day) - 5},${height - M.bottom - 1} h10 l-5,-8 z`} />
            </g>
          ))}
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
            {markers?.filter((m) => m.day === hover.day).map((m) => (
              <span key={m.label} className="tip-marker">
                {m.label}
              </span>
            ))}
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
  showTitle = true,
  height = 200,
}: {
  title: string;
  points: { day: string; value: number }[];
  color: string;
  yMax: number;
  yTicks: number[];
  unit: string;
  detail?: (day: string) => string | null;
  showTitle?: boolean;
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
      gsap.fromTo('.bar', { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.9, ease: 'expo.out', stagger: 0.025 });
    },
    { scope: hover.ref },
  );

  return (
    <figure className="chart">
      {showTitle && (
        <figcaption>
          <span className="chart-title">{title}</span>
        </figcaption>
      )}
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

/** Seconds as m:ss. */
function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/**
 * A raw sensor trace drawn like a monitor strip: a readable window of the session, with an
 * overview of the whole session underneath. Click or drag the overview to move the window.
 */
export function TraceChart({
  points,
  color = SERIES_COLORS[0],
  yMax = 180,
  height = 210,
  windowS = 60,
  label,
}: {
  points: { s: number; deg: number }[];
  color?: string;
  yMax?: number;
  height?: number;
  windowS?: number;
  label: string;
}) {
  const size = useWidth();
  const w = size.w;
  const total = Math.max(1, points[points.length - 1]?.s ?? 1);
  const win = Math.min(windowS, total);
  const [start, setStart] = useState(0);
  const innerW = w - M.left - 16;
  const innerH = height - M.top - M.bottom;
  const x = (sec: number) => M.left + ((sec - start) / win) * innerW;
  const y = (deg: number) => M.top + innerH - (Math.min(deg, yMax) / yMax) * innerH;
  const svg = useRef<SVGSVGElement>(null);
  const overview = useRef<SVGSVGElement>(null);
  const clipId = `trace-clip-${useId().replace(/:/g, '')}`;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.fromTo('.trace-line', { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.8, ease: 'power1.inOut' });
      gsap.fromTo('.trace-area', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1, delay: 1.2 });
    },
    { scope: svg, dependencies: [points.length] },
  );

  const visible = points.filter((p) => p.s >= start - 1 && p.s <= start + win + 1);
  const line = visible.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${y(p.deg).toFixed(1)}`).join('');
  const area = visible.length ? `${line} L${x(visible[visible.length - 1].s)},${y(0)} L${x(visible[0].s)},${y(0)} Z` : '';
  const ticks = Array.from({ length: 7 }, (_, i) => start + (win / 6) * i);
  const hovered = hoverIdx === null ? null : points[hoverIdx];

  const onMove = (e: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const sec = start + ((((e.clientX - box.left) / box.width) * w - M.left) / innerW) * win;
    let best = 0;
    for (let i = 0; i < points.length; i++) if (Math.abs(points[i].s - sec) < Math.abs(points[best].s - sec)) best = i;
    setHoverIdx(points[best].s >= start && points[best].s <= start + win ? best : null);
  };

  // Overview: whole session, small.
  const oh = 34;
  const ox = (sec: number) => M.left + (sec / total) * innerW;
  const oy = (deg: number) => oh - 3 - (Math.min(deg, yMax) / yMax) * (oh - 6);
  const overviewPath = points.map((p, i) => `${i ? 'L' : 'M'}${ox(p.s).toFixed(1)},${oy(p.deg).toFixed(1)}`).join('');
  const seek = (e: React.PointerEvent) => {
    const box = overview.current!.getBoundingClientRect();
    const sec = ((((e.clientX - box.left) / box.width) * w - M.left) / innerW) * total;
    setStart(Math.max(0, Math.min(total - win, sec - win / 2)));
  };

  return (
    <div className="chart-plot" ref={size.ref}>
      <svg ref={svg} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHoverIdx(null)}>
        <g className="axes">
          {[0, 45, 90, 135, 180]
            .filter((t) => t <= yMax)
            .map((t) => (
              <g key={t}>
                <line x1={M.left} x2={w - 16} y1={y(t)} y2={y(t)} className="grid" />
                <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {t}°
                </text>
              </g>
            ))}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle">
              {clock(t)}
            </text>
          ))}
        </g>
        <clipPath id={clipId}>
          <rect x={M.left} y={0} width={innerW} height={height} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          <path d={area} className="trace-area" fill={color} />
          <path d={line} className="trace-line" stroke={color} />
        </g>
        {hovered && (
          <>
            <line className="crosshair" x1={x(hovered.s)} x2={x(hovered.s)} y1={M.top} y2={height - M.bottom} />
            <circle cx={x(hovered.s)} cy={y(hovered.deg)} r={4} fill={color} className="dot" />
          </>
        )}
      </svg>
      {hovered && (
        <div className="chart-tip" style={{ left: `${(x(hovered.s) / w) * 100}%`, transform: `translateX(${x(hovered.s) / w > 0.6 ? '-105%' : '5%'})` }}>
          <strong>{clock(hovered.s)}</strong>
          <span>{Math.round(hovered.deg)}° arm elevation</span>
        </div>
      )}
      {total > win && (
        <svg
          ref={overview}
          className="trace-overview"
          viewBox={`0 0 ${w} ${oh}`}
          role="slider"
          aria-label="Move the window through the session"
          aria-valuemin={0}
          aria-valuemax={Math.round(total - win)}
          aria-valuenow={Math.round(start)}
          aria-valuetext={`${clock(start)} to ${clock(start + win)}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setStart((s0) => Math.min(total - win, s0 + win / 4));
            if (e.key === 'ArrowLeft') setStart((s0) => Math.max(0, s0 - win / 4));
          }}
          onPointerDown={(e) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            seek(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons) seek(e);
          }}
        >
          <path d={overviewPath} className="overview-line" />
          <rect x={ox(start)} y={1} width={ox(start + win) - ox(start)} height={oh - 2} className="overview-window" rx={3} />
        </svg>
      )}
    </div>
  );
}

/** A tiny trend line for stat tiles: history in gray, the latest point in the accent. */
export function Sparkline({ values, width = 96, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => height - 3 - ((v - lo) / Math.max(1e-6, hi - lo)) * (height - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} />
    </svg>
  );
}
