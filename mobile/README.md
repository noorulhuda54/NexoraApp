# NaSCon League — Android app (Expo SDK 52 / React Native 0.76 / TypeScript)

Screens (Section 8.2): Login · role-aware Home · Fixtures · Match detail (live score, polling every 4 s, event timeline,
pinned product) · Standings (qualification status) · Clubs / Club profile (info, staff, venue, roster) · Roster action
(transfer / loan / release, Club Manager) · Scoring (start, score, end, correct = compensation, League Organizer) · Store
(variant picker, cart, discount, mock payment, receipt + PDF download) · Sync status & settings (always-visible
Online/Offline/Syncing bar + pending queue).

Offline (NFR-4): GET responses for fixtures, matches, standings, clubs and products are cached in SQLite (`src/db.ts`).
Scoring and roster actions are written to a persistent SQLite queue in the exact Section 5.14 format and replayed through
`POST /api/v1/sync` (same code path as `/audit/v1/offline-sync`, plus RBAC). The JWT is kept in `expo-secure-store`
(Android Keystore). The backend address is editable on the login screen and in Sync & settings
(emulator `http://10.0.2.2:8080`, phone `http://<laptop-LAN-IP>:8080`).

## Build the release APK (needs internet; output must be copied to `mobile/release/app-release.apk`)

### Option A — local (Android Studio installed: JDK 17 + Android SDK 35, `ANDROID_HOME` set)
```bash
cd mobile
npm ci
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../release/app-release.apk
```
(The Expo template signs release builds with the debug keystore, so the APK installs directly.)

### Option B — Expo cloud build (free Expo account)
```bash
cd mobile
npm ci
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # answer "yes" to create the project / keystore
# download the .apk from the printed URL and save it as mobile/release/app-release.apk
```

## Dev run
`npx expo start` (Expo Go does not include every native module version; prefer the APK).

## Checks
`npx tsc --noEmit` (type check) · `npx expo export --platform android` (bundles JS to Hermes bytecode).
