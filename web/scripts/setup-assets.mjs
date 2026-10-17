// Copies the MediaPipe wasm runtime and downloads the pose model into public/
// so the demo works on bad venue Wi-Fi. Runs on `npm install`; never fails the install.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = join(root, 'public/mediapipe/wasm');
const modelDest = join(root, 'public/models/pose_landmarker_full.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

try {
  cpSync(wasmSrc, wasmDest, { recursive: true });
  console.log('[assets] copied MediaPipe wasm');
} catch (err) {
  console.warn('[assets] could not copy wasm; the app will fall back to the CDN:', err.message);
}

if (existsSync(modelDest)) {
  console.log('[assets] pose model already present');
} else {
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(modelDest), { recursive: true });
    writeFileSync(modelDest, Buffer.from(await res.arrayBuffer()));
    console.log('[assets] downloaded pose model');
  } catch (err) {
    console.warn('[assets] could not download pose model; the app will fall back to the CDN:', err.message);
  }
}
