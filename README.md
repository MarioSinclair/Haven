# Haven

Guided shoulder rehab after breast cancer surgery. A laptop camera, plus an optional ESP32 armband, tracks arm range live, keeps patients within their PT's limits and coaches by voice. Physical therapists set each patient's phase, exercises and limits and follow their progress; patients see their plan and how far they've come. Safety rules are plain code; Gemini only writes the report prose.

Built with React + Vite, Express, Tiger Data (TimescaleDB), Auth0 and Gemini.

**Design rule:** safety logic (limits, alerts, flags) is deterministic code. Gemini only writes prose about numbers it is handed and never decides a flag. The server checks every number in its text against the data, asks Gemini once to fix any it can't find, and marks any still unmatched for the PT.

The app name lives in one place: `APP_NAME` in `web/src/lib/brand.ts`.

## Layout

```
web/                          React + Vite app, runs in Chrome
  src/lib/pose/               MediaPipe landmarks → shoulder angles, form metrics, overlay
  src/lib/session/            session state machine, rep counting, limits, camera/band fusion
  src/lib/band/protocol.ts    Bluetooth contract with the armband (read this first if you're on hardware)
  src/lib/flags.ts            the deterministic flag rules (shared with the server)
  src/lib/carePlan.ts         patient, plan and session validation (shared with the server)
  src/lib/numberGuard.ts      checks every number Gemini writes against the data
  src/lib/baseline.ts         what progress is measured against (pre-op > healthy arm > general goal)
  src/components/             screens: SetupScreen, SessionScreen, SummaryScreen, PatientProgress (patient);
                              PatientsScreen, CarePlanScreen, ProgressScreen + Dashboard (clinician);
                              JudgesPage (/judges), SimulatedSession (judges replay)
server/                       Express API: Auth0, Tiger Data, Gemini
db/
  migrations/                 001 schema, 002 Timescale (Tiger only), 003 patient sign-in, 004 band reminder
  seed.sql                    generated demo patient (don't edit by hand)
  scripts/generate-seed.mjs   regenerates seed.sql
```

## Run it locally

