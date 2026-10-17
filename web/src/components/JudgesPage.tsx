// Judge-facing overview at /judges. Fill in the constants below before judging; empty links are hidden.
const PROJECT_NAME = 'Rehab Coach';
const LIVE_DOMAIN = ''; // e.g. 'example.com' once the GoDaddy domain points at the deployment
const DEMO_VIDEO_URL = '';
const REPO_URL = '';
const TEAM: { name: string; role: string }[] = [
  { name: 'Teammate 1', role: 'Camera tracking and session engine' },
  { name: 'Teammate 2', role: 'Armband firmware and Bluetooth' },
  { name: 'Teammate 3', role: 'Backend, dashboard and Gemini report' },
];

const TRY_STEPS = [
  'Open the session page in Chrome on a laptop and allow the camera.',
  'Leave Phase 1 selected (90° limit). No armband with you? Click "Simulate band".',
  'Step back until your head, arms and hips are in frame, arms relaxed, and hold still while it calibrates.',
  'Raise your left arm out to the side. Go past 90° and the line turns red, it beeps, and the voice tells you to lower. Shrug as you lift and it tells you to relax your shoulder.',
  'Rate your pain after the set, then press "End session" to see the summary.',
];

const DECIDED_BY_CODE = [
  'Arm angle, rep counts and form checks',
  'Range limits and the alerts when you pass them',
  'Every flag: range loss, rising pain, reported symptoms, low daily use, limit breaks',
  'Every number that appears in a report',
];

const WRITTEN_BY_GEMINI = [
  'A plain-language weekly summary for the patient',
  'The narrative in the PT report, explaining flags the rules already raised',
];

