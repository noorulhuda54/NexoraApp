# AGENTS.md — NaSCon '26 Part I continuity log

## Project
Multi-sport league & club operations platform (NaSCon '26 App Dev, Part I). Binding spec: the official 22-page PDF
(Sections 5.1–5.14 define the autograded `/audit/v1/*` contract). Backend on host port 8080 via Docker Compose.

## Architecture
- `backend/` Node.js 22 + Express 4.21.2, pg 8.13.1, ioredis 5.4.2 (no other runtime deps).
  - `src/lib.js` errors, canonical JSON + HMAC (5.3), HS256 JWT, validators.
  - `src/state.js` in-process domain state (Maps) + baseline seed (5.5); every mutation is written through to PostgreSQL.
  - `src/db.js` PostgreSQL 16 schema (kv, append-only `match_events`, append-only `roster_audit`, `domain_events`, meta) + serialized write queue; state rehydrates from DB at boot.
  - `src/queue.js` / `src/worker.js` Redis 7 list queue `nascon:domain-events` + worker container.
  - `src/services/*` domain services; `src/routes/*` HTTP routes.
- `docker-compose.yml`: db (postgres:16-alpine), redis (redis:7-alpine), api (port 8080), worker.
- `mobile/` Expo SDK 52 (React Native 0.76.9, TypeScript 5.3) app: `App.tsx` (custom stack+tabs navigation), `src/api.ts`, `src/db.ts` (expo-sqlite), `src/sync.ts` (queue/NetInfo), `src/screens/*`.
- `backend/src/routes/mobile.js` authenticated `/api/v1/*` API for the app; `backend/src/services/seedDemo.js` demo league/fixtures/roster.

## Startup
- Docker: `DAY1_SALT=<salt> docker compose up -d --build` → `curl localhost:8080/health`
- Local (no DB): `cd backend && npm ci && DAY1_SALT=x node src/server.js`
- Tests: `./run_tests.sh`

## Status (update every chunk)
| Phase | State |
|---|---|
| 1 Backend skeleton, /health, Docker | DONE — compose verified locally (db/redis/api/worker healthy, restart rehydrates state) |
| 2 Reset + baseline seed | DONE |
| 3 Sports + fixtures (RR/Swiss/SE/DE) | DONE — tests/fixtures.test.js |
| 4 Events/score/HMAC | DONE — tests/scoring.test.js, Appendix A vectors |
| 5 Leagues/standings | DONE — tests/standings.test.js (3-way H2H, compensation, NRR, lots) |
| 6 Roster | DONE — tests/roster.test.js (order of checks, loan return, deferred) |
| 7 Checkout/inventory/PDF | DONE — tests/store.test.js (20 buyers), tests/smoke_api.py vs Docker |
| 8 RBAC/security/rate limit | DONE — tests/rbac.test.js |
| 5.14 Offline sync | DONE — tests/sync.test.js |
| 9 Mobile | DONE (source): all Section 8.2 screens, SQLite cache, persistent queue, SecureStore JWT; `tsc` clean; `expo export` bundles OK. Not run on a device yet (UNVERIFIED on device). |
| 10 Integration/APK/coverage | coverage DONE; APK built in workspace (see APK build notes) after dl.google.com was allowed. |

## Tests executed (latest)
- `./run_tests.sh` → 38 pass / 0 fail (node:test, in-process, no DB), incl. tests/mobile_api.test.js.
- Swiss optimality cross-checked against brute force on 297 random instances (0 mismatches); 64 teams × 30 rounds worst case < 2 s.
- `/audit/v1/reset` twice → byte-identical reset response and standings (Docker).
- `DAY1_SALT=test-salt python3 tests/smoke_api.py` against Docker stack → 10/10 PASS.

## Known issues / assumptions
- Runtime source of truth is in-process state persisted write-through to PostgreSQL (single api replica required).
- Unknown variant ids in `/reset` `stock` are ignored.
- Spec ambiguities resolved: 400 checks (team_id, event_type) run before 409 status checks (global validation order);
  RBAC probes check 401 → 404 (id unknown) → 403; TP match is listed inside the final round of single_elim;
  GF1.winner_to → GF2.away / loser_to → GF2.home so GF2 keeps GF1's home/away teams; roster request_id reuse with a
  different body → 409 DUPLICATE_REQUEST_ID (not in catalogue); offline-sync rejected unknown match → server_version 0.
- Docker build cannot fetch npm packages inside this sandbox (proxy); verified with a local Dockerfile variant that copies node_modules. Real `Dockerfile` uses `npm ci` (grader has internet during build).
- APK build notes (this sandbox): Android SDK at /opt/android-sdk (platform 35, build-tools 35.0.0, NDK 26.1.10909125, CMake 3.22.1);
  JDK 17 required (apt openjdk-17-jdk-headless; Gradle's foojay toolchain download is blocked); Maven Central rate-limits (429) this egress →
  ~/.gradle/init.d/mirror.gradle routes Central to maven-central.storage-download.googleapis.com; the sandbox JAVA_TOOL_OPTIONS stderr notice
  breaks AGP's prefab step (CXX1210) → run gradle with `env -u JAVA_TOOL_OPTIONS` and pass those options via org.gradle.jvmargs.
  ABIs built: armeabi-v7a, arm64-v8a, x86_64 (android/gradle.properties after prebuild).
- Mobile live updates use 4 s polling of /api/v1/matches/:id; backend also exposes SSE at GET /api/v1/stream.

## Checkpoints
- nascon-checkpoint-01.zip: Phase 1–2 skeleton.
- nascon-checkpoint-02.zip: full backend contract (5.4–5.14) + tests + coverage.
- nascon-checkpoint-03.zip: + /api/v1 mobile API, demo league content, Expo mobile app source.
- nascon-checkpoint-06.zip: + mobile/release/app-release.apk (69 MB, debug-keystore signed, minSdk 24/targetSdk 34, ABIs armeabi-v7a/arm64-v8a/x86_64; apksigner verify OK; NOT yet run on a device/emulator).
- nascon-checkpoint-05.zip: + offline sign-in (SHA-256 credential hash in SecureStore), per-author queued tokens, queue kept on sign-out, per-user + shared SQLite cache, NOOR_TESTING.md.
- nascon-checkpoint-04.zip: + faster Swiss B&B, roster as-of-date replay, bye-result fix, rescheduling/conflict detection (`services/schedule.js`), match admin states, order fulfilment transitions.

## Next action
Install mobile/release/app-release.apk on a phone (adb install) and rehearse the Section 8.4 desk check (NOOR_TESTING.md); fix any device issues.
