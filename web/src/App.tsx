import { useEffect, useMemo, useState } from 'react';
import { SessionScreen } from './components/SessionScreen';
import { SetupScreen } from './components/SetupScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { SimulatedBand, WebBluetoothBand, type BandSource, type BandStatus } from './lib/band/band';
import { cameraTruth } from './lib/band/simTruth';
import { defaultProtocolByPhase, loadPatient, OFFLINE_PATIENT, type PatientProfile, type ProtocolByPhase } from './lib/db';
import type { SessionPlan } from './lib/protocol';
import type { SessionResult } from './lib/session/engine';
import { Coach } from './lib/voice/coach';

type Screen =
  | { name: 'setup' }
  | { name: 'session'; plan: SessionPlan; skeletonOnly: boolean }
  | { name: 'summary'; result: SessionResult };

interface Loaded {
  patient: PatientProfile;
  protocol: ProtocolByPhase;
  error?: string;
}

export function App() {
  const coach = useMemo(() => new Coach(), []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'setup' });
  const [band, setBand] = useState<BandSource | null>(null);
  const [bandStatus, setBandStatus] = useState<BandStatus>('disconnected');

  useEffect(() => {
    loadPatient()
      .then(setLoaded)
      .catch((err) => setLoaded({ patient: OFFLINE_PATIENT, protocol: defaultProtocolByPhase(), error: String(err) }));
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

  if (!loaded) return <div className="loading">Loading patient…</div>;

  return (
    <main>
      {screen.name === 'setup' && (
        <SetupScreen
          patient={loaded.patient}
          protocol={loaded.protocol}
          loadError={loaded.error}
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
      {screen.name === 'session' && (
        <SessionScreen
          plan={screen.plan}
          band={band}
          coach={coach}
          skeletonOnly={screen.skeletonOnly}
          onFinish={(result) => setScreen({ name: 'summary', result })}
        />
      )}
      {screen.name === 'summary' && <SummaryScreen result={screen.result} patient={loaded.patient} onDone={() => setScreen({ name: 'setup' })} />}
    </main>
  );
}
