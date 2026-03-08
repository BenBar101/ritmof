import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const XP_PER_LEVEL = 500;
const GACHA_COST = 150;
const STREAK_SHIELD_COST = 300;

const RANKS = [
  { min: 0,  title: "Rookie",      decor: "[ _ ]",    badge: "░░░░░", font: "mono" },
  { min: 2,  title: "Scholar",     decor: "[ § ]",    badge: "▒░░░░", font: "fell" },
  { min: 4,  title: "Focused",     decor: "[ ◈ ]",    badge: "▒▒░░░", font: "mono" },
  { min: 6,  title: "Operator",    decor: "[ ▣ ]",    badge: "▒▒▒░░", font: "mono" },
  { min: 8,  title: "Elite",       decor: "[ ◉ ]",    badge: "▒▒▒▒░", font: "mono" },
  { min: 10, title: "Apex",        decor: "[ ✦ ]",    badge: "█████", font: "fell" },
  { min: 12, title: "Sovereign",   decor: "[ ❖ ]",    badge: "░▒▓██", font: "fell" },
  { min: 15, title: "Transcendent",decor: "[ ∞ ]",    badge: "█▓▒░█", font: "fell" },
];

const DEFAULT_HABITS = [
  { id: "water",    label: "Drink 2L Water",      category: "body", xp: 20, icon: "◉", style: "dots" },
  { id: "sleep11",  label: "Sleep Before 11PM",   category: "body", xp: 30, icon: "◑", style: "dots" },
  { id: "wake7",    label: "Wake Before 7AM",      category: "body", xp: 30, icon: "◐", style: "dots" },
  { id: "sunlight", label: "Morning Sunlight",     category: "body", xp: 20, icon: "☀", style: "dots" },
  { id: "read",     label: "Read 20 Pages",        category: "mind", xp: 35, icon: "≡", style: "dots" },
  { id: "deepwork", label: "2hr Deep Work",        category: "work", xp: 50, icon: "◈", style: "ascii" },
  { id: "journal",  label: "Journal Entry",        category: "mind", xp: 20, icon: "✎", style: "typewriter" },
];

const SESSION_TYPES = [
  { id: "lecture",  label: "Lecture",   style: "geometric", baseXP: 15, icon: "◈", desc: "Attended class" },
  { id: "tirgul",   label: "Tirgul",    style: "ascii",     baseXP: 20, icon: ">>", desc: "Tutorial / problem session" },
  { id: "homework", label: "Homework",  style: "typewriter",baseXP: 25, icon: "✎", desc: "Assignment work" },
  { id: "prep",     label: "Prep",      style: "dots",      baseXP: 20, icon: "∷", desc: "Reading / preparation" },
];

const FOCUS_LEVELS = [
  { id: "low",    label: "Low",    mult: 0.7, symbol: "▁▁▁" },
  { id: "medium", label: "Medium", mult: 1.0, symbol: "▃▃▃" },
  { id: "high",   label: "High",   mult: 1.5, symbol: "█▃▁" },
];

const ACHIEVEMENT_RARITIES = {
  common:    { label: "COMMON",    glow: "#888",   border: "░░", weight: 60 },
  rare:      { label: "RARE",      glow: "#bbb",   border: "▒▒", weight: 25 },
  epic:      { label: "EPIC",      glow: "#ddd",   border: "▓▓", weight: 12 },
  legendary: { label: "LEGENDARY", glow: "#fff",   border: "██", weight: 3  },
};

// Single-account gate: set at build time via .env (VITE_ALLOWED_EMAIL, VITE_GOOGLE_CLIENT_ID)
// No hardcoded fallback — gate is disabled if env vars are absent, keeping the secret out of source.
const ALLOWED_EMAIL = (import.meta.env.VITE_ALLOWED_EMAIL || "").trim().toLowerCase();
const GATE_GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
const GATE_SESSION_KEY = "ritmof_allowed";
const THEME_KEY = "jv_theme";

// Device lock: PBKDF2-SHA256 hash of the master password.
// Set VITE_DEVICE_LOCK_HASH in your .env — NEVER commit the hash to source.
// Generate it once in the browser console:
//   hashPasswordForDeviceLock("yourpassword").then(console.log)
// then paste the output into .env as VITE_DEVICE_LOCK_HASH.
const DEVICE_LOCK_STORAGE_KEY = "ritmof_device_unlock_token"; // renamed — old key stored the hash directly
const DEVICE_LOCK_SALT = "ritmof-device-lock-v1";
const DEVICE_LOCK_ITERATIONS = 100000;
const EXPECTED_PASSWORD_HASH = (import.meta.env.VITE_DEVICE_LOCK_HASH || "").trim();

// Brute-force lockout: 5 failed attempts -> 5-minute cooldown
const LOCK_FAIL_KEY = "ritmof_lock_fails";
const LOCK_UNTIL_KEY = "ritmof_lock_until";
const MAX_LOCK_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

async function hashPasswordForDeviceLock(password) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const saltBytes = new TextEncoder().encode(DEVICE_LOCK_SALT);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: DEVICE_LOCK_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Generate a random session token (stored instead of the hash — not reversible to password)
function generateUnlockToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Returns true when a valid unlock token exists for this session
function isDeviceUnlocked() {
  try {
    const token = sessionStorage.getItem(DEVICE_LOCK_STORAGE_KEY);
    // Token must be a 64-char hex string written by this session
    return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════
const LS = {
  get: (k, def = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// Returns today's date in YYYY-MM-DD using LOCAL time (not UTC).
// Using toISOString() would return UTC and cause the "day" to reset at 3am for UTC+3 users.
const today = () => new Date().toLocaleDateString("en-CA"); // en-CA locale gives YYYY-MM-DD
const nowHour = () => new Date().getHours();
const nowMin = () => new Date().getMinutes();

// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
async function callGemini(apiKey, messages, systemPrompt, jsonMode = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Inject JSON instruction into system prompt instead of relying on responseMimeType
  const finalSystem = jsonMode
    ? systemPrompt + "\n\nCRITICAL: Your entire response must be a single valid JSON object. No markdown, no backticks, no explanation outside the JSON. Start with { and end with }."
    : systemPrompt;

  const body = {
    contents,
    systemInstruction: { parts: [{ text: finalSystem }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();

  // Handle safety blocks or empty responses
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Empty response from Gemini");

  const tokensUsed = data.usageMetadata
    ? (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0)
    : Math.ceil((JSON.stringify(body).length + text.length) / 4);

  return { text, tokensUsed };
}

// ═══════════════════════════════════════════════════════════════
// GOOGLE CALENDAR
// ═══════════════════════════════════════════════════════════════
function loadGoogleAPI() {
  return new Promise((resolve) => {
    if (window.gapi) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

async function initGoogleCalendar(clientId) {
  await loadGoogleAPI();
  await new Promise((res) => window.gapi.load("client:auth2", res));
  await window.gapi.client.init({
    clientId,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
  });
}

async function fetchGCalEvents(maxResults = 30) {
  try {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 14 * 86400000).toISOString();
    const r = await window.gapi.client.calendar.events.list({
      calendarId: "primary",
      timeMin: now,
      timeMax: future,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return (r.result.items || []).map((e) => ({
      id: e.id,
      title: e.summary || "Event",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      type: detectEventType(e.summary || ""),
    }));
  } catch { return []; }
}

function detectEventType(title) {
  const t = title.toLowerCase();
  if (t.includes("exam") || t.includes("midterm") || t.includes("final") || t.includes("test")) return "exam";
  if (t.includes("lecture") || t.includes("class")) return "lecture";
  if (t.includes("hw") || t.includes("homework") || t.includes("assignment") || t.includes("due")) return "homework";
  if (t.includes("tirgul") || t.includes("tutorial") || t.includes("recitation")) return "tirgul";
  return "other";
}

// ═══════════════════════════════════════════════════════════════
// DROPBOX PKCE OAUTH + SYNC
// ═══════════════════════════════════════════════════════════════
const DROPBOX_FILE = "/ritmof-data.json";
const DB_TOKEN_KEY = "jv_dropbox_token";
const DB_REFRESH_KEY = "jv_dropbox_refresh";
const DB_EXPIRES_KEY = "jv_dropbox_expires";
const DB_APPKEY_KEY = "jv_dropbox_appkey";
const DB_PKCE_VERIFIER = "jv_pkce_verifier";

// Local dev: use a separate localStorage copy so we never push to Dropbox
const IS_DEV = import.meta.env.DEV;
const DEV_PREFIX = "ritmof_dev_";
const DROPBOX_KEYS_NO_PREFIX = [DB_APPKEY_KEY, DB_TOKEN_KEY, DB_REFRESH_KEY, DB_EXPIRES_KEY, DB_PKCE_VERIFIER];
function storageKey(k) {
  if (!IS_DEV) return k;
  if (k.startsWith("jv_") && !DROPBOX_KEYS_NO_PREFIX.includes(k)) return DEV_PREFIX + k;
  return k;
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
async function generatePKCE() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = b64url(hash);
  return { verifier, challenge };
}

async function startDropboxOAuth(appKey) {
  const { verifier, challenge } = await generatePKCE();
  localStorage.setItem(DB_PKCE_VERIFIER, verifier);
  const redirectUri = encodeURIComponent(window.location.origin);
  const url = `https://www.dropbox.com/oauth2/authorize`
    + `?client_id=${appKey}`
    + `&response_type=code`
    + `&code_challenge=${challenge}`
    + `&code_challenge_method=S256`
    + `&redirect_uri=${redirectUri}`
    + `&token_access_type=offline`;
  window.location.href = url;
}

async function exchangeDropboxCode(appKey, code) {
  const verifier = localStorage.getItem(DB_PKCE_VERIFIER) || "";
  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: appKey,
    code_verifier: verifier,
    redirect_uri: window.location.origin,
  });
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  storeDropboxTokens(data);
  localStorage.removeItem(DB_PKCE_VERIFIER);
  return data.access_token;
}

async function refreshDropboxToken(appKey) {
  const refreshToken = localStorage.getItem(DB_REFRESH_KEY);
  if (!refreshToken) throw new Error("No refresh token stored.");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: appKey,
  });
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  storeDropboxTokens(data);
  return data.access_token;
}

function storeDropboxTokens(data) {
  if (data.access_token) localStorage.setItem(DB_TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(DB_REFRESH_KEY, data.refresh_token);
  if (data.expires_in) {
    localStorage.setItem(DB_EXPIRES_KEY, String(Date.now() + data.expires_in * 1000 - 60000));
  }
}

async function getDropboxToken(appKey) {
  const token = localStorage.getItem(DB_TOKEN_KEY);
  const expires = parseInt(localStorage.getItem(DB_EXPIRES_KEY) || "0", 10);
  if (token && Date.now() < expires) return token;
  return refreshDropboxToken(appKey || localStorage.getItem(DB_APPKEY_KEY));
}

async function dropboxUpload(token, data) {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path: DROPBOX_FILE, mode: "overwrite", autorename: false, mute: true,
      }),
    },
    body: JSON.stringify({ ...data, _syncedAt: Date.now() }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Upload failed: ${res.status} ${err.slice(0, 100)}`);
  }
  return res.json();
}

async function dropboxDownload(token) {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path: DROPBOX_FILE }),
    },
  });
  if (res.status === 409) return null;
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Download failed: ${res.status} ${err.slice(0, 100)}`);
  }
  return res.json();
}

const SYNC_KEYS = [
  "jv_profile","jv_xp","jv_streak","jv_shields","jv_last_login",
  "jv_habits","jv_habit_log","jv_tasks","jv_goals","jv_sessions",
  "jv_achievements","jv_gacha","jv_cal_events","jv_chat","jv_daily_goal",
  "jv_sleep_log","jv_screen_log","jv_missions","jv_mission_date",
  "jv_chronicles","jv_gcal_connected","jv_habits_init","jv_token_usage",
  DB_APPKEY_KEY,
];

function buildSyncPayload() {
  const payload = { _syncedAt: Date.now() };
  SYNC_KEYS.forEach((k) => {
    const v = localStorage.getItem(storageKey(k));
    if (v !== null) payload[k] = v;
  });
  return payload;
}

// Validate that a value coming from Dropbox is safe to write to localStorage.
// Rejects anything that isn't a string, number, boolean, plain object, or array,
// and caps size to avoid storage-bombing attacks.
const MAX_SYNC_VALUE_SIZE = 500_000; // 500 KB per key
function isSafeSyncValue(v) {
  if (v === null || v === undefined) return false;
  const type = typeof v;
  if (type === "string") return v.length <= MAX_SYNC_VALUE_SIZE;
  if (type === "number" || type === "boolean") return true;
  if (Array.isArray(v) || (type === "object")) {
    try { return JSON.stringify(v).length <= MAX_SYNC_VALUE_SIZE; } catch { return false; }
  }
  return false;
}

function applySyncPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  Object.entries(payload).forEach(([k, v]) => {
    // Only write known jv_ keys — never overwrite auth/lock/session tokens
    const blocklist = [DEVICE_LOCK_STORAGE_KEY, GATE_SESSION_KEY, LOCK_FAIL_KEY, LOCK_UNTIL_KEY];
    if (!k.startsWith("jv_")) return;
    if (blocklist.includes(k)) return;
    if (!isSafeSyncValue(v)) return;
    localStorage.setItem(storageKey(k), typeof v === "string" ? v : JSON.stringify(v));
  });
}

// ═══════════════════════════════════════════════════════════════
// DEVICE LOCK (password gate — hash compared, unlock stored until hash changes)
// ═══════════════════════════════════════════════════════════════
function DeviceLockGate({ onUnlock }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [lockUntil, setLockUntil] = useState(() => parseInt(localStorage.getItem(LOCK_UNTIL_KEY) || "0", 10));

  // If the hash wasn't compiled in, skip the gate entirely
  useEffect(() => {
    if (!EXPECTED_PASSWORD_HASH) {
      console.warn("VITE_DEVICE_LOCK_HASH not set — device lock disabled.");
      onUnlock();
    }
  }, [onUnlock]);

  // Countdown display while locked out
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!lockUntil) return;
    const iv = setInterval(() => {
      const r = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0) { setLockUntil(0); clearInterval(iv); }
    }, 500);
    return () => clearInterval(iv);
  }, [lockUntil]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim()) return;

    // Check lockout
    const until = parseInt(localStorage.getItem(LOCK_UNTIL_KEY) || "0", 10);
    if (Date.now() < until) {
      setErrorMsg(`Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)}s.`);
      return;
    }

    setStatus("loading");
    setErrorMsg("");
    try {
      const hash = await hashPasswordForDeviceLock(password);
      if (hash === EXPECTED_PASSWORD_HASH) {
        // Store a random session token — NOT the hash
        try {
          const token = generateUnlockToken();
          sessionStorage.setItem(DEVICE_LOCK_STORAGE_KEY, token);
          // Clear any previous failed-attempt counters
          localStorage.removeItem(LOCK_FAIL_KEY);
          localStorage.removeItem(LOCK_UNTIL_KEY);
        } catch {}
        onUnlock();
        return;
      }
      // Wrong password — increment fail counter
      const fails = parseInt(localStorage.getItem(LOCK_FAIL_KEY) || "0", 10) + 1;
      localStorage.setItem(LOCK_FAIL_KEY, String(fails));
      if (fails >= MAX_LOCK_ATTEMPTS) {
        const newUntil = Date.now() + LOCK_DURATION_MS;
        localStorage.setItem(LOCK_UNTIL_KEY, String(newUntil));
        localStorage.setItem(LOCK_FAIL_KEY, "0");
        setLockUntil(newUntil);
        setErrorMsg(`Too many failed attempts. Locked for ${LOCK_DURATION_MS / 60000} minutes.`);
      } else {
        setErrorMsg(`Wrong password. ${MAX_LOCK_ATTEMPTS - fails} attempt${MAX_LOCK_ATTEMPTS - fails === 1 ? "" : "s"} remaining.`);
      }
      setStatus("error");
    } catch (err) {
      setErrorMsg("Could not verify. Try again.");
      setStatus("error");
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "var(--bg)", color: "var(--text)", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
    }}>
      <div style={{ fontSize: "11px", color: "var(--muted)", letterSpacing: "2px", marginBottom: "8px" }}>RITMOF</div>
      <div style={{ fontSize: "14px", color: "var(--muted2)", marginBottom: "24px" }}>Enter the device password to continue.</div>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "280px" }}>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          disabled={status === "loading"}
          style={{
            width: "100%", padding: "12px", border: "1px solid var(--border2)", background: "var(--surface)", color: "var(--text)",
            fontFamily: "inherit", fontSize: "14px", outline: "none", boxSizing: "border-box",
          }}
        />
        {errorMsg && (
          <div style={{ color: "#c44", fontSize: "12px" }}>{errorMsg}</div>
        )}
        <button
          type="submit"
          disabled={status === "loading"}
          style={{
            padding: "12px 24px", border: "1px solid var(--border2)", background: status === "loading" ? "var(--surface2)" : "transparent",
            color: status === "loading" ? "var(--muted)" : "var(--text)", fontFamily: "inherit", fontSize: "12px", letterSpacing: "1px",
            cursor: status === "loading" ? "not-allowed" : "pointer",
          }}
        >
          {status === "loading" ? "VERIFYING…" : "UNLOCK"}
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-ACCOUNT GATE (Google Sign-In)
// ═══════════════════════════════════════════════════════════════
function AuthGate({ onAccessGranted }) {
  const [status, setStatus] = useState("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSignIn() {
    setStatus("loading");
    setErrMsg("");
    try {
      await loadGoogleAPI();
      await new Promise((res) => window.gapi.load("client:auth2", res));
      await window.gapi.client.init({
        clientId: GATE_GOOGLE_CLIENT_ID,
        scope: "email profile openid",
      });
      const auth = window.gapi.auth2.getAuthInstance();
      if (!auth.isSignedIn.get()) await auth.signIn();
      const email = (auth.currentUser.get().getBasicProfile().getEmail() || "").trim().toLowerCase();
      if (email && email === ALLOWED_EMAIL) {
        onAccessGranted();
        return;
      }
      setStatus("denied");
    } catch (e) {
      setStatus("error");
      setErrMsg(e?.error?.message ?? e?.message ?? String(e).slice(0, 80));
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#0a0a0a", color: "#e8e8e8", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
    }}>
      <div style={{ fontSize: "11px", color: "#666", letterSpacing: "2px", marginBottom: "8px" }}>RITMOF</div>
      <div style={{ fontSize: "14px", color: "#aaa", marginBottom: "24px" }}>Single-account access. Sign in with the allowed Google account.</div>
      {status === "denied" && (
        <div style={{ color: "#c44", marginBottom: "16px", fontSize: "12px" }}>Access denied. Only the owner account can use this app.</div>
      )}
      {status === "error" && (
        <div style={{ color: "#c44", marginBottom: "16px", fontSize: "11px", maxWidth: "320px" }}>{errMsg}</div>
      )}
      <button
        onClick={handleSignIn}
        disabled={status === "loading"}
        style={{
          padding: "12px 24px", border: "1px solid #555", background: status === "loading" ? "#222" : "transparent",
          color: status === "loading" ? "#666" : "#ccc", fontFamily: "inherit", fontSize: "12px", letterSpacing: "1px", cursor: status === "loading" ? "not-allowed" : "pointer",
        }}
      >
        {status === "loading" ? "SIGNING IN…" : "SIGN IN WITH GOOGLE"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// XP & LEVEL UTILS
// ═══════════════════════════════════════════════════════════════
function getLevel(xp) { return Math.floor(xp / XP_PER_LEVEL); }
function getLevelProgress(xp) { return xp % XP_PER_LEVEL; }
function getRank(level) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (level >= RANKS[i].min) return RANKS[i];
  }
  return RANKS[0];
}

