import { t } from "./translations.js";
import { initTheme, applyTheme, getStoredTheme } from "./theme.js";

const langToggle = document.getElementById("langToggle");
const langToggleText = document.getElementById("langToggleText");
const themeToggle = document.getElementById("themeToggle");

const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const signUpBtn = document.getElementById("signUpBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const authError = document.getElementById("authError");
const firebaseWarning = document.getElementById("firebaseWarning");

let lang = localStorage.getItem("posturecare_lang") || "en";
let cloud = null;

/* ---------------------------------------------------------------------- */
/* i18n                                                                    */
/* ---------------------------------------------------------------------- */
function applyLanguage(newLang) {
  lang = newLang;
  localStorage.setItem("posturecare_lang", lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(lang, el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(lang, el.getAttribute("data-i18n-placeholder"));
  });

  langToggleText.textContent = t(lang, "langToggleLabel");
}

langToggle.addEventListener("click", () => applyLanguage(lang === "en" ? "ar" : "en"));

/* ---------------------------------------------------------------------- */
/* Theme                                                                    */
/* ---------------------------------------------------------------------- */
function updateThemeToggleIcon() {
  themeToggle.textContent = getStoredTheme() === "dark" ? "☀️" : "🌙";
}

themeToggle.addEventListener("click", () => {
  applyTheme(getStoredTheme() === "dark" ? "light" : "dark");
  updateThemeToggleIcon();
});

/* ---------------------------------------------------------------------- */
/* Auth                                                                     */
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

// Firebase is loaded dynamically so a blocked or offline Firebase CDN degrades
// this page to a disabled form with an explanatory note instead of breaking it.
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
    authForm.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    firebaseWarning.classList.remove("hidden");
    document.body.classList.remove("gate-loading");
    return;
  }

  const [appMod, authMod, syncMod] = modules;
  cloud = { ...appMod, ...authMod, ...syncMod };

  if (!cloud.isFirebaseConfigured) {
    authForm.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    firebaseWarning.classList.remove("hidden");
    document.body.classList.remove("gate-loading");
    return;
  }

  cloud.watchAuthState((user) => {
    if (user) {
      window.location.replace("app.html");
      return;
    }
    document.body.classList.remove("gate-loading");
  });
}

/* ---------------------------------------------------------------------- */
/* Init                                                                     */
/* ---------------------------------------------------------------------- */
initTheme();
updateThemeToggleIcon();
applyLanguage(lang);
initCloudSync();
