import { GoogleGenAI } from '@google/genai';
import type { ClinicianReport, Report, ReportStats } from '../../web/src/lib/apiTypes';
import { daysBetween } from '../../web/src/lib/flags';
import { collectNumbers, unsupportedNumbers } from '../../web/src/lib/numberGuard';
import { DEFAULT_PROTOCOL, EXERCISES } from '../../web/src/lib/protocol';
import { config } from './config';
import { db, HttpError } from './db';
import type { Progress } from '../../web/src/lib/apiTypes';
import { loadProgress } from './progress';

const REFERENCE_LABEL = {
  clinician_goal: "the PT's goal",
  pre_op: 'the same arm before surgery',
  contralateral: 'the other arm',
  general_goal: 'a general recovery goal',
} as const;

/** The only facts the model sees. Every number in the report comes from here. */
export function buildStats(p: Progress, periodDays = 14): ReportStats {
  const end = p.asOf;
  const start = shiftDay(end, -(periodDays - 1));
  const inPeriod = (d: string) => d >= start && d <= end;

  const exercises = p.exercises
    .map((e) => {
      const days = e.days.filter((d) => inPeriod(d.day));
      if (!days.length) return null;
      const latest = days[days.length - 1];
      const best = days.reduce((a, b) => (b.bestPeakDeg > a.bestPeakDeg ? b : a));
      return {
        exercise: EXERCISES[e.exerciseId].name,
        side: e.side,
        reference_deg: round0(e.reference.deg),
        reference: REFERENCE_LABEL[e.reference.source],
        start_deg: e.startDeg === null ? null : round0(e.startDeg),
        best_deg: round0(best.bestPeakDeg),
        best_day: best.day,
        latest_deg: round0(latest.bestPeakDeg),
        latest_day: latest.day,
        latest_pct_of_reference: round0((latest.bestPeakDeg / e.reference.deg) * 100),
        gained_since_start_deg: e.startDeg === null ? null : round0(latest.bestPeakDeg - e.startDeg),
      };
    })
    .filter((e) => e !== null);

  const gaps = p.exercises.flatMap((e) => e.days.filter((d) => inPeriod(d.day) && d.cameraBandGapDeg !== null).map((d) => d.cameraBandGapDeg!));
  const sessions = p.sessions.filter((s) => inPeriod(s.day));

  return {
    patient: {
      name: p.patient.displayName.replace(/\s*\(demo\)\s*$/i, ''),
      affected_side: p.patient.affectedSide,
      surgery: p.patient.surgeryType,
      surgery_date: p.patient.surgeryDate,
      days_since_surgery: p.patient.surgeryDate ? daysBetween(p.patient.surgeryDate, end) : null,
      phase: p.patient.currentPhase,
      phase_label: DEFAULT_PROTOCOL[p.patient.currentPhase].label,
    },
    period: { start, end, days: periodDays },
    sessions_completed: sessions.length,
    exercises,
    pain: sessions.filter((s) => s.maxPain !== null).map((s) => ({ day: s.day, max_pain: s.maxPain! })),
    symptoms_reported: sessions
      .filter((s) => s.armHeaviness || s.armpitCord || s.notes)
      .map((s) => ({ day: s.day, arm_heaviness: s.armHeaviness, armpit_cord: s.armpitCord, note: s.notes })),
    daily_use: p.dailyUse.filter((u) => inPeriod(u.day)).map((u) => ({ day: u.day, active_min: round0(u.activeMinutes), raises_over_90: u.raisesOver90 })),
    camera_band_gap_deg: gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    flags: p.flags.map(({ rule, severity, title, detail, evidence }) => ({ rule, severity, title, detail, evidence })),
  };
}