export function JudgesPage() {
  return (
    <div className="judges">
      <header className="j-hero">
        <p className="eyebrow">For judges</p>
        <h1>{PROJECT_NAME}</h1>
        <p className="j-lede">
          Guided shoulder rehab for people recovering from breast cancer surgery: a camera coach that enforces their care team's limits, an armband that tracks real-world arm use,
          and a report their physical therapist can act on.
        </p>
        <div className="inline">
          <a className="button primary" href="/">
            Try a session
          </a>
          {DEMO_VIDEO_URL && (
            <a className="button" href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer">
              Demo video
            </a>
          )}
          {REPO_URL && (
            <a className="button" href={REPO_URL} target="_blank" rel="noreferrer">
              Source code
            </a>
          )}
        </div>
        {LIVE_DOMAIN && <p className="fine">Live at {LIVE_DOMAIN}</p>}
      </header>

      <section className="j-section">
        <h2>The problem</h2>
        <p>
          After a mastectomy or lymph node removal, shoulder exercises start within days, often with a temporary limit on how high the arm can go while surgical drains are in.
          Patients do them alone at home. Their physical therapist sees them every week or two and has to rely on memory for what happened in between: how high they really got,
          whether it hurt, whether a tight cord appeared under the arm.
        </p>
      </section>

      <section className="j-section">
        <h2>Try it in 60 seconds</h2>
        <ol className="j-steps">
          {TRY_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="j-section">
        <h2>How it works</h2>
        <div className="j-cards">
          <article className="card">
            <p className="eyebrow">1 · Camera coach</p>
            <h3>Measures every rep, live</h3>
            <p className="muted">
              MediaPipe Pose runs in the browser. We measure the upper arm against the trunk, count reps, enforce the limit with a beep and a voice cue, catch shrugging, leaning and
              a bent elbow, and ask for a pain rating after every set.
            </p>
          </article>
          <article className="card">
            <p className="eyebrow">2 · Armband</p>
            <h3>Fills the gaps</h3>
            <p className="muted">
              A XIAO ESP32-S3 with a BNO085 IMU streams the arm's angle over Bluetooth at 20 Hz. When the camera loses the arm, the band takes over. Between sessions it logs how high
              and how often the arm is raised in daily life.
            </p>
          </article>
          <article className="card">
            <p className="eyebrow">3 · Report for the PT</p>
            <h3>Turns data into a conversation</h3>
            <p className="muted">
              Deterministic rules flag range loss, rising pain, reported symptoms and limit breaks. Gemini writes a plain-language summary for the patient and a one-page report the PT
              can read before the next visit.
            </p>
          </article>
        </div>
      </section>

      <section className="j-section">
        <h2>Architecture</h2>
        <div className="j-flow" role="img" aria-label="Armband and laptop camera feed the browser app, which stores angles in Supabase; a rules engine raises flags and Gemini writes the reports.">
          <div className="j-node">
            <strong>Armband</strong>
            <span>XIAO ESP32-S3 + BNO085</span>
          </div>
          <div className="j-arrow">Bluetooth, 20 Hz</div>
          <div className="j-node j-node-main">
            <strong>Browser app</strong>
            <span>MediaPipe on-device · session engine · voice coach</span>
            <span className="j-tag">Laptop camera, never uploaded</span>
          </div>
          <div className="j-arrow">angles + answers only</div>
          <div className="j-node">
            <strong>Supabase</strong>
            <span>Postgres</span>
          </div>
          <div className="j-arrow">aggregates</div>
          <div className="j-node">
            <strong>Rules engine</strong>
            <span>deterministic flags</span>
          </div>
          <div className="j-arrow">stats + flags</div>
          <div className="j-node">
            <strong>Gemini</strong>
            <span>patient summary · PT report</span>
          </div>
        </div>
      </section>

      <section className="j-section">
        <h2>Code decides. Gemini explains.</h2>
        <p className="muted">Anything that affects safety is ordinary, testable code. The language model only ever describes numbers it is handed.</p>
        <div className="j-split">
          <div className="card">
            <h3>Decided by code</h3>
            <ul>
              {DECIDED_BY_CODE.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3>Written by Gemini</h3>
            <ul>
              {WRITTEN_BY_GEMINI.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="fine">Gemini never sees video, never sets a limit and never raises a flag.</p>
          </div>
        </div>
      </section>

      <section className="j-section">
        <h2>Privacy</h2>
        <ul className="j-list">
          <li>Video never leaves the laptop. Pose tracking runs on-device; only angles, counts and answers are stored.</li>
          <li>Patients can hide the camera image and see only an outline of their arm, which matters after chest surgery.</li>
          <li>Voice answers are optional. Chrome's speech recognition uses Google's servers, so tap buttons are the default.</li>
        </ul>
      </section>

      <section className="j-section">
        <h2>Prize tracks</h2>
        <div className="j-cards">
          <article className="card">
            <h3>Best use of Gemini API</h3>
            <p className="muted">
              Gemini turns weeks of rep-level data and rule-based flags into two documents for two audiences: an encouraging summary for the patient, and a structured report for the
              PT. It writes the words; code supplies every number.
            </p>
          </article>
          <article className="card">
            <h3>Hardware</h3>
            <p className="muted">
              The band computes elevation on the board as the angle between the current gravity vector and the one captured with the arm hanging, so it works however it is strapped
              on. It packs readings into an 18-byte Bluetooth packet and logs per-minute summaries when no laptop is connected. The strap is wide and loose, because patients are told
              to avoid anything tight on the arm after lymph node removal.
            </p>
          </article>
          <article className="card">
            <h3>Domain</h3>
            <p className="muted">{LIVE_DOMAIN ? `Deployed at ${LIVE_DOMAIN}.` : 'Deployed on our own domain.'}</p>
          </article>
        </div>
      </section>

      <section className="j-section">
        <h2>Honest notes</h2>
        <ul className="j-list">
          <li>The patient in the dashboard is simulated: two and a half weeks of recovery with a setback, built so the flags have something real to find.</li>
          <li>The range limits in the demo are placeholders. Real limits come from the patient's surgeon or physical therapist.</li>
          <li>This is a 36-hour prototype, not a medical device.</li>
          <li>The camera-vs-band agreement shown on the session summary is measured live, not precomputed.</li>
        </ul>
      </section>

      <section className="j-section">
        <h2>Team</h2>
        <ul className="j-team">
          {TEAM.map((m) => (
            <li key={m.name}>
              <strong>{m.name}</strong>
              <span className="muted">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
