import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import { translations, t } from "./translations.js";
import { analyzePosture, StatusSmoother, DEFAULT_THRESHOLDS } from "./postureAnalysis.js";

/* ---------------------------------------------------------------------- */
/* DOM references                                                         */
/* ---------------------------------------------------------------------- */
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdValue = document.getElementById("thresholdValue");
const soundToggle = document.getElementById("soundToggle");

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");

const neckValue = document.getElementById("neckValue");
const neckBar = document.getElementById("neckBar");
const shoulderValue = document.getElementById("shoulderValue");
const shoulderBar = document.getElementById("shoulderBar");
const spineValue = document.getElementById("spineValue");
const spineBar = document.getElementById("spineBar");

const statDurationValue = document.getElementById("statDurationValue");
const statGoodPctValue = document.getElementById("statGoodPctValue");
const statPoorPctValue = document.getElementById("statPoorPctValue");
const statAlertsValue = document.getElementById("statAlertsValue");
const chartEmpty = document.getElementById("chartEmpty");

const alertBanner = document.getElementById("alertBanner");
const alertText = document.getElementById("alertText");
const alertDismiss = document.getElementById("alertDismiss");

const langToggle = document.getElementById("langToggle");
const langToggleText = document.getElementById("langToggleText");

const accountCard = document.getElementById("accountCard");
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const signUpBtn = document.getElementById("signUpBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const authError = document.getElementById("authError");
const firebaseWarning = document.getElementById("firebaseWarning");
const userEmailDisplay = document.getElementById("userEmailDisplay");

const allTimeCard = document.getElementById("allTimeCard");
const atSessionsValue = document.getElementById("atSessionsValue");
const atDurationValue = document.getElementById("atDurationValue");
const atGoodPctValue = document.getElementById("atGoodPctValue");
const atAlertsValue = document.getElementById("atAlertsValue");

/* ---------------------------------------------------------------------- */
/* State                                                                  */
/* ---------------------------------------------------------------------- */
let lang = localStorage.getItem("posturecare_lang") || "en";
let settings = {
  alertThreshold: Number(localStorage.getItem("posturecare_threshold")) || 30,
  soundEnabled: localStorage.getItem("posturecare_sound") !== "false",
};

let poseLandmarker = null;
let modelLoading = null;
let stream = null;
let running = false;
let rafId = null;
let tickIntervalId = null;
let lastVideoTime = -1;

const smoother = new StatusSmoother(8);
let currentStatus = "none"; // 'good' | 'poor' | 'none'
let poorStreakStart = null;
let lastAlertTime = null;
let alertHideTimeout = null;

let session = null; // reset on start
let trendChart = null;

let cloud = null; // populated by initCloudSync() once Firebase modules load successfully
let currentUser = null;
let unsubscribeSettings = null;
let applyingRemoteSettings = false; // guard against write-back loops while syncing

/* ---------------------------------------------------------------------- */
/* i18n                                                                    */
/* ---------------------------------------------------------------------- */
function applyLanguage(newLang) {
  lang = newLang;
  localStorage.setItem("posturecare_lang", lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(lang, key);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(lang, key);
  });

  langToggleText.textContent = t(lang, "langToggleLabel");
  thresholdValue.textContent = `${settings.alertThreshold}${t(lang, "thresholdUnit")}`;
  updateStatusBadge(currentStatus);

  if (trendChart) {
    trendChart.data.datasets[0].label = t(lang, "chartTitle");
    trendChart.update("none");
  }
}

langToggle.addEventListener("click", () => {
  applyLanguage(lang === "en" ? "ar" : "en");
  syncSettingsToCloud();
});

/* ---------------------------------------------------------------------- */
/* Settings                                                                */
/* ---------------------------------------------------------------------- */
thresholdSlider.value = settings.alertThreshold;
soundToggle.checked = settings.soundEnabled;

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

thresholdSlider.addEventListener("input", () => {
  settings.alertThreshold = Number(thresholdSlider.value);
  thresholdValue.textContent = `${settings.alertThreshold}${t(lang, "thresholdUnit")}`;
  localStorage.setItem("posturecare_threshold", String(settings.alertThreshold));
  syncSettingsToCloud();
});