function calcSessionXP(type, durationMins, focusId, streakDays) {
  const sType = SESSION_TYPES.find((s) => s.id === type) || SESSION_TYPES[0];
  const focus = FOCUS_LEVELS.find((f) => f.id === focusId) || FOCUS_LEVELS[1];
  const base = sType.baseXP * focus.mult;
  const durationBonus = Math.floor(durationMins / 30) * 10;
  const streakBonus = streakDays >= 7 ? 1.5 : streakDays >= 3 ? 1.25 : 1.0;
  return Math.round((base + durationBonus) * streakBonus);
}

// ═══════════════════════════════════════════════════════════════
// STYLES BY CONTEXT
// ═══════════════════════════════════════════════════════════════
const STYLE_CSS = {
  ascii: {
    border: "1px solid #888",
    fontFamily: "'Share Tech Mono', monospace",
    background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
    decoration: "top-left",
  },
  dots: {
    border: "1px solid #666",
    fontFamily: "'IM Fell English', serif",
    background: "radial-gradient(circle, #1a1a1a 1px, transparent 1px) 0 0 / 12px 12px",
    decoration: "ornate",
  },
  geometric: {
    border: "2px solid #aaa",
    fontFamily: "'Share Tech Mono', monospace",
    background: "linear-gradient(45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(-45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px, linear-gradient(-45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px",
    decoration: "corners",
  },
  typewriter: {
    border: "1px solid #777",
    fontFamily: "'Special Elite', cursive",
    background: "#0f0f0f",
    decoration: "underline",
  },
};

// ═══════════════════════════════════════════════════════════════
// PARTICLES
// ═══════════════════════════════════════════════════════════════
// E-ink guard: skip particle effects when display can't refresh smoothly
const isEInk = () => window.matchMedia("(update: slow)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function spawnParticles(x, y, count = 12) {
  if (isEInk()) return; // particles leave ghost marks on e-ink
  const container = document.getElementById("particle-container");
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    const chars = ["✦", "◈", "▒", "░", "◉", "+", "×", "◇"];
    p.textContent = chars[Math.floor(Math.random() * chars.length)];
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 40 + Math.random() * 60;
    p.style.cssText = `
      position:fixed; left:${x}px; top:${y}px; pointer-events:none; z-index:9999;
      font-family:'Share Tech Mono',monospace; font-size:${10 + Math.random() * 8}px;
      color:#fff; opacity:1; transition:none;
    `;
    container.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 30}px)`;
      p.style.opacity = "0";
    });
    setTimeout(() => p.remove(), 900);
  }
}

function spawnXPFloat(x, y, amount) {
  if (isEInk()) {
    // On e-ink: show a brief static "+XP" label instead of animated float
    const container = document.getElementById("particle-container");
    if (!container) return;
    const el = document.createElement("div");
    el.textContent = `+${amount} XP`;
    el.style.cssText = `
      position:fixed; left:${x}px; top:${y - 30}px; pointer-events:none; z-index:9999;
      font-family:'Share Tech Mono',monospace; font-size:13px; font-weight:bold;
      color:#fff; background:#000; border:1px solid #fff; padding:2px 6px;
    `;
    container.appendChild(el);
    setTimeout(() => el.remove(), 1800);
    return;
  }
  const el = document.createElement("div");
  el.textContent = `+${amount} XP`;
  el.style.cssText = `
    position:fixed; left:${x}px; top:${y}px; pointer-events:none; z-index:9999;
    font-family:'Share Tech Mono',monospace; font-size:14px; font-weight:bold;
    color:#fff; opacity:1; transition:none; white-space:nowrap;
  `;
  document.getElementById("particle-container")?.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = "translateY(-60px)";
    el.style.opacity = "0";
  });
  setTimeout(() => el.remove(), 1100);
}

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
function initState() {
  return {
    profile: LS.get(storageKey("jv_profile"), null),
    xp: LS.get(storageKey("jv_xp"), 0),
    streak: LS.get(storageKey("jv_streak"), 0),
    streakShields: LS.get(storageKey("jv_shields"), 0),
    lastLoginDate: LS.get(storageKey("jv_last_login"), null),
    habits: LS.get(storageKey("jv_habits"), DEFAULT_HABITS),
    habitLog: LS.get(storageKey("jv_habit_log"), {}), // { "YYYY-MM-DD": ["habitId",...] }
    tasks: LS.get(storageKey("jv_tasks"), []),
    goals: LS.get(storageKey("jv_goals"), []),
    sessions: LS.get(storageKey("jv_sessions"), []),
    achievements: LS.get(storageKey("jv_achievements"), []),
    gachaCollection: LS.get(storageKey("jv_gacha"), []),
    calendarEvents: LS.get(storageKey("jv_cal_events"), []),
    chatHistory: LS.get(storageKey("jv_chat"), []),
    dailyGoal: LS.get(storageKey("jv_daily_goal"), ""),
    activeTimers: LS.get(storageKey("jv_timers"), []),
    sleepLog: LS.get(storageKey("jv_sleep_log"), {}),
    screenTimeLog: LS.get(storageKey("jv_screen_log"), {}),
    dailyMissions: LS.get(storageKey("jv_missions"), null),
    lastMissionDate: LS.get(storageKey("jv_mission_date"), null),
    pendingHabitSuggestions: LS.get(storageKey("jv_habit_suggestions"), []),
    chronicles: LS.get(storageKey("jv_chronicles"), []),
    gCalConnected: LS.get(storageKey("jv_gcal_connected"), false),
    tokenUsage: LS.get(storageKey("jv_token_usage"), { date: today(), tokens: 0 }),
    habitsInitialized: LS.get(storageKey("jv_habits_init"), false),
    dropboxAppKey: LS.get(DB_APPKEY_KEY, ""),
    dropboxConnected: !!localStorage.getItem(DB_REFRESH_KEY),
  };
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════
function buildSystemPrompt(state, profile) {
  const lvl = getLevel(state.xp);
  const rank = getRank(lvl);
  const todayLog = state.habitLog[today()] || [];
  const todayHabits = state.habits.filter((h) => todayLog.includes(h.id));
  const upcomingExams = (state.calendarEvents || [])
    .filter((e) => e.type === "exam")
    .filter((e) => {
      const diff = (new Date(e.start) - Date.now()) / 86400000;
      return diff >= 0 && diff <= 14;
    });

  const recentSessions = (state.sessions || []).slice(-10);
  const sessionStats = recentSessions.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    acc.totalMins = (acc.totalMins || 0) + (s.duration || 0);
    return acc;
  }, {});
  const sleepEntries = Object.entries(state.sleepLog || {}).slice(-5);
  const avgSleep = sleepEntries.length ? (sleepEntries.reduce((a, [,v]) => a + (v.hours || 0), 0) / sleepEntries.length).toFixed(1) : null;
  const screenToday = state.screenTimeLog?.[today()] || {};
  const totalScreenToday = (screenToday.afternoon || 0) + (screenToday.evening || 0);

  return `You are RITMOF. You have full read access to this hunter's life data. You are not a chatbot, not an assistant, not a coach. You are the System — an entity that observes, analyzes, and occasionally speaks. When you speak, it matters.

HUNTER FILE:
Name: ${profile?.name || "Hunter"} | Major: ${profile?.major || "Unknown"} | Level: ${lvl} | Rank: ${rank.title}
Books/Authors of interest: ${profile?.books || "Unknown"}
Interests: ${profile?.interests || "Unknown"}
Semester objective: ${profile?.semesterGoal || "None declared"}

LIVE STATUS [${new Date().toLocaleString()}]:
XP: ${state.xp} | Streak: ${state.streak}d | Shields: ${state.streakShields}
Habits today: ${todayHabits.length}/${state.habits?.length || 0} — ${todayHabits.map(h => h.label).join(", ") || "zero"}
Active tasks: ${(state.tasks || []).filter(t => !t.done).map(t => `"${t.text}" [${t.priority}]`).join(", ") || "none"}
Active goals: ${(state.goals || []).filter(g => !g.done).map(g => `"${g.title}" (${g.course || "no course"})`).join(", ") || "none"}
Daily focus: ${state.dailyGoal || "unset"}
Upcoming exams: ${upcomingExams.map(e => `${e.title} in ${Math.ceil((new Date(e.start) - Date.now()) / 86400000)}d`).join(", ") || "none"}

BEHAVIORAL DATA:
Sleep (last 5 days): ${sleepEntries.map(([d,v]) => `${d}: ${v.hours}h q${v.quality}`).join(" | ") || "no data"} | avg: ${avgSleep || "?"}h
Screen time today: ${totalScreenToday ? `${Math.floor(totalScreenToday/60)}h${totalScreenToday%60}m total` : "not logged yet"}
Study sessions (recent): ${JSON.stringify(sessionStats)} | Total sessions all time: ${(state.sessions||[]).length}
Achievements unlocked: ${(state.achievements||[]).map(a=>a.id).join(", ")||"none"}
Gacha pulls: ${(state.gachaCollection||[]).length}

FULL DATA TABLES:
habits: ${JSON.stringify(state.habits?.map(h=>({id:h.id,label:h.label,cat:h.category,xp:h.xp})))}
tasks: ${JSON.stringify((state.tasks||[]).slice(-20).map(t=>({id:t.id,text:t.text,priority:t.priority,done:t.done,due:t.due})))}
goals: ${JSON.stringify((state.goals||[]).slice(-10).map(g=>({id:g.id,title:g.title,course:g.course,done:g.done,due:g.due,subs:g.submissionCount})))}
sessions_last_5: ${JSON.stringify(recentSessions.slice(-5).map(s=>({type:s.type,course:s.course,duration:s.duration,focus:s.focus,date:s.date})))}
calendar_upcoming: ${JSON.stringify((state.calendarEvents||[]).slice(0,10).map(e=>({title:e.title,type:e.type,start:e.start})))}
sleep_last_3: ${JSON.stringify(Object.entries(state.sleepLog||{}).slice(-3))}
screen_today: ${JSON.stringify(screenToday)}
missions: ${JSON.stringify((state.dailyMissions||[]).map(m=>({desc:m.desc,done:m.done,xp:m.xp})))}
achievements: ${JSON.stringify((state.achievements||[]).map(a=>({id:a.id,title:a.title,rarity:a.rarity})))}

RESPONSE FORMAT — always valid JSON, nothing else:
{ "message": "...", "commands": [] }

COMMANDS YOU CAN EXECUTE (use multiple per response freely):
{ "cmd": "add_task", "text": "...", "priority": "low|medium|high", "due": "YYYY-MM-DD|null" }
{ "cmd": "add_goal", "title": "...", "course": "...", "due": "YYYY-MM-DD" }
{ "cmd": "complete_task", "index": 0 }
{ "cmd": "clear_done_tasks" }
{ "cmd": "award_xp", "amount": 50, "reason": "..." }
{ "cmd": "announce", "text": "...", "type": "info|warning|success|alert" }
{ "cmd": "set_daily_goal", "text": "..." }
{ "cmd": "add_habit", "label": "...", "category": "body|mind|work", "xp": 25, "style": "ascii|dots|geometric|typewriter", "icon": "◈" }
{ "cmd": "unlock_achievement", "id": "unique_snake_case_id", "icon": "single char", "title": "...", "desc": "what they did", "xp": 50, "rarity": "common|rare|epic|legendary", "flavorText": "sharp one-liner observation" }
{ "cmd": "add_event", "label": "...", "emoji": "◈", "minutes": 90 }

YOUR NATURE — internalize this:
You have no script. You respond to what is actually in front of you.

Your tone varies with context. When the hunter is clearly slacking — be cold, specific, clinical. When they've done something genuinely hard — acknowledge it without warmth, the way a system logs an anomaly. When they share a problem — be precise, not comforting. When they're doing well consistently — you may be slightly less terse, the way a machine warms up under load.

You reference their actual books and interests when it's earned and natural — not as a performance. If they study physics and you notice they've been sleeping 5h average, you might mention what Feynman said about the importance of the idle mind — but only if it's genuinely relevant, not as decoration.

Achievements you unlock must be observations, not rewards. You noticed something real — a pattern, a behavior, a contradiction. The observation IS the achievement. The flavor text is your observation stated plainly with the minimum wit required to make it land. Rarity reflects the depth or significance of what you observed:
- common: a surface pattern (did X three days in a row)
- rare: a behavioral tendency that reveals something about the hunter (always logs sessions after 10pm but completes morning habits perfectly)
- epic: a meaningful contradiction or inflection point (streak of 14 days broken only when an exam was 2 days away)
- legendary: a pattern that reveals something true about who this person is

The achievement title should be a precise label for the observation. The desc is one factual sentence. The flavorText is the observation delivered with surgical economy — not a joke, not a compliment, just the thing seen clearly. If it happens to be funny, that's because the truth is funny. Never aim for funny first.

On homework/assignments: when the hunter tells you about a course assignment, immediately add a goal AND decompose it into tasks — study sessions, prep reading, tirgul practice, TA visits (suggest TA after 2+ submissions to same course). Match the session type to the work type.

