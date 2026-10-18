# Haven

*Recover at home, never alone.*

Haven is a personal post-mastectomy rehabilitation coach. A laptop camera, plus an optional ESP32 armband, tracks arm range live, keeps patients within their PT's limits and coaches by voice. Physical therapists set each patient's phase, exercises and limits and follow their progress; patients see their plan and how far they've come. Safety rules are plain code; Gemini only writes the report prose.

Built with React + Vite, Express, Tiger Data (TimescaleDB), Auth0 and Gemini. Needs Node 22.12 or later.

```sh
cd server && npm install && npm run db:setup -- --seed && npm run dev   # put DATABASE_URL in server/.env first
cd web && npm install && npm run dev                                    # in a second terminal
```

Without Auth0 keys it runs in dev mode, where the top bar flips between the Patient and Clinician sides.
