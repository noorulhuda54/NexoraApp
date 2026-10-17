# NaSCon '26 — Multi-Sport League & Club Operations Platform (Part I)

## Run
```bash
DAY1_SALT=<your-salt> docker compose up -d --build
curl http://localhost:8080/health   # {"status":"ok"}
```
No manual steps: the API creates its PostgreSQL schema and seeds baseline data at startup. `POST /audit/v1/reset` re-seeds.

Services: `api` (Node.js/Express, port 8080), `db` (PostgreSQL 16), `redis` (Redis 7 queue), `worker` (queue consumer).

## Tests
```bash
./run_tests.sh
```

## Demo accounts (password `Nascon@26` for all)
| Role | Email |
|---|---|
| Platform Super-Admin | admin@nascon.test |
| League Organizer (owns league-alpha-1) | organizer@nascon.test |
| Club Manager (owns club-alpha-1) | manager@nascon.test |
| Player (player-alpha-1) | player@nascon.test |
| General Viewer | viewer@nascon.test |

## Mobile
Expo / React Native Android app in `mobile/` — build steps in `mobile/README.md`. Release APK path: `mobile/release/app-release.apk`.
In the app, set the server address (login screen → Server settings): emulator `http://10.0.2.2:8080`, phone `http://<laptop LAN IP>:8080`.

## Layout
- `backend/` API + worker (Node.js 22, Express, PostgreSQL 16, Redis 7) — `/audit/v1/*` grader contract, `/api/v1/*` app API
- `tests/` node:test suites (+ `smoke_api.py` black-box check against a running stack)
- `COVERAGE.json` regenerated from real measurements by `./run_tests.sh`
