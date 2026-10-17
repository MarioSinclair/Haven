import { useEffect, useRef, useState } from 'react';
import { getDemo } from '../lib/api';
import type { DemoBundle } from '../lib/apiTypes';
import { APP_NAME } from '../lib/brand';
import { EASE, gsap, reducedMotion, ScrollTrigger, SplitText, useGSAP } from '../lib/motion';
import { AmbientBackground } from './AmbientBackground';
import { Dashboard, Panel } from './Dashboard';
import { Logo } from './Logo';
import { ReportView } from './ReportView';
import { SimulatedSession } from './SimulatedSession';

// ---------------------------------------------------------------------------------------------
// Fill these in before judging. Anything left empty is hidden on the live site.
// ---------------------------------------------------------------------------------------------
/** YouTube or Vimeo link, or a file in web/public/judges/ such as '/judges/demo.mp4'. */
const DEMO_VIDEO = '';
const LIVE_DOMAIN = ''; // e.g. 'example.com' once the GoDaddy domain points at the deployment
const REPO_URL = '';
const TEAM: { name: string; role: string }[] = [
  { name: 'Teammate 1', role: 'Camera tracking and session engine' },
  { name: 'Teammate 2', role: 'Armband firmware and Bluetooth' },
  { name: 'Teammate 3', role: 'Server, Tiger Data, dashboard and Gemini report' },
];
/** Screenshots and photos. Put files in web/public/judges/ and list them here. */
const GALLERY: { src: string; caption: string }[] = [
  { src: '/judges/console.png', caption: 'The PT console on the simulated demo patient: range, flags, band telemetry, daily use, pain and form.' },
  { src: '/judges/setup.png', caption: 'Session setup: phase, per-exercise limits set by the PT, armband connection and comfort options.' },
  { src: '/judges/judges-replay.png', caption: 'The replay further up this page: the real session engine on a scripted set.' },
  // { src: '/judges/demo-1.jpg', caption: 'Live session with the armband on.' },
];
// ---------------------------------------------------------------------------------------------

const FACTS = [
  'Video never leaves the laptop',
  '20 Hz armband over Bluetooth',
  'Limits enforced in code',
  'Hypertables on Tiger Data',
  'Gemini explains, never decides',
  'Auth0 roles for patients and PTs',
  'Every number in a report is checked',
];

const TLDR = [
  { k: 'For', v: 'People recovering from breast cancer surgery, and the physical therapists who guide them.' },
  { k: 'Problem', v: 'Rehab after a mastectomy is mostly done alone at home. Between visits the PT can’t see how high the arm got, whether it hurt, or whether a limit was broken.' },
  { k: 'Built', v: 'A personal rehab coach for home: a camera coach that enforces the PT’s limits, an armband that keeps enforcing them between sessions, and a console with reports written by Gemini from numbers our code computed.' },
  { k: 'Stack', v: 'MediaPipe · XIAO ESP32-S3 + BNO085 · React · Express · Tiger Data · Auth0 · Gemini' },
];

function embed(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  return url ? { kind: 'video', src: url } : null;
}

