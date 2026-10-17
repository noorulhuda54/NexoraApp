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
See `mobile/README.md`. Release APK: `mobile/release/app-release.apk`.