soundToggle.addEventListener("change", () => {
  settings.soundEnabled = soundToggle.checked;
  localStorage.setItem("posturecare_sound", String(settings.soundEnabled));
  syncSettingsToCloud();
});

/* ---------------------------------------------------------------------- */
/* Pose model                                                              */
/* ---------------------------------------------------------------------- */
async function ensurePoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    statusText.textContent = t(lang, "loadingModel");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    const modelAssetPath =
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

    try {
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    } catch (err) {
      // Fall back to CPU delegate if GPU acceleration isn't available.
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    }
    return poseLandmarker;
  })();

  return modelLoading;
}

/* ---------------------------------------------------------------------- */
/* Session lifecycle                                                       */
/* ---------------------------------------------------------------------- */
function resetSession() {
  const now = performance.now();
  session = {
    startTime: now,
    lastTick: now,
    goodMs: 0,
    poorMs: 0,
    noneMs: 0,
    alertCount: 0,
    chartLabels: [],
    chartScores: [],
  };
  poorStreakStart = null;
  lastAlertTime = null;
  smoother.reset();
  currentStatus = "none";
  resetTrendChart();
  updateDashboardUI();
  statAlertsValue.textContent = "0";
}

async function startMonitoring() {
  try {
    startBtn.disabled = true;
    await ensurePoseLandmarker();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    resetSession();
    running = true;
    lastVideoTime = -1;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    rafId = requestAnimationFrame(detectLoop);
    tickIntervalId = setInterval(sessionTick, 1000);
  } catch (err) {
    console.error(err);
    statusText.textContent = t(lang, "permissionError");
    updateStatusBadge("none");
    startBtn.disabled = false;
  }
}

function stopMonitoring() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (tickIntervalId) clearInterval(tickIntervalId);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  persistSessionSummary();

  startBtn.disabled = false;
  stopBtn.disabled = true;

  currentStatus = "none";
  updateStatusBadge("none");
  statusText.textContent = t(lang, "statusWaiting");
  hideAlertBanner();
}

startBtn.addEventListener("click", startMonitoring);
stopBtn.addEventListener("click", stopMonitoring);

/* ---------------------------------------------------------------------- */
/* Detection loop                                                          */
/* ---------------------------------------------------------------------- */
function detectLoop() {
  if (!running) return;

  if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = video.currentTime;
    const result = poseLandmarker.detectForVideo(video, performance.now());
    handleResult(result);
  }

  rafId = requestAnimationFrame(detectLoop);
}

const drawingUtils = new DrawingUtils(ctx);

function handleResult(result) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const landmarks = result.landmarks && result.landmarks[0];

  if (landmarks) {
    const analysis = analyzePosture(landmarks, DEFAULT_THRESHOLDS);

    if (analysis) {
      smoother.push(analysis.isPoor);
      currentStatus = smoother.status;
      drawSkeleton(landmarks, analysis, currentStatus);
      updateMetricsUI(analysis);
    } else {
      smoother.reset();
      currentStatus = "none";
      drawSkeleton(landmarks, null, "none");
      clearMetricsUI();
    }
  } else {
    smoother.reset();
    currentStatus = "none";
    clearMetricsUI();
  }

  updateStatusBadge(currentStatus);
  handleAlertLogic(currentStatus);
  ctx.restore();
}