export function JudgesPage() {
  const root = useRef<HTMLDivElement>(null);
  const [demo, setDemo] = useState<{ bundle: DemoBundle; source: 'live' | 'snapshot' } | null>(null);
  const video = embed(DEMO_VIDEO);

  useEffect(() => {
    getDemo()
      .then((bundle) => setDemo({ bundle, source: 'live' }))
      .catch(async () => {
        const snapshot = (await import('../fixtures/demo.json')).default as unknown as DemoBundle;
        setDemo({ bundle: snapshot, source: 'snapshot' });
      });
  }, []);

  useGSAP(
    () => {
      if (reducedMotion()) {
        gsap.set('.j-reveal', { autoAlpha: 1 });
        return;
      }
      SplitText.create('.j-hero h1', {
        type: 'lines',
        mask: 'lines',
        autoSplit: true,
        onSplit: (self) => gsap.fromTo(self.lines, { yPercent: 105 }, { yPercent: 0, duration: 1.1, ease: EASE, stagger: 0.09 }),
      });
      gsap.fromTo('.j-hero .j-reveal', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.07, delay: 0.3 });
      const track = root.current?.querySelector('.marquee-track');
      if (track) gsap.to(track, { xPercent: -50, duration: 38, ease: 'none', repeat: -1 });
      ScrollTrigger.batch('.judges-main .j-reveal', {
        start: 'top 90%',
        once: true,
        onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.08, overwrite: true }),
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="judges-page">
      <AmbientBackground />
      <nav className="topbar">
        <a href="/" className="brand">
          <Logo />
          <span>{APP_NAME}</span>
        </a>
        <div className="tabs">
          <a href="#replay">Replay</a>
          <a href="#console">Console</a>
          <a href="#how">How it works</a>
        </div>
        <div className="topbar-right">
          <a className="button primary" href="/">
            Open the app
          </a>
        </div>
      </nav>

      <div className="judges">
        <header className="j-hero">
          <p className="eyebrow j-reveal">A personal post-mastectomy rehab coach · for judges</p>
          <h1>
            Getting your <em>reach</em> back after breast cancer surgery.
          </h1>
          <div className="tldr j-reveal">
            {TLDR.map((row) => (
              <div key={row.k}>
                <span className="kpi-label">{row.k}</span>
                <p>{row.v}</p>
              </div>
            ))}
          </div>
          <div className="inline j-reveal">
            {video && (
              <a className="button primary" href="#video">
                Watch the demo
              </a>
            )}
            <a className={`button ${video ? '' : 'primary'}`} href="#replay">
              See it work
            </a>
            <a className="button" href="/">
              Try it yourself
            </a>
            {REPO_URL && (
              <a className="button" href={REPO_URL} target="_blank" rel="noreferrer">
                Source code
              </a>
            )}
            {LIVE_DOMAIN && <span className="fine">Live at {LIVE_DOMAIN}</span>}
          </div>
        </header>

        <div className="marquee" aria-label="Key facts">
          <div className="marquee-track">
            {[...FACTS, ...FACTS].map((fact, i) => (
              <span key={i} aria-hidden={i >= FACTS.length}>
                {fact}
              </span>
            ))}
          </div>
        </div>

        <main className="judges-main">
          {(video || import.meta.env.DEV) && (
            <section className="j-section" id="video">
              <SectionHead n="01" title="The demo" sub="Recorded end to end: a real session with the armband, then the PT's view." />
              <div className="video-frame j-reveal">
                {video?.kind === 'iframe' && (
                  <iframe src={video.src} title="Demo video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowFullScreen />
                )}
                {video?.kind === 'video' && <video src={video.src} controls playsInline preload="metadata" />}
                {!video && <p className="video-empty">Set DEMO_VIDEO at the top of JudgesPage.tsx. This placeholder only shows in development.</p>}
              </div>
            </section>
          )}

          <section className="j-section" id="replay">
            <SectionHead
              n="02"
              title="See it work, no camera needed"
              sub="A scripted set played through the app's real pipeline: synthetic landmarks go into the same angle maths and session engine the app uses, with a simulated armband alongside. Every count, alert and cue below is the engine's own output."
            />
            <div className="j-reveal">
              <SimulatedSession />
            </div>
          </section>

          <section className="j-section" id="console">
            <SectionHead
              n="03"
              title="What the physical therapist sees"
              sub="The console from the app, on a simulated patient: two and a half weeks after a left mastectomy, with a setback (axillary cording) the rules catch on their own. Hover the charts."
            />
            <div className="console-frame j-reveal">
              {demo ? (
                <Dashboard
                  progress={demo.bundle.progress}
                  bandTrace={demo.bundle.bandTrace}
                  system={demo.bundle.system}
                  source={demo.source}
                  reportSlot={
                    <Panel id="09" title="Report" meta={demo.bundle.report ? `${demo.bundle.report.model} · checked against the data` : 'Gemini'} span={12} className="report">
                      {demo.bundle.report ? (
                        <ReportView report={demo.bundle.report} />
                      ) : (
                        <p className="muted">The Gemini report for this patient appears here once one has been generated in the app.</p>
                      )}
                    </Panel>
                  }
                />
              ) : (
                <p className="loading">Loading the console…</p>
              )}
            </div>
          </section>

          {GALLERY.length > 0 && (
            <section className="j-section">
              <SectionHead n="04" title="Screens and photos" />
              <div className="gallery">
                {GALLERY.map((g) => (
                  <figure key={g.src} className="j-reveal">
                    <a href={g.src} target="_blank" rel="noreferrer">
                      <img src={g.src} alt={g.caption} loading="lazy" onError={(e) => ((e.currentTarget.closest('figure') as HTMLElement).style.display = 'none')} />
                    </a>
                    <figcaption>{g.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}

          <section className="j-section" id="how">
            <SectionHead n="05" title="How it works" />
            <div className="j-cards">
              <article className="card j-reveal">
                <p className="eyebrow">Camera coach</p>
                <h3>Measures every rep, live</h3>
                <p className="muted">
                  MediaPipe Pose runs in the browser. We measure the upper arm against the trunk, count reps, enforce the limit with a beep and a voice cue, catch shrugging, leaning
                  and a bent elbow, and ask for a pain rating after every set.
                </p>
              </article>
              <article className="card j-reveal">
                <p className="eyebrow">Armband</p>
                <h3>Real-time monitoring</h3>
                <p className="muted">
                  A XIAO ESP32-S3 with a BNO085 IMU monitors the arm in real time, streaming its angle over Bluetooth at 20 Hz. In a session it takes over when the camera loses the
                  arm. Between sessions it keeps the PT's limit on its own: it beeps faster as the arm nears the limit, alarms above it, and chirps if the arm hasn't been raised for a
                  while.
                </p>
              </article>
              <article className="card j-reveal">
                <p className="eyebrow">PT console</p>
                <h3>Turns data into a conversation</h3>
                <p className="muted">
                  Fixed rules flag range loss, rising pain, reported symptoms and limit breaks. Gemini writes a plain-language summary for the patient and a one-page report the PT can
                  read before the next visit.
                </p>
              </article>
            </div>
            <div
              className="j-flow j-reveal"
              role="img"
              aria-label="Armband and laptop camera feed the browser app, which sends angles to an API server; the server stores them in Tiger Data, runs the flag rules and asks Gemini for the report."
            >
              <div className="j-node">
                <strong>Armband</strong>
                <span>XIAO ESP32-S3 + BNO085</span>
              </div>
              <div className="j-arrow">Bluetooth, 20 Hz</div>
              <div className="j-node j-node-main">
                <strong>Browser app</strong>
                <span>MediaPipe on-device · session engine · voice coach</span>
                <span className="j-tag">Camera never uploaded</span>
              </div>
              <div className="j-arrow">angles + answers</div>
              <div className="j-node">
                <strong>API server</strong>
                <span>Auth0-verified · rules engine</span>
              </div>
              <div className="j-arrow">SQL</div>
              <div className="j-node">
                <strong>Tiger Data</strong>
                <span>hypertables · continuous aggregates</span>
              </div>
              <div className="j-arrow">stats + flags</div>
              <div className="j-node">
                <strong>Gemini</strong>
                <span>patient summary · PT report</span>
              </div>
            </div>
            <div className="j-split">
              <div className="card j-reveal">
                <h3>Decided by code</h3>
                <ul>
                  <li>Arm angle, rep counts and form checks</li>
                  <li>Range limits and the alerts when you pass them</li>
                  <li>Every flag: range loss, rising pain, symptoms, low daily use, limit breaks</li>
                  <li>Every number that appears in a report</li>
                </ul>
              </div>
              <div className="card j-reveal">
                <h3>Written by Gemini</h3>
                <ul>
                  <li>A plain-language summary for the patient</li>
                  <li>The PT report's narrative, explaining flags the rules already raised</li>
                  <li>Questions the PT could ask at the next visit</li>
                </ul>
                <p className="fine">
                  The server checks every number in Gemini's text against the data, sends any that don't match back to Gemini once, and marks any still unmatched for the PT.
                  Gemini never sees video and never sets a limit or a flag.
                </p>
              </div>
            </div>
          </section>

          <section className="j-section j-reveal">
            <SectionHead n="06" title="Privacy and honest notes" />
            <ul className="j-list">
              <li>Video never leaves the laptop. Pose tracking runs on-device; only angles, counts and answers are stored.</li>
              <li>Patients can hide the camera image and see only an outline of their arm, which matters after chest surgery.</li>
              <li>The patient in the console is simulated, and the replay is scripted. Both run through the real code.</li>
              <li>The band as built doesn't log daily arm use yet, so the console's daily-use panel shows simulated data.</li>
              <li>The range limits in the demo are placeholders. Real limits come from the patient's surgeon or physical therapist.</li>
              <li>Chrome's speech recognition uses Google's servers, so voice answers are optional and tap buttons are the default.</li>
              <li>This is a 36-hour prototype, not a medical device.</li>
            </ul>
          </section>

          <section className="j-section j-reveal">
            <SectionHead n="07" title="Team" />
            <ul className="j-team">
              {TEAM.map((m) => (
                <li key={m.name}>
                  <strong>{m.name}</strong>
                  <span className="muted">{m.role}</span>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}

function SectionHead({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <header className="j-head j-reveal">
      <span className="j-num">{n}</span>
      <div>
        <h2>{title}</h2>
        {sub && <p className="muted">{sub}</p>}
      </div>
    </header>
  );
}
