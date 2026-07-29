import {
  ref,
  set,
  update,
  onValue,
  push,
  query,
  limitToLast,
  get,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { db } from "./firebase-app.js";

const MAX_SESSIONS_FOR_STATS = 500;

// Real-time settings sync: fires whenever the user's settings change, from
// this device or another one signed into the same account.
export function watchSettings(uid, callback) {
  return onValue(ref(db, `users/${uid}/settings`), (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}

export function saveSettings(uid, settings) {
  return update(ref(db, `users/${uid}`), { settings });
}

export function saveSessionSummary(uid, summary) {
  const newSessionRef = push(ref(db, `users/${uid}/sessions`));
  return set(newSessionRef, { ...summary, endedAt: serverTimestamp() });
}

// Aggregates the user's most recent sessions into all-time totals.
export async function loadAllTimeStats(uid) {
  const sessionsQuery = query(ref(db, `users/${uid}/sessions`), limitToLast(MAX_SESSIONS_FOR_STATS));
  const snap = await get(sessionsQuery);

  let totalSessions = 0;
  let totalGoodMs = 0;
  let totalPoorMs = 0;
  let totalAlerts = 0;

  snap.forEach((child) => {
    const data = child.val();
    totalSessions += 1;
    totalGoodMs += data.goodMs || 0;
    totalPoorMs += data.poorMs || 0;
    totalAlerts += data.alertCount || 0;
  });

  const trackedMs = totalGoodMs + totalPoorMs;
  return {
    totalSessions,
    totalDurationMs: totalGoodMs + totalPoorMs,
    avgGoodPct: trackedMs > 0 ? Math.round((totalGoodMs / trackedMs) * 100) : null,
    totalAlerts,
  };
}
