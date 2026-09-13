# DevOps Mobile

An Ionic Angular application packaged for Android with Capacitor.

## Local development

```bash
npm ci
npm start
```

## Build a debug APK

The Android SDK and a compatible JDK are required locally.

```bash
npm run android:apk
```

The generated file is `android/app/build/outputs/apk/debug/app-debug.apk`.

## GitHub Actions

Every push to this repository triggers `.github/workflows/android-apk.yml`. The
workflow installs dependencies, lints, tests, builds the Angular bundle, syncs
Capacitor, assembles a debug APK, and uploads the APK as a GitHub Actions
artifact. Download it from the completed workflow run's **Artifacts** section.

The workflow builds a debug APK. A signed release APK requires a release
keystore and GitHub Actions secrets, which are intentionally not committed to
the repository.
