import { useRef, type ReactNode } from 'react';
import type { BandTrace, Progress, SystemStats } from '../lib/apiTypes';
import { percentOf } from '../lib/baseline';
import { daysBetween, type Severity } from '../lib/flags';
import { countUp, EASE, gsap, reducedMotion, useGSAP } from '../lib/motion';
import { DEFAULT_PROTOCOL, EXERCISES } from '../lib/protocol';
import { BarChart, LineChart, SERIES_COLORS, shortDay, TraceChart } from './charts';

const OF_REFERENCE = { clinician_goal: 'of the goal you set', pre_op: 'of pre-op range', contralateral: 'of the other arm', general_goal: 'of the general goal' } as const;
const BAND_NAME = { clinician_goal: 'GOAL', pre_op: 'PRE-OP', contralateral: 'OTHER ARM', general_goal: 'GOAL' } as const;
const SEVERITY_ORDER: Severity[] = ['urgent', 'warn', 'info'];
const FLAG_TAG: Record<Severity, string> = { urgent: 'Urgent', warn: 'Review', info: 'Note' };

interface Props {
  progress: Progress;
  bandTrace: BandTrace | null;
  system: SystemStats | null;
  /** Live from the server, or the bundled snapshot. */
  source: 'live' | 'snapshot';
  /** Shown after the range chart, e.g. the Gemini report. */
  reportSlot?: ReactNode;
  /** Start with the detail panels open. */
  detailOpen?: boolean;
}

/**
 * The clinician's view of one patient, built for a quick glance: whether anything needs them, the
 * few numbers that matter and the range chart first, everything else one click away.
 */