function drawSkeleton(landmarks, analysis, status) {
  const color =
    status === "good" ? "#5fb3a3" : status === "poor" ? "#d03b3b" : "#7fa8d9";

  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: "rgba(127, 168, 217, 0.45)",
    lineWidth: 2,
  });
  drawingUtils.drawLandmarks(landmarks, {
    color,
    fillColor: color,
    radius: 2.5,
    lineWidth: 1,
  });

  if (!analysis) return;

  const w = canvas.width;
  const h = canvas.height;
  const toPx = (p) => ({ x: p.x * w, y: p.y * h });
  const shoulder = toPx(analysis.midShoulder);
  const head = toPx(analysis.headPoint);

  // Vertical reference line from mid-shoulder, to visualize the neck-tilt angle.
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "rgba(139, 139, 134, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(shoulder.x, shoulder.y - h * 0.28);
  ctx.stroke();
  ctx.setLineDash([]);

  // Shoulder -> head line colored by posture status.
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();

  ctx.fillStyle = color;
  [shoulder, head].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  if (analysis.midHip) {
    const hip = toPx(analysis.midHip);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(shoulder.x, shoulder.y);
    ctx.stroke();
  }
}

/* ---------------------------------------------------------------------- */
/* Metrics UI                                                              */
/* ---------------------------------------------------------------------- */
function setMetric(valueEl, barEl, angle, maxAngle, isWarn, unit = "°") {
  if (angle === null || angle === undefined) {
    valueEl.textContent = `--${unit}`;
    barEl.style.width = "0%";
    barEl.classList.remove("warn");
    return;
  }
  valueEl.textContent = `${Math.round(angle)}${unit}`;
  const pct = Math.min(100, (angle / maxAngle) * 100);
  barEl.style.width = `${pct}%`;
  barEl.classList.toggle("warn", isWarn);
}

function updateMetricsUI(analysis) {
  setMetric(neckValue, neckBar, analysis.neckAngle, 45, analysis.flags.neck);
  setMetric(shoulderValue, shoulderBar, analysis.shoulderTilt, 20, analysis.flags.shoulder);
  setMetric(spineValue, spineBar, analysis.spineAngle, 45, analysis.flags.spine);
}

function clearMetricsUI() {
  setMetric(neckValue, neckBar, null, 45, false);
  setMetric(shoulderValue, shoulderBar, null, 20, false);
  setMetric(spineValue, spineBar, null, 45, false);
}

function updateStatusBadge(status) {
  statusBadge.classList.remove("status-good", "status-poor", "status-none");
  statusBadge.classList.add(`status-${status}`);
  const key = status === "good" ? "statusGood" : status === "poor" ? "statusPoor" : running ? "statusNone" : "statusWaiting";
  statusText.textContent = t(lang, key);
}

/* ---------------------------------------------------------------------- */
/* Alerts                                                                   */
/* ---------------------------------------------------------------------- */
function handleAlertLogic(status) {
  if (!running) return;
  const now = performance.now();
  const thresholdMs = settings.alertThreshold * 1000;

  if (status === "poor") {
    if (poorStreakStart === null) poorStreakStart = now;
    const elapsed = now - poorStreakStart;
    const canReAlert = lastAlertTime === null || now - lastAlertTime >= thresholdMs;

    if (elapsed >= thresholdMs && canReAlert) {
      triggerAlert();
      lastAlertTime = now;
    }
  } else {
    poorStreakStart = null;
    lastAlertTime = null;
  }
}

function triggerAlert() {
  session.alertCount += 1;
  statAlertsValue.textContent = String(session.alertCount);
  showAlertBanner(t(lang, "alertMessage"));
  if (settings.soundEnabled) playChime();
}

function showAlertBanner(message) {
  alertText.textContent = message;
  alertBanner.classList.remove("hidden");
  if (alertHideTimeout) clearTimeout(alertHideTimeout);
  alertHideTimeout = setTimeout(hideAlertBanner, 6000);
}

function hideAlertBanner() {
  alertBanner.classList.add("hidden");
  if (alertHideTimeout) {
    clearTimeout(alertHideTimeout);
    alertHideTimeout = null;
  }
}

alertDismiss.addEventListener("click", hideAlertBanner);

let audioCtx = null;
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 640;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (err) {
    // Audio isn't essential to the demo; fail silently if unsupported.
  }
}

