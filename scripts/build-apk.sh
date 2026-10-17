#!/usr/bin/env bash
# Builds mobile/release/app-release.apk locally. Needs JDK 17, Android SDK (ANDROID_HOME) and internet.
set -euo pipefail
cd "$(dirname "$0")/../mobile"
npm ci --no-audit --no-fund
npx expo prebuild --platform android --clean
sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64/' android/gradle.properties
(cd android && ./gradlew assembleRelease)   # needs JDK 17 as JAVA_HOME
mkdir -p release
cp android/app/build/outputs/apk/release/app-release.apk release/app-release.apk
ls -la release/app-release.apk
