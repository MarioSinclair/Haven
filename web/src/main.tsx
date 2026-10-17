import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import { JudgesPage } from './components/JudgesPage';
import { APP_NAME } from './lib/brand';
import '@fontsource-variable/urbanist';
import './styles.css';

const isJudges = window.location.pathname.replace(/\/+$/, '') === '/judges';
if (isJudges) document.title = `For judges · ${APP_NAME}`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isJudges ? (
      <JudgesPage />
    ) : (
      <AuthGate>
        <App />
      </AuthGate>
    )}
  </StrictMode>,
);
