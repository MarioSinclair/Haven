import type { Report } from '../lib/apiTypes';
import type { Severity } from '../lib/flags';
import { shortDay } from './charts';

export const SEVERITY: Record<Severity, { icon: string; label: string; tag: string }> = {
  urgent: { icon: '!', label: 'Contact care team', tag: 'URGENT' },
  warn: { icon: '▲', label: 'Review', tag: 'WARN' },
  info: { icon: 'i', label: 'Note', tag: 'INFO' },
};

/** The Gemini report: the patient's summary, then the PT's page with code-computed numbers. */
export function ReportView({ report }: { report: Report }) {
  const s = report.stats;
  const notes = new Map(report.clinician.flag_notes.map((n) => [n.rule, n.note]));
  return (
    <article className="report-body">
      <header>
        <p className="eyebrow">
          {shortDay(report.periodStart)} – {shortDay(report.periodEnd)} · {s.sessions_completed} sessions
        </p>
        <h3>
          {s.patient.name}: {s.patient.surgery ?? 'post-mastectomy rehab'}
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
