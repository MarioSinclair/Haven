import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { JudgesPage } from './components/JudgesPage';
import './styles.css';

const isJudges = window.location.pathname.replace(/\/+$/, '') === '/judges';
if (isJudges) document.title = 'For judges · Shoulder Rehab Coach';

createRoot(document.getElementById('root')!).render(<StrictMode>{isJudges ? <JudgesPage /> : <App />}</StrictMode>);
