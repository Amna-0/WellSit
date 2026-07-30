import { t } from "./translations.js";
import { initTheme, applyTheme, getStoredTheme } from "./theme.js";

const langToggle = document.getElementById("langToggle");
const langToggleText = document.getElementById("langToggleText");
const themeToggle = document.getElementById("themeToggle");

const signInForm = document.getElementById("signInForm");
const signInIdentifier = document.getElementById("signInIdentifier");
const signInPassword = document.getElementById("signInPassword");

const signUpForm = document.getElementById("signUpForm");
const signUpUsername = document.getElementById("signUpUsername");
const signUpEmail = document.getElementById("signUpEmail");
const signUpPassword = document.getElementById("signUpPassword");
const signUpConfirmPassword = document.getElementById("signUpConfirmPassword");

const authError = document.getElementById("authError");
const firebaseWarning = document.getElementById("firebaseWarning");
const modeSwitchBtn = document.getElementById("modeSwitchBtn");

let lang = localStorage.getItem("posturecare_lang") || "en";
let cloud = null;
let mode = "signIn"; // 'signIn' | 'signUp'

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
/* Sign in / sign up mode switch                                           */
/* ---------------------------------------------------------------------- */
function setMode(newMode) {
  mode = newMode;
  clearAuthError();
  signInForm.classList.toggle("hidden", mode !== "signIn");
  signUpForm.classList.toggle("hidden", mode !== "signUp");
  modeSwitchBtn.textContent = t(lang, mode === "signIn" ? "switchToSignUp" : "switchToSignIn");
  modeSwitchBtn.setAttribute("data-i18n", mode === "signIn" ? "switchToSignUp" : "switchToSignIn");
}

modeSwitchBtn.addEventListener("click", () => setMode(mode === "signIn" ? "signUp" : "signIn"));

/* ---------------------------------------------------------------------- */
/* Auth                                                                     */
/* ---------------------------------------------------------------------- */
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

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
  const key = typeof err === "string" ? err : authErrorKey(err);
  authError.textContent = t(lang, key);
  authError.classList.remove("hidden");
}

function clearAuthError() {
  authError.classList.add("hidden");
}

signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!cloud) return;
  clearAuthError();

  const identifier = signInIdentifier.value.trim();
  const password = signInPassword.value;

  try {
    let email = identifier;
    if (!identifier.includes("@")) {
      const resolved = await cloud.resolveUsernameToEmail(identifier);
      if (!resolved) {
        showAuthError("authErrorInvalidCreds");
        return;
      }
      email = resolved;
    }
    await cloud.signIn(email, password);
  } catch (err) {
    showAuthError(err);
  }
});

signUpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!cloud) return;
  clearAuthError();

  const username = signUpUsername.value.trim();
  const email = signUpEmail.value.trim();
  const password = signUpPassword.value;
  const confirmPassword = signUpConfirmPassword.value;

  if (!USERNAME_PATTERN.test(username)) {
    showAuthError("authErrorUsernameFormat");
    return;
  }
  if (password !== confirmPassword) {
    showAuthError("authErrorPasswordMismatch");
    return;
  }

  try {
    if (await cloud.isUsernameTaken(username)) {
      showAuthError("authErrorUsernameTaken");
      return;
    }
    const cred = await cloud.signUp(email, password);
    await cloud.claimUsername(cred.user.uid, username, email);
  } catch (err) {
    showAuthError(err);
  }
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
    disableForms();
    document.body.classList.remove("gate-loading");
    return;
  }

  const [appMod, authMod, syncMod] = modules;
  cloud = { ...appMod, ...authMod, ...syncMod };

  if (!cloud.isFirebaseConfigured) {
    disableForms();
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

function disableForms() {
  [signInForm, signUpForm].forEach((form) => {
    form.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
  });
  modeSwitchBtn.disabled = true;
  firebaseWarning.classList.remove("hidden");
}

/* ---------------------------------------------------------------------- */
/* Init                                                                     */
/* ---------------------------------------------------------------------- */
initTheme();
updateThemeToggleIcon();
applyLanguage(lang);
setMode("signIn");
initCloudSync();
