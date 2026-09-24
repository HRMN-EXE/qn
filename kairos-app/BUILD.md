# Ledger APK — build instructions

Your Ledger/Kairos web app (same UI, untouched) inside an Expo shell that runs
**fully offline** with **real Android notifications/alarms**, even when the app
is closed.

```
ledger-v1/   ← Next.js project (patched: static export + native alarm bridge)
kairos-app/  ← Expo shell — build the APK from HERE
└── web/     ← your entire app as static files (already built & copied in)
```

## Build the APK (on your PC)

```bash
cd kairos-app
npm install
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

First build: accept the prompts, let EAS generate the keystore. ~10–20 min →
download link for the APK → install on your phone (allow "unknown sources").

## Test checklist (airplane mode!)

- [ ] App opens past the flame animation into "What should we call you?"
- [ ] Create a task with a time → notification fires ~5 min before (reminder)
- [ ] Close the app completely, lock the phone → notification still fires
- [ ] Data survives kill + reopen (localStorage)
- [ ] No "Web error" alert appears (if it does, note the text — it tells you exactly what broke)

## Updating the app later (when your web code changes)

In `ledger-v1`:
```bash
npm run build
node build-web.mjs
rm -rf ../kairos-app/web && cp -r web-dist ../kairos-app/web
```
Then rebuild: `eas build -p android --profile preview`.

## Notes

- **Package name:** `com.hrmn.ledger` in `app.json`. New signing key ≠ old APK,
  so uninstall any previously installed version first.
- **Expo Go won't work for this app** (it loads from native APK assets) — test
  with real builds. That's also why notifications work: no Expo Go limitations.
- **"Web error" alerts:** the shell forwards uncaught JS errors from the web app
  as native alerts, so a broken build is self-diagnosing instead of a stuck flame.
- React error #418 in logs is a benign hydration-mismatch warning (the theme
  pre-paint script changes `data-theme` before React hydrates). Harmless —
  happens on normal http hosting too.

## What was wrong (for the record)

The first packaging attempt inlined all JS into one HTML file. Three separate
things were silently broken:

1. **Turbopack needs real script URLs** — its runtime derives chunk identity
   from `script.src`; inlined scripts have none → boot crash.
2. **Root-relative paths break on `file://`** — `/_next/...` resolves to the
   *filesystem root*, not the app folder → every asset 404s.
   Fix: `assetPrefix: "./"` in `next.config.ts` (Next emits relative paths and
   sets the matching Turbopack suffix, keeping chunk keys consistent — do NOT
   hand-rewrite the paths, that deadlocks chunk registration).
3. **`history.replaceState("/")` throws on `file://`** — Next's router does
   this at boot, killing hydration silently. Fix: injected shim no-ops
   cross-URL history ops (see `build-web.mjs`).
