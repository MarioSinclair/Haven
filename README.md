# Rehab Coach

Guided shoulder rehab for people recovering from breast cancer surgery. A laptop camera measures arm angles live, enforces the care team's range limits, catches compensation (shrugging, leaning, bent elbow), and coaches by voice. An ESP32 + IMU armband fills in when the camera loses the arm and logs how much the arm is used in daily life. Everything feeds a dashboard and an AI-written report for the patient's physical therapist.

**Design rule:** safety logic (limits, alerts, flags) is deterministic code. The LLM (Gemini) only writes summaries of numbers it is handed; it never decides a flag.

## Layout

```
web/                         React + Vite app, runs in Chrome
  src/lib/pose/              MediaPipe landmarks → shoulder angles, form metrics, overlay
  src/lib/session/           session state machine, rep counting, limits, camera/band fusion
  src/lib/band/protocol.ts   BLE contract with the firmware (read this first if you're on hardware)
  src/lib/baseline.ts        what progress is measured against (pre-op > healthy arm > general goal)
  src/lib/db.ts              Supabase reads/writes
supabase/
  migrations/                schema
  seed.sql                   generated demo patient (don't edit by hand)
  scripts/generate-seed.mjs  regenerates seed.sql
```

## Run the web app

```sh
cd web
npm install      # also copies the MediaPipe runtime and downloads the pose model into public/
npm run dev      # open http://localhost:5173 in Chrome
npm test         # unit tests for angles, reps, limits, fusion, packets, the session flow
```

Judges' overview: http://localhost:5173/judges (fill in the team, links and domain at the top of `web/src/components/JudgesPage.tsx`).

It runs without a backend (sessions aren't saved) and without hardware: **Simulate band** follows the camera angle through the real packet encoder and parser. Web Bluetooth and voice input need Chrome.

## Backend (Supabase)

1. Create a Supabase project. In the SQL editor, run `supabase/migrations/20261015000000_init.sql`, then `supabase/seed.sql`.
2. Copy `web/.env.example` to `web/.env.local` and fill in the project URL and anon key.

On demo day, run `node supabase/scripts/generate-seed.mjs` and re-run `seed.sql` so the demo data ends yesterday.

RLS policies are wide open so the app works without login. Don't put real patient data in this.

## The demo patient

"Maya (demo)": left mastectomy with axillary node dissection. 14 sessions over 17 days, built so the flag rules have something real to find:

| Days after surgery | What the data shows |
|---|---|
| −6 | Pre-op range check on both arms (side raise 172° on the surgery side) |
| 2–9 | Phase 1, drains in, 90° limit. Range climbs 58° → 89°; a rep or two slips past 90° late in the phase; the band logs reaches above 90° at home on day 6 |
| 10–14 | Drains out, no limit. Range climbs to 126° |
| 15–17 | Axillary cording reported. Side-raise range drops ~17%, pain 2 → 6–7, daily arm use falls ~40%, shrugging rises |

## Band protocol (firmware)

Full contract in [web/src/lib/band/protocol.ts](web/src/lib/band/protocol.ts). In short:

- Advertise as `RehabBand…` with service `f78880cb-642c-467a-9663-6f5165ebeed0`.
- **Data** (notify, ~20 Hz): 18 bytes, little-endian. Board millis, elevation in 0.01°, rate in 0.1°/s, quaternion Q14, battery %, flags.
- **Command** (write): `0x01` zero, `0x02`/`0x03` session start/end, `0x04` daily-use mode, `0x05` + uint32 unix time (sent on every connect, since the board has no clock), `0x06` dump daily log.
- **Daily** (notify): 8-byte per-minute records after `0x06`, ending with an all-zero record.
- Elevation = the angle between the current gravity vector and the one stored at zero (arm hanging), both in the sensor frame. That works however the band is strapped on. Use the BNO085 gravity report (or rotate world-down by the game rotation vector), not the raw accelerometer.
- After lymph node removal, patients are told to avoid anything tight on that arm. Use a wide, loose strap.

## Not built yet

Dashboard, clinician setup view, the deterministic flag rules, the Gemini report and PDF export, and the firmware itself.
