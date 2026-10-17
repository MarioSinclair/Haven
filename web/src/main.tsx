import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate, markGatePassed } from './components/AuthGate';
import { JudgesPage } from './components/JudgesPage';
import { RibbonGate } from './components/RibbonGate';
import { APP_NAME } from './lib/brand';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/urbanist';
import './styles.css';

const path = window.location.pathname.replace(/\/+$/, '');
if (path === '/judges') document.title = `For judges · ${APP_NAME}`;

function Root() {
  if (path === '/judges') return <JudgesPage />;
  // Always shows the ribbon intro, for recording the demo or showing it off.
  if (path === '/welcome') {
    return (
      <RibbonGate
        continueLabel="Enter"
        note="This page always plays the intro. The app shows it once per session."
        onContinue={() => {
          markGatePassed();
          window.location.href = '/';
        }}
      />
    );
  }
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
