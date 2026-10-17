# Haven

Guided shoulder rehab for people recovering from breast cancer surgery. A laptop camera measures arm angles live, enforces the care team's range limits, catches compensation (shrugging, leaning, bent elbow), and coaches by voice. An ESP32 + IMU armband fills in when the camera loses the arm and logs how much the arm is used in daily life. Everything feeds a progress dashboard and a Gemini-written report for the patient's physical therapist.

**Design rule:** safety logic (limits, alerts, flags) is deterministic code. Gemini only writes prose about numbers it is handed; it never decides a flag, and the server rejects any number in its text that isn't in the data.

The app name lives in one place: `APP_NAME` in `web/src/lib/brand.ts`.

## Layout

```
web/                          React + Vite app, runs in Chrome
  src/lib/pose/               MediaPipe landmarks → shoulder angles, form metrics, overlay
  src/lib/session/            session state machine, rep counting, limits, camera/band fusion
  src/lib/band/protocol.ts    BLE contract with the firmware (read this first if you're on hardware)
  src/lib/flags.ts            the deterministic flag rules (shared with the server)
  src/lib/numberGuard.ts      checks every number Gemini writes against the data
  src/lib/baseline.ts         what progress is measured against (pre-op > healthy arm > general goal)
  src/components/             screens: Dashboard (PT console), SimulatedSession (judges replay),
                              JudgesPage (/judges), AmbientBackground
server/                       Express API: Auth0, Tiger Data, Gemini
db/
  migrations/001_schema.sql   plain Postgres schema
  migrations/002_timescale.sql hypertables, continuous aggregates, columnstore (Tiger only)
  seed.sql                    generated demo patient (don't edit by hand)
  scripts/generate-seed.mjs   regenerates seed.sql
```

## Run it locally

Two terminals. The web app works on its own too (sessions just aren't saved).

```sh
# 1. API server
cd server
cp .env.example .env          # fill in DATABASE_URL at least
npm install
npm run db:setup -- --seed    # applies migrations, loads the demo patient
npm run dev                   # http://localhost:8787/api/health

# 2. Web app
cd web
npm install                   # also copies the MediaPipe runtime and downloads the pose model
npm run dev                   # http://localhost:5173 (and /judges)
npm test
```

The app opens with the ribbon intro once per browser session (pull the ribbon down, or press Skip); `/welcome` always shows it, which is handy for recording the demo. Vite forwards `/api` to the server. Missing pieces switch off cleanly: no Auth0 settings means dev mode (everyone is the demo clinician), and no Gemini key means the report button explains what's missing.

## Services

**Tiger Data.** Create a free service at console.cloud.timescale.com and put its connection string in `DATABASE_URL`. `db:setup` applies `002_timescale.sql` only where TimescaleDB is available, so plain Postgres works too. Reps, daily use and the raw 20 Hz band stream are hypertables; the dashboard reads the `rom_daily` and `daily_use_daily` continuous aggregates in real-time mode.

**Auth0.** In the Auth0 dashboard:
1. Applications → APIs → Create API. Its Identifier is the audience. Put the tenant domain and the identifier in `server/.env` (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`).
2. Applications → Create Application → Single Page Application. Add `http://localhost:5173` (and the live domain) to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins. Turn on Refresh Token Rotation. Put the domain, client ID and audience in `web/.env.local`.
3. List clinician emails in `CLINICIAN_EMAILS`. Everyone else signs in as a patient linked to the demo patient.

**Gemini.** Get a key from Google AI Studio and set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Requests go out with storage off.

## The judges page (/judges)

Built so a judge can understand and evaluate the project from the link alone: a TL;DR, the demo video, a replay that runs the real session engine on a scripted set, the PT console on the demo patient, and a screenshot gallery. Before judging, fill in the constants at the top of `web/src/components/JudgesPage.tsx`:

- `DEMO_VIDEO`: a YouTube or Vimeo link, or an mp4 dropped into `web/public/judges/` (e.g. `'/judges/demo.mp4'`).
- `GALLERY`: screenshots and photos of you doing the demo, also in `web/public/judges/`.
- `TEAM`, `LIVE_DOMAIN`, `REPO_URL`.

The console section reads the public, read-only `/api/demo` endpoint (the simulated patient only). If the server is unreachable it falls back to `web/src/fixtures/demo.json`. Once you're on Tiger and have generated a Gemini report, refresh that snapshot with `cd server && npm run export-demo`, so the fallback shows Tiger's stats and the report too.

## Deploy (GoDaddy domain)

`cd web && npm run build`, then run the server (`npm start`) on any Node host (Render, Railway, Fly). The server serves `web/dist` itself, so one deploy covers the whole site. Point the domain's DNS at the host, and add the domain to the Auth0 application's allowed URLs. It must be HTTPS: Chrome only allows the camera and Bluetooth on secure origins.

On demo day, run `node db/scripts/generate-seed.mjs` and `npm run db:setup -- --seed` so the demo data ends yesterday.

## The demo patient

"Maya (demo)": left mastectomy with axillary node dissection. 14 sessions over 17 days, built so the flag rules have something real to find:

| Days after surgery | What the data shows |
|---|---|
| −6 | Pre-op range check on both arms (side raise 172° on the surgery side) |
| 2–9 | Phase 1, drains in, 90° limit. Range climbs 58° → 89°; a rep or two slips past 90° late in the phase; the band logs reaches above 90° at home on day 6 |
| 10–14 | Drains out, no limit. Range climbs to 126° |
| 15–17 | Axillary cording reported. Side-raise range drops ~17%, pain 2 → 6–7, daily arm use falls ~40%, shrugging rises |

## Hardware

- XIAO ESP32-S3: the brain. It reads the sensor, sends data over BLE to the laptop, and charges the battery.
- BNO085: measures upper-arm orientation. You'll use the Game Rotation Vector report.
- 600 mAh LiPo plus a JST pigtail: detachable power.
- Armband: holds everything aligned with the upper arm.

## Band protocol (firmware)

Full contract in [web/src/lib/band/protocol.ts](web/src/lib/band/protocol.ts). In short:

- Advertise as `RehabBand…` with service `f78880cb-642c-467a-9663-6f5165ebeed0`.
- **Data** (notify, ~20 Hz): 18 bytes, little-endian. Board millis, elevation in 0.01°, rate in 0.1°/s, quaternion Q14, battery %, flags.
- **Command** (write): `0x01` zero, `0x02`/`0x03` session start/end, `0x04` daily-use mode, `0x05` + uint32 unix time (sent on every connect, since the board has no clock), `0x06` dump daily log.
- **Daily** (notify): 8-byte per-minute records after `0x06`, ending with an all-zero record.
- Elevation = the angle between the current gravity vector and the one stored at zero (arm hanging), both in the sensor frame. That works however the band is strapped on. Use the BNO085 gravity report (or rotate world-down by the game rotation vector), not the raw accelerometer.
- After lymph node removal, patients are told to avoid anything tight on that arm. Use a wide, loose strap.

## Not built yet

The firmware, a clinician screen listing all patients, and a test of `002_timescale.sql` against a live Tiger service.