/* ---------------------------------------------------------------------- */
/* Session dashboard + trend chart                                         */
/* ---------------------------------------------------------------------- */
function sessionTick() {
  if (!session) return;
  const now = performance.now();
  const dt = now - session.lastTick;
  session.lastTick = now;

  if (currentStatus === "good") session.goodMs += dt;
  else if (currentStatus === "poor") session.poorMs += dt;
  else session.noneMs += dt;

  const elapsedSec = Math.round((now - session.startTime) / 1000);
  const label = formatDuration(elapsedSec);
  const score = currentStatus === "good" ? 100 : currentStatus === "poor" ? 0 : null;

  session.chartLabels.push(label);
  session.chartScores.push(score);
  if (session.chartLabels.length > 180) {
    session.chartLabels.shift();
    session.chartScores.shift();
  }

  updateDashboardUI();
  updateTrendChart();
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function updateDashboardUI() {
  if (!session) return;
  const elapsedSec = Math.round((performance.now() - session.startTime) / 1000);
  statDurationValue.textContent = formatDuration(elapsedSec);

  const trackedMs = session.goodMs + session.poorMs;
  if (trackedMs > 0) {
    statGoodPctValue.textContent = `${Math.round((session.goodMs / trackedMs) * 100)}%`;
    statPoorPctValue.textContent = `${Math.round((session.poorMs / trackedMs) * 100)}%`;
  } else {
    statGoodPctValue.textContent = "--%";
    statPoorPctValue.textContent = "--%";
  }
  statAlertsValue.textContent = String(session.alertCount);
}

function resetTrendChart() {
  if (!trendChart) return;
  trendChart.data.labels = [];
  trendChart.data.datasets[0].data = [];
  trendChart.update("none");
  chartEmpty.classList.remove("hidden");
}

function updateTrendChart() {
  if (!trendChart || !session) return;
  trendChart.data.labels = session.chartLabels;
  trendChart.data.datasets[0].data = session.chartScores;
  trendChart.update("none");
  chartEmpty.classList.toggle("hidden", session.chartScores.length > 0);
}

function initTrendChart() {
  const chartCanvas = document.getElementById("trendChart");
  trendChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: t(lang, "chartTitle"),
          data: [],
          borderColor: "#2a78d6",
          backgroundColor: "rgba(42, 120, 214, 0.12)",
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          spanGaps: true,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: "#e1e0d9" },
          ticks: { color: "#8b8b86", callback: (v) => `${v}%` },
        },
        x: {
          grid: { display: false },
          ticks: { color: "#8b8b86", maxTicksLimit: 8 },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: "#2d2d2d",
          bodyColor: "#2d2d2d",
          borderColor: "#e1e0d9",
          borderWidth: 1,
          callbacks: {
            label: (item) => (item.raw === null ? "" : `${item.raw}%`),
          },
        },
      },
    },
  });
}

/* ---------------------------------------------------------------------- */
/* Account & cloud sync (Firebase)                                         */
/* ---------------------------------------------------------------------- */
function authErrorKey(err) {
  switch (err?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "authErrorInvalidCreds";
    case "auth/email-already-in-use":
      return "authErrorEmailInUse";
    case "auth/weak-password":
      return "authErrorWeakPassword";
    default:
      return "authErrorGeneric";
  }
}

function showAuthError(err) {
  authError.textContent = t(lang, authErrorKey(err));
  authError.classList.remove("hidden");
}

function clearAuthError() {
  authError.classList.add("hidden");
}

function setAuthUI(user) {
  authLoggedOut.classList.toggle("hidden", !!user);
  authLoggedIn.classList.toggle("hidden", !user);
  allTimeCard.classList.toggle("hidden", !user);
  if (user) {
    userEmailDisplay.textContent = user.email || "";
  }
}

// Pushes the current local settings to Firestore, ignoring the write if we're
// mid-apply of a settings snapshot that just came from Firestore itself
// (avoids a save -> snapshot -> save feedback loop).
function syncSettingsToCloud() {
  if (!cloud || !currentUser || applyingRemoteSettings) return;
  cloud
    .saveSettings(currentUser.uid, {
      lang,
      alertThreshold: settings.alertThreshold,
      soundEnabled: settings.soundEnabled,
    })
    .catch((err) => console.error("Failed to sync settings:", err));
}

