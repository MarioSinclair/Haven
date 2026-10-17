import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BandTrace, Progress, SystemStats } from '../lib/apiTypes';
import { daysBetween } from '../lib/flags';
import { countUp, EASE, gsap, reducedMotion, useGSAP } from '../lib/motion';
import { DEFAULT_PROTOCOL, EXERCISES } from '../lib/protocol';
import { BarChart, LineChart, SERIES_COLORS, shortDay, Sparkline, TraceChart } from './charts';
import { SEVERITY } from './ReportView';

const REFERENCE_NAME = { clinician_goal: 'PT goal', pre_op: 'pre-op', contralateral: 'other arm', general_goal: 'goal' } as const;
const SHORT_NAME = { side_raise: 'Side raise', scaption: 'Scaption', forward_raise: 'Forward' } as const;

interface Props {
  progress: Progress;
  bandTrace: BandTrace | null;
  system: SystemStats | null;
  /** Live from the server, or the bundled snapshot. */
  source: 'live' | 'snapshot';
  /** Rendered as the last panel, e.g. the Gemini report. */
  reportSlot?: ReactNode;
}

/** The clinician's console: one screen, every signal, each panel labelled like an instrument. */
export function Dashboard({ progress, bandTrace, system, source, reportSlot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const { patient, exercises, sessions, dailyUse, flags, asOf } = progress;

  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', root.current);
      if (reducedMotion()) {
        gsap.set(items, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(items, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.05, clearProps: 'transform' });
      gsap.fromTo('.event', { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.5, ease: EASE, stagger: 0.06, delay: 0.5 });
      countUp(root.current);
    },
    { scope: root, dependencies: [progress], revertOnUpdate: true },
  );

  const days = (from: string) => daysBetween(from, asOf);
  const window14 = sessions.filter((s) => days(s.day) < 14);
  const sessionDays = new Set(window14.map((s) => s.day));

  // KPIs
  const pained = sessions.filter((s) => s.maxPain !== null);
  const lastPain = pained[pained.length - 1]?.maxPain ?? null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const painRecent = mean(pained.slice(-3).map((s) => s.maxPain!));
  const painBefore = mean(pained.slice(-6, -3).map((s) => s.maxPain!));
  const useRecent = mean(dailyUse.slice(-3).map((u) => u.activeMinutes));
  const useBefore = mean(dailyUse.slice(-10, -3).map((u) => u.activeMinutes));
  const useDelta = useBefore ? ((useRecent - useBefore) / useBefore) * 100 : 0;
  const gaps = exercises.flatMap((e) => e.days.map((d) => d.cameraBandGapDeg).filter((g): g is number => g !== null));
  const gap = gaps.length ? mean(gaps) : null;

  // Phases and symptom pins for the range chart.
  const phases: { fromDay: string; toDay: string; label: string }[] = [];
  for (const s of sessions) {
    const last = phases[phases.length - 1];
    if (last && last.label.startsWith(`P${s.phase}`)) last.toDay = s.day;
    else phases.push({ fromDay: s.day, toDay: s.day, label: `P${s.phase} · ${DEFAULT_PROTOCOL[s.phase as 1 | 2 | 3].label.toUpperCase()}` });
  }
  const markers = sessions.filter((s) => s.armpitCord || s.armHeaviness).map((s) => ({ day: s.day, label: s.armHeaviness ? 'Swelling reported' : 'Cording reported' }));
  const phase1 = sessions.filter((s) => s.phase === 1);
  const phase1Limit = Math.min(...DEFAULT_PROTOCOL[1].prescriptions.map((p) => p.ceilingDeg ?? Infinity));
  const limit =
    phase1.length && Number.isFinite(phase1Limit)
      ? { value: phase1Limit, fromDay: phase1[0].day, toDay: phase1[phase1.length - 1].day, label: `${phase1Limit}° LIMIT` }
      : undefined;
  const refs = exercises.filter((e) => e.reference.source !== 'general_goal').map((e) => e.reference.deg);
  const band = refs.length
    ? { from: Math.min(...refs), to: Math.max(...refs), label: `${REFERENCE_NAME[exercises[0].reference.source].toUpperCase()}\n${Math.round(Math.min(...refs))}–${Math.round(Math.max(...refs))}°` }
    : undefined;

  // Per-day form and the session log.
  const byDay = new Map<string, { reps: number; comp: number; over: number; best: Record<string, number> }>();
  for (const e of exercises) {
    for (const d of e.days) {
      const row = byDay.get(d.day) ?? { reps: 0, comp: 0, over: 0, best: {} };
      row.reps += d.reps;
      row.comp += d.repsWithCompensation;
      row.over += d.repsOverCeiling;
      row.best[e.exerciseId] = d.bestPeakDeg;
      byDay.set(d.day, row);
    }
  }
  const formDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, r]) => ({ day, value: (r.comp / Math.max(1, r.reps)) * 100 }));
  const counts = { urgent: flags.filter((f) => f.severity === 'urgent').length, warn: flags.filter((f) => f.severity === 'warn').length, info: flags.filter((f) => f.severity === 'info').length };

  return (
    <div className="ops" ref={root}>
      <header className="ops-head" data-reveal>
        <div>
          <p className="ops-id">PATIENT {patient.id.slice(-4).toUpperCase()} · {patient.affectedSide.toUpperCase()} SIDE</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">{patient.surgeryType ?? 'Shoulder recovery'}</p>
        </div>
        <div className="ops-chips">
          {patient.surgeryDate && <span className="ops-chip">POST-OP DAY {days(patient.surgeryDate)}</span>}
          <span className="ops-chip">
            PHASE {patient.currentPhase} · {DEFAULT_PROTOCOL[patient.currentPhase].label.toUpperCase()}
          </span>
          <span className="ops-chip">DATA THROUGH {shortDay(asOf).toUpperCase()}</span>
          <span className={`ops-chip ops-live ${source}`}>
            <i className="led" />
            {source === 'live' ? 'LIVE' : 'SNAPSHOT'} <Clock />
          </span>
        </div>
      </header>

      <section className="ops-kpis" aria-label="Key numbers" data-reveal>
        {exercises.map((e) => {
          const last = e.days[e.days.length - 1];
          const best = Math.max(...e.days.map((d) => d.bestPeakDeg));
          const pct = Math.round((last.bestPeakDeg / e.reference.deg) * 100);
          return (
            <Kpi
              key={`${e.exerciseId}:${e.side}`}
              label={`${SHORT_NAME[e.exerciseId]} · % ${REFERENCE_NAME[e.reference.source]}`}
              value={pct}
              suffix="%"
              sub={`${Math.round(last.bestPeakDeg)}° now · ${Math.round(best)}° best`}
              tone={last.bestPeakDeg < best * 0.9 ? 'bad' : 'neutral'}
              spark={e.days.map((d) => d.bestPeakDeg)}
            />
          );
        })}
        <div className="kpi">
          <span className="kpi-label">Adherence · 14 d</span>
          <span className="kpi-value">
            <span data-count={sessionDays.size}>{sessionDays.size}</span>
            <small>/14</small>
          </span>
          <span className="adherence" aria-label={`${sessionDays.size} of the last 14 days had a session`}>
            {Array.from({ length: 14 }, (_, i) => {
              const d = new Date(Date.parse(`${asOf}T00:00:00Z`) - (13 - i) * 86_400_000).toISOString().slice(0, 10);
              return <i key={d} className={sessionDays.has(d) ? 'on' : ''} title={shortDay(d)} />;
            })}
          </span>
        </div>
        {lastPain !== null && (
          <Kpi
            label="Pain · last session"
            value={lastPain}
            suffix="/10"
            sub={`last 3 avg ${painRecent.toFixed(1)}, was ${painBefore.toFixed(1)}`}
            tone={painRecent - painBefore >= 2 ? 'bad' : 'neutral'}
            spark={pained.map((s) => s.maxPain!)}
          />
        )}
        {dailyUse.length > 0 && (
          <Kpi
            label="Arm use · min/day"
            value={Math.round(useRecent)}
            sub={`${useDelta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(useDelta))}% vs prior week`}
            tone={useDelta <= -30 ? 'bad' : 'neutral'}
            spark={dailyUse.map((u) => u.activeMinutes)}
          />
        )}
        {gap !== null && <Kpi label="Camera ↔ band" value={gap} decimals={1} suffix="°" sub="mean peak gap" tone="good" />}
      </section>

      <div className="ops-grid">
        <Panel id="01" title="Range of motion" meta="best per session · degrees" span={8}>
          <LineChart
            title="Range of motion"
            showTitle={false}
            unit="°"
            yMax={180}
            yTicks={[0, 45, 90, 135, 180]}
            band={band}
            limit={limit}
            phases={phases}
            markers={markers}
            height={300}
            series={exercises.map((e, i) => ({
              id: `${e.exerciseId}:${e.side}`,
              label: `${EXERCISES[e.exerciseId].name}${exercises.some((x) => x.side !== e.side) ? ` (${e.side})` : ''}`,
              color: SERIES_COLORS[i % SERIES_COLORS.length],
              points: e.days.map((d) => ({ day: d.day, value: d.bestPeakDeg })),
            }))}
          />
        </Panel>

        <Panel id="02" title="Event log" meta={`${counts.urgent} urgent · ${counts.warn} warn · ${counts.info} info`} span={4} status={counts.urgent ? 'bad' : counts.warn ? 'warn' : 'ok'}>
          <p className="fine ops-note">Raised by fixed rules in code, not by AI.</p>
          {flags.length === 0 ? (
            <p className="muted">All clear.</p>
          ) : (
            <ol className="events">
              {flags.map((f) => (
                <li key={f.rule} className={`event event-${f.severity}`}>
                  <span className="sev">{SEVERITY[f.severity].tag}</span>
                  <div>
                    <p className="event-title">{f.title}</p>
                    <p className="event-detail">{f.detail}</p>
                    <code>{f.rule}</code>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel
          id="03"
          title="Band telemetry"
          meta={bandTrace ? `${bandTrace.rawSamples.toLocaleString()} rows @ 20 Hz → ${bandTrace.points.length} pts @ ${bandTrace.hz} Hz` : 'no band data'}
          span={8}
        >
          {bandTrace ? (
            <>
              <TraceChart points={bandTrace.points} label="Arm elevation from the armband during the last session" />
              <p className="fine ops-note">
                Last session, {new Date(bandTrace.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Peak{' '}
                {Math.round(Math.max(...bandTrace.points.map((p) => p.deg)))}°. Raw stream stored as a hypertable; max-pooled in SQL for display.
              </p>
            </>
          ) : (
            <p className="muted">Connect the armband during a session to record its stream.</p>
          )}
        </Panel>

        <Panel id="04" title="Data pipeline" meta={system?.engine ?? 'unknown'} span={4}>
          {system ? <SystemPanel system={system} /> : <p className="muted">Unavailable.</p>}
        </Panel>

        {dailyUse.length > 0 && (
          <Panel id="05" title="Daily arm use" meta="armband · active min/day" span={4}>
            <BarChart
              title="Active arm minutes a day"
              showTitle={false}
              unit=" min"
              yMax={niceMax(Math.max(...dailyUse.map((u) => u.activeMinutes)))}
              yTicks={ticks(niceMax(Math.max(...dailyUse.map((u) => u.activeMinutes))))}
              color={SERIES_COLORS[0]}
              points={dailyUse.map((u) => ({ day: u.day, value: u.activeMinutes }))}
              detail={(day) => {
                const u = dailyUse.find((x) => x.day === day);
                return u ? `${u.raisesOver90} raises above 90°, highest ${Math.round(u.maxElevDeg)}°` : null;
              }}
            />
          </Panel>
        )}

        <Panel id="06" title="Pain" meta="peak per session · 0–10" span={4}>
          <LineChart
            title="Peak pain each session"
            showTitle={false}
            unit=""
            yMax={10}
            yTicks={[0, 5, 10]}
            height={200}
            series={[{ id: 'pain', label: 'Pain', color: SERIES_COLORS[0], points: pained.map((s) => ({ day: s.day, value: s.maxPain! })) }]}
          />
        </Panel>

        <Panel id="07" title="Form" meta="reps with compensation · %" span={4}>
          <BarChart title="Reps with compensation" showTitle={false} unit="%" yMax={100} yTicks={[0, 50, 100]} color={SERIES_COLORS[1]} points={formDays} />
        </Panel>

        <Panel id="08" title="Session log" meta={`${sessions.length} sessions`} span={12}>
          <div className="table-scroll">
            <table className="rx ops-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Phase</th>
                  {exercises.map((e) => (
                    <th key={e.exerciseId + e.side}>{EXERCISES[e.exerciseId].name}</th>
                  ))}
                  <th>Reps</th>
                  <th>Past limit</th>
                  <th>Form %</th>
                  <th>Pain</th>
                  <th>Reported</th>
                </tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((s, i) => {
                  const r = byDay.get(s.day);
                  return (
                    <tr key={`${s.day}-${i}`}>
                      <td>{shortDay(s.day)}</td>
                      <td>P{s.phase}</td>
                      {exercises.map((e) => (
                        <td key={e.exerciseId + e.side}>{r?.best[e.exerciseId] === undefined ? '–' : `${Math.round(r.best[e.exerciseId])}°`}</td>
                      ))}
                      <td>{r?.reps ?? '–'}</td>
                      <td className={r?.over ? 'cell-warn' : ''}>{r?.over ?? 0}</td>
                      <td>{r ? Math.round((r.comp / Math.max(1, r.reps)) * 100) : '–'}</td>
                      <td className={(s.maxPain ?? 0) >= 7 ? 'cell-warn' : ''}>{s.maxPain ?? '–'}</td>
                      <td>{[s.armpitCord && 'cording', s.armHeaviness && 'swelling'].filter(Boolean).join(', ') || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {reportSlot}
      </div>
    </div>
  );
}

export function Panel({
  id,
  title,
  meta,
  span,
  status = 'ok',
  children,
  className = '',
}: {
  id: string;
  title: string;
  meta?: string;
  span: number;
  status?: 'ok' | 'warn' | 'bad';
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`} style={{ '--span': span } as React.CSSProperties} data-reveal>
      <header className="panel-head">
        <i className={`led led-${status}`} aria-hidden="true" />
        <span className="panel-id">{id}</span>
        <h2 className="panel-title">{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  suffix = '',
  decimals = 0,
  sub,
  tone,
  spark,
}: {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  sub?: string;
  tone: 'good' | 'bad' | 'neutral';
  spark?: number[];
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        <span data-count={value.toFixed(decimals)} data-decimals={decimals}>
          {value.toFixed(decimals)}
        </span>
        <small>{suffix}</small>
      </span>
      {sub && <span className="kpi-sub">{sub}</span>}
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

function SystemPanel({ system }: { system: SystemStats }) {
  const maxRows = Math.max(...system.tables.map((t) => t.rows), 1);
  return (
    <div className="sys">
      <table className="sys-table">
        <tbody>
          {system.tables.map((t) => (
            <tr key={t.name}>
              <td>
                <code>{t.name}</code>
                <span className="sys-kind">{t.hypertable ? `hypertable · ${t.chunks} chunks${t.compressedChunks ? ` · ${t.compressedChunks} in columnstore` : ''}` : 'table'}</span>
              </td>
              <td className="sys-rows">
                {t.rows.toLocaleString()}
                <span className="sys-bar" style={{ width: `${Math.max(3, (Math.log10(t.rows + 1) / Math.log10(maxRows + 1)) * 100)}%` }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {system.tables.some((t) => t.beforeBytes && t.afterBytes) && (
        <p className="fine">
          Columnstore:{' '}
          {system.tables
            .filter((t) => t.beforeBytes && t.afterBytes)
            .map((t) => `${t.name} ${(t.beforeBytes! / t.afterBytes!).toFixed(1)}× smaller`)
            .join(' · ')}
        </p>
      )}
      {system.continuousAggregates.length > 0 ? (
        <p className="fine">
          Continuous aggregates (real-time): {system.continuousAggregates.map((c) => <code key={c}>{c}</code>)}
        </p>
      ) : (
        <p className="fine">Running on plain Postgres here. On Tiger, the three time-series tables become hypertables and the rollups become continuous aggregates.</p>
      )}
    </div>
  );
}

/** Wall clock, ticking, for the console header. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="ops-clock">{now.toLocaleTimeString([], { hour12: false })}</span>;
}

function niceMax(v: number): number {
  const step = v > 200 ? 100 : v > 50 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

function ticks(max: number): number[] {
  const step = max / 4;
  return [0, step, step * 2, step * 3, max];
}
