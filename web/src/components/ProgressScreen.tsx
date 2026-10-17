import { useEffect, useRef, useState } from 'react';
import { generateReport, getProgress, latestReport } from '../lib/api';
import type { Progress, Report } from '../lib/apiTypes';
import type { Severity } from '../lib/flags';
import { countUp, EASE, gsap, reducedMotion, useGSAP } from '../lib/motion';
import { DEFAULT_PROTOCOL, EXERCISES } from '../lib/protocol';
import { BarChart, LineChart, SERIES_COLORS, shortDay } from './charts';

const SEVERITY: Record<Severity, { icon: string; label: string }> = {
  urgent: { icon: '!', label: 'Contact care team' },
  warn: { icon: '▲', label: 'Review' },
  info: { icon: 'i', label: 'Note' },
};

const REFERENCE_NAME = { clinician_goal: 'PT goal', pre_op: 'before surgery', contralateral: 'other arm', general_goal: 'general goal' } as const;

export function ProgressScreen({ patientId, geminiEnabled }: { patientId: string; geminiEnabled: boolean }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!progress) return;
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', root.current);
      if (reducedMotion()) {
        gsap.set(items, { autoAlpha: 1 });
        return;
      }
      gsap.fromTo(items, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.08, clearProps: 'transform' });
      countUp(root.current);
    },
    { scope: root, dependencies: [progress] },
  );

  useGSAP(
    () => {
      if (!report || reducedMotion()) return;
      gsap.from('.report-body > *', { autoAlpha: 0, y: 14, duration: 0.7, ease: EASE, stagger: 0.08 });
    },
    { scope: root, dependencies: [report?.id] },
  );

  useEffect(() => {
    Promise.all([getProgress(patientId), latestReport(patientId)])
      .then(([p, r]) => {
        setProgress(p);
        setReport(r);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [patientId]);

  const generate = async () => {
    setGenerating(true);
    setReportError(null);
    try {
      setReport(await generateReport(patientId));
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  if (error) return <div className="setup"><p className="notice">Could not load progress: {error}</p></div>;
  if (!progress) return <div className="loading">Loading progress…</div>;

  const { patient, exercises, sessions, dailyUse, flags } = progress;
  const recentSessions = sessions.filter((s) => daysAgo(s.day, progress.asOf) < 14).length;
  const gaps = exercises.flatMap((e) => e.days.map((d) => d.cameraBandGapDeg).filter((g): g is number => g !== null));
  const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

  // Phase 1 limit, drawn only across the days phase 1 applied.
  const phase1 = sessions.filter((s) => s.phase === 1);
  const phase1Limit = Math.min(...DEFAULT_PROTOCOL[1].prescriptions.map((p) => p.ceilingDeg ?? Infinity));
  const limit =
    phase1.length && Number.isFinite(phase1Limit)
      ? { value: phase1Limit, fromDay: phase1[0].day, toDay: phase1[phase1.length - 1].day, label: `${phase1Limit}° limit while drains were in` }
      : undefined;

  const refs = exercises.filter((e) => e.reference.source !== 'general_goal').map((e) => e.reference.deg);
  const band = refs.length
    ? {
        from: Math.min(...refs),
        to: Math.max(...refs),
        label: `${capitalize(REFERENCE_NAME[exercises[0].reference.source])}\n${Math.min(...refs) === Math.max(...refs) ? '' : `${Math.round(Math.min(...refs))}–`}${Math.round(Math.max(...refs))}°`,
      }
    : undefined;

  return (
    <div className="setup progress-page" ref={root}>
      <header className="setup-header no-print" data-reveal>
        <div>
          <p className="eyebrow">Progress · through {shortDay(progress.asOf)}</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">
            {patient.surgeryType ?? 'Shoulder recovery'}
            {patient.surgeryDate ? ` · day ${daysAgo(patient.surgeryDate, progress.asOf)} after surgery` : ''} · phase {patient.currentPhase}: {DEFAULT_PROTOCOL[patient.currentPhase].label}
          </p>
        </div>
      </header>

      <section className="tiles no-print" aria-label="Summary" data-reveal>
        {exercises.map((e) => {
          const last = e.days[e.days.length - 1];
          const best = Math.max(...e.days.map((d) => d.bestPeakDeg));
          return (
            <div className="tile" key={`${e.exerciseId}:${e.side}`}>
              <span className="tile-label">
                {EXERCISES[e.exerciseId].name}, {e.side} arm
              </span>
              <span className="tile-value" data-count={Math.round((last.bestPeakDeg / e.reference.deg) * 100)} data-suffix="%">
                {Math.round((last.bestPeakDeg / e.reference.deg) * 100)}%
              </span>
              <span className="tile-sub">
                of {REFERENCE_NAME[e.reference.source]} ({Math.round(e.reference.deg)}°) · now {Math.round(last.bestPeakDeg)}°, best {Math.round(best)}°
                {e.startDeg !== null ? `, started at ${Math.round(e.startDeg)}°` : ''}
              </span>
            </div>
          );
        })}
        <div className="tile">
          <span className="tile-label">Sessions, last 14 days</span>
          <span className="tile-value" data-count={recentSessions}>
            {recentSessions}
          </span>
        </div>
        {gap !== null && (
          <div className="tile">
            <span className="tile-label">Camera vs band</span>
            <span className="tile-value" data-count={gap.toFixed(1)} data-decimals="1" data-suffix="°">
              {gap.toFixed(1)}°
            </span>
            <span className="tile-sub">average gap between the two sensors' peaks</span>
          </div>
        )}
      </section>

      <section className="card no-print" data-reveal>
        <h2>Flags</h2>
        <p className="fine">Raised by fixed rules in code, not by AI.</p>
        {flags.length === 0 ? (
          <p className="muted">Nothing needs attention.</p>
        ) : (
          <ul className="flags">
            {flags.map((f) => (
              <li key={f.rule} className={`flag flag-${f.severity}`}>
                <span className="flag-badge" aria-hidden="true">
                  {SEVERITY[f.severity].icon}
                </span>
                <div>
                  <p>
                    <span className="flag-level">{SEVERITY[f.severity].label}</span> {f.title}
                  </p>
                  <p className="muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card no-print" data-reveal>
        <LineChart
          title="Best arm angle each session"
          unit="°"
          yMax={180}
          yTicks={[0, 45, 90, 135, 180]}
          band={band}
          limit={limit}
          series={exercises.map((e, i) => ({
            id: `${e.exerciseId}:${e.side}`,
            label: `${EXERCISES[e.exerciseId].name}${exercises.some((x) => x.side !== e.side) ? ` (${e.side})` : ''}`,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            points: e.days.map((d) => ({ day: d.day, value: d.bestPeakDeg })),
          }))}
        />
      </section>

      <div className="two-up no-print" data-reveal>
        {dailyUse.length > 0 && (
          <section className="card">
            <BarChart
              title="Active arm minutes a day (armband)"
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
          </section>
        )}
        <section className="card">
          <LineChart
            title="Peak pain each session (0–10)"
            unit=""
            yMax={10}
            yTicks={[0, 5, 10]}
            height={200}
            series={[
              {
                id: 'pain',
                label: 'Pain',
                color: SERIES_COLORS[0],
                points: sessions.filter((s) => s.maxPain !== null).map((s) => ({ day: s.day, value: s.maxPain! })),
              },
            ]}
          />
        </section>
      </div>

      <section className="card report" data-reveal>
        <div className="report-head no-print">
          <div>
            <h2>Report</h2>
            <p className="fine">Gemini writes the words from the numbers and flags above. It can't add or change a flag, and every number it writes is checked against the data.</p>
          </div>
          <div className="inline">
            <button className="primary" onClick={generate} disabled={!geminiEnabled || generating}>
              {generating ? 'Writing…' : report ? 'Regenerate with Gemini' : 'Generate with Gemini'}
            </button>
            {report && (
              <button className="secondary" onClick={() => window.print()}>
                Save as PDF
              </button>
            )}
          </div>
        </div>
        {!geminiEnabled && <p className="notice no-print">Set GEMINI_API_KEY on the server to generate reports.</p>}
        {reportError && <p className="notice no-print">{reportError}</p>}
        {report && <ReportView report={report} />}
      </section>
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const s = report.stats;
  const notes = new Map(report.clinician.flag_notes.map((n) => [n.rule, n.note]));
  return (
    <article className="report-body">
      <header>
        <p className="eyebrow">
          {shortDay(report.periodStart)} – {shortDay(report.periodEnd)} · {s.sessions_completed} sessions
        </p>
        <h3>
          {s.patient.name}: {s.patient.surgery ?? 'shoulder recovery'}
        </h3>
        {s.patient.days_since_surgery !== null && (
          <p className="muted">
            Day {s.patient.days_since_surgery} after surgery · phase {s.patient.phase}: {s.patient.phase_label}
          </p>
        )}
      </header>

      <section>
        <h4>For {s.patient.name}</h4>
        <p className="report-summary">{report.patientSummary}</p>
      </section>

      <section>
        <h4>For the physical therapist</h4>
        <p>{report.clinician.overview}</p>
        <table className="rx">
          <thead>
            <tr>
              <th>Exercise</th>
              <th>Now</th>
              <th>Best</th>
              <th>Reference</th>
              <th>% of reference</th>
              <th>Since first session</th>
            </tr>
          </thead>
          <tbody>
            {s.exercises.map((e) => (
              <tr key={`${e.exercise}:${e.side}`}>
                <td>
                  {e.exercise} ({e.side})
                </td>
                <td>{e.latest_deg}°</td>
                <td>
                  {e.best_deg}° ({shortDay(e.best_day)})
                </td>
                <td>
                  {e.reference_deg}° ({e.reference})
                </td>
                <td>{e.latest_pct_of_reference}%</td>
                <td>{e.gained_since_start_deg === null ? '–' : `+${e.gained_since_start_deg}°`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.flags.length > 0 && (
          <table className="rx report-flags">
            <thead>
              <tr>
                <th>Flag (rules)</th>
                <th>Explanation (Gemini)</th>
              </tr>
            </thead>
            <tbody>
              {s.flags.map((f) => (
                <tr key={f.rule}>
                  <td>
                    <strong>{SEVERITY[f.severity as Severity]?.label ?? f.severity}:</strong> {f.title}
                    <br />
                    <span className="muted">{f.detail}</span>
                  </td>
                  <td>{notes.get(f.rule) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {report.clinician.questions_for_visit.length > 0 && (
          <>
            <h5>Questions for the next visit</h5>
            <ul>
              {report.clinician.questions_for_visit.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <footer className="fine">
        {report.unverifiedNumbers.length ? (
          <span className="warn-text">Check these numbers in the text; they weren't found in the data: {report.unverifiedNumbers.join(', ')}.</span>
        ) : (
          'Every number in the text was checked against the data.'
        )}{' '}
        Written by {report.model} on {new Date(report.createdAt).toLocaleString()}. Flags come from fixed rules, not the model. Not medical advice.
      </footer>
    </article>
  );
}

function daysAgo(day: string, asOf: string): number {
  return Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function niceMax(v: number): number {
  const step = v > 200 ? 100 : v > 50 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

function ticks(max: number): number[] {
  const step = max / 4;
  return [0, step, step * 2, step * 3, max];
}
