import { useEffect, useMemo, useState } from 'react';
import { AmbientBackground } from './components/AmbientBackground';
import { useAuthInfo } from './components/AuthGate';
import { CarePlanScreen } from './components/CarePlanScreen';
import { Logo } from './components/Logo';
import { PatientProgress } from './components/PatientProgress';
import { PatientsScreen } from './components/PatientsScreen';
import { ProgressScreen } from './components/ProgressScreen';
import { SessionScreen } from './components/SessionScreen';
import { SetupScreen } from './components/SetupScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { defaultProtocolByPhase, DEMO_PATIENT_ID, getMe, listPatients, loadPatient, OFFLINE_PATIENT, serverStatus, type PatientProfile, type ServerStatus } from './lib/api';
import type { BandTracePoint, Me, PatientBundle, ProtocolByPhase } from './lib/apiTypes';
import { APP_NAME } from './lib/brand';
import { SimulatedBand, WebBluetoothBand, type BandSource, type BandStatus } from './lib/band/band';
import { cameraTruth } from './lib/band/simTruth';
import { phaseLimit } from './lib/carePlan';
import type { SessionPlan } from './lib/protocol';
import type { SessionResult } from './lib/session/engine';
import { Coach } from './lib/voice/coach';

/** The two halves of the app. A signed-in patient only ever gets their side. */
type View = 'patient' | 'clinician';
/** Clinicians plan and review; sessions happen on the patient side. */
type ClinicianScreen = 'patients' | 'plan' | 'progress';
type PatientScreen = 'setup' | 'progress';
/** A session runs full screen, then shows its summary, on whichever side started it. */
type Run = { name: 'session'; plan: SessionPlan; skeletonOnly: boolean } | { name: 'summary'; result: SessionResult; trace: BandTracePoint[] };

/** The patient on screen. Offline there's no bundle, just the placeholder patient. */
interface Current {
  patient: PatientProfile;
  protocol: ProtocolByPhase;
  bundle?: PatientBundle;
  /** Bumped on every load so screens that copy the plan into state start fresh. */
  version: number;
  error?: string;
}

