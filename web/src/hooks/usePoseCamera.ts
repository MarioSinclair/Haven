import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPoseLandmarker } from '../lib/pose/landmarker';

export type CameraStatus = 'starting' | 'ready' | 'error';

type FrameHandler = (landmarks: NormalizedLandmark[] | null, t: number, width: number, height: number) => void;

/** Opens the webcam, runs pose detection on every new frame, and hands results to `onFrame`. Video never leaves the page. */
export function usePoseCamera(videoRef: RefObject<HTMLVideoElement | null>, onFrame: FrameHandler) {
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onFrame);
  handler.current = onFrame;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: PoseLandmarker | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        landmarker = await createPoseLandmarker();
        if (cancelled) return;
        setStatus('ready');

        let lastVideoTime = -1;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          const t = performance.now();
          const result = landmarker!.detectForVideo(video, t);
          handler.current(result.landmarks[0] ?? null, t, video.videoWidth, video.videoHeight);
        };
        loop();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
    };
  }, [videoRef]);

  return { status, error };
}
