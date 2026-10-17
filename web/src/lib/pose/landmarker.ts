import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Keep in sync with the exact version pinned in package.json.
const MEDIAPIPE_VERSION = '1.0.1';

// Local copies come from scripts/setup-assets.mjs; the CDN is the fallback.
const SOURCES = [
  { wasm: '/mediapipe/wasm', model: '/models/pose_landmarker_full.task' },
  {
    wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
    model: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  },
];

export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  let lastError: unknown;
  for (const source of SOURCES) {
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        const fileset = await FilesetResolver.forVisionTasks(source.wasm);
        return await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: source.model, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch (err) {
        lastError = err;
        console.warn(`Pose model failed to load from ${source.wasm} on ${delegate}`, err);
      }
    }
  }
  throw lastError;
}
