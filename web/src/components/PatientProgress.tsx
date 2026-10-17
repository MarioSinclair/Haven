import { useEffect, useRef, useState } from 'react';
import { getProgress, latestReport } from '../lib/api';
import type { Progress, Report } from '../lib/apiTypes';
import { percentOf } from '../lib/baseline';
import { daysBetween } from '../lib/flags';
import { useReveal } from '../lib/motion';
import { affectedSides, DEFAULT_PROTOCOL, EXERCISES } from '../lib/protocol';
import { LineChart, SERIES_COLORS, shortDay } from './charts';

const MEASURED_AGAINST = {
  clinician_goal: 'of the goal your PT set',
  pre_op: 'of your range before surgery',
  contralateral: 'of your other arm',
  general_goal: 'of the general goal',
} as const;

/** The patient's own view of their recovery: plain numbers and the report summary, no clinical flags. */
export function PatientProgress({ patientId, onBack }: { patientId: string; onBack: () => void }) {
  const [data, setData] = useState<{ progress: Progress; report: Report | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const progress = await getProgress(patientId);
        setData({ progress, report: await latestReport(patientId).catch(() => null) });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [patientId]);

  return (
    <div className="setup">
      <button className="link back" onClick={onBack}>
        ← Back to your session
      </button>
      {error && <p className="notice">Could not load your progress: {error}</p>}
      {!data && !error && <p className="loading">Loading your progress…</p>}
      {data && <ProgressBody progress={data.progress} report={data.report} />}
    </div>
  );
}

function ProgressBody({ progress, report }: { progress: Progress; report: Report | null }) {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  const { patient, exercises, sessions, asOf } = progress;
  const sides = affectedSides(patient.affectedSide);
  const tracked = exercises.filter((e) => sides.includes(e.side) && e.days.length);
  const thisWeek = sessions.filter((s) => daysBetween(s.day, asOf) < 7).length;
  const sinceSurgery = patient.surgeryDate ? daysBetween(patient.surgeryDate, new Date().toLocaleDateString('en-CA')) : null;

  return (
    <div className="stack" ref={root}>
      <header className="setup-header" data-reveal>
        <div>
          <p className="eyebrow">Your progress</p>
          <h1>{patient.displayName}</h1>
          <p className="muted">
            {sinceSurgery !== null && sinceSurgery >= 0 ? `Day ${sinceSurgery} after surgery · ` : ''}
            Phase {patient.currentPhase}: {DEFAULT_PROTOCOL[patient.currentPhase].label}
          </p>
        </div>
        <span className="badge badge-ok">
          {thisWeek} session{thisWeek === 1 ? '' : 's'} in the last 7 days
        </span>
      </header>

      {!tracked.length && (
        <p className="card muted" data-reveal>
          Your range shows up here after your first session.
        </p>
      )}

      {tracked.map((e) => {
        const name = EXERCISES[e.exerciseId].name;
        const latest = e.days[e.days.length - 1];
        const gained = e.startDeg !== null ? Math.round(latest.bestPeakDeg - e.startDeg) : null;
        return (
          <section key={`${e.exerciseId}:${e.side}`} className="card" data-reveal>
            <h2>
              {name}
              {sides.length > 1 ? `, ${e.side} arm` : ''}
            </h2>
            <div className="pp-stats">
              <div>
                <strong>{Math.round(latest.bestPeakDeg)}°</strong>
                <span className="fine">your best, {shortDay(latest.day)}</span>
              </div>
              <div>
                <strong>{percentOf(latest.bestPeakDeg, e.reference)}%</strong>
                <span className="fine">
                  {MEASURED_AGAINST[e.reference.source]} ({Math.round(e.reference.deg)}°)
                </span>
              </div>
              {gained !== null && (
                <div>
                  <strong>
                    {gained >= 0 ? '+' : ''}
                    {gained}°
                  </strong>
                  <span className="fine">since your first session</span>
                </div>
              )}
            </div>
            <LineChart
              title={`${name}: your best each day`}
              showTitle={false}
              unit="°"
              yMax={180}
              yTicks={[0, 90, 180]}
              height={180}
              series={[{ id: e.exerciseId, label: 'Your best', color: SERIES_COLORS[0], points: e.days.map((d) => ({ day: d.day, value: d.bestPeakDeg })) }]}
            />
          </section>
        );
      })}

      {report?.patientSummary && (
        <section className="card" data-reveal>
          <h2>Your summary</h2>
          <p>{report.patientSummary}</p>
          <p className="fine">Written by Gemini from your numbers on {new Date(report.createdAt).toLocaleDateString()}, and checked against them.</p>
        </section>
      )}
    </div>
  );
}
