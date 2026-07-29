import {
  doc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-app.js";

const MAX_SESSIONS_FOR_STATS = 500;

// Real-time settings sync: fires whenever the user's settings change, from
// this device or another one signed into the same account.
export function watchSettings(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    callback(snap.exists() ? snap.data().settings || null : null);
  });
}

export function saveSettings(uid, settings) {
  return setDoc(doc(db, "users", uid), { settings }, { merge: true });
}

export function saveSessionSummary(uid, summary) {
  return addDoc(collection(db, "users", uid, "sessions"), {
    ...summary,
    endedAt: serverTimestamp(),
  });
}

// Aggregates the user's most recent sessions into all-time totals.
export async function loadAllTimeStats(uid) {
  const sessionsQuery = query(
    collection(db, "users", uid, "sessions"),
    orderBy("endedAt", "desc"),
    limit(MAX_SESSIONS_FOR_STATS)
  );
  const snap = await getDocs(sessionsQuery);

  let totalSessions = 0;
  let totalGoodMs = 0;
  let totalPoorMs = 0;
  let totalAlerts = 0;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
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
