import { useEffect, useMemo, useState } from 'react';
import { AmbientBackground } from './components/AmbientBackground';
import { useAuthInfo } from './components/AuthGate';
import { Logo } from './components/Logo';
import { ProgressScreen } from './components/ProgressScreen';
import { SessionScreen } from './components/SessionScreen';
import { SetupScreen } from './components/SetupScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { defaultProtocolByPhase, DEMO_PATIENT_ID, getMe, loadPatient, OFFLINE_PATIENT, serverStatus, type PatientProfile, type ServerStatus } from './lib/api';
import type { BandTracePoint, Me, ProtocolByPhase } from './lib/apiTypes';
import { APP_NAME } from './lib/brand';
import { SimulatedBand, WebBluetoothBand, type BandSource, type BandStatus } from './lib/band/band';
import { cameraTruth } from './lib/band/simTruth';
import type { SessionPlan } from './lib/protocol';
import type { SessionResult } from './lib/session/engine';
import { Coach } from './lib/voice/coach';

type Screen =
  | { name: 'setup' }
  | { name: 'session'; plan: SessionPlan; skeletonOnly: boolean }
  | { name: 'summary'; result: SessionResult; trace: BandTracePoint[] }
  | { name: 'progress' };

interface Loaded {
  patient: PatientProfile;
  protocol: ProtocolByPhase;
  error?: string;
}

export function App() {
  const coach = useMemo(() => new Coach(), []);
  const auth = useAuthInfo();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'setup' });
  const [band, setBand] = useState<BandSource | null>(null);
  const [bandStatus, setBandStatus] = useState<BandStatus>('disconnected');

  useEffect(() => {
    (async () => {
      const s = await serverStatus();
      setStatus(s);
      if (!s.reachable || !s.database) {
        setLoaded({ patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase() });
        return;
      }
      try {
        const user = await getMe();
        setMe(user);
        setLoaded(await loadPatient(user.patientId ?? DEMO_PATIENT_ID));
      } catch (err) {
        setLoaded({ patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase(), error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  useEffect(() => {
    if (!band) return;
    return band.onStatus(setBandStatus);
  }, [band]);

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

  if (!loaded || !status) return <div className="loading">Loading…</div>;

  const online = !!loaded.patient.id;

  if (screen.name === 'session') {
    return (
      <SessionScreen
        plan={screen.plan}
        band={band}
        coach={coach}
        skeletonOnly={screen.skeletonOnly}
        onFinish={(result, trace) => setScreen({ name: 'summary', result, trace })}
      />
    );
  }

  return (
    <>
      <AmbientBackground />
      <nav className="topbar">
        <a href="/" className="brand" aria-label="Home">
          <Logo />
          <span>{APP_NAME}</span>
        </a>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={screen.name !== 'progress'} className={screen.name !== 'progress' ? 'active' : ''} onClick={() => setScreen({ name: 'setup' })}>
            Session
          </button>
          <button
            role="tab"
            aria-selected={screen.name === 'progress'}
            className={screen.name === 'progress' ? 'active' : ''}
            disabled={!online}
            title={online ? undefined : 'Start the server to see progress'}
            onClick={() => setScreen({ name: 'progress' })}
          >
            Progress
          </button>
        </div>
        <div className="topbar-right">
          {me && <span className="pill">{me.role === 'clinician' ? 'Clinician' : 'Patient'}</span>}
          {auth ? (
            <button className="link" onClick={auth.logout}>
              Sign out{auth.email ? ` ${auth.email}` : ''}
            </button>
          ) : (
            online && <span className="fine">Dev mode</span>
          )}
        </div>
      </nav>

      <main>
        {screen.name === 'setup' && (
          <SetupScreen
            patient={loaded.patient}
            protocol={loaded.protocol}
            loadError={loaded.error}
            online={online}
            isClinician={me?.role === 'clinician'}
            band={band}
            bandStatus={bandStatus}
            onConnectBand={connectBand}
            onDisconnectBand={disconnectBand}
            onStart={(plan, opts) => {
              coach.unlock();
              coach.enabled = opts.voice;
              setScreen({ name: 'session', plan, skeletonOnly: opts.skeletonOnly });
            }}
          />
        )}
        {screen.name === 'summary' && (
          <SummaryScreen result={screen.result} trace={screen.trace} patient={loaded.patient} onDone={() => setScreen({ name: 'setup' })} />
        )}
        {screen.name === 'progress' && loaded.patient.id && <ProgressScreen patientId={loaded.patient.id} geminiEnabled={status.gemini} />}
      </main>
    </>
  );
}
