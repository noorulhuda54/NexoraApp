# How to test a checkpoint ZIP (for Noor)

Prerequisites: Docker Engine 24+ with Compose v2, Python 3, (optional) Node.js 20/22 for unit tests.

1. Unzip; open a terminal in the folder that contains `docker-compose.yml`.
2. Start everything (use the real salt only on the command line, never in a file):
   ```bash
   DAY1_SALT='<our-salt>' docker compose up -d --build
   ```
   Must finish in < 10 min. Then within 120 s:
   ```bash
   curl http://localhost:8080/health          # → {"status":"ok"}
   docker compose ps                          # api, worker, db, redis all "Up"
   ```
3. Black-box smoke test (checks HMAC with the real salt, 20 parallel buyers, PDF, RBAC, rate limit):
   ```bash
   DAY1_SALT='<our-salt>' python3 tests/smoke_api.py
   ```
   Expect `10 checks passed`. Send me any `FAIL` lines.
4. Unit/API tests + coverage (needs Node.js):
   ```bash
   ./run_tests.sh        # expect "fail 0"; regenerates COVERAGE.json
   ```
5. Restart check: `docker compose restart api && sleep 5 && curl localhost:8080/health`.
6. Clean-machine check (what the grader does): `docker compose down -v` then step 2 again.
7. Logs if something fails: `docker compose logs api --tail 100` — paste the output to me.

## Build and install the Android APK
Follow `mobile/README.md` (Option A: Android Studio, Option B: Expo EAS). Copy the result to
`mobile/release/app-release.apk`, commit, push. Install on a phone: `adb install mobile/release/app-release.apk`
(or copy the file to the phone and open it).
In the app: Login screen → "Server settings" → `http://<laptop LAN IP>:8080` (emulator: `http://10.0.2.2:8080`).

## Desk-check rehearsal (Section 8.4)
1. Online: sign in once as manager@nascon.test and once as organizer@nascon.test (password Nascon@26) so both
   accounts can sign in offline later. Open Fixtures, a Match, Table, Clubs → Alpha United.
2. Airplane mode → the top bar turns red "Offline"; cached screens still open with "Offline — showing saved data".
3. As organizer: Fixtures → the Live match → "+ Goal" → confirmation says "saved offline"; bar shows "1 pending".
   Home → Sign out → sign in as manager (works offline) → Clubs → Alpha United → "Move Hassan" → Loan → end date → Submit.
4. Force-close the app and reopen (still offline) → Sync status lists both pending actions with their author.
5. Network on → automatic sync within ~10 s (or "Sync now") → Recent results: Applied / Rejected + plain-language reason.
