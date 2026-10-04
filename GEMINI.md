# Mobile Development Automation System

## Project Mission

Build and maintain an Android-first automated development and testing workflow for this Angular + Capacitor mobile application.

The development workflow must eventually support:

Code change
→ Angular build
→ Capacitor sync
→ Android debug build
→ physical Android device installation
→ Maestro UI tests
→ screenshots/video/log collection
→ structured test report
→ failure diagnosis
→ developer-approved bug fix
→ targeted re-test

Do not make autonomous production-code changes based only on an AI-generated diagnosis. The AI may diagnose, identify likely root causes, and propose fixes. Code changes must be reviewed and approved by the developer.

---

## Technology Stack

Primary application:

* Angular
* Capacitor
* Android
* TypeScript
* HTML
* SCSS

Development environment:

* macOS
* Apple Silicon Mac
* Android Studio
* Android SDK
* ADB
* Gradle
* Node.js
* npm
* Git

Mobile automation:

* Maestro CLI
* ADB
* Physical Android device over USB

Future automation:

* Playwright for browser/web-layer testing where appropriate
* AI-assisted failure analysis
* Automated test reports
* Optional CI/CD integration

iOS is NOT part of the first implementation phase. Design the architecture so iOS can be added later without unnecessarily complicating the Android implementation.

---

# Core Development Principles

## 1. Android-first

Prioritize physical Android device testing.

Do not introduce iOS-specific infrastructure unless explicitly requested.

## 2. Physical device first

Prefer a real Android device connected through USB and ADB.

Do not require an Android emulator for the initial implementation.

## 3. CLI-first

Use CLI tools and deterministic scripts.

Prefer:

* adb
* maestro
* npm
* npx
* gradle
* shell scripts

Do not require a GUI testing workflow.

## 4. Preserve the existing application

Before modifying application code:

* inspect the existing project structure
* identify the current Angular version
* identify the Capacitor version
* identify the Android application ID
* inspect package.json
* inspect capacitor.config.*
* inspect Android configuration
* understand existing build commands

Do not replace existing architecture unnecessarily.

## 5. Small incremental changes

Make one logical change at a time.

After each infrastructure change:

1. validate it
2. run the relevant command
3. inspect the output
4. fix errors
5. continue

Do not make a large number of unrelated modifications in one step.

---

# Required Development Workflow

The desired workflow is:

```text
Developer changes code
        ↓
Build Angular application
        ↓
Capacitor sync
        ↓
Build Android debug APK
        ↓
Detect connected Android device
        ↓
Install/update APK
        ↓
Launch application
        ↓
Run relevant Maestro tests
        ↓
Collect evidence
        ↓
PASS / FAIL
```

If a test fails:

```text
Failure
   ↓
Screenshot
   ↓
Video when configured
   ↓
Maestro output
   ↓
ADB logcat
   ↓
Application logs
   ↓
Structured failure report
   ↓
Root-cause analysis
   ↓
Developer reviews proposed fix
   ↓
Apply fix
   ↓
Re-run targeted test
```

---

# Build Rules

Before creating new build commands, inspect existing package.json scripts.

Prefer existing project scripts when available.

Typical commands may include:

```bash
npm install
npm run build
npx cap sync android
```

Android build may use:

```bash
cd android
./gradlew assembleDebug
```

Do not hard-code commands if the project already has an established equivalent.

---

# Android Device Rules

Before running device tests:

```bash
adb devices
```

A usable device must appear with status:

```text
device
```

Do not continue automated installation/testing if the device is:

```text
unauthorized
offline
```

Instead report the exact device state.

Never uninstall the user's application automatically unless explicitly requested.

Prefer:

```bash
adb install -r
```

for debug APK updates when appropriate.

---

# Maestro Rules

Maestro is the primary Android UI automation framework.

Test flows must be stored under:

```text
maestro/
```

Organize tests by feature:

```text
maestro/
├── smoke/
├── regression/
├── offline/
├── sync/
└── lifecycle/
```

Each test must have:

* clear name
* deterministic actions
* meaningful assertions
* minimal unnecessary waits
* stable selectors

Prefer accessibility/text/resource identifiers over coordinate-based taps.

Avoid arbitrary sleep commands unless there is no reliable synchronization mechanism.

---

# Test Categories

Maintain separate test categories.

## Smoke

Fast tests verifying that the application starts and core functionality works.

Examples:

* launch app
* login
* dashboard opens
* primary navigation works

## Regression

Feature-level tests.

Examples:

* activity creation
* activity editing
* snag creation
* snag editing
* data synchronization

## Offline

Test:

* enter offline state
* create data
* edit data
* close application
* reopen application
* verify persistence
* reconnect
* synchronize