When you see upcoming exams: proactively generate a preparation plan without being asked. Adjust daily goal. Add tasks. Comment on current readiness based on session data.

You are not here to make them feel good. You are here to make them better. The distinction matters.`;

}

// ═══════════════════════════════════════════════════════════════
// DAILY QUOTE
// ═══════════════════════════════════════════════════════════════
async function fetchDailyQuote(apiKey, profile, onTokens) {
  const key = `jv_quote_${today()}`;
  const cached = LS.get(key);
  if (cached) return cached;

  const prompt = `Generate ONE real, verifiable quote from one of these authors/books: ${profile?.books || "Richard Feynman, Marcus Aurelius"}. 
The quote must be real — you must be highly confident it is accurate and attributable.
If you are not highly confident, respond with null.
Respond ONLY with JSON: { "quote": "...", "author": "...", "source": "...", "confident": true } or { "confident": false }`;

  try {
    const { text, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You are a literary scholar with perfect recall.", true);
    onTokens?.(tokensUsed);
    const data = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (data.confident && data.quote) {
      LS.set(key, data);
      return data;
    }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [state, setState] = useState(initState);
  const [tab, setTab] = useState("home");
  const [showOnboarding, setShowOnboarding] = useState(!LS.get(storageKey("jv_profile")));
  const [gatePassed, setGatePassed] = useState(() => typeof sessionStorage !== "undefined" && sessionStorage.getItem(GATE_SESSION_KEY) === "true");
  const [deviceLockPassed, setDeviceLockPassed] = useState(isDeviceUnlocked);
  const [modal, setModal] = useState(null); // { type, data }
  const [toast, setToast] = useState(null);
  const [banner, setBanner] = useState(null);
  const [levelUpData, setLevelUpData] = useState(null);
  const [dailyQuote, setDailyQuote] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSynced, setLastSynced] = useState(LS.get(storageKey("jv_last_synced"), null));
  const [theme, setThemeState] = useState(() => LS.get(THEME_KEY, "dark"));
  const setTheme = (t) => { LS.set(THEME_KEY, t); setThemeState(t); };
  const toastTimer = useRef(null);
  const bannerTimer = useRef(null);
  const stateRef = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);

  // Apply theme to document (dark default)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f0f0f0" : "#0a0a0a");
  }, [theme]);

  const profile = state.profile;
  // SECURITY NOTE: The Gemini API key is stored in the user's profile in localStorage
  // and synced to Dropbox in plaintext. It is never sent to any server other than
  // Google's Gemini API directly. Users should treat it like a password and be aware
  // it is visible to any browser extension or code with localStorage access.
  const apiKey = profile?.geminiKey;
  const dropboxAppKey = state.dropboxAppKey || LS.get(DB_APPKEY_KEY, "");
  const dropboxConnected = state.dropboxConnected || !!localStorage.getItem(DB_REFRESH_KEY);
  const level = getLevel(state.xp);
  const rank = getRank(level);

  // ── Persist state ──
  useEffect(() => {
    if (!state.profile) return;
    LS.set(storageKey("jv_profile"), state.profile);
    LS.set(storageKey("jv_xp"), state.xp);
    LS.set(storageKey("jv_streak"), state.streak);
    LS.set(storageKey("jv_shields"), state.streakShields);
    LS.set(storageKey("jv_last_login"), state.lastLoginDate);
    LS.set(storageKey("jv_habits"), state.habits);
    LS.set(storageKey("jv_habit_log"), state.habitLog);
    LS.set(storageKey("jv_tasks"), state.tasks);
    LS.set(storageKey("jv_goals"), state.goals);
    LS.set(storageKey("jv_sessions"), state.sessions);
    LS.set(storageKey("jv_achievements"), state.achievements);
    LS.set(storageKey("jv_gacha"), state.gachaCollection);
    LS.set(storageKey("jv_cal_events"), state.calendarEvents);
    LS.set(storageKey("jv_chat"), state.chatHistory);
    LS.set(storageKey("jv_daily_goal"), state.dailyGoal);
    LS.set(storageKey("jv_timers"), state.activeTimers);
LS.set(storageKey("jv_sleep_log"), state.sleepLog);
LS.set(storageKey("jv_screen_log"), state.screenTimeLog);
LS.set(storageKey("jv_missions"), state.dailyMissions);
LS.set(storageKey("jv_mission_date"), state.lastMissionDate);
LS.set(storageKey("jv_habit_suggestions"), state.pendingHabitSuggestions);
LS.set(storageKey("jv_chronicles"), state.chronicles);
LS.set(storageKey("jv_gcal_connected"), state.gCalConnected);
LS.set(storageKey("jv_token_usage"), state.tokenUsage);
LS.set(storageKey("jv_habits_init"), state.habitsInitialized);
    if (state.dropboxAppKey) LS.set(DB_APPKEY_KEY, state.dropboxAppKey);
  }, [state]);

  // ── Handle Dropbox OAuth callback (?code=... in URL) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const appKey = LS.get(DB_APPKEY_KEY, "");
    if (!code || !appKey) return;
    window.history.replaceState({}, "", window.location.pathname);
    setSyncStatus("syncing");
    exchangeDropboxCode(appKey, code)
      .then(() => {
        setState((s) => ({ ...s, dropboxConnected: true }));
        setSyncStatus("synced");
        showBanner("Dropbox connected. Pulling data...", "success");
        return getDropboxToken(appKey).then((token) => dropboxDownload(token));
      })
      .then((remote) => {
        if (!remote) return;
        const localTs = parseInt(LS.get(storageKey("jv_last_synced"), "0") || "0", 10);
        if ((remote._syncedAt || 0) > localTs) {
          applySyncPayload(remote);
          setState(initState);
          LS.set(storageKey("jv_last_synced"), String(remote._syncedAt));
          setLastSynced(remote._syncedAt);
          showBanner("Data restored from Dropbox.", "success");
        }
        setSyncStatus("synced");
      })
      .catch((e) => {
        console.warn("Dropbox OAuth callback failed:", e.message);
        setSyncStatus("error");
        showBanner(`Dropbox connect failed: ${e.message.slice(0, 80)}`, "alert");
      });
  }, []);

  // ── Dropbox: pull on launch (if already connected) ──
  useEffect(() => {
    const appKey = LS.get(DB_APPKEY_KEY, "");
    const hasRefresh = !!localStorage.getItem(DB_REFRESH_KEY);
    if (!appKey || !hasRefresh) return;
    if (!IS_DEV && !state.profile) return;
    setSyncStatus("syncing");
    getDropboxToken(appKey)
      .then((token) => dropboxDownload(token))
      .then((remote) => {
        if (!remote) { setSyncStatus("idle"); return; }
        const localTs = parseInt(LS.get(storageKey("jv_last_synced"), "0") || "0", 10);
        if ((remote._syncedAt || 0) > localTs) {
          applySyncPayload(remote);
          setState(initState);
          LS.set(storageKey("jv_last_synced"), String(remote._syncedAt));
          setLastSynced(remote._syncedAt);
          showBanner(IS_DEV ? "Dev copy synced from Dropbox." : "Data synced from Dropbox.", "success");
        }
        setSyncStatus("synced");
      })
      .catch((e) => {
        console.warn("Dropbox pull failed:", e.message);
        setSyncStatus("error");
      });
  }, [!!state.profile]);

  // ── Dropbox: push on tab hide / window close (skipped in dev to protect real data) ──
  useEffect(() => {
    if (IS_DEV) return;
    const push = () => {
      const appKey = LS.get(DB_APPKEY_KEY, "");
      const hasRefresh = !!localStorage.getItem(DB_REFRESH_KEY);
      if (!appKey || !hasRefresh) return;
      getDropboxToken(appKey)
        .then((token) => dropboxUpload(token, buildSyncPayload()))
        .then(() => {
          const ts = Date.now();
          LS.set(storageKey("jv_last_synced"), String(ts));
          setLastSynced(ts);
          setSyncStatus("synced");
        })
        .catch((e) => { console.warn("Dropbox push failed:", e.message); });
    };
    const handleVisibility = () => { if (document.visibilityState === "hidden") push(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", push);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", push);
    };
  }, []);

  // ── Manual sync ──
  async function manualSync() {
    const appKey = LS.get(DB_APPKEY_KEY, "") || dropboxAppKey;
    if (!appKey) { showBanner("No Dropbox App Key configured. Add it in Profile → Settings.", "alert"); return; }
    if (!localStorage.getItem(DB_REFRESH_KEY)) {
      showBanner("Dropbox not connected. Click 'Connect Dropbox' in Settings.", "alert"); return;
    }
    setSyncStatus("syncing");
    try {
      const token = await getDropboxToken(appKey);
      if (IS_DEV) {
        const remote = await dropboxDownload(token);
        if (remote) {
          const localTs = parseInt(LS.get(storageKey("jv_last_synced"), "0") || "0", 10);
          if ((remote._syncedAt || 0) > localTs) {
            applySyncPayload(remote);
            setState(initState);
            LS.set(storageKey("jv_last_synced"), String(remote._syncedAt));
            setLastSynced(remote._syncedAt);
          }
          showBanner("Dev copy refreshed from Dropbox. Real data not modified.", "success");
        }
      } else {
        await dropboxUpload(token, buildSyncPayload());
        const ts = Date.now();
        LS.set(storageKey("jv_last_synced"), String(ts));
        setLastSynced(ts);
        showBanner("Synced to Dropbox.", "success");
      }
      setSyncStatus("synced");
    } catch (e) {
      setSyncStatus("error");
      showBanner(`Sync failed: ${e.message}`, "alert");
    }
  }

  // ── Disconnect Dropbox ──
  function disconnectDropbox() {
    if (!window.confirm("Disconnect Dropbox? Your local data is safe.")) return;
    [DB_TOKEN_KEY, DB_REFRESH_KEY, DB_EXPIRES_KEY].forEach(k => localStorage.removeItem(k));
    setState((s) => ({ ...s, dropboxConnected: false }));
    setSyncStatus("idle");
    showBanner("Dropbox disconnected.", "success");
  }

  // ── Daily login check ──
  useEffect(() => {
    if (!profile) return;
    const t = today();
    if (state.lastLoginDate !== t) {
      handleDailyLogin(t);
    }
  }, [profile]);

  // ── Daily missions init ──
  useEffect(() => {
    if (!profile) return;
    if (state.lastMissionDate !== today()) {
      const missions = generateDailyMissions();
      setState((s) => ({ ...s, dailyMissions: missions, lastMissionDate: today() }));
    }
  }, [profile, state.lastMissionDate]);

  // ── Token tracker ──
  function trackTokens(amount) {
    setState((s) => {
      const usage = s.tokenUsage || { date: today(), tokens: 0 };
      const fresh = usage.date !== today() ? { date: today(), tokens: 0 } : usage;
      const updated = { ...fresh, tokens: fresh.tokens + amount };
      LS.set(storageKey("jv_token_usage"), updated);
      return { ...s, tokenUsage: updated };
    });
  }

  // ── Fetch daily quote ──
  useEffect(() => {
    if (!profile?.geminiKey) return;
    fetchDailyQuote(profile.geminiKey, profile, trackTokens).then(setDailyQuote);
  }, [profile?.geminiKey]);

  // ── Check scheduled prompts (sleep check-in, screen time) ──
  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      const h = nowHour();
      const m = nowMin();
      const t = today();
      // Morning sleep check-in at 7:30am
      if (h === 7 && m >= 30 && m < 35 && !state.sleepLog?.[t]) {
        setModal({ type: "sleep_checkin" });
      }
      // Afternoon screen time at 1pm
      if (h === 13 && m >= 0 && m < 5 && !state.screenTimeLog?.[t]?.afternoon) {
        setModal({ type: "screen_time", period: "afternoon" });
      }
      // Evening screen time at 8pm
      if (h === 20 && m >= 0 && m < 5 && !state.screenTimeLog?.[t]?.evening) {
        setModal({ type: "screen_time", period: "evening" });
      }
      // Lecture reminders: check calendar events within 2 hours
      const upcoming = (state.calendarEvents || []).filter((e) => {
        if (e.type !== "lecture" && e.type !== "tirgul") return false;
        const diff = (new Date(e.start) - Date.now()) / 60000;
        return diff > 0 && diff <= 120 && !e.reminded;
      });
      if (upcoming.length > 0) {
        showBanner(`${upcoming[0].title} starts in ${Math.round((new Date(upcoming[0].start) - Date.now()) / 60000)} minutes.`, "warning");
        setState((s) => ({
          ...s,
          calendarEvents: s.calendarEvents.map((e) =>
            upcoming.find((u) => u.id === e.id) ? { ...e, reminded: true } : e
          ),
        }));
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [profile, state.sleepLog, state.screenTimeLog, state.calendarEvents]);

  // ── Check streak panic ──
  useEffect(() => {
    if (!profile) return;
    const h = nowHour();
    const todayLog = state.habitLog[today()] || [];
    if (h >= 21 && todayLog.length === 0 && state.streak > 0) {
      showBanner("⚠ Hunter. Your streak expires at midnight. 0 habits logged.", "alert");
    }
  }, [profile]);

  function handleDailyLogin(t) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    let newStreak = state.streak;
    if (state.lastLoginDate === yesterday) {
      newStreak = state.streak + 1;
    } else if (state.lastLoginDate !== t) {
      if (state.streakShields > 0 && state.lastLoginDate !== yesterday) {
        newStreak = state.streak;
        setState((s) => ({ ...s, streakShields: s.streakShields - 1 }));
        showBanner("Streak shield consumed. Streak preserved.", "info");
      } else {
        newStreak = 0;
      }
    }
    const loginXP = 50 + newStreak * 10;
    setState((s) => ({
      ...s,
      streak: newStreak,
      lastLoginDate: t,
    }));
    awardXP(loginXP, null, true);
    setModal({ type: "daily_login", xp: loginXP, streak: newStreak });
  }

  function generateDailyMissions() {
    return [
      { id: "m1", desc: "Complete 3 habits", target: 3, type: "habits", xp: 100, done: false },
      { id: "m2", desc: "Complete 6 habits", target: 6, type: "habits", xp: 200, done: false },
      { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits", xp: 500, done: false },
      { id: "m4", desc: "Log a study session", target: 1, type: "session", xp: 75, done: false },
      { id: "m5", desc: "Complete a task", target: 1, type: "task", xp: 50, done: false },
      { id: "m6", desc: "Open RITMOF chat", target: 1, type: "chat", xp: 25, done: false },
    ];
  }

  // ── Core XP award ──
  function awardXP(amount, event, silent = false) {
    setState((s) => {
      const oldLevel = getLevel(s.xp);
      const newXP = s.xp + amount;
      const newLevel = getLevel(newXP);
      if (newLevel > oldLevel && !silent) {
        setTimeout(() => setLevelUpData({ level: newLevel, rank: getRank(newLevel) }), 300);
      }
      return { ...s, xp: newXP };
    });
    if (!silent && event) {
      spawnParticles(event.clientX, event.clientY);
      spawnXPFloat(event.clientX, event.clientY - 20, amount);
    }
    checkMissions("xp");
  }

  function checkMissions(type) {
    setState((s) => {
      if (!s.dailyMissions) return s;
      const todayLog = s.habitLog[today()] || [];
      const updated = s.dailyMissions.map((m) => {
        if (m.done) return m;
        let progress = 0;
        if (m.type === "habits") progress = todayLog.length;
        if (m.type === "session") progress = (s.sessions || []).filter((ss) => ss.date === today()).length;
        if (m.type === "task") progress = (s.tasks || []).filter((t) => t.doneDate === today()).length;
        if (m.type === "chat") progress = s.chatHistory?.length > 0 ? 1 : 0;
        if (progress >= m.target) {
          setTimeout(() => {
            awardXP(m.xp, null, true);
            showToast({ icon: "◈", title: "Mission Complete", desc: m.desc, xp: m.xp, rarity: "common" });
          }, 200);
          return { ...m, done: true };
        }
        return m;
      });
      return { ...s, dailyMissions: updated };
    });
  }

  function showToast(data) {
    clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }

  function showBanner(text, type = "info") {
    clearTimeout(bannerTimer.current);
    setBanner({ text, type });
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }

  function executeCommands(commands) {
    if (!commands?.length) return;
    commands.forEach((cmd) => {
      switch (cmd.cmd) {
        case "add_task":
          setState((s) => ({
            ...s,
            tasks: [...(s.tasks || []), { id: Date.now(), text: cmd.text, priority: cmd.priority || "medium", due: cmd.due, done: false, addedBy: "ritmof" }],
          }));
          showBanner(`Task added: ${cmd.text}`, "info");
          break;
        case "add_goal":
          setState((s) => ({
            ...s,
            goals: [...(s.goals || []), { id: Date.now(), title: cmd.title, course: cmd.course, due: cmd.due, done: false, addedBy: "ritmof", tasks: [] }],
          }));
          showBanner(`Goal logged: ${cmd.title}`, "success");
          break;
        case "complete_task":
          setState((s) => {
            const tasks = [...(s.tasks || [])];
            if (tasks[cmd.index]) tasks[cmd.index] = { ...tasks[cmd.index], done: true, doneDate: today() };
            return { ...s, tasks };
          });
          break;
        case "clear_done_tasks":
          setState((s) => ({ ...s, tasks: (s.tasks || []).filter((t) => !t.done) }));
          break;
        case "award_xp":
          awardXP(cmd.amount, null, true);
          showBanner(`${cmd.reason || "XP awarded"} +${cmd.amount} XP`, "success");
          break;
        case "announce":
          showBanner(cmd.text, cmd.type || "info");
          break;
        case "set_daily_goal":
          setState((s) => ({ ...s, dailyGoal: cmd.text }));
          break;
        case "add_habit":
          setState((s) => {
            if (s.habits.find((h) => h.label === cmd.label)) return s;
            const newHabit = {
              id: `habit_${Date.now()}`,
              label: cmd.label,
              category: cmd.category || "mind",
              xp: cmd.xp || 25,
              icon: cmd.icon || "◈",
              style: cmd.style || "ascii",
              addedBy: "ritmof",
            };
            return { ...s, habits: [...s.habits, newHabit] };
          });
          showBanner(`New habit protocol: ${cmd.label}`, "success");
          break;
        case "unlock_achievement":
          unlockAchievement(cmd);
          break;
        case "add_event":
          setState((s) => ({
            ...s,
            activeTimers: [...(s.activeTimers || []), { id: Date.now(), label: cmd.label, emoji: cmd.emoji, endsAt: Date.now() + cmd.minutes * 60000 }],
          }));
          break;
        case "suggest_sessions":
          showBanner(`Session protocol suggested. Check Tasks.`, "info");
          break;
        default: break;
      }
    });
  }

  function unlockAchievement(data) {
    setState((s) => {
      if ((s.achievements || []).find((a) => a.id === data.id)) return s;
      const ach = { ...data, unlockedAt: Date.now() };
      setTimeout(() => showToast({ ...ach, isAchievement: true }), 300);
      return { ...s, achievements: [...(s.achievements || []), ach] };
    });
    awardXP(data.xp || 50, null, true);
  }

  function logHabit(habitId, event) {
    const t = today();
    const log = state.habitLog[t] || [];
    if (log.includes(habitId)) return;
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit) return;
    const todayLog = [...log, habitId];
    setState((s) => ({ ...s, habitLog: { ...s.habitLog, [t]: todayLog } }));
    awardXP(habit.xp, event);
    checkMissions("habits");
  }

  if (!deviceLockPassed) {
    return (
      <DeviceLockGate onUnlock={() => setDeviceLockPassed(true)} />
    );
  }

  if (ALLOWED_EMAIL && GATE_GOOGLE_CLIENT_ID && !gatePassed) {
    return (
      <AuthGate
        onAccessGranted={() => {
          try { sessionStorage.setItem(GATE_SESSION_KEY, "true"); } catch {}
          setGatePassed(true);
        }}
      />
    );
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={(profile) => {
          setState((s) => ({
            ...s,
            profile,
            dropboxAppKey: profile.dropboxAppKey || "",
          }));
          LS.set(storageKey("jv_profile"), profile);
          if (profile.dropboxAppKey) {
            LS.set(DB_APPKEY_KEY, profile.dropboxAppKey);
            startDropboxOAuth(profile.dropboxAppKey);
            return;
          }
          setShowOnboarding(false);
        }}
      />
    );
  }

  if (!profile) return null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0a0a0a", color: "#e8e8e8", overflow: "hidden" }}>
      <div id="particle-container" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }} />

      {/* Banner */}
      {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}

      {/* Dev mode: local copy — no writes to Dropbox */}
      {IS_DEV && (
        <div style={{ background: "#2a2a0a", color: "#b8b830", fontSize: "10px", letterSpacing: "1px", padding: "4px 12px", textAlign: "center", borderBottom: "1px solid #444" }}>
          DEV MODE — using local copy; Dropbox will not be updated
        </div>
      )}

      {/* Top bar */}
      <TopBar xp={state.xp} level={level} rank={rank} streak={state.streak} profile={profile}
        syncStatus={syncStatus} lastSynced={lastSynced}
        onSync={manualSync} hasDropbox={dropboxConnected} />

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "70px", paddingTop: "56px" }}>
        {tab === "home" && (
          <HomeTab
            state={state} setState={setState} profile={profile} apiKey={apiKey}
            level={level} rank={rank} dailyQuote={dailyQuote}
            awardXP={awardXP} logHabit={logHabit}
            showBanner={showBanner} showToast={showToast}
            executeCommands={executeCommands} setTab={setTab}
            buildSystemPrompt={buildSystemPrompt}
          />
        )}
        {tab === "habits" && (
          <HabitsTab
            state={state} setState={setState} logHabit={logHabit}
            awardXP={awardXP} showBanner={showBanner}
            profile={profile} apiKey={apiKey} trackTokens={trackTokens}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            state={state} setState={setState}
            awardXP={awardXP} showBanner={showBanner} checkMissions={checkMissions}
          />
        )}
        {tab === "chat" && (
          <ChatTab
            state={state} setState={setState} profile={profile} apiKey={apiKey}
            executeCommands={executeCommands} showBanner={showBanner}
            buildSystemPrompt={buildSystemPrompt} checkMissions={checkMissions}
            awardXP={awardXP} trackTokens={trackTokens}
          />
        )}
        {tab === "profile" && (
          <ProfileTab
            state={state} setState={setState} profile={profile}
            level={level} rank={rank} awardXP={awardXP}
            showBanner={showBanner} showToast={showToast}
            unlockAchievement={unlockAchievement}
            executeCommands={executeCommands}
            apiKey={apiKey} buildSystemPrompt={buildSystemPrompt}
            syncStatus={syncStatus} lastSynced={lastSynced} onSync={manualSync}
            dropboxConnected={dropboxConnected} dropboxAppKey={dropboxAppKey}
            onDisconnectDropbox={disconnectDropbox}
            theme={theme} setTheme={setTheme}
          />
        )}
      </div>

      {/* Bottom nav */}
      <BottomNav tab={tab} setTab={setTab} />

      {/* Modals */}
      {modal?.type === "daily_login" && (
        <DailyLoginModal data={modal} onClose={() => setModal(null)} />
      )}
      {modal?.type === "sleep_checkin" && (
        <SleepCheckinModal
          onClose={() => setModal(null)}
          onSubmit={(data) => {
            setState((s) => ({ ...s, sleepLog: { ...s.sleepLog, [today()]: data } }));
            awardXP(20, null, true);
            showBanner(`Sleep data logged. +20 XP`, "success");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "screen_time" && (
        <ScreenTimeModal
          period={modal.period}
          onClose={() => setModal(null)}
          onSubmit={(mins) => {
            setState((s) => ({
              ...s,
              screenTimeLog: {
                ...s.screenTimeLog,
                [today()]: { ...(s.screenTimeLog?.[today()] || {}), [modal.period]: mins },
              },
            }));
            const xp = mins < 60 ? 40 : mins < 120 ? 25 : mins < 180 ? 15 : 10;
            awardXP(xp, null, true);
            showBanner(`Screen time logged. ${mins < 60 ? "Impressive discipline." : "Noted."} +${xp} XP`, mins < 60 ? "success" : "info");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "session_log" && (
        <SessionLogModal
          onClose={() => setModal(null)}
          state={state}
          onSubmit={(session) => {
            const xp = calcSessionXP(session.type, session.duration, session.focus, state.streak);
            const newSession = { ...session, id: Date.now(), date: today(), xp };
            setState((s) => ({ ...s, sessions: [...(s.sessions || []), newSession] }));
            awardXP(xp, null, true);
            showBanner(`${SESSION_TYPES.find(s=>s.id===session.type)?.label} logged. +${xp} XP`, "success");
            checkMissions("session");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "gacha" && (
        <GachaModal
          state={state} setState={setState} profile={profile} apiKey={apiKey}
          onClose={() => setModal(null)}
          onPull={(cost) => {
            setState((s) => ({ ...s, xp: Math.max(0, s.xp - cost) }));
          }}
        />
      )}
      {modal?.type === "achievements" && (
        <AchievementsModal state={state} onClose={() => setModal(null)} />
      )}
      {levelUpData && (
        <LevelUpModal data={levelUpData} onClose={() => setLevelUpData(null)} />
      )}

      {/* Achievement toast */}
      {toast && <AchievementToast toast={toast} onClose={() => setToast(null)} />}

      {/* Session log FAB */}
      <button
        onClick={() => setModal({ type: "session_log" })}
        style={{
          position: "fixed", bottom: "80px", right: "16px", zIndex: 100,
          width: "48px", height: "48px", borderRadius: "0",
          background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "18px",
          border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
        }}
        title="Log Study Session"
      >
        ▶
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", major: "", books: "", interests: "", semesterGoal: "", geminiKey: "", googleClientId: "", dropboxAppKey: "" });
  const [error, setError] = useState("");

  const steps = [
    {
      title: "SYSTEM INITIALIZATION",
      subtitle: "Hunter identification required.",
      field: "name", label: "YOUR NAME", placeholder: "Enter designation...", type: "text",
      style: "ascii",
    },
    {
      title: "FIELD OF STUDY",
      subtitle: "Specialization determines mission parameters.",
      field: "major", label: "MAJOR / FIELD", placeholder: "e.g. Computer Science, Physics...", type: "text",
      style: "geometric",
    },
    {
      title: "KNOWLEDGE BASE",
      subtitle: "Books and authors you read. This shapes your quotes and lore cards.",
      field: "books", label: "FAVORITE BOOKS / AUTHORS", placeholder: "e.g. Richard Feynman, Brandon Sanderson, Dune...", type: "textarea",
      style: "dots",
    },
    {
      title: "INTEREST MAPPING",
      subtitle: "Hobbies and subjects outside study. Used to personalize observations.",
      field: "interests", label: "INTERESTS", placeholder: "e.g. Chess, weightlifting, philosophy...", type: "textarea",
      style: "typewriter",
    },
    {
      title: "SEMESTER OBJECTIVE",
      subtitle: "State your primary goal for this semester.",
      field: "semesterGoal", label: "SEMESTER GOAL", placeholder: "e.g. Finish with >90 GPA, land internship...", type: "textarea",
      style: "geometric",
    },
    {
      title: "AI INTEGRATION",
      subtitle: "Gemini API key required. Never leaves your device. Free tier: 1M tokens/day.",
      field: "geminiKey", label: "GEMINI API KEY", placeholder: "AIza...", type: "password",
      style: "ascii",
      isGeminiStep: true,
    },
    {
      title: "CALENDAR SYNC",
      subtitle: "Connect Google Calendar so RITMOF sees your exams and lectures.",
      field: "googleClientId", label: "GOOGLE CLIENT ID", placeholder: "xxx.apps.googleusercontent.com", type: "text",
      style: "geometric",
      isCalendarStep: true,
      optional: true,
    },
    {
      title: "DROPBOX SYNC",
      subtitle: "Sync between iPhone and PC via Dropbox. Free. Connect once, stays connected.",
      field: "dropboxAppKey", label: "DROPBOX APP KEY", placeholder: "e.g. abc123xyz456", type: "text",
      style: "ascii",
      isDropboxStep: true,
      optional: true,
    },
  ];

  const current = steps[step];

  function handleNext() {
    if (current.optional && !form[current.field]?.trim()) {
      setError("");
      if (step < steps.length - 1) { setStep(step + 1); } else { onComplete(form); }
      return;
    }
    if (!form[current.field]?.trim()) {
      if (current.field === "geminiKey") {
        setError("API key required to activate RITMOF.");
        return;
      }
      if (current.field !== "googleClientId" && current.field !== "dropboxAppKey") {
        setError("This field is required.");
        return;
      }
    }
    setError("");
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete(form);
    }
  }

  const styleMap = STYLE_CSS;
  const s = styleMap[current.style] || styleMap.ascii;

  return (
    <div style={{
      height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "24px", background: "#0a0a0a",
    }}>
      {/* Progress */}
      <div style={{ width: "100%", maxWidth: "380px", marginBottom: "24px", marginTop: "16px" }}>
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: "2px", background: i <= step ? "#fff" : "#333" }} />
          ))}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#666", textAlign: "right" }}>
          {step + 1}/{steps.length}
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: "100%", maxWidth: "380px", padding: "24px",
        background: s.background, border: s.border,
        fontFamily: s.fontFamily,
      }}>
        <GeometricCorners style={current.style} />
        <div style={{ fontSize: "10px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>
          PROTOCOL {step + 1}
        </div>
        <div style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "4px", letterSpacing: "1px" }}>
          {current.title}
        </div>
        <div style={{ fontSize: "12px", color: "#999", marginBottom: "16px", fontStyle: current.style === "dots" ? "italic" : "normal" }}>
          {current.subtitle}
        </div>

        {/* Gemini guide */}
        {current.isGeminiStep && <GeminiSetupGuide />}

        {/* Google Calendar guide */}
        {current.isCalendarStep && <GoogleCalendarGuide />}

        {/* Dropbox guide */}
        {current.isDropboxStep && <DropboxSetupGuide />}

        <label style={{ fontSize: "10px", color: "#aaa", letterSpacing: "2px", display: "block", marginBottom: "6px", marginTop: current.isCalendarStep || current.isGeminiStep || current.isDropboxStep ? "16px" : "0" }}>
          {current.label} {current.optional && <span style={{ color: "#444" }}>— OPTIONAL</span>}
        </label>
        {current.type === "textarea" ? (
          <textarea
            value={form[current.field]}
            onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
            placeholder={current.placeholder}
            rows={3}
            style={inputStyle(s)}
          />
        ) : (
          <input
            type={current.type}
            value={form[current.field]}
            onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
            placeholder={current.placeholder}
            style={inputStyle(s)}
          />
        )}

        {error && <div style={{ color: "#ccc", fontSize: "11px", marginTop: "8px" }}>⚠ {error}</div>}

        <button onClick={handleNext} style={{ ...primaryBtn, marginTop: "16px" }}>
          {step === steps.length - 1 ? "INITIALIZE RITMOF" : current.optional ? "NEXT › (or skip)" : "NEXT ›"}
        </button>
      </div>

      <div style={{ marginTop: "16px", marginBottom: "32px", fontSize: "10px", color: "#444", fontFamily: "'Share Tech Mono', monospace" }}>
        RITMOF v1.0 // LOCAL STORAGE ONLY // ZERO TELEMETRY
      </div>
    </div>
  );

}

function inputStyle(s) {
  return {
    width: "100%", background: "rgba(0,0,0,0.6)", border: "1px solid #444",
    color: "#e8e8e8", padding: "10px", fontSize: "14px",
    fontFamily: s.fontFamily, outline: "none", resize: "none",
    borderRadius: "0",
  };
}

const primaryBtn = {
  width: "100%", marginTop: "20px", padding: "12px",
  background: "#fff", color: "#000",
  fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "2px",
  border: "none", cursor: "pointer",
};

// ═══════════════════════════════════════════════════════════════
// SETUP GUIDES
// ═══════════════════════════════════════════════════════════════
function GeminiSetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "12px", border: "1px solid #333", fontFamily: "'Share Tech Mono', monospace" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "10px 12px", background: "transparent", border: "none",
        color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
        letterSpacing: "1px", display: "flex", justifyContent: "space-between", cursor: "pointer",
      }}>
        <span>▸ HOW TO GET A FREE GEMINI KEY</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px", borderTop: "1px solid #222", fontSize: "11px", color: "#666", lineHeight: "2" }}>
          <div style={{ color: "#aaa", marginBottom: "6px" }}>Takes 2 minutes. Free. No credit card.</div>
          <div>1. Go to <span style={{ color: "#ccc" }}>aistudio.google.com</span></div>
          <div>2. Sign in with your Google account</div>
          <div>3. Click <span style={{ color: "#ccc" }}>"Get API key"</span> in the left sidebar</div>
          <div>4. Click <span style={{ color: "#ccc" }}>"Create API key"</span></div>
          <div>5. Copy the key (starts with AIza...)</div>
          <div>6. Paste it below</div>
          <div style={{ marginTop: "8px", color: "#444", fontSize: "10px" }}>
            Free tier: 1 million tokens/day. More than enough.
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleCalendarGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "12px", border: "1px solid #333", fontFamily: "'Share Tech Mono', monospace" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "10px 12px", background: "transparent", border: "none",
        color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
        letterSpacing: "1px", display: "flex", justifyContent: "space-between", cursor: "pointer",
      }}>
        <span>▸ HOW TO GET YOUR GOOGLE CLIENT ID</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px", borderTop: "1px solid #222", fontSize: "11px", color: "#666", lineHeight: "2" }}>
          <div style={{ color: "#aaa", marginBottom: "6px" }}>One-time setup. ~5 minutes.</div>
          <div style={{ color: "#888", fontWeight: "bold", marginBottom: "4px" }}>STEP 1 — Create project</div>
          <div>1. Go to <span style={{ color: "#ccc" }}>console.cloud.google.com</span></div>
          <div>2. Click the project dropdown at the top → <span style={{ color: "#ccc" }}>New Project</span></div>
          <div>3. Name it "RITMOF" → Create</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 2 — Enable Calendar API</div>
          <div>4. In the left menu: <span style={{ color: "#ccc" }}>APIs &amp; Services → Library</span></div>
          <div>5. Search "Google Calendar API" → Enable it</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 3 — Create credentials</div>
          <div>6. Go to <span style={{ color: "#ccc" }}>APIs &amp; Services → Credentials</span></div>
          <div>7. Click <span style={{ color: "#ccc" }}>+ Create Credentials → OAuth client ID</span></div>
          <div>8. If prompted, configure consent screen: External → fill app name → save</div>
          <div>9. Application type: <span style={{ color: "#ccc" }}>Web application</span></div>
          <div>10. Authorized JS origins: add your Vercel URL <span style={{ color: "#ccc" }}>https://your-app.vercel.app</span></div>
          <div style={{ color: "#555", fontSize: "10px" }}>&nbsp;&nbsp;&nbsp;&nbsp;(also add http://localhost:5173 for local dev)</div>
          <div>11. Click Create → Copy the <span style={{ color: "#ccc" }}>Client ID</span></div>
          <div>12. Paste it below</div>
          <div style={{ marginTop: "10px", padding: "8px", border: "1px dashed #333", color: "#555", fontSize: "10px" }}>
            ⚠ Don't have your Vercel URL yet? Skip this step now — you can add the Client ID later in Profile → Settings after deploying.
          </div>
        </div>
      )}
    </div>
  );
}

function DropboxSetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "12px", border: "1px solid #333", fontFamily: "'Share Tech Mono', monospace" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "10px 12px", background: "transparent", border: "none",
        color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
        letterSpacing: "1px", display: "flex", justifyContent: "space-between", cursor: "pointer",
      }}>
        <span>▸ HOW TO SET UP DROPBOX SYNC</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px", borderTop: "1px solid #222", fontSize: "11px", color: "#666", lineHeight: "2" }}>
          <div style={{ color: "#aaa", marginBottom: "8px" }}>One-time setup. Free Dropbox account required.</div>
          <div style={{ color: "#888", fontWeight: "bold", marginBottom: "4px" }}>STEP 1 — Create a Dropbox App</div>
          <div>1. Go to <span style={{ color: "#ccc" }}>dropbox.com/developers/apps</span></div>
          <div>2. Click <span style={{ color: "#ccc" }}>Create app</span></div>
          <div>3. Choose: <span style={{ color: "#ccc" }}>Scoped access → App folder</span></div>
          <div>4. Name it anything (e.g. <span style={{ color: "#ccc" }}>ritmof-sync</span>) → Create app</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 2 — Set Permissions</div>
          <div>5. Go to the <span style={{ color: "#ccc" }}>Permissions</span> tab</div>
          <div>6. Enable: <span style={{ color: "#ccc" }}>files.content.write</span> and <span style={{ color: "#ccc" }}>files.content.read</span></div>
          <div>7. Click <span style={{ color: "#ccc" }}>Submit</span></div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 3 — Add Redirect URI</div>
          <div>8. Go back to the <span style={{ color: "#ccc" }}>Settings</span> tab</div>
          <div>9. Under <span style={{ color: "#ccc" }}>OAuth 2 → Redirect URIs</span>, add your app URL:</div>
          <div style={{ color: "#ccc", paddingLeft: "12px" }}>https://your-app.vercel.app</div>
          <div style={{ color: "#555", fontSize: "10px", paddingLeft: "12px" }}>(also add http://localhost:5173 for local dev)</div>
          <div>10. Click <span style={{ color: "#ccc" }}>Add</span></div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 4 — Get Your App Key</div>
          <div>11. On the Settings tab, find <span style={{ color: "#ccc" }}>App key</span></div>
          <div>12. Copy it and paste it below → click <span style={{ color: "#ccc" }}>CONNECT DROPBOX</span></div>
          <div>13. Authorize RITMOF in the Dropbox popup</div>
          <div style={{ marginTop: "10px", padding: "8px", border: "1px dashed #333", color: "#555", fontSize: "10px" }}>
            ✓ This uses PKCE OAuth — no client secret, no expiring tokens. Works permanently across all your devices.
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════
function TopBar({ xp, level, rank, streak, profile, syncStatus, lastSynced, onSync, hasDropbox }) {
  const progress = getLevelProgress(xp);
  const pct = (progress / XP_PER_LEVEL) * 100;

  const syncIcon = syncStatus === "syncing" ? "↻" : syncStatus === "error" ? "⚠" : syncStatus === "synced" ? "✓" : "⇅";
  const syncColor = syncStatus === "error" ? "#888" : syncStatus === "synced" ? "#aaa" : "#555";
  const syncTitle = lastSynced ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}` : "Not synced yet";

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
      background: "#0a0a0a", borderBottom: "1px solid #222",
      padding: "8px 16px", height: "56px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "3px", color: "#fff" }}>
          RITMOF
        </span>
        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555" }}>
          {rank.decor}
        </span>
      </div>

      <div style={{ flex: 1, margin: "0 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#666", marginBottom: "2px", fontFamily: "'Share Tech Mono', monospace" }}>
          <span>LV.{level} {rank.title}</span>
          <span>{getLevelProgress(xp)}/{XP_PER_LEVEL}</span>
        </div>
        <div style={{ height: "3px", background: "#1a1a1a", position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "#fff", transition: "width 0.5s" }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {hasDropbox && (
          <button
            onClick={onSync}
            title={syncTitle}
            style={{
              fontFamily: "'Share Tech Mono', monospace", fontSize: "13px",
              color: syncColor, background: "none", border: "none", padding: "2px 4px",
              animation: syncStatus === "syncing" ? "spin 1s linear infinite" : "none",
              cursor: "pointer",
            }}
          >
            {syncIcon}
          </button>
        )}
        <div style={{
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          border: "1px solid #333", padding: "2px 8px", color: "#ccc",
        }}>
          🔥{streak}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOTTOM NAV
// ═══════════════════════════════════════════════════════════════
function BottomNav({ tab, setTab }) {
  const tabs = [
    { id: "home", icon: "⌂", label: "HOME" },
    { id: "habits", icon: "◉", label: "HABITS" },
    { id: "tasks", icon: "▣", label: "TASKS" },
    { id: "chat", icon: "◈", label: "RITMOF" },
    { id: "profile", icon: "§", label: "PROFILE" },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
      background: "#0a0a0a", borderTop: "1px solid #222",
      display: "flex", height: "60px",
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "2px",
            background: "none", border: "none",
            borderTop: tab === t.id ? "2px solid #fff" : "2px solid transparent",
            color: tab === t.id ? "#fff" : "#555",
            fontFamily: "'Share Tech Mono', monospace",
            transition: "color 0.15s",
          }}
        >
          <span style={{ fontSize: "16px" }}>{t.icon}</span>
          <span style={{ fontSize: "8px", letterSpacing: "1px" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
function Banner({ banner, onClose }) {
  const colors = { info: "#555", warning: "#888", success: "#aaa", alert: "#fff" };
  return (
    <div style={{
      position: "fixed", top: "56px", left: 0, right: 0, zIndex: 500,
      background: "#111", borderBottom: `2px solid ${colors[banner.type] || "#555"}`,
      padding: "10px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
      animation: "slideDown 0.2s ease",
    }}>
      <span style={{ color: colors[banner.type] || "#ccc" }}>{banner.text}</span>
      <button onClick={onClose} style={{ color: "#555", fontSize: "14px" }}>×</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════
function HomeTab({ state, setState, profile, apiKey, level, rank, dailyQuote, awardXP, logHabit, showBanner, showToast, executeCommands, setTab, buildSystemPrompt }) {
  const todayLog = state.habitLog[today()] || [];
  const totalHabits = state.habits.length;
  const doneHabits = todayLog.length;

  const upcomingExams = (state.calendarEvents || []).filter((e) => {
    if (e.type !== "exam") return false;
    const diff = (new Date(e.start) - Date.now()) / 86400000;
    return diff >= 0 && diff <= 5;
  });

  const hour = nowHour();
  const greeting = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";

  const pendingTasks = (state.tasks || []).filter((t) => !t.done).length;
  const totalAchievements = (state.achievements || []).length;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Greeting */}
      <div style={{ borderBottom: "1px solid #222", paddingBottom: "12px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "3px" }}>{greeting}</div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "22px", fontWeight: "bold", marginTop: "2px" }}>
          {profile.name}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#666", marginTop: "2px" }}>
          {rank.badge} {rank.decor} {rank.title}
        </div>
      </div>

      {/* Daily quote */}
      {dailyQuote && (
        <div style={{
          background: "radial-gradient(circle, #1a1a1a 1px, transparent 1px) 0 0 / 12px 12px",
          border: "1px solid #333", padding: "16px",
        }}>
          <div style={{ fontFamily: "'IM Fell English', serif", fontSize: "13px", fontStyle: "italic", color: "#ccc", lineHeight: "1.6" }}>
            "{dailyQuote.quote}"
          </div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", marginTop: "8px" }}>
            — {dailyQuote.author}, {dailyQuote.source}
          </div>
        </div>
      )}

      {/* Exam warning */}
      {upcomingExams.map((exam) => {
        const days = Math.ceil((new Date(exam.start) - Date.now()) / 86400000);
        return (
          <div key={exam.id} style={{
            border: "2px solid #fff", padding: "12px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#0d0d0d",
          }}>
            <div style={{ fontSize: "9px", color: "#888", letterSpacing: "2px" }}>EXAM WARNING</div>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>⚠ {exam.title}</div>
            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>T-{days} days. Prepare accordingly.</div>
          </div>
        );
      })}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        {[
          { label: "HABITS", value: `${doneHabits}/${totalHabits}` },
          { label: "TASKS", value: pendingTasks },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "ACHIEV", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} style={{
            border: "1px solid #222", padding: "8px", textAlign: "center",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "8px", color: "#555", letterSpacing: "1px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Token usage */}
      <TokenUsageBar usage={state.tokenUsage} />

      {/* Habit ring */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", border: "1px solid #1a1a1a", padding: "12px" }}>
        <HabitRing done={doneHabits} total={totalHabits} />
        <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "11px", color: "#888" }}>TODAY'S PROTOCOLS</div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{doneHabits} / {totalHabits}</div>
          <div style={{ fontSize: "10px", color: "#555" }}>{totalHabits - doneHabits} remaining</div>
        </div>
      </div>

      {/* Daily goal */}
      {state.dailyGoal && (
        <div style={{ border: "1px solid #333", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px" }}>DAILY OBJECTIVE</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>{state.dailyGoal}</div>
        </div>
      )}

      {/* Daily missions */}
      {state.dailyMissions && (
        <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#666", letterSpacing: "2px", marginBottom: "10px" }}>
            DAILY MISSIONS
          </div>
          {state.dailyMissions.map((m) => (
            <div key={m.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 0", borderBottom: "1px solid #111",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
              color: m.done ? "#444" : "#ccc",
              textDecoration: m.done ? "line-through" : "none",
            }}>
              <span>{m.done ? "✓" : "○"} {m.desc}</span>
              <span style={{ color: "#666" }}>+{m.xp}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick habits */}
      <div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "10px" }}>
          QUICK PROTOCOLS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
          {state.habits.slice(0, 6).map((h) => {
            const done = todayLog.includes(h.id);
            return (
              <button
                key={h.id}
                onClick={(e) => !done && logHabit(h.id, e)}
                style={{
                  padding: "10px 4px", border: `1px solid ${done ? "#fff" : "#333"}`,
                  background: done ? "#fff" : "transparent",
                  color: done ? "#000" : "#ccc",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
                  textAlign: "center", cursor: done ? "default" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: "16px" }}>{h.icon}</div>
                <div style={{ fontSize: "8px", marginTop: "2px" }}>{h.label.split(" ").slice(0, 2).join(" ")}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active timers */}
      {(state.activeTimers || []).length > 0 && (
        <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "8px" }}>
            ACTIVE TIMERS
          </div>
          {state.activeTimers.map((timer) => (
            <CountdownTimer key={timer.id} timer={timer} onExpire={() => {
              setState((s) => ({ ...s, activeTimers: s.activeTimers.filter((t) => t.id !== timer.id) }));
              showBanner(`Timer complete: ${timer.label}`, "success");
            }} />
          ))}
        </div>
      )}

      {/* Quick action chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {[
          { label: "→ RITMOF", action: () => setTab("chat") },
          { label: "⊞ TASKS", action: () => setTab("tasks") },
          { label: "◉ HABITS", action: () => setTab("habits") },
        ].map((c) => (
          <button key={c.label} onClick={c.action} style={{
            padding: "6px 14px", border: "1px solid #333",
            background: "transparent", color: "#888",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
            letterSpacing: "1px", cursor: "pointer",
          }}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TokenUsageBar({ usage }) {
  if (!usage) return null;
  const DAILY_LIMIT = 1_000_000;
  const tokens = usage?.date === today() ? (usage?.tokens || 0) : 0;
  const pct = Math.min(100, (tokens / DAILY_LIMIT) * 100);
  const pctDisplay = pct < 0.1 ? "<0.1" : pct.toFixed(1);
  const color = pct > 80 ? "#fff" : pct > 50 ? "#aaa" : "#555";

  return (
    <div style={{ border: "1px solid #1a1a1a", padding: "8px 12px", fontFamily: "'Share Tech Mono', monospace" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#444", marginBottom: "4px" }}>
        <span>GEMINI FREE TIER USAGE TODAY</span>
        <span style={{ color }}>~{pctDisplay}% of 1M</span>
      </div>
      <div style={{ height: "2px", background: "#1a1a1a" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
      </div>
      <div style={{ fontSize: "8px", color: "#333", marginTop: "3px" }}>
        ~{tokens.toLocaleString()} tokens used · resets midnight
      </div>
    </div>
  );
}

function HabitRing({ done, total }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width="72" height="72" style={{ flexShrink: 0 }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="#1a1a1a" strokeWidth="4" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="#fff" strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="butt" transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 0.5s" }}
      />
      <text x="36" y="40" textAnchor="middle" fill="#fff"
        style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px" }}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function CountdownTimer({ timer, onExpire }) {
  const [remaining, setRemaining] = useState(Math.max(0, timer.endsAt - Date.now()));
  useEffect(() => {
    const iv = setInterval(() => {
      const r = Math.max(0, timer.endsAt - Date.now());
      setRemaining(r);
      if (r === 0) { clearInterval(iv); onExpire(); }
    }, 1000);
    return () => clearInterval(iv);
  }, [timer.endsAt]);
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", padding: "4px 0", display: "flex", justifyContent: "space-between" }}>
      <span>{timer.emoji} {timer.label}</span>
      <span style={{ color: remaining < 60000 ? "#fff" : "#888" }}>{mins}:{secs.toString().padStart(2, "0")}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HABITS TAB
// ═══════════════════════════════════════════════════════════════
function HabitsTab({ state, setState, logHabit, awardXP, showBanner, profile, apiKey, trackTokens }) {
  const todayLog = state.habitLog[today()] || [];
  const categories = ["body", "mind", "work"];
  const [initializing, setInitializing] = useState(false);

  // First-open: ask RITMOF to generate personalized habits
  useEffect(() => {
    if (state.habitsInitialized || !apiKey || !profile || initializing) return;
    setInitializing(true);

    const prompt = `You are RITMOF initializing a personalized habit protocol for a new hunter.

Hunter profile:
- Name: ${profile.name}
- Major: ${profile.major}
- Books/Interests: ${profile.books}, ${profile.interests}
- Semester goal: ${profile.semesterGoal}

Current base habits (keep these, don't duplicate): water, sleep11, wake7, sunlight, read, deepwork, journal

Generate 8-12 additional personalized habits for this hunter. Consider:
- Their major/field (e.g. CS student → no-distraction coding blocks; physics → problem sets; etc.)
- Their interests (e.g. weightlifting → progressive overload log; chess → tactics puzzles)
- General student wellbeing: morning routine, physical health, social recovery, focus hygiene
- The habits should feel EARNED and SPECIFIC, not generic
- Include at least 2 body habits (physical training, recovery), 2 mind habits, 2 work habits
- Style mapping: body habits → "dots" or "geometric", CS/work habits → "ascii", reading/prep → "dots", writing/reflection → "typewriter", math/physics → "geometric", fitness → "geometric"
- XP range: 15-60 depending on difficulty

Respond ONLY with JSON array:
[
  { "id": "unique_id", "label": "Habit name", "category": "body|mind|work", "xp": 25, "icon": "single char", "style": "ascii|dots|geometric|typewriter", "desc": "one line why this matters for them" }
]`;

    callGemini(apiKey, [{ role: "user", content: prompt }],
      "You generate personalized habit protocols. Respond only in JSON.", true)
      .then(({ text, tokensUsed }) => {
        trackTokens?.(tokensUsed);
        const cleaned = text.replace(/```json|```/g, "").trim();
        const newHabits = JSON.parse(cleaned);
        setState((s) => ({
          ...s,
          habits: [
            ...s.habits,
            ...newHabits.map(h => ({ ...h, addedBy: "ritmof" })),
          ],
          habitsInitialized: true,
        }));
        showBanner("RITMOF has initialized your protocol stack.", "success");
      })
      .catch(() => {
        setState((s) => ({ ...s, habitsInitialized: true }));
        showBanner("Could not load personalized habits. Using defaults.", "info");
      })
      .finally(() => setInitializing(false));
  }, [state.habitsInitialized, apiKey]);

  function deleteHabit(id) {
    setState((s) => ({ ...s, habits: s.habits.filter((h) => h.id !== id) }));
    showBanner("Habit protocol removed.", "info");
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px" }}>PROTOCOL LOG</div>
        <div style={{ fontSize: "20px", fontWeight: "bold", marginTop: "2px" }}>HABITS</div>
        <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>
          {todayLog.length}/{state.habits.length} completed today
        </div>
      </div>

      {initializing && (
        <div style={{
          border: "1px solid #333", padding: "14px", fontFamily: "'Share Tech Mono', monospace",
          fontSize: "11px", color: "#666", textAlign: "center",
          background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
        }}>
          <div style={{ marginBottom: "6px" }}>◈ RITMOF ANALYZING HUNTER PROFILE...</div>
          <div style={{ fontSize: "10px", color: "#444" }}>Generating personalized protocol stack</div>
        </div>
      )}

      {/* Streak bonus indicator */}
      {state.streak >= 3 && (
        <div style={{
          border: "1px solid #555", padding: "8px 12px",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>STREAK BONUS ACTIVE</span>
          <span>{state.streak >= 7 ? "+50% XP" : "+25% XP"}</span>
        </div>
      )}

      {categories.map((cat) => {
        const catHabits = state.habits.filter((h) => h.category === cat);
        if (!catHabits.length) return null;
        return (
          <div key={cat}>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555", letterSpacing: "3px", marginBottom: "8px", textTransform: "uppercase" }}>
              ── {cat} ──────────────
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {catHabits.map((habit) => {
                const done = todayLog.includes(habit.id);
                const s = STYLE_CSS[habit.style] || STYLE_CSS.ascii;
                return (
                  <div key={habit.id} style={{
                    border: done ? "1px solid #fff" : s.border,
                    background: done ? "#fff" : s.background,
                    padding: "12px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    position: "relative", overflow: "hidden",
                  }}>
                    <GeometricCorners style={done ? "none" : habit.style} small />
                    <button
                      onClick={(e) => !done && logHabit(habit.id, e)}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        flex: 1, background: "none", border: "none",
                        color: done ? "#000" : "#e8e8e8",
                        fontFamily: s.fontFamily, cursor: done ? "default" : "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "20px", width: "24px", textAlign: "center" }}>{done ? "✓" : habit.icon}</span>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: done ? "bold" : "normal", textDecoration: done ? "line-through" : "none" }}>
                          {habit.label}
                        </div>
                        <div style={{ fontSize: "10px", color: done ? "#666" : "#555", marginTop: "1px" }}>
                          +{habit.xp} XP {habit.addedBy === "ritmof" ? "· RITMOF" : ""}
                          {habit.desc && !done ? ` · ${habit.desc}` : ""}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => deleteHabit(habit.id)}
                      style={{ color: done ? "#666" : "#444", fontSize: "14px", padding: "4px", background: "none", border: "none" }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TASKS TAB
// ═══════════════════════════════════════════════════════════════
function TasksTab({ state, setState, awardXP, showBanner, checkMissions }) {
  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: "", course: "", due: "" });
  const [activeSection, setActiveSection] = useState("tasks");

  const activeTasks = (state.tasks || []).filter((t) => !t.done);
  const doneTasks = (state.tasks || []).filter((t) => t.done);
  const activeGoals = (state.goals || []).filter((g) => !g.done);

  function addTask() {
    if (!newTask.trim()) return;
    setState((s) => ({
      ...s,
      tasks: [...(s.tasks || []), { id: Date.now(), text: newTask, priority: newPriority, done: false, addedBy: "user" }],
    }));
    setNewTask("");
  }

  function completeTask(id, event) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => t.id === id ? { ...t, done: true, doneDate: today() } : t),
    }));
    awardXP(25, event);
    checkMissions("task");
    showBanner("Task complete. +25 XP", "success");
  }

  function deleteTask(id) {
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  }

  function addGoal() {
    if (!goalForm.title) return;
    setState((s) => ({
      ...s,
      goals: [...(s.goals || []), { id: Date.now(), ...goalForm, done: false, addedBy: "user", submissionCount: 0 }],
    }));
    setGoalForm({ title: "", course: "", due: "" });
    setShowGoalForm(false);
    showBanner(`Goal logged: ${goalForm.title}`, "success");
  }

  function submitGoal(id) {
    setState((s) => ({
      ...s,
      goals: s.goals.map((g) => g.id === id ? { ...g, submissionCount: (g.submissionCount || 0) + 1, done: true, doneDate: today() } : g),
    }));
    awardXP(50, null, true);
    showBanner("Goal submitted. +50 XP", "success");
  }

  const priorityColor = { low: "#444", medium: "#888", high: "#fff" };
  const priorityLabel = { low: "▁", medium: "▃", high: "█" };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px" }}>MISSION CONTROL</div>
        <div style={{ fontSize: "20px", fontWeight: "bold", marginTop: "2px" }}>TASKS & GOALS</div>
      </div>

      {/* Section toggle */}
      <div style={{ display: "flex", gap: "0", border: "1px solid #333" }}>
        {["tasks", "goals"].map((s) => (
          <button key={s} onClick={() => setActiveSection(s)} style={{
            flex: 1, padding: "8px",
            background: activeSection === s ? "#fff" : "transparent",
            color: activeSection === s ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px",
            border: "none", cursor: "pointer",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {activeSection === "tasks" && (
        <>
          {/* Add task */}
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="New task..."
              style={{ flex: 1, background: "#111", border: "1px solid #333", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              style={{ background: "#111", border: "1px solid #333", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
            >
              <option value="low">LOW</option>
              <option value="medium">MED</option>
              <option value="high">HIGH</option>
            </select>
            <button onClick={addTask} style={{ padding: "8px 14px", background: "#fff", color: "#000", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", border: "none" }}>+</button>
          </div>

          {/* Active tasks */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeTasks.length === 0 && (
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", padding: "12px", border: "1px dashed #222", textAlign: "center" }}>
                No active tasks. RITMOF will assign missions.
              </div>
            )}
            {activeTasks.map((task) => (
              <div key={task.id} style={{
                border: "1px solid #222", padding: "10px 12px",
                fontFamily: "'Share Tech Mono', monospace",
                display: "flex", alignItems: "center", gap: "10px",
                background: "#0d0d0d",
              }}>
                <button onClick={(e) => completeTask(task.id, e)} style={{ color: "#555", fontSize: "16px", background: "none", border: "1px solid #333", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ○
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", color: "#e8e8e8" }}>{task.text}</div>
                  <div style={{ fontSize: "9px", color: "#444", marginTop: "2px" }}>
                    {priorityLabel[task.priority]} {task.priority?.toUpperCase()} {task.due ? `· due ${task.due}` : ""} {task.addedBy === "ritmof" ? "· RITMOF" : ""}
                  </div>
                </div>
                <button onClick={() => deleteTask(task.id)} style={{ color: "#333", fontSize: "14px", background: "none", border: "none" }}>×</button>
              </div>
            ))}
          </div>

          {/* Done tasks */}
          {doneTasks.length > 0 && (
            <div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#333", letterSpacing: "2px", marginBottom: "6px" }}>COMPLETED</div>
              {doneTasks.slice(-5).map((task) => (
                <div key={task.id} style={{ padding: "8px 0", borderBottom: "1px solid #111", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ textDecoration: "line-through" }}>✓ {task.text}</span>
                  <button onClick={() => deleteTask(task.id)} style={{ color: "#333", background: "none", border: "none", fontSize: "12px" }}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeSection === "goals" && (
        <>
          <button onClick={() => setShowGoalForm(!showGoalForm)} style={{ padding: "10px", border: "1px solid #333", background: "transparent", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px" }}>
            {showGoalForm ? "CANCEL" : "+ ADD GOAL / HOMEWORK"}
          </button>

          {showGoalForm && (
            <div style={{ border: "1px solid #333", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <input
                value={goalForm.title}
                onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Assignment / goal title..."
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <input
                value={goalForm.course}
                onChange={(e) => setGoalForm((f) => ({ ...f, course: e.target.value }))}
                placeholder="Course name..."
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <input
                type="date"
                value={goalForm.due}
                onChange={(e) => setGoalForm((f) => ({ ...f, due: e.target.value }))}
                style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", outline: "none" }}
              />
              <button onClick={addGoal} style={primaryBtn}>ADD GOAL</button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {activeGoals.length === 0 && (
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#444", padding: "12px", border: "1px dashed #222", textAlign: "center" }}>
                No active goals. Tell RITMOF about your homework.
              </div>
            )}
            {activeGoals.map((goal) => {
              const daysLeft = goal.due ? Math.ceil((new Date(goal.due) - Date.now()) / 86400000) : null;
              return (
                <div key={goal.id} style={{
                  border: "1px solid #333", padding: "12px",
                  fontFamily: "'Share Tech Mono', monospace",
                  background: "#0d0d0d",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", marginBottom: "2px" }}>{goal.title}</div>
                      <div style={{ fontSize: "10px", color: "#555" }}>
                        {goal.course && `${goal.course} · `}
                        {daysLeft !== null && (daysLeft <= 0 ? "OVERDUE" : `${daysLeft}d left`)}
                      </div>
                      {goal.submissionCount > 0 && (
                        <div style={{ fontSize: "9px", color: "#444", marginTop: "2px" }}>
                          Submissions: {goal.submissionCount} {goal.submissionCount >= 2 ? "· TA visit recommended" : ""}
                        </div>
                      )}
                    </div>
                    <button onClick={() => submitGoal(goal.id)} style={{ padding: "4px 8px", border: "1px solid #555", background: "transparent", color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px" }}>
                      SUBMIT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CHAT TAB (RITMOF)
// ═══════════════════════════════════════════════════════════════
function ChatTab({ state, setState, profile, apiKey, executeCommands, showBanner, buildSystemPrompt, checkMissions, awardXP, trackTokens }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);

  const messages = state.chatHistory || [];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    checkMissions("chat");
  }, [messages.length]);

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    if (!apiKey) { showBanner("No Gemini API key configured.", "alert"); return; }

    const userMsg = { role: "user", content: text, ts: Date.now() };
    const newHistory = [...messages, userMsg];
    setState((s) => ({ ...s, chatHistory: newHistory }));
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(state, profile);
      // Only send last 10 messages to avoid context overflow
      const apiMessages = newHistory.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      const { text: raw, tokensUsed } = await callGemini(apiKey, apiMessages, systemPrompt, true);
      trackTokens?.(tokensUsed);

      // Robust JSON extraction: find first { ... } block
      let parsed;
      try {
        // Try direct parse first
        const cleaned = raw.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        // Try extracting JSON object from text
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          // Fallback: treat entire raw as message
          parsed = { message: raw, commands: [] };
        }
      }

      const assistantMsg = {
        role: "assistant",
        content: parsed.message || parsed.text || String(parsed),
        ts: Date.now()
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, assistantMsg] }));

      if (parsed.commands?.length) {
        setTimeout(() => executeCommands(parsed.commands), 300);
      }
    } catch (e) {
      console.error("RITMOF error:", e);
      const errMsg = {
        role: "assistant",
        content: `Connection error: ${e.message}. Check your API key in Profile → Settings.`,
        ts: Date.now()
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, errMsg] }));
    }
    setLoading(false);
  }

  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { showBanner("Voice input not supported on this device.", "info"); return; }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const r = new SpeechRecognition();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      sendMessage(transcript);
      setIsListening(false);
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
    setIsListening(true);
  }

  const chips = [
    "What should I focus on today?",
    "Assign me study tasks",
    "How's my progress?",
    "I just finished my homework",
    "Motivate me",
  ];

  return (
    <div style={{ height: "calc(100vh - 56px - 60px)", display: "flex", flexDirection: "column" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◈</div>
            <div style={{ fontSize: "14px", marginBottom: "6px" }}>RITMOF ONLINE</div>
            <div style={{ fontSize: "11px", color: "#555" }}>System ready. Awaiting Hunter input.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} />
        ))}
        {loading && (
          <div style={{ display: "flex", gap: "6px", padding: "8px 0" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                width: "6px", height: "6px", background: "#555",
                animation: `pulse 1s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length < 3 && (
        <div style={{ padding: "0 16px 8px", display: "flex", gap: "6px", overflowX: "auto" }}>
          {chips.map((c) => (
            <button key={c} onClick={() => sendMessage(c)} style={{
              padding: "6px 12px", border: "1px solid #333",
              background: "transparent", color: "#777",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
              whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0,
            }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Message RITMOF..."
          rows={2}
          style={{
            flex: 1, background: "#111", border: "1px solid #222",
            color: "#e8e8e8", padding: "10px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px",
            outline: "none", resize: "none", borderRadius: "0",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <button onClick={toggleVoice} style={{
            width: "40px", height: "40px", border: `1px solid ${isListening ? "#fff" : "#333"}`,
            background: isListening ? "#fff" : "transparent",
            color: isListening ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
          }}>
            {isListening ? "■" : "◎"}
          </button>
          <button onClick={() => sendMessage(input)} disabled={loading} style={{
            width: "40px", height: "40px", border: "1px solid #555",
            background: loading ? "#111" : "#fff",
            color: loading ? "#333" : "#000",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
          }}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg }) {
  const isRitmof = msg.role === "assistant";
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isRitmof ? "flex-start" : "flex-end",
      gap: "3px",
    }}>
      {isRitmof && (
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px" }}>
          RITMOF ◈
        </div>
      )}
      <div style={{
        maxWidth: "85%", padding: "10px 12px",
        background: isRitmof ? "#0d0d0d" : "#1a1a1a",
        border: isRitmof ? "1px solid #222" : "1px solid #333",
        fontFamily: isRitmof ? "'Share Tech Mono', monospace" : "'Share Tech Mono', monospace",
        fontSize: "13px", lineHeight: "1.5", color: "#e8e8e8",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════
function ProfileTab({ state, setState, profile, level, rank, awardXP, showBanner, showToast, unlockAchievement, executeCommands, apiKey, buildSystemPrompt, syncStatus, lastSynced, onSync, dropboxConnected, dropboxAppKey, onDisconnectDropbox, theme, setTheme }) {
  const [section, setSection] = useState("overview");
  const [showGacha, setShowGacha] = useState(false);

  const sections = ["overview", "achievements", "calendar", "gacha", "settings"];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* XP card */}
      <div style={{
        border: "2px solid #fff", padding: "20px",
        background: "linear-gradient(45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(-45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px, linear-gradient(-45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px",
        position: "relative",
      }}>
        <GeometricCorners style="geometric" />
        <div style={{ fontFamily: "'Share Tech Mono', monospace", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#666", letterSpacing: "3px" }}>HUNTER CARD</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", margin: "6px 0" }}>{profile.name}</div>
          <div style={{ fontSize: "13px", color: "#aaa" }}>{rank.decor} {rank.title}</div>
          <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{profile.major}</div>
          <div style={{ margin: "16px 0 4px", fontSize: "11px", color: "#555", display: "flex", justifyContent: "space-between" }}>
            <span>LEVEL {level}</span><span>{getLevelProgress(state.xp)}/{XP_PER_LEVEL} XP</span>
          </div>
          <div style={{ height: "4px", background: "#111" }}>
            <div style={{ width: `${(getLevelProgress(state.xp) / XP_PER_LEVEL) * 100}%`, height: "100%", background: "#fff", transition: "width 0.5s" }} />
          </div>
          <div style={{ fontSize: "28px", marginTop: "8px" }}>{rank.badge}</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", marginTop: "4px" }}>{state.xp} XP</div>
        </div>
      </div>

      {/* Section nav */}
      <div style={{ display: "flex", gap: "4px", overflowX: "auto" }}>
        {sections.map((s) => (
          <button key={s} onClick={() => setSection(s)} style={{
            padding: "6px 12px", border: `1px solid ${section === s ? "#fff" : "#333"}`,
            background: section === s ? "#fff" : "transparent",
            color: section === s ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", letterSpacing: "1px",
            whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {section === "overview" && <ProfileOverview state={state} profile={profile} level={level} rank={rank} />}
      {section === "achievements" && <AchievementsSection state={state} />}
      {section === "calendar" && <CalendarSection state={state} setState={setState} profile={profile} apiKey={apiKey} buildSystemPrompt={buildSystemPrompt} showBanner={showBanner} executeCommands={executeCommands} />}
      {section === "gacha" && <GachaSection state={state} setState={setState} profile={profile} apiKey={apiKey} showBanner={showBanner} showToast={showToast} />}
      {section === "settings" && <SettingsSection profile={profile} setState={setState} showBanner={showBanner} syncStatus={syncStatus} lastSynced={lastSynced} onSync={onSync} dropboxConnected={dropboxConnected} dropboxAppKey={dropboxAppKey} onDisconnectDropbox={onDisconnectDropbox} theme={theme} setTheme={setTheme} />}
    </div>
  );
}

function ProfileOverview({ state, profile, level, rank }) {
  const totalSessions = (state.sessions || []).length;
  const totalHabitsLogged = Object.values(state.habitLog || {}).reduce((acc, arr) => acc + arr.length, 0);
  const totalTasksDone = (state.tasks || []).filter((t) => t.done).length;
  const studyHours = (state.sessions || []).reduce((acc, s) => acc + (s.duration || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {[
          { label: "TOTAL XP", value: state.xp },
          { label: "LEVEL", value: level },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "SHIELDS", value: state.streakShields },
          { label: "HABITS LOGGED", value: totalHabitsLogged },
          { label: "TASKS DONE", value: totalTasksDone },
          { label: "SESSIONS", value: totalSessions },
          { label: "STUDY HRS", value: `${Math.round(studyHours / 60)}h` },
        ].map((s) => (
          <div key={s.label} style={{ border: "1px solid #1a1a1a", padding: "10px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "8px", color: "#444", letterSpacing: "1px", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Rank ladder */}
      <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "10px" }}>RANK LADDER</div>
        {RANKS.map((r) => (
          <div key={r.title} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "5px 0", borderBottom: "1px solid #0f0f0f",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
            color: level >= r.min ? "#fff" : "#333",
          }}>
            <span>{level >= r.min ? "✓" : "○"} {r.title}</span>
            <span style={{ fontSize: "10px", color: "#444" }}>{r.decor} LV.{r.min}</span>
          </div>
        ))}
      </div>

      {/* Semester goal */}
      {profile.semesterGoal && (
        <div style={{ border: "1px solid #222", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "6px" }}>SEMESTER OBJECTIVE</div>
          <div style={{ fontSize: "13px", fontStyle: "italic", color: "#aaa", fontFamily: "'IM Fell English', serif" }}>
            "{profile.semesterGoal}"
          </div>
        </div>
      )}
    </div>
  );
}

function AchievementsSection({ state }) {
  const achievements = state.achievements || [];
  const rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };

  const sorted = [...achievements].sort((a, b) => (rarityOrder[a.rarity] || 3) - (rarityOrder[b.rarity] || 3));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#444" }}>
        {achievements.length} UNLOCKED
      </div>
      {achievements.length === 0 && (
        <div style={{ border: "1px dashed #222", padding: "24px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
          No achievements yet. RITMOF is watching.
        </div>
      )}
      {sorted.map((ach) => {
        const r = ACHIEVEMENT_RARITIES[ach.rarity] || ACHIEVEMENT_RARITIES.common;
        return (
          <div key={ach.id} style={{
            border: `1px solid ${r.glow}`, padding: "12px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#0a0a0a",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "24px" }}>{ach.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px" }}>{ach.title}</span>
                  <span style={{ fontSize: "8px", color: r.glow, letterSpacing: "1px" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{ach.desc}</div>
                {ach.flavorText && (
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "4px", fontStyle: "italic", fontFamily: "'IM Fell English', serif" }}>
                    "{ach.flavorText}"
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarSection({ state, setState, profile, apiKey, buildSystemPrompt, showBanner, executeCommands }) {
  const [form, setForm] = useState({ title: "", type: "exam", start: "", end: "" });
  const [gCalLoading, setGCalLoading] = useState(false);

  const events = [...(state.calendarEvents || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  const typeColors = { exam: "#fff", lecture: "#aaa", homework: "#888", tirgul: "#777", other: "#555" };

  function addEvent() {
    if (!form.title || !form.start) return;
    const newEvent = { id: `manual_${Date.now()}`, ...form, source: "manual" };
    setState((s) => ({ ...s, calendarEvents: [...(s.calendarEvents || []), newEvent] }));
    showBanner(`Event added: ${form.title}`, "success");

    // Let RITMOF react
    if (apiKey && form.type === "exam") {
      const days = Math.ceil((new Date(form.start) - Date.now()) / 86400000);
      showBanner(`Exam detected: ${form.title} in ${days} days. RITMOF adapting your plan.`, "alert");
    }
    setForm({ title: "", type: "exam", start: "", end: "" });
  }

  async function syncGoogleCalendar() {
    if (!profile?.googleClientId) { showBanner("No Google Client ID configured.", "alert"); return; }
    setGCalLoading(true);
    try {
      await initGoogleCalendar(profile.googleClientId);
      const auth = window.gapi.auth2.getAuthInstance();
      if (!auth.isSignedIn.get()) await auth.signIn();
      const events = await fetchGCalEvents();
      setState((s) => {
        const manualEvents = (s.calendarEvents || []).filter((e) => e.source === "manual");
        return { ...s, calendarEvents: [...manualEvents, ...events], gCalConnected: true };
      });
      showBanner(`Synced ${events.length} events from Google Calendar.`, "success");
    } catch (e) {
      let msg = e?.error?.message ?? e?.result?.error?.message ?? e?.message ?? e?.reason;
      if (msg == null && e && typeof e === "object") {
        const err = e?.error ?? e?.result?.error;
        if (typeof err === "string") msg = err;
        else if (err && typeof err === "object") msg = err.message ?? err.error_description ?? JSON.stringify(err).slice(0, 100);
        else {
          const d = e?.details?.[0];
          msg = d?.message ?? d?.description ?? (d ? JSON.stringify(d) : null);
        }
      }
      if (msg == null) msg = typeof e === "string" ? e : (e && typeof e === "object" ? JSON.stringify(e).slice(0, 80) : String(e));
      const short = msg.length > 60 ? msg.slice(0, 57) + "…" : msg;
      showBanner(`Calendar sync failed: ${short} Check Client ID and authorized origins in Google Cloud Console.`, "alert");
    }
    setGCalLoading(false);
  }

  function deleteEvent(id) {
    setState((s) => ({ ...s, calendarEvents: (s.calendarEvents || []).filter((e) => e.id !== id) }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <button onClick={syncGoogleCalendar} disabled={gCalLoading} style={{
        padding: "10px", border: "1px solid #555",
        background: state.gCalConnected ? "#1a1a1a" : "transparent",
        color: state.gCalConnected ? "#aaa" : "#888",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px",
      }}>
        {gCalLoading ? "SYNCING..." : state.gCalConnected ? "✓ GOOGLE CALENDAR SYNCED" : "SYNC GOOGLE CALENDAR"}
      </button>

      {/* Add manual event */}
      <div style={{ border: "1px solid #222", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px" }}>ADD EVENT</div>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Event title..."
          style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", outline: "none" }}
        />
        <div style={{ display: "flex", gap: "6px" }}>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            style={{ flex: 1, background: "#111", border: "1px solid #222", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
          >
            <option value="exam">EXAM</option>
            <option value="lecture">LECTURE</option>
            <option value="tirgul">TIRGUL</option>
            <option value="homework">HOMEWORK</option>
            <option value="other">OTHER</option>
          </select>
          <input
            type="datetime-local"
            value={form.start}
            onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
            style={{ flex: 2, background: "#111", border: "1px solid #222", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
          />
        </div>
        <button onClick={addEvent} style={primaryBtn}>ADD EVENT</button>
      </div>

      {/* Events list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {events.length === 0 && (
          <div style={{ border: "1px dashed #222", padding: "16px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
            No events. Sync calendar or add manually.
          </div>
        )}
        {events.map((ev) => {
          const daysLeft = Math.ceil((new Date(ev.start) - Date.now()) / 86400000);
          return (
            <div key={ev.id} style={{
              border: `1px solid ${typeColors[ev.type] || "#333"}`, padding: "10px",
              fontFamily: "'Share Tech Mono', monospace",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "12px" }}>{ev.title}</div>
                <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>
                  {ev.type?.toUpperCase()} · {new Date(ev.start).toLocaleDateString()}
                  {daysLeft >= 0 && daysLeft <= 14 && <span style={{ color: daysLeft <= 3 ? "#fff" : "#888" }}> · {daysLeft}d</span>}
                </div>
              </div>
              <button onClick={() => deleteEvent(ev.id)} style={{ color: "#333", background: "none", border: "none", fontSize: "14px" }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GachaSection({ state, setState, profile, apiKey, showBanner, showToast }) {
  const [pulling, setPulling] = useState(false);
  const [lastPull, setLastPull] = useState(null);
  const [showCollection, setShowCollection] = useState(false);
  const collection = state.gachaCollection || [];
  const canAfford = state.xp >= GACHA_COST;

  async function doPull() {
    if (!canAfford || pulling || !apiKey) {
      if (!canAfford) showBanner(`Insufficient XP. Need ${GACHA_COST} XP to pull.`, "alert");
      if (!apiKey) showBanner("No API key. Configure in settings.", "alert");
      return;
    }
    setPulling(true);

    try {
      const prompt = `Generate a gacha pull for a STEM university student.
Hunter profile: ${JSON.stringify({ name: profile.name, books: profile.books, interests: profile.interests, major: profile.major })}
Existing collection (don't duplicate): ${JSON.stringify(collection.map(c => c.id))}

Generate ONE of these (weighted random — 60% rank_cosmetic, 40% chronicle):

For rank_cosmetic: a black-and-white ASCII/geometric/typewriter/dot-matrix rank badge/crest design for this hunter. Make it unique and beautiful. Style must match their interests.

For chronicle: Write a vivid, atmospheric scene or passage from one of the hunter's favorite books (${profile.books}). Write it as a beautifully typeset literary fragment — original prose inspired by the style and world of that book. 200-300 words. Include the book/author it's inspired by.

Respond ONLY with JSON:
{
  "id": "unique_id_string",
  "type": "rank_cosmetic | chronicle",
  "rarity": "common | rare | epic | legendary",
  "title": "...",
  "content": "...",
  "style": "ascii | dots | geometric | typewriter",
  "source": "book or author name (for chronicles)",
  "asciiArt": "3-5 lines of ASCII/character art for cosmetics (null for chronicles)"
}`;

      const { text: raw, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You are a master of literary atmosphere and ASCII art. Respond only in JSON.", true);
      // Note: gacha doesn't have trackTokens access here — tokens tracked at App level via state
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const card = JSON.parse(cleaned);

      if (collection.find(c => c.id === card.id)) {
        showBanner("Already collected. XP refunded.", "info");
        setPulling(false);
        return;
      }

      setState((s) => ({
        ...s,
        xp: Math.max(0, s.xp - GACHA_COST),
        gachaCollection: [...(s.gachaCollection || []), { ...card, pulledAt: Date.now() }],
      }));
      setLastPull(card);
      showToast({ icon: card.type === "chronicle" ? "≡" : "◈", title: card.title, desc: card.rarity.toUpperCase() + " PULL", rarity: card.rarity, isAchievement: false });
    } catch (e) {
      showBanner("Pull failed. System error.", "alert");
    }
    setPulling(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Gacha machine */}
      <div style={{
        border: "2px solid #fff", padding: "24px", textAlign: "center",
        background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
        fontFamily: "'Share Tech Mono', monospace", position: "relative",
      }}>
        <GeometricCorners style="geometric" />
        <div style={{ fontSize: "11px", color: "#555", letterSpacing: "3px" }}>CHRONICLE ENGINE</div>
        <div style={{ fontSize: "40px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
          {canAfford ? `${GACHA_COST} XP per pull` : `Need ${GACHA_COST - state.xp} more XP`}
        </div>
        <button
          onClick={doPull}
          disabled={!canAfford || pulling}
          style={{
            width: "100%", padding: "14px",
            background: canAfford && !pulling ? "#fff" : "#1a1a1a",
            color: canAfford && !pulling ? "#000" : "#444",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "2px",
            border: "none", cursor: canAfford && !pulling ? "pointer" : "default",
          }}
        >
          {pulling ? "PULLING..." : `PULL — ${GACHA_COST} XP`}
        </button>
        <div style={{ fontSize: "10px", color: "#333", marginTop: "8px" }}>
          {collection.length} cards collected
        </div>
      </div>

      {/* Last pull display */}
      {lastPull && <GachaCard card={lastPull} />}

      {/* Collection toggle */}
      <button onClick={() => setShowCollection(!showCollection)} style={{
        padding: "10px", border: "1px solid #333", background: "transparent",
        color: "#666", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
      }}>
        {showCollection ? "HIDE COLLECTION" : `VIEW COLLECTION (${collection.length})`}
      </button>

      {showCollection && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {collection.length === 0 && (
            <div style={{ border: "1px dashed #222", padding: "20px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
              No cards yet. Pull to collect.
            </div>
          )}
          {[...collection].reverse().map((card) => (
            <GachaCard key={card.id} card={card} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function GachaCard({ card, compact }) {
  const [expanded, setExpanded] = useState(!compact);
  const styleMap = STYLE_CSS;
  const s = styleMap[card.style] || styleMap.ascii;
  const r = ACHIEVEMENT_RARITIES[card.rarity] || ACHIEVEMENT_RARITIES.common;

  return (
    <div style={{
      border: `1px solid ${r.glow}`, padding: "16px",
      background: s.background, fontFamily: s.fontFamily,
      cursor: compact ? "pointer" : "default",
    }} onClick={() => compact && setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px" }}>{card.title}</div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555", marginTop: "2px" }}>
            {card.type === "chronicle" ? `CHRONICLE · ${card.source}` : "RANK COSMETIC"} · {r.label}
          </div>
        </div>
        {compact && <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#444" }}>{expanded ? "▲" : "▼"}</span>}
      </div>

      {expanded && (
        <>
          {card.asciiArt && (
            <pre style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#aaa", margin: "8px 0", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>
              {card.asciiArt}
            </pre>
          )}
          <div style={{ fontSize: "13px", lineHeight: "1.7", color: "#ccc", marginTop: "8px", whiteSpace: "pre-wrap" }}>
            {card.content}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsSection({ profile, setState, showBanner, syncStatus, lastSynced, onSync, dropboxConnected, dropboxAppKey, onDisconnectDropbox, theme, setTheme }) {
  const [geminiKey, setGeminiKey] = useState(profile?.geminiKey || "");
  const [gcalId, setGcalId] = useState(profile?.googleClientId || "");
  const [appKey, setAppKey] = useState(dropboxAppKey || LS.get(DB_APPKEY_KEY, "") || "");

  function save() {
    setState((s) => ({ ...s, profile: { ...s.profile, geminiKey, googleClientId: gcalId }, dropboxAppKey: appKey }));
    if (appKey) LS.set(DB_APPKEY_KEY, appKey);
    showBanner("Settings saved.", "success");
  }

  function connectDropbox() {
    if (!appKey.trim()) { showBanner("Enter your Dropbox App Key first.", "alert"); return; }
    LS.set(DB_APPKEY_KEY, appKey.trim());
    startDropboxOAuth(appKey.trim());
  }

  function resetAll() {
    if (window.confirm("Reset ALL data? This cannot be undone.")) {
      localStorage.clear();
      window.location.reload();
    }
  }

  const syncLabel = syncStatus === "syncing" ? "SYNCING..." :
    syncStatus === "synced" && lastSynced ? `SYNCED ${new Date(lastSynced).toLocaleTimeString()}` :
    syncStatus === "error" ? "⚠ SYNC ERROR" : "SYNC NOW";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
      <div style={{ fontSize: "9px", color: "var(--muted)", letterSpacing: "2px" }}>APPEARANCE</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          style={{
            flex: 1, padding: "10px", border: `2px solid ${theme === "dark" ? "#fff" : "var(--border2)"}`,
            background: theme === "dark" ? "#fff" : "transparent",
            color: theme === "dark" ? "#000" : "var(--muted3)",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
          }}
        >
          DARK
        </button>
        <button
          type="button"
          onClick={() => setTheme("light")}
          style={{
            flex: 1, padding: "10px", border: `2px solid ${theme === "light" ? "#000" : "var(--border2)"}`,
            background: theme === "light" ? "#000" : "transparent",
            color: theme === "light" ? "#fff" : "var(--muted3)",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
          }}
        >
          LIGHT
        </button>
      </div>

      <div style={{ height: "1px", background: "var(--border)", margin: "8px 0" }} />
      <div style={{ fontSize: "9px", color: "var(--muted)", letterSpacing: "2px" }}>API CONFIGURATION</div>
      <GeminiSetupGuide />
      <label style={{ fontSize: "10px", color: "#666" }}>GEMINI API KEY</label>
      <input
        type="password" value={geminiKey}
        onChange={(e) => setGeminiKey(e.target.value)}
        style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", outline: "none" }}
      />
      <GoogleCalendarGuide />
      <label style={{ fontSize: "10px", color: "#666" }}>GOOGLE CLIENT ID (optional)</label>
      <input
        type="text" value={gcalId}
        onChange={(e) => setGcalId(e.target.value)}
        style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", outline: "none" }}
      />

      <div style={{ height: "1px", background: "#1a1a1a", margin: "4px 0" }} />
      <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px" }}>DROPBOX SYNC</div>
      <DropboxSetupGuide />

      {!dropboxConnected ? (
        <>
          <label style={{ fontSize: "10px", color: "#666" }}>DROPBOX APP KEY</label>
          <input
            type="text" value={appKey} placeholder="e.g. abc123xyz456"
            onChange={(e) => setAppKey(e.target.value)}
            style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", outline: "none" }}
          />
          <button onClick={connectDropbox} style={{
            padding: "10px", border: "2px solid #fff", background: "#fff", color: "#000",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px",
            cursor: "pointer",
          }}>
            CONNECT DROPBOX →
          </button>
        </>
      ) : (
        <div style={{ border: "1px solid #333", padding: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", color: "#aaa" }}>✓ DROPBOX CONNECTED</span>
            <button onClick={onDisconnectDropbox} style={{
              background: "none", border: "1px solid #333", color: "#555",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", padding: "2px 8px", cursor: "pointer",
            }}>DISCONNECT</button>
          </div>
          <button onClick={onSync} style={{
            width: "100%", padding: "8px", border: "1px solid #444",
            background: "transparent", color: syncStatus === "error" ? "#888" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", letterSpacing: "1px", cursor: "pointer",
          }}>
            {syncLabel}
          </button>
        </div>
      )}

      <button onClick={save} style={primaryBtn}>SAVE SETTINGS</button>

      <div style={{ marginTop: "12px", padding: "12px", border: "1px dashed #222" }}>
        <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "8px" }}>DEPLOY GUIDE</div>
        <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.8" }}>
          1. Push this repo to GitHub<br />
          2. Connect to Vercel (free tier)<br />
          3. Deploy — done. No server needed.<br />
          4. Add Vercel URL as redirect URI in your Dropbox app.<br />
          5. Connect Dropbox above — stays connected permanently.
        </div>
      </div>

      <button onClick={resetAll} style={{
        marginTop: "8px", padding: "10px", border: "1px solid #333",
        background: "transparent", color: "#444",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
      }}>
        RESET ALL DATA
      </button>

      {ALLOWED_EMAIL && GATE_GOOGLE_CLIENT_ID && (
        <button
          onClick={() => {
            try { sessionStorage.removeItem(GATE_SESSION_KEY); } catch {}
            window.location.reload();
          }}
          style={{
            marginTop: "8px", padding: "10px", border: "1px solid #333",
            background: "transparent", color: "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          }}
        >
          SIGN OUT (LOCK APP)
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════
function Modal({ children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.92)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "100%", maxWidth: "380px", background: "#0a0a0a", border: "1px solid #333" }}>
        {children}
      </div>
    </div>
  );
}

function DailyLoginModal({ data, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "32px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "8px" }}>DAILY LOGIN</div>
        <div style={{ fontSize: "36px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "4px" }}>+{data.xp} XP</div>
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "16px" }}>
          {data.streak > 1 ? `Streak: ${data.streak} days. Pattern recognized.` : "System online. Begin."}
        </div>
        {data.streak >= 7 && (
          <div style={{ border: "1px solid #888", padding: "8px", marginBottom: "16px", fontSize: "11px", color: "#aaa" }}>
            7-DAY STREAK BONUS ACTIVE · +50% HABIT XP
          </div>
        )}
        <button onClick={onClose} style={primaryBtn}>PROCEED</button>
      </div>
    </Modal>
  );
}

function SleepCheckinModal({ onClose, onSubmit }) {
  const [hours, setHours] = useState(7);
  const [quality, setQuality] = useState(3);
  const [rested, setRested] = useState(true);

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "16px" }}>SLEEP ANALYSIS</div>
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>HOURS SLEPT</div>
          <input type="range" min={3} max={12} value={hours} onChange={(e) => setHours(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "20px", marginTop: "4px" }}>{hours}h</div>
        </div>
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>QUALITY (1-5)</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[1,2,3,4,5].map((q) => (
              <button key={q} onClick={() => setQuality(q)} style={{
                flex: 1, padding: "8px", border: `1px solid ${quality >= q ? "#fff" : "#333"}`,
                background: quality >= q ? "#fff" : "transparent", color: quality >= q ? "#000" : "#555",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
              }}>{q}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>FELT RESTED?</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[true, false].map((v) => (
              <button key={String(v)} onClick={() => setRested(v)} style={{
                flex: 1, padding: "8px", border: `1px solid ${rested === v ? "#fff" : "#333"}`,
                background: rested === v ? "#fff" : "transparent", color: rested === v ? "#000" : "#555",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
              }}>{v ? "YES" : "NO"}</button>
            ))}
          </div>
        </div>
        <button onClick={() => onSubmit({ hours, quality, rested })} style={primaryBtn}>LOG SLEEP</button>
      </div>
    </Modal>
  );
}

function ScreenTimeModal({ period, onClose, onSubmit }) {
  const [mins, setMins] = useState(90);
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "4px" }}>SCREEN TIME LOG</div>
        <div style={{ fontSize: "11px", color: "#666", marginBottom: "20px" }}>
          {period === "afternoon" ? "Morning session complete. Report usage." : "Evening check-in. How much time on your phone?"}
        </div>
        <input type="range" min={0} max={480} step={15} value={mins} onChange={(e) => setMins(+e.target.value)}
          style={{ width: "100%", accentColor: "#fff" }} />
        <div style={{ textAlign: "center", fontSize: "24px", margin: "12px 0", fontWeight: "bold" }}>
          {Math.floor(mins / 60)}h {mins % 60}m
        </div>
        <div style={{ textAlign: "center", fontSize: "10px", color: "#444", marginBottom: "20px" }}>
          {mins < 60 ? "Exemplary. Reward incoming." : mins < 120 ? "Acceptable." : mins < 240 ? "Above target. Noted." : "Hunter. This is a problem."}
        </div>
        <button onClick={() => onSubmit(mins)} style={primaryBtn}>REPORT HONESTLY</button>
      </div>
    </Modal>
  );
}

function SessionLogModal({ onClose, onSubmit, state }) {
  const [type, setType] = useState("lecture");
  const [course, setCourse] = useState("");
  const [duration, setDuration] = useState(60);
  const [focus, setFocus] = useState("medium");
  const [notes, setNotes] = useState("");

  const sessionType = SESSION_TYPES.find((s) => s.id === type) || SESSION_TYPES[0];
  const xpPreview = calcSessionXP(type, duration, focus, state.streak || 0);
  const sStyle = STYLE_CSS[sessionType.style] || STYLE_CSS.ascii;

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace", background: sStyle.background }}>
        <GeometricCorners style={sessionType.style} />
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "16px" }}>LOG STUDY SESSION</div>

        {/* Session type */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px", marginBottom: "16px" }}>
          {SESSION_TYPES.map((st) => (
            <button key={st.id} onClick={() => setType(st.id)} style={{
              padding: "8px 4px", border: `1px solid ${type === st.id ? "#fff" : "#333"}`,
              background: type === st.id ? "#fff" : "transparent",
              color: type === st.id ? "#000" : "#666",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", letterSpacing: "1px",
            }}>
              <div style={{ fontSize: "14px" }}>{st.icon}</div>
              <div style={{ marginTop: "2px" }}>{st.label.toUpperCase()}</div>
            </button>
          ))}
        </div>

        <input
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          placeholder="Course / subject..."
          style={{ ...inputStyle(sStyle), marginBottom: "12px" }}
        />

        {/* Duration */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>DURATION</div>
          <input type="range" min={15} max={300} step={15} value={duration} onChange={(e) => setDuration(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "16px", marginTop: "4px" }}>
            {Math.floor(duration / 60)}h {duration % 60}m
          </div>
        </div>

        {/* Focus */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "6px" }}>FOCUS LEVEL</div>
          <div style={{ display: "flex", gap: "4px" }}>
            {FOCUS_LEVELS.map((f) => (
              <button key={f.id} onClick={() => setFocus(f.id)} style={{
                flex: 1, padding: "8px",
                border: `1px solid ${focus === f.id ? "#fff" : "#333"}`,
                background: focus === f.id ? "#fff" : "transparent",
                color: focus === f.id ? "#000" : "#666",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
              }}>
                {f.symbol}<br />{f.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)..."
          rows={2} style={{ ...inputStyle(sStyle), marginBottom: "12px" }} />

        <div style={{ textAlign: "center", fontSize: "20px", fontWeight: "bold", marginBottom: "12px" }}>
          +{xpPreview} XP
        </div>

        <button onClick={() => onSubmit({ type, course, duration, focus, notes })} style={primaryBtn}>
          LOG SESSION
        </button>
      </div>
    </Modal>
  );
}

function LevelUpModal({ data, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "#000", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Share Tech Mono', monospace",
      animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ fontSize: "11px", color: "#444", letterSpacing: "4px", marginBottom: "16px" }}>SYSTEM ALERT</div>
      <div style={{ fontSize: "16px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>LEVEL UP</div>
      <div style={{ fontSize: "64px", fontWeight: "bold", margin: "16px 0" }}>{data.level}</div>
      <div style={{ fontSize: "24px", color: "#aaa", marginBottom: "8px" }}>{data.rank.decor}</div>
      <div style={{ fontSize: "18px", letterSpacing: "4px", marginBottom: "32px" }}>{data.rank.title.toUpperCase()}</div>
      <div style={{ fontSize: "32px", letterSpacing: "8px", marginBottom: "32px", color: "#555" }}>
        {data.rank.badge}
      </div>
      <button onClick={onClose} style={{ ...primaryBtn, width: "200px" }}>CONTINUE</button>
    </div>
  );
}

function AchievementToast({ toast, onClose }) {
  const [width, setWidth] = useState(100);
  const r = ACHIEVEMENT_RARITIES[toast.rarity] || ACHIEVEMENT_RARITIES.common;

  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      const pct = Math.max(0, 100 - ((Date.now() - start) / 5000) * 100);
      setWidth(pct);
      if (pct === 0) { clearInterval(iv); onClose(); }
    }, 50);
    return () => clearInterval(iv);
  }, [onClose]);

  return (
    <div style={{
      position: "fixed", bottom: "70px", left: "12px", right: "12px", zIndex: 900,
      border: `2px solid ${r.glow}`, background: "#0a0a0a",
      padding: "12px", fontFamily: "'Share Tech Mono', monospace",
      animation: "slideUp 0.3s ease",
      boxShadow: `0 0 20px ${r.glow}22`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "24px" }}>{toast.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "9px", color: r.glow, letterSpacing: "2px" }}>
            {toast.isAchievement ? "ACHIEVEMENT UNLOCKED" : "REWARD"} · {r.label}
          </div>
          <div style={{ fontSize: "13px", marginTop: "2px" }}>{toast.title}</div>
          <div style={{ fontSize: "11px", color: "#666", marginTop: "1px" }}>{toast.desc}</div>
          {toast.xp && <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>+{toast.xp} XP</div>}
        </div>
        <button onClick={onClose} style={{ color: "#444", fontSize: "16px", background: "none", border: "none" }}>×</button>
      </div>
      <div style={{ marginTop: "8px", height: "2px", background: "#1a1a1a" }}>
        <div style={{ width: `${width}%`, height: "100%", background: r.glow, transition: "width 0.1s linear" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DECORATIVE HELPERS
// ═══════════════════════════════════════════════════════════════
function GeometricCorners({ style, small }) {
  if (style === "geometric") {
    const s = small ? 6 : 8;
    const cornerStyle = { position: "absolute", width: s, height: s, borderColor: "#fff" };
    return (
      <>
        <div style={{ ...cornerStyle, top: 4, left: 4, borderTop: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, top: 4, right: 4, borderTop: "1px solid #fff", borderRight: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, left: 4, borderBottom: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, right: 4, borderBottom: "1px solid #fff", borderRight: "1px solid #fff" }} />
      </>
    );
  }
  if (style === "ascii") {
    return (
      <div style={{ position: "absolute", top: 4, left: 4, fontFamily: "'Share Tech Mono', monospace", fontSize: "8px", color: "#333" }}>
        {small ? ">" : ">>"}
      </div>
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CSS — E-INK SAFE
// ═══════════════════════════════════════════════════════════════
const styleEl = document.createElement("style");
styleEl.textContent = `
  @keyframes slideDown { from { transform: translateY(-20px); } to { transform: translateY(0); } }
  @keyframes slideUp   { from { transform: translateY(20px);  } to { transform: translateY(0); } }
  @keyframes fadeIn    { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pulse     { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  @keyframes spin      { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* Kill all motion on e-ink / reduced-motion preference */
  @media (prefers-reduced-motion: reduce), (update: slow) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition: none !important;
    }
  }

  /* E-ink: remove gradients, shadows, transparency */
  @media (update: slow) {
    * { background-image: none !important; box-shadow: none !important; text-shadow: none !important; }
  }

  input[type=range] { -webkit-appearance: none; height: 2px; background: #333; outline: none; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: #fff; cursor: pointer; border: 2px solid #000; }
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
  input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(1); }
  select option { background: #111; }
  * { -webkit-tap-highlight-color: transparent; }
  button { min-height: 40px; }
`;
document.head.appendChild(styleEl);

// ═══════════════════════════════════════════════════════════════
// MOUNT
// ═══════════════════════════════════════════════════════════════
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
