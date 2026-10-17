import { useEffect, useState } from 'react';
import { generateReport, getBandTrace, getProgress, getSystem, latestReport } from '../lib/api';
import type { BandTrace, Progress, Report, SystemStats } from '../lib/apiTypes';
import { Dashboard, Panel } from './Dashboard';
import { ReportView } from './ReportView';

export function ProgressScreen({ patientId, geminiEnabled, onBack }: { patientId: string; geminiEnabled: boolean; onBack?: () => void }) {
  const [data, setData] = useState<{ progress: Progress; bandTrace: BandTrace | null; system: SystemStats | null } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Sequential on purpose: a handful of small requests, and gentle on the database.
        const progress = await getProgress(patientId);
        const bandTrace = await getBandTrace(patientId).catch(() => null);
        const system = await getSystem().catch(() => null);
        setData({ progress, bandTrace, system });
        setReport(await latestReport(patientId));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [patientId]);

  if (error) {
    return (
      <div className="setup">
        <p className="notice">Could not load progress: {error}</p>
      </div>
    );
  }
  if (!data) return <div className="loading">Loading console…</div>;

  return (
    <>
      {onBack && (
        <div className="ops-back">
          <button className="link back" onClick={onBack}>
            ← Care plan
          </button>
        </div>
      )}
      <Dashboard
        progress={data.progress}
        bandTrace={data.bandTrace}
        system={data.system}
        source="live"
        reportSlot={<ReportPanel patientId={patientId} geminiEnabled={geminiEnabled} report={report} onReport={setReport} />}
      />
    </>
  );
}

function ReportPanel({ patientId, geminiEnabled, report, onReport }: { patientId: string; geminiEnabled: boolean; report: Report | null; onReport: (r: Report) => void }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      onReport(await generateReport(patientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Panel id="09" title="Report" meta={report ? `${report.model} · checked against the data` : 'Gemini'} span={12} className="report">
      <div className="report-head no-print">
        <p className="fine">Gemini writes the words from the numbers and flags above. It can't add or change a flag, and every number it writes is checked against the data.</p>
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
      {error && <p className="notice no-print">{error}</p>}
      {report && <ReportView report={report} />}
    </Panel>
  );
}