export function Dashboard({ progress, bandTrace, system, source, reportSlot, detailOpen = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const { patient, sessions, dailyUse, flags, asOf } = progress;
  const exercises = progress.exercises.filter((e) => e.days.length > 0);

  useGSAP(
    () => {
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', root.current);
      if (reducedMotion()) {
        gsap.set(items, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(items, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE, stagger: 0.05, clearProps: 'transform' });
      countUp(root.current);
    },
    { scope: root, dependencies: [progress], revertOnUpdate: true },
  );

  const days = (from: string) => daysBetween(from, asOf);
  const sessionDays = new Set(sessions.filter((s) => days(s.day) < 14).map((s) => s.day));
  const lastSession = sessions[sessions.length - 1];

  // What needs the PT, most serious first.
  const sorted = [...flags].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const urgent = flags.filter((f) => f.severity === 'urgent').length;
  const review = flags.filter((f) => f.severity === 'warn').length;
  const status = urgent ? 'bad' : review ? 'warn' : 'ok';
  const verdict = urgent ? 'Needs attention today' : review ? 'Worth a look' : 'On track';
  const counted = [urgent && `${urgent} urgent`, review && `${review} to review`].filter(Boolean).join(', ');

  // Headline numbers.
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pained = sessions.filter((s) => s.maxPain !== null);
  const lastPain = pained[pained.length - 1]?.maxPain ?? null;
  const painRecent = mean(pained.slice(-3).map((s) => s.maxPain!));
  const painBefore = mean(pained.slice(-6, -3).map((s) => s.maxPain!));
  const painChange = pained.length >= 4 ? painRecent - painBefore : 0;
  const painTrend =
    pained.length < 4
      ? 'Peak pain in the last session'
      : painChange >= 1
        ? `Rising: ${painRecent.toFixed(1)} lately, was ${painBefore.toFixed(1)}`
        : painChange <= -1
          ? `Easing: ${painRecent.toFixed(1)} lately, was ${painBefore.toFixed(1)}`
          : `Steady at about ${painRecent.toFixed(1)}`;
  const useRecent = mean(dailyUse.slice(-3).map((u) => u.activeMinutes));
  const useBefore = mean(dailyUse.slice(-10, -3).map((u) => u.activeMinutes));
  const useDelta = useBefore ? Math.round(((useRecent - useBefore) / useBefore) * 100) : null;
  const gaps = exercises.flatMap((e) => e.days.map((d) => d.cameraBandGapDeg).filter((g): g is number => g !== null));
  const gap = gaps.length ? mean(gaps) : null;

  // Phases and symptom pins for the range chart.
  const phases: { fromDay: string; toDay: string; label: string }[] = [];
  for (const s of sessions) {
    const last = phases[phases.length - 1];
    if (last && last.label === `PHASE ${s.phase}`) last.toDay = s.day;
    else phases.push({ fromDay: s.day, toDay: s.day, label: `PHASE ${s.phase}` });
  }
  const markers = sessions.filter((s) => s.armpitCord || s.armHeaviness).map((s) => ({ day: s.day, label: s.armHeaviness ? 'Swelling reported' : 'Cording reported' }));
  const phase1 = sessions.filter((s) => s.phase === 1);
  // The limit the PT saved for phase 1, not the placeholder.
  const phase1Limit = Math.min(...progress.protocol[1].map((p) => p.ceilingDeg ?? Infinity));
  const limit =
    phase1.length && Number.isFinite(phase1Limit)
      ? { value: phase1Limit, fromDay: phase1[0].day, toDay: phase1[phase1.length - 1].day, label: `${phase1Limit}° LIMIT` }
      : undefined;
  const refs = exercises.filter((e) => e.reference.source !== 'general_goal').map((e) => e.reference.deg);
  const band = refs.length
    ? { from: Math.min(...refs), to: Math.max(...refs), label: `${BAND_NAME[exercises[0].reference.source]}\n${Math.round(Math.min(...refs))}–${Math.round(Math.max(...refs))}°` }
    : undefined;
  const bothSides = exercises.some((x) => x.side !== exercises[0].side);

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

  const sideLabel = patient.affectedSide === 'both' ? 'Both sides' : `${patient.affectedSide[0].toUpperCase()}${patient.affectedSide.slice(1)} side`;
  const postOp = patient.surgeryDate ? `day ${days(patient.surgeryDate)} after surgery` : null;

  return (
    <div className="ops" ref={root}>
      <header className="ops-head" data-reveal>
        <div>
          <h1>{patient.displayName}</h1>
          <p className="muted">{[sideLabel, patient.surgeryType, postOp].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="ops-chips">
          <span className="ops-chip">
            Phase {patient.currentPhase}: {DEFAULT_PROTOCOL[patient.currentPhase].label}
          </span>
          <span className={`ops-chip ops-live ${source}`}>
            <i className="led" />
            {source === 'live' ? `Updated ${shortDay(asOf)}` : 'Sample patient'}
          </span>
        </div>
      </header>

      <section className={`glance glance-${status}`} aria-label="At a glance" data-reveal>
        <div className="glance-verdict">
          <h2>
            <i className={`led led-${status}`} aria-hidden="true" />
            {verdict}
          </h2>
          <p className="muted">{counted ? `${counted} from the latest sessions.` : 'Nothing flagged in the latest sessions.'}</p>
        </div>
        {sorted.length > 0 && (
          <ul className="glance-flags">
            {sorted.map((f) => (
              <li key={f.rule} className={`glance-flag glance-flag-${f.severity}`}>
                <span className="glance-tag">{FLAG_TAG[f.severity]}</span>
                <strong>{f.title}</strong>
                <span className="glance-detail">{f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glance-stats" aria-label="Key numbers" data-reveal>
        {exercises.length > 0 && (
          <Stat label="Range, latest session">
            <ul className="glance-rows">
              {exercises.map((e) => {
                const last = e.days[e.days.length - 1];
                const best = Math.max(...e.days.map((d) => d.bestPeakDeg));
                const dropped = last.bestPeakDeg < best * 0.9;
                return (
                  <li key={`${e.exerciseId}:${e.side}`} className={dropped ? 'down' : ''}>
                    <span className="glance-name">
                      {EXERCISES[e.exerciseId].name}
                      {bothSides ? ` (${e.side})` : ''}
                    </span>
                    <strong>{Math.round(last.bestPeakDeg)}°</strong>
                    <span className="glance-note">
                      {percentOf(last.bestPeakDeg, e.reference)}% {OF_REFERENCE[e.reference.source]}
                      {dropped ? ` · down from ${Math.round(best)}°` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Stat>
        )}
        <Stat label="Sessions, last 14 days">
          <span className="glance-value">
            <span data-count={sessionDays.size}>{sessionDays.size}</span>
            <small>of 14 days</small>
          </span>
          <span className="adherence" aria-label={`${sessionDays.size} of the last 14 days had a session`}>
            {Array.from({ length: 14 }, (_, i) => {
              const d = new Date(Date.parse(`${asOf}T00:00:00Z`) - (13 - i) * 86_400_000).toISOString().slice(0, 10);
              return <i key={d} className={sessionDays.has(d) ? 'on' : ''} title={shortDay(d)} />;
            })}
          </span>
          {lastSession && <span className="glance-sub">Last one {shortDay(lastSession.day)}</span>}
        </Stat>
        {lastPain !== null && (
          <Stat label="Pain" tone={painChange >= 2 || lastPain >= 7 ? 'bad' : 'neutral'}>
            <span className="glance-value">
              <span data-count={lastPain}>{lastPain}</span>
              <small>/10</small>
            </span>
            <span className="glance-sub">{painTrend}</span>
          </Stat>
        )}
        {dailyUse.length > 0 && (
          <Stat label="Arm use, from the band" tone={useDelta !== null && useDelta <= -30 ? 'bad' : 'neutral'}>
            <span className="glance-value">
              <span data-count={Math.round(useRecent)}>{Math.round(useRecent)}</span>
              <small>min a day</small>
            </span>
            <span className="glance-sub">{useDelta === null ? 'Active minutes, last 3 days' : `${Math.abs(useDelta)}% ${useDelta < 0 ? 'less' : 'more'} than the week before`}</span>
          </Stat>
        )}
      </section>

      <Panel title="Range of motion" meta="Best each session, in degrees" span={12}>
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
            label: `${EXERCISES[e.exerciseId].name}${bothSides ? ` (${e.side})` : ''}`,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            points: e.days.map((d) => ({ day: d.day, value: d.bestPeakDeg })),
          }))}
        />
      </Panel>

      {reportSlot}

      <details className="ops-more" open={detailOpen} data-reveal>
        <summary>
          More detail
          <span className="fine">Pain and form over time, daily arm use, the armband's last session, every session and the database</span>
        </summary>
        <div className="ops-grid">
          <Panel title="Pain" meta="Peak each session, 0–10" span={4}>
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

          <Panel title="Form" meta="Reps with compensation, %" span={4}>
            <BarChart title="Reps with compensation" showTitle={false} unit="%" yMax={100} yTicks={[0, 50, 100]} color={SERIES_COLORS[1]} points={formDays} />
          </Panel>

          {dailyUse.length > 0 && (
            <Panel title="Daily arm use" meta="Armband, active minutes" span={4}>
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

          <Panel
            title="Armband, last session"
            meta={bandTrace ? `${bandTrace.rawSamples.toLocaleString()} readings at 20 Hz, shown at ${bandTrace.hz} Hz` : 'No band data'}
            span={8}
          >
            {bandTrace ? (
              <>
                <TraceChart points={bandTrace.points} label="Arm elevation from the armband during the last session" />
                <p className="fine">
                  {new Date(bandTrace.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, peak{' '}
                  {Math.round(Math.max(...bandTrace.points.map((p) => p.deg)))}°.
                  {gap !== null && ` Camera and band peaks agree within ${gap.toFixed(1)}° on average.`} Raw stream stored as a hypertable; max-pooled in SQL for display.
                </p>
              </>
            ) : (
              <p className="muted">Connect the armband during a session to record its stream.</p>
            )}
          </Panel>

          <Panel title="Database" meta={system?.engine ?? 'unknown'} span={4}>
            {system ? <SystemPanel system={system} /> : <p className="muted">Unavailable.</p>}
          </Panel>

          <Panel title="Session log" meta={`${sessions.length} sessions`} span={12}>
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
        </div>
      </details>
    </div>
  );
}

export function Panel({
  title,
  meta,
  span,
  status = 'ok',
  children,
  className = '',
}: {
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
        <h2 className="panel-title">{title}</h2>
        {meta && <span className="panel-meta">{meta}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Stat({ label, tone = 'neutral', children }: { label: string; tone?: 'bad' | 'neutral'; children: ReactNode }) {
  return (
    <div className={`glance-card glance-card-${tone}`}>
      <span className="glance-label">{label}</span>
      {children}
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

function niceMax(v: number): number {
  const step = v > 200 ? 100 : v > 50 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

function ticks(max: number): number[] {
  const step = max / 4;
  return [0, step, step * 2, step * 3, max];
}