const SYSTEM_INSTRUCTION = `You write progress summaries for a shoulder rehabilitation app used after breast cancer surgery.
You receive JSON that the app computed. Follow these rules exactly:
- Use only facts and numbers that appear in the JSON. Never calculate new numbers: no new percentages, averages, differences or counts. Write durations in words unless the number is in the JSON.
- The flags were raised by fixed rules. Explain every flag. Never add a flag, drop one, or soften or raise its severity, and never call something fine that a flag questions.
- Do not diagnose and do not give medical instructions. When something is concerning, say to raise it with the care team.
- patient_summary: speak to the patient as "you", warm and plain, short sentences, 90 to 140 words. Name real progress first, then mention each warn or urgent flag gently and say to tell their care team.
- clinician.overview: 3 to 5 concise clinical sentences for a cancer-rehab physical therapist.
- clinician.flag_notes: exactly one entry per flag, using the flag's rule id.
- clinician.questions_for_visit: 2 to 4 questions the therapist could ask at the next visit.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    patient_summary: { type: 'string' },
    clinician: {
      type: 'object',
      properties: {
        overview: { type: 'string' },
        flag_notes: {
          type: 'array',
          items: { type: 'object', properties: { rule: { type: 'string' }, note: { type: 'string' } }, required: ['rule', 'note'] },
        },
        questions_for_visit: { type: 'array', items: { type: 'string' } },
      },
      required: ['overview', 'flag_notes', 'questions_for_visit'],
    },
  },
  required: ['patient_summary', 'clinician'],
};

interface ModelOutput {
  patient_summary: string;
  clinician: ClinicianReport;
}

const ai = config.gemini ? new GoogleGenAI({ apiKey: config.gemini.apiKey }) : null;

async function askGemini(stats: ReportStats, rejected: string[]): Promise<ModelOutput> {
  const retryNote = rejected.length
    ? `\n\nYour previous draft used numbers that are not in the data: ${rejected.join(', ')}. Rewrite without them.`
    : '';
  const interaction = await ai!.interactions.create({
    model: config.gemini!.model,
    system_instruction: SYSTEM_INSTRUCTION,
    input: `Progress data:\n${JSON.stringify(stats)}${retryNote}`,
    response_format: { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA },
    // Health data: don't keep a copy on Google's side.
    store: false,
  });
  if (!interaction.output_text) throw new HttpError(502, 'Gemini returned no text');
  return JSON.parse(interaction.output_text) as ModelOutput;
}

function proseOf(out: ModelOutput): string {
  return [out.patient_summary, out.clinician.overview, ...out.clinician.flag_notes.map((n) => n.note), ...out.clinician.questions_for_visit].join('\n');
}

/**
 * Builds the stats, asks Gemini for prose, and checks every number in that prose against the
 * stats. One retry with the offending numbers named; anything still unsupported is stored and shown.
 */
export async function generateReport(patientId: string): Promise<Report> {
  if (!ai) throw new HttpError(503, 'GEMINI_API_KEY is not set');
  const stats = buildStats(await loadProgress(patientId));
  const allowed = collectNumbers(stats);

  let out = await askGemini(stats, []);
  let misses = unsupportedNumbers(proseOf(out), allowed);
  if (misses.length) {
    out = await askGemini(stats, misses);
    misses = unsupportedNumbers(proseOf(out), allowed);
  }

  const row = (
    await db().query(
      `insert into reports (patient_id, period_start, period_end, stats, patient_summary, clinician_report, model, unverified_numbers)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, created_at`,
      [patientId, stats.period.start, stats.period.end, stats, out.patient_summary, out.clinician, config.gemini!.model, JSON.stringify(misses)],
    )
  ).rows[0];

  return {
    id: row.id,
    periodStart: stats.period.start,
    periodEnd: stats.period.end,
    stats,
    patientSummary: out.patient_summary,
    clinician: out.clinician,
    model: config.gemini!.model,
    unverifiedNumbers: misses,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function latestReport(patientId: string): Promise<Report | null> {
  const r = (await db().query('select * from reports where patient_id = $1 order by created_at desc limit 1', [patientId])).rows[0];
  if (!r) return null;
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    stats: r.stats,
    patientSummary: r.patient_summary,
    clinician: r.clinician_report,
    model: r.model,
    unverifiedNumbers: r.unverified_numbers,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round0 = (x: number) => Math.round(x);
const round1 = (x: number) => Math.round(x * 10) / 10;