const offline = (error?: string): Current => ({ patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase(), version: 0, error });
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function App() {
  const coach = useMemo(() => new Coach(), []);
  const auth = useAuthInfo();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('patient');
  const [clinicianScreen, setClinicianScreen] = useState<ClinicianScreen>('patients');
  const [patientScreen, setPatientScreen] = useState<PatientScreen>('setup');
  const [run, setRun] = useState<Run | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [band, setBand] = useState<BandSource | null>(null);
  const [bandStatus, setBandStatus] = useState<BandStatus>('disconnected');

  const show = (bundle: PatientBundle) => setCurrent((c) => ({ patient: bundle.patient, protocol: bundle.protocol, bundle, version: (c?.version ?? 0) + 1 }));

  useEffect(() => {
    (async () => {
      const s = await serverStatus();
      setStatus(s);
      if (!s.reachable || !s.database) {
        setCurrent(offline());
        setReady(true);
        return;
      }
      try {
        const user = await getMe();
        setMe(user);
        // Clinicians start at their patient list; a patient goes straight to their session.
        if (user.role === 'clinician') setView('clinician');
        else show(await loadPatient(user.patientId ?? DEMO_PATIENT_ID));
      } catch (err) {
        setCurrent(offline(message(err)));
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!band) return;
    return band.onStatus(setBandStatus);
  }, [band]);

  // The PT's limit and reminder go to the band whenever it connects or the plan changes. Only a
  // plan loaded from the server counts: offline, the placeholder protocol is nobody's decision.
  const plan = current?.bundle;
  const bandLimit = plan ? phaseLimit(plan.protocol[plan.patient.currentPhase]) : undefined;
  const bandReminder = plan?.patient.reminderMinutes;
  useEffect(() => {
    if (!band || bandStatus !== 'connected' || bandLimit === undefined || bandReminder === undefined) return;
    band.configure({ limitDeg: bandLimit, reminderMinutes: bandReminder }).catch(() => undefined);
  }, [band, bandStatus, bandLimit, bandReminder]);

  const connectBand = async (kind: 'ble' | 'simulated') => {
    band?.disconnect();
    const next = kind === 'ble' ? new WebBluetoothBand() : new SimulatedBand(() => cameraTruth.deg);
    setBand(next);
    setBandStatus('connecting');
    await next.connect();
    setBandStatus(next.status);
  };

  const disconnectBand = () => {
    band?.disconnect();
    setBand(null);
    setBandStatus('disconnected');
  };

  const openPatient = async (patientId: string) => {
    try {
      show(await loadPatient(patientId));
      setClinicianScreen('plan');
    } catch (err) {
      window.alert(`Could not open the patient: ${message(err)}`);
    }
  };

  /** A clinician previewing the patient side sees the patient they have open, else the demo patient. */
  const switchView = async (next: View) => {
    setRun(null);
    setView(next);
    if (next !== 'patient' || current) return;
    try {
      const demo = await loadPatient(DEMO_PATIENT_ID).catch(() => null);
      if (demo) return show(demo);
      const [first] = await listPatients();
      if (!first) throw new Error('Add a patient on the clinician side first.');
      show(await loadPatient(first.patient.id));
    } catch (err) {
      setPreviewError(message(err));
    }
  };

  const startSession = (plan: SessionPlan, opts: { skeletonOnly: boolean; voice: boolean }) => {
    coach.unlock();
    coach.enabled = opts.voice;
    setRun({ name: 'session', plan, skeletonOnly: opts.skeletonOnly });
  };

  if (!ready || !status) return <div className="loading">Loading…</div>;

  if (run?.name === 'session') {
    return (
      <SessionScreen
        plan={run.plan}
        band={band}
        coach={coach}
        skeletonOnly={run.skeletonOnly}
        onFinish={(result, trace) => setRun({ name: 'summary', result, trace })}
      />
    );
  }

  const clinician = me?.role === 'clinician';
  const side: View = clinician ? view : 'patient';
  const online = !!current?.patient.id;
  // A signed-in clinician trying the patient side, or a sign-in with no record of their own, must not
  // add to a real record. Dev mode has no sign-in and still saves, so the save path can be tried locally.
  const skipSave = clinician && auth ? 'Preview: not saved' : me?.readOnly ? 'Demo: not saved' : undefined;

  return (
    <>
      <AmbientBackground />
      <nav className="topbar">
        <a href="/" className="brand" aria-label="Home">
          <Logo />
          <span>{APP_NAME}</span>
        </a>
        {clinician && (
          <div className="view-switch" role="radiogroup" aria-label="View">
            {(['patient', 'clinician'] as View[]).map((v) => (
              <button key={v} role="radio" aria-checked={side === v} className={side === v ? 'on' : ''} onClick={() => side !== v && void switchView(v)}>
                {v === 'patient' ? 'Patient' : 'Clinician'}
              </button>
            ))}
          </div>
        )}
        <div className="topbar-right">
          {clinician && side === 'patient' && current && <span className="pill topbar-patient">Viewing as {current.patient.displayName}</span>}
          {me?.readOnly && <span className="pill topbar-patient">Demo patient: sessions aren't saved</span>}
          {auth ? (
            <button className="link" onClick={auth.logout}>
              Sign out<span className="signout-email">{auth.email ? ` ${auth.email}` : ''}</span>
            </button>
          ) : (
            (online || clinician) && <span className="fine">Dev mode</span>
          )}
        </div>
      </nav>

      <main>
        {run?.name === 'summary' && current ? (
          <SummaryScreen result={run.result} trace={run.trace} patient={current.patient} skipSave={skipSave} onDone={() => setRun(null)} />
        ) : side === 'clinician' ? (
          <>
            {clinicianScreen === 'patients' && <PatientsScreen onOpen={openPatient} />}
            {clinicianScreen === 'plan' && current?.bundle && (
              <CarePlanScreen
                key={current.bundle.patient.id}
                bundle={current.bundle}
                onChange={show}
                onBack={() => setClinicianScreen('patients')}
                onProgress={() => setClinicianScreen('progress')}
              />
            )}
            {clinicianScreen === 'progress' && current?.patient.id && (
              <ProgressScreen key={current.patient.id} patientId={current.patient.id} geminiEnabled={status.gemini} onBack={() => setClinicianScreen('plan')} />
            )}
          </>
        ) : !current ? (
          previewError ? (
            <div className="setup">
              <p className="notice">{previewError}</p>
            </div>
          ) : (
            <div className="loading">Loading…</div>
          )
        ) : patientScreen === 'progress' && current.patient.id ? (
          <PatientProgress key={current.patient.id} patientId={current.patient.id} onBack={() => setPatientScreen('setup')} />
        ) : (
          <SetupScreen
            key={`${current.patient.id}:${current.version}`}
            patient={current.patient}
            protocol={current.protocol}
            loadError={current.error}
            online={online}
            planLocked={online}
            band={band}
            bandStatus={bandStatus}
            onConnectBand={connectBand}
            onDisconnectBand={disconnectBand}
            onStart={startSession}
            onProgress={online ? () => setPatientScreen('progress') : undefined}
          />
        )}
      </main>
    </>
  );
}
