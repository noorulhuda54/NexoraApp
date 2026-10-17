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
- `mobile/` Expo React Native app (Phase 9).

## Startup
- Docker: `DAY1_SALT=<salt> docker compose up -d --build` → `curl localhost:8080/health`
- Local (no DB): `cd backend && npm ci && DAY1_SALT=x node src/server.js`
- Tests: `./run_tests.sh`

## Status (update every chunk)
| Phase | State |
|---|---|
| 1 Backend skeleton, /health, Docker | DONE |
| 2 Reset + baseline seed | DONE (demo league content pending) |
| 3 Sports + fixtures | sports DONE; fixtures IN PROGRESS |
| 4 Events/score/HMAC | HMAC DONE (Appendix A vectors pass); events TODO |
| 5 Leagues/standings | TODO |
| 6 Roster | TODO |
| 7 Checkout/inventory/PDF | TODO |
| 8 RBAC/security/rate limit | TODO |
| 9 Mobile | TODO |
| 10 Integration/APK/coverage | TODO |

## Known issues / assumptions
- Runtime source of truth is in-process state persisted write-through to PostgreSQL (single api replica required).
- Unknown variant ids in `/reset` `stock` are ignored.
- Android SDK not present in workspace → APK build status UNVERIFIED/BLOCKED until attempted.

## Checkpoints
- nascon-checkpoint-01.zip: Phase 1–2 skeleton.

## Next action
Implement /audit/v1/fixtures (round_robin, swiss, single_elim, double_elim) in `backend/src/services/fixtures.js`.