Node 22.12 or later. Two terminals. The web app works on its own too (sessions just aren't saved).

```sh
# 1. API server
cd server
cp .env.example .env          # fill in DATABASE_URL at least
npm install
npm run db:setup -- --seed    # applies new migrations, loads the demo patient
npm run dev                   # http://localhost:8787/api/health
npm test                      # sign-in and role tests

# 2. Web app
cd web
npm install                   # also copies the MediaPipe runtime and downloads the pose model
npm run dev                   # http://localhost:5173 (and /judges)
npm test
```

The app opens with the ribbon intro once per browser session (pull the ribbon down, or press Skip); `/welcome` always shows it, which is handy for recording the demo. Vite forwards `/api` to the server. Missing pieces switch off cleanly: no Auth0 settings means dev mode (everyone is the demo clinician and the top bar flips between the Patient and Clinician sides), and no Gemini key means the report button explains what's missing.

## Services

**Tiger Data.** Create a free service at console.cloud.timescale.com and put its connection string in `DATABASE_URL`. `db:setup` records which migrations it has applied, so run it again after pulling new ones. It applies `002_timescale.sql` only where TimescaleDB is available, so plain Postgres works too. Reps, daily use and the raw 20 Hz band stream are hypertables; the dashboard reads the `rom_daily` and `daily_use_daily` continuous aggregates in real-time mode.

**Auth0.** In the Auth0 dashboard:
1. Applications → APIs → Create API. Its Identifier is the audience. Put the tenant domain and the identifier in `server/.env` (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`).
2. Applications → Create Application → Single Page Application. Add `http://localhost:5173` (and the live domain) to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins. Turn on Refresh Token Rotation. Put the domain, client ID and audience in `web/.env.local` (`VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`).
3. List clinician emails in `CLINICIAN_EMAILS`. Only verified emails count. A patient signs in to the record whose email a clinician entered; anyone else sees the demo patient, read-only, and their sessions aren't saved.

**Gemini.** Get a key from Google AI Studio and set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.8-flash`. Requests go out with storage off.

## The judges page (/judges)

Built so a judge can understand and evaluate the project from the link alone: a TL;DR, the demo video, a replay that runs the real session engine on a scripted set, the PT console on the demo patient, and a screenshot gallery. Before judging, fill in the constants at the top of `web/src/components/JudgesPage.tsx`:

- `DEMO_VIDEO`: a YouTube or Vimeo link, or an mp4 dropped into `web/public/judges/` (e.g. `'/judges/demo.mp4'`).
- `GALLERY`: screenshots and photos of you doing the demo, also in `web/public/judges/`.
- `TEAM`, `LIVE_DOMAIN`, `REPO_URL`. Filling in `REPO_URL` adds a "Source code" link, so update the assertion in `JudgesPage.test.tsx` that expects it to be absent.

The console section reads the public, read-only `/api/demo` endpoint (the simulated patient only). If the server doesn't answer within 4 seconds it falls back to `web/src/fixtures/demo.json`. Once you're on Tiger and have generated a Gemini report, refresh that snapshot with `cd server && npm run export-demo`, so the fallback shows Tiger's stats and the report too.

## Deploy (GoDaddy domain)

`cd web && npm run build`, then run the server (`npm start`) on any Node host (Render, Railway, Fly) with Node 22.12 or later. The server serves `web/dist` itself, so one deploy covers the whole site. Point the domain's DNS at the host, and add the domain to the Auth0 application's allowed URLs. It must be HTTPS: Chrome only allows the camera and Bluetooth on secure origins.

Auth0 is required in production: the server refuses to start without `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` when it's serving `web/dist` or `NODE_ENV=production`, because dev mode would make every visitor a clinician. Run `npm run db:setup` against the live database after each deploy that adds a migration.

On demo day, run `node db/scripts/generate-seed.mjs` and `npm run db:setup -- --seed` so the demo data ends yesterday.

## The demo patient

"Maya (demo)": left mastectomy with axillary node dissection. 14 sessions over 17 days, built so the flag rules have something real to find:

| Days after surgery | What the data shows |
|---|---|
| −6 | Pre-op range check on both arms (side raise 172° on the surgery side) |
| 2–9 | Phase 1, drains in, 90° limit. Range climbs 58° → 89°; a rep or two slips past 90° late in the phase; the band logs reaches above 90° at home on day 6 |
| 10–14 | Drains out, no limit. Range climbs to 126° |
| 15–17 | Axillary cording reported. Side-raise range drops ~17%, pain 2 → 6–7, daily arm use falls ~40%, shrugging rises |

The daily-use data is simulated: the band as built doesn't log daily use yet.

## Hardware

- XIAO ESP32-S3: the brain. It reads the sensor, sends data over BLE to the laptop, and charges the battery.
- BNO085: measures upper-arm orientation.
- 600 mAh LiPo plus a JST pigtail: detachable power.
- Armband: holds everything aligned with the upper arm. After lymph node removal, patients are told to avoid anything tight on that arm, so the strap is wide and loose.

## Band protocol

Full contract in [web/src/lib/band/protocol.ts](web/src/lib/band/protocol.ts). The band as built speaks plain text over the Nordic UART service:

- **Band → app** (notify, 20 Hz): one line per sample, `ms, elevation°, rate °/s, gyro x, gyro y, gyro z, zeroed (1/0), limit° (0 = off), over (1/0)`. Older firmware stops after `zeroed`.
- **App → band** (write): `z` zero with the arm hanging relaxed; `c<deg>` safe limit, where the buzzer beeps faster from 10° below and alarms above it (0 = off); `r<min>` chirp after this many minutes without raising the arm above 60° (0 = off); `m1`/`m0` mute and unmute; `b` test beep.
- The app sends the PT's limit (the strictest in the patient's current phase) and reminder every time the band connects. The band keeps them through power-off but forgets the zero, and only warns once zeroed.
- Elevation is the angle between the current gravity vector and the one stored at zero, so it works however the band is strapped on.

The binary GATT contract at the top of `protocol.ts` (session markers, clock sync, a per-minute daily-use log) is still supported by the app, but no firmware implements it yet.

## Not built yet

- Daily-use logging on the band. The band firmware lives outside this repo.
- Server tests beyond sign-in. The web tests cover the shared flag rules, plan and session validation, and band parsing.
