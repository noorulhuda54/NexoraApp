# Traceability (FR / NFR → code → tests)
| ID | Source files | Automated tests |
|---|---|---|
| FR-1.1 Sports as data, 3 scoring models | backend/src/services/sports.js, backend/src/state.js (seed), backend/src/services/matches.js (`project`) | tests/sports.test.js, tests/scoring.test.js |
| FR-1.1 Event sourcing + compensation | backend/src/services/matches.js, backend/src/db.js (`match_events` append-only trigger) | tests/scoring.test.js |
| FR-1.2 League setup | backend/src/services/standings.js (`createLeague`), backend/src/state.js | tests/standings.test.js |
| FR-1.3 Round-robin / Swiss / single / double elimination | backend/src/services/fixtures.js | tests/fixtures.test.js |
| FR-1.3 Match state machine | backend/src/services/matches.js | tests/scoring.test.js |
| FR-1.4 Standings, H2H, tie-breaks, qualification | backend/src/services/standings.js | tests/standings.test.js |
| FR-2.1 Clubs / tenants | backend/src/state.js, backend/src/routes/mobile.js | tests/rbac.test.js |
| FR-2.2 Roster, transfers, loans, audit | backend/src/services/roster.js, backend/src/db.js (`roster_audit`) | tests/roster.test.js |
| FR-2.3 Store, checkout, receipts, order events | backend/src/services/store.js, backend/src/services/pdf.js, backend/src/queue.js, backend/src/worker.js | tests/store.test.js, tests/smoke_api.py |
| FR-5.1 5-tier RBAC | backend/src/services/rbac.js | tests/rbac.test.js |
| NFR-3 Concurrency | backend/src/services/store.js (`checkout`) | tests/store.test.js, tests/smoke_api.py |
| NFR-4 Offline tolerance | backend/src/services/sync.js, mobile/src/offline/* | tests/sync.test.js |
| NFR-5 Security (JWT, rate limit, validation, 413) | backend/src/lib.js, backend/src/routes/api.js, backend/src/app.js | tests/rbac.test.js, tests/core.test.js |
| NFR-7 Reproducibility | docker-compose.yml, backend/Dockerfile, backend/src/db.js, backend/src/server.js | tests/smoke_api.py (Docker) |
| 5.3 HMAC signatures | backend/src/lib.js | tests/core.test.js |
