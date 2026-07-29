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

Nothing runs on a server. The only network requests are the initial CDN
loads for the model/library files — after that, everything (camera frames,
pose landmarks, angle math) stays on-device.

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

Then open **http://localhost:5500/** in Chrome or Edge.

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
index.html              App shell / markup
css/style.css            Light, calming design system
js/translations.js       EN / AR string dictionary
js/postureAnalysis.js    Landmark → angle → posture-status math (pure functions)
js/main.js                Camera, pose-model loop, UI wiring, session dashboard
run.ps1                   One-click local server + browser launch
```

## Privacy by design

- Camera stream is attached directly to a local `<video>` element and read
  frame-by-frame by the on-device model — never encoded, sent, or stored.
- No backend, no database, no analytics.
- Session stats (duration, good/poor %, alert count, trend chart) live only
  in memory for the current browser tab and disappear on refresh.