## Lifecycle

Test:

* background application
* reopen
* force close
* relaunch
* logout
* restart application

---

# Test Execution Rules

Do not run the complete regression suite for every source-code change.

Determine the affected feature first.

Examples:

If a snag-related service changes:

Run relevant snag tests first.

If authentication changes:

Run authentication and smoke tests.

Run the complete regression suite only when appropriate.

---

# Evidence Collection

When a test fails, preserve useful evidence.

Expected artifacts:

```text
test-artifacts/
├── screenshots/
├── videos/
├── logs/
└── reports/
```

Evidence should include:

* failed test name
* failed step
* expected behavior
* actual behavior
* screenshot
* relevant logs
* device information
* application version/build information
* timestamp

Do not store unnecessary artifacts indefinitely.

Successful tests should not generate large permanent video files unless explicitly configured.

---

# ADB Evidence

ADB may be used for:

* device detection
* APK installation
* application launch
* screenshots
* screen recording
* logcat
* device information

Useful commands include:

```bash
adb devices
adb install -r <apk>
adb shell am force-stop <package>
adb shell monkey -p <package> 1
adb logcat
adb exec-out screencap -p > screenshot.png
adb shell screenrecord /sdcard/test.mp4
adb pull /sdcard/test.mp4
```

Do not execute destructive ADB commands without explicit approval.

Avoid:

```bash
adb shell pm clear
adb uninstall
adb shell rm -rf
```

unless required by the test and explicitly configured.

---

# Automation Scripts

Reusable deterministic automation belongs under:

```text
scripts/
```

Prefer small scripts with one responsibility.

Example:

```text
scripts/
├── build-android.sh
├── install-android.sh
├── run-maestro.sh
├── collect-artifacts.sh
└── dev-test.sh
```

The scripts must:

* fail clearly
* return meaningful exit codes
* print concise progress
* avoid hiding errors
* work from the project root
* avoid hard-coded absolute paths

Use environment variables for configurable values such as:

```text
ANDROID_APP_ID
APK_PATH
ARTIFACT_DIR
```

---

# Failure Handling

Never hide test failures.

A command failure must cause the appropriate pipeline stage to fail.

Example:

```text
BUILD FAILED
```

must not become:

```text
BUILD SUCCESS
```

Do not ignore stderr.

Do not automatically retry indefinitely.

If a retry is useful, use a small explicit limit.

---

# AI Failure Analysis

AI analysis is a later layer of the system.

When analyzing failures, use:

1. Maestro test output
2. failed step
3. screenshot
4. ADB logcat
5. application logs
6. relevant source code
7. recent code changes

The AI should produce:

```text
Failure
Expected
Actual
Likely root cause
Evidence
Affected files
Suggested fix
Confidence
Recommended test
```

Do not claim certainty when evidence is insufficient.

Use:

```text
Likely
Possible
Insufficient evidence
```

instead of inventing a root cause.

---

# Bug Fix Workflow

When a failure is detected:

```text
1. Reproduce
2. Collect evidence
3. Identify affected code
4. Diagnose
5. Propose fix
6. Developer approval
7. Apply fix
8. Run targeted test
9. Run related regression tests
10. Report result
```

Do not modify unrelated code while fixing a test failure.

---

# Code Quality

Prefer:

* TypeScript strictness
* existing project conventions
* reusable services
* small functions
* meaningful names
* typed interfaces
* proper error handling
* deterministic tests

Avoid:

* unnecessary dependencies
* duplicated automation logic
* magic coordinates
* arbitrary delays
* huge shell scripts
* global state unless already part of the architecture
* unnecessary framework migrations

---

# Security

Never hard-code:

* passwords
* API keys
* access tokens
* signing keys
* production credentials

Do not commit:

```text
.env
keystore files
credentials
private keys
test secrets
```

Use test credentials through environment variables or appropriate local configuration.

---

# Definition of Done

A feature is considered automation-ready when:

1. Application builds successfully.
2. APK installs on the physical Android device.
3. Application launches.
4. Relevant Maestro flow exists.
5. Important user behavior has assertions.
6. Failure produces useful evidence.
7. Logs are available for diagnosis.
8. Test can be re-run deterministically.
9. Related regression tests pass.
10. No unrelated project behavior is broken.

---

# Agent Behavior

Before implementing:

* inspect first
* understand existing architecture
* explain the implementation plan briefly
* make minimal changes

During implementation:

* use existing dependencies where possible
* avoid unnecessary rewrites
* validate every stage

After implementation:

* run the relevant tests
* report exact commands executed
* report PASS/FAIL
* report files changed
* report remaining limitations

Never say a feature is working without actually testing it.