function applyRemoteSettings(remote) {
  if (!remote) return;
  applyingRemoteSettings = true;

  if (remote.lang && remote.lang !== lang) applyLanguage(remote.lang);
  if (typeof remote.alertThreshold === "number") {
    settings.alertThreshold = remote.alertThreshold;
    thresholdSlider.value = settings.alertThreshold;
    thresholdValue.textContent = `${settings.alertThreshold}${t(lang, "thresholdUnit")}`;
    localStorage.setItem("posturecare_threshold", String(settings.alertThreshold));
  }
  if (typeof remote.soundEnabled === "boolean") {
    settings.soundEnabled = remote.soundEnabled;
    soundToggle.checked = settings.soundEnabled;
    localStorage.setItem("posturecare_sound", String(settings.soundEnabled));
  }

  applyingRemoteSettings = false;
}

function persistSessionSummary() {
  if (!cloud || !currentUser || !session) return;
  const trackedMs = session.goodMs + session.poorMs;
  if (trackedMs < 1000) return; // skip near-empty sessions

  cloud
    .saveSessionSummary(currentUser.uid, {
      goodMs: session.goodMs,
      poorMs: session.poorMs,
      alertCount: session.alertCount,
    })
    .then(refreshAllTimeStats)
    .catch((err) => console.error("Failed to save session summary:", err));
}

async function refreshAllTimeStats() {
  if (!cloud || !currentUser) return;
  try {
    const stats = await cloud.loadAllTimeStats(currentUser.uid);
    atSessionsValue.textContent = String(stats.totalSessions);
    atDurationValue.textContent = formatDuration(Math.round(stats.totalDurationMs / 1000));
    atGoodPctValue.textContent = stats.avgGoodPct === null ? "--%" : `${stats.avgGoodPct}%`;
    atAlertsValue.textContent = String(stats.totalAlerts);
  } catch (err) {
    console.error("Failed to load all-time stats:", err);
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!cloud) return;
  clearAuthError();
  cloud.signIn(authEmail.value, authPassword.value).catch(showAuthError);
});

signUpBtn.addEventListener("click", () => {
  if (!cloud) return;
  clearAuthError();
  cloud.signUp(authEmail.value, authPassword.value).catch(showAuthError);
});

googleSignInBtn.addEventListener("click", () => {
  if (!cloud) return;
  clearAuthError();
  cloud.signInWithGoogle().catch(showAuthError);
});

signOutBtn.addEventListener("click", () => {
  if (!cloud) return;
  cloud.signOutUser().catch((err) => console.error("Sign-out failed:", err));
});

// Firebase is loaded dynamically so that a blocked or offline Firebase CDN
// only takes out cloud sync, never the core camera/posture-detection feature.
async function initCloudSync() {
  let modules;
  try {
    modules = await Promise.all([
      import("./firebase-app.js"),
      import("./auth.js"),
      import("./cloudSync.js"),
    ]);
  } catch (err) {
    console.warn("Cloud sync unavailable — Firebase failed to load:", err);
    accountCard.classList.add("hidden");
    return;
  }

  const [appMod, authMod, syncMod] = modules;
  cloud = { ...appMod, ...authMod, ...syncMod };

  if (!cloud.isFirebaseConfigured) {
    authForm.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    firebaseWarning.classList.remove("hidden");
    return;
  }

  cloud.watchAuthState((user) => {
    currentUser = user;
    setAuthUI(user);
    clearAuthError();
    authForm.reset();

    if (unsubscribeSettings) {
      unsubscribeSettings();
      unsubscribeSettings = null;
    }

    if (user) {
      unsubscribeSettings = cloud.watchSettings(user.uid, applyRemoteSettings);
      refreshAllTimeStats();
    }
  });
}

initCloudSync();

/* ---------------------------------------------------------------------- */
/* Init                                                                     */
/* ---------------------------------------------------------------------- */
initTrendChart();
applyLanguage(lang);
updateDashboardUI();
