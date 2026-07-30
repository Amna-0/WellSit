# PostureCare — AI Posture Monitor

A browser-only prototype built for **TCS Sustainathon Saudi Arabia 2026** —
track: *AI for Community Health & Well-being*.

PostureCare watches your sitting posture through your webcam using an
on-device AI pose-detection model, and gently nudges you when you start to
slouch. All video processing happens **entirely inside your browser** — no
frame, image, or video is ever uploaded anywhere.

## Tech stack

- **Pose detection**: [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (`PoseLandmarker`, lite model) — runs fully client-side via WebAssembly/WebGL.
- **UI**: Vanilla HTML/CSS/JS, no build step, no framework.
- **Charts**: Chart.js (CDN).
- **i18n**: English / Arabic (RTL) toggle, plain JS dictionary in `js/translations.js`.
- **Theme**: light/dark mode toggle, persisted per browser (`js/theme.js`).
- **Cloud & auth**: [Firebase](https://firebase.google.com) Authentication + Firestore, loaded from CDN — see [Cloud sync with Firebase](#cloud-sync-with-firebase) below.

Posture detection itself never touches a server — the only network requests
are the initial CDN loads for the model/library files, after which camera
frames, pose landmarks, and angle math all stay on-device. Firebase is used
only for the account system (sign-in) and for syncing settings/session
history to your own Firebase project.

## Running it

Camera access and ES module imports both require an `http://` origin (not
`file://`), so the app needs a trivial static file server. No Node.js
install is required — this uses Python, which ships with most systems.

**Option A — one click (Windows):**

Double-click `run.ps1` (or right-click → *Run with PowerShell*). It starts a
local server and opens the app in your default browser.

**Option B — manual:**

```powershell
py -m http.server 5500
```

Then open **http://localhost:5500/** in Chrome or Edge — this loads
`index.html`, the sign-in page. Create an account (or sign in) and you're
redirected to `app.html`, the actual posture monitor.

When prompted, allow camera access. Click **Start Monitoring**, sit
naturally in front of your webcam, then try slouching forward to see the
status flip to poor posture and the live angle metrics update.

## How posture is scored

From the 33 body landmarks MediaPipe detects, we compute three angles each
frame (see `js/postureAnalysis.js`):

| Metric | How it's measured | Flag threshold |
|---|---|---|
| Neck tilt | Angle between the shoulder-midpoint→head line and vertical | > 20° |
| Shoulder balance | Angle of the shoulder line from horizontal | > 8° |
| Back / spine curve | Angle between hip-midpoint→shoulder-midpoint line and vertical (only when hips are in frame) | > 25° |

These thresholds are loosely based on commonly cited ergonomic guidance
(forward head tilt becoming a concern past roughly 15–20° from vertical). A
frame is flagged "poor" if any one metric crosses its threshold; a small
rolling majority-vote window smooths out single-frame noise so the status
indicator doesn't flicker.

If poor posture persists past the configurable alert duration (default
30s, adjustable in Settings), a gentle on-screen reminder appears, with an
optional soft audio chime.

## Project structure

```
index.html              Sign-in page (entry point)
app.html                 The posture monitor itself (requires sign-in)
css/style.css            Design system — light + dark theme
js/translations.js       EN / AR string dictionary
js/theme.js              Light/dark theme state (localStorage + [data-theme])
js/postureAnalysis.js    Landmark → angle → posture-status math (pure functions)
js/login.js               Sign-in page wiring (sign up / sign in / Google)
js/main.js                Camera, pose-model loop, UI wiring, session dashboard
js/firebase-config.js     Your Firebase project's web config (fill this in)
js/firebase-app.js        Initializes the Firebase app/auth/firestore instances
js/auth.js                Sign up / sign in / Google sign-in / sign out
js/cloudSync.js           Settings sync + session history + all-time stats
firestore.rules           Per-user Firestore security rules
run.ps1                   One-click local server + browser launch
```

## Cloud sync with Firebase

Signing in is required — `index.html` is the entry point and `app.html`
(the actual posture monitor) redirects back to it if there's no signed-in
user. Once signed in you get:

- An account (email/password or Google) tied to a Firebase project you own.
- Settings (language, theme, alert threshold, sound) synced in real time
  across every device signed into that account.
- Session history saved to Firestore, and an "All-Time Stats" panel
  aggregating it (total sessions, total time, average good-posture %,
  total alerts).

Note: creating a Firestore database requires the project to be on Google
Cloud's Blaze (pay-as-you-go) plan — a linked card, even though normal usage
here stays within the free quota. If you'd rather not link a card, Firebase
Realtime Database is a free alternative with no billing requirement; ask for
that version of `js/cloudSync.js` / `js/firebase-app.js` if needed.

**Setup:**

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Authentication** → *Get started* → enable the **Email/Password**
   provider (and **Google**, if you want the "Continue with Google" button
   to work).
3. **Firestore Database** → *Create database* → start in production mode.
4. Deploy `firestore.rules` from this repo (Firestore → Rules tab → paste
   its contents → Publish). It restricts every user to reading/writing only
   their own data.
5. **Project settings** → *Your apps* → add a **Web app** → copy the
   `firebaseConfig` object it gives you into `js/firebase-config.js`,
   replacing the `YOUR_...` placeholders.

That config object is safe to ship in client-side code (it identifies the
project, it isn't a secret) — access control comes entirely from
`firestore.rules`, not from hiding it.

If `js/firebase-config.js` is left with its placeholder values, the app
detects that automatically: the account panel shows a "cloud sync isn't set
up yet" note and the sign-in form stays disabled, while the rest of the app
keeps working normally. The Firebase SDK is also loaded lazily and
defensively — if its CDN can't be reached (offline, blocked network), cloud
sync silently disables itself instead of breaking the app.

## Privacy by design

- Camera stream is attached directly to a local `<video>` element and read
  frame-by-frame by the on-device model — never encoded, sent, or stored.
- No backend for the core posture-detection feature — that stays entirely
  on-device even though an account is required to reach it.
- Live session stats (duration, good/poor %, alert count, trend chart) are
  computed in memory for the current browser tab; only the end-of-session
  summary (totals, no video/images) is saved to your Firebase project.
