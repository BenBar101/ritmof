import { DATA_DISCLOSURE_SEEN_KEY, THEME_KEY } from "../constants";

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════
export const LS = {
  get: (k, def = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ls-quota-exceeded'));
      }
    }
  },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// Returns today's date in YYYY-MM-DD using LOCAL time (not UTC).
// Using toISOString() would return UTC and cause the "day" to reset at 3am for UTC+3 users.
export const today = () => new Date().toLocaleDateString("en-CA"); // en-CA locale gives YYYY-MM-DD
export const nowHour = () => new Date().getHours();
export const nowMin = () => new Date().getMinutes();

// ═══════════════════════════════════════════════════════════════
// DEV / PROD ISOLATION
// ═══════════════════════════════════════════════════════════════
export const IS_DEV = import.meta.env.DEV === true;
export const DEV_PREFIX = "ritmol_dev_";
// Public app icon (works with Vite base path for GitHub Pages).
export const APP_ICON_URL = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/icon-192.png`;

// Fix #3: prefix every key that belongs to this app in dev mode so dev and prod
// environments never share storage — not just keys that start with "jv_".
const APP_CONSTANT_KEYS = new Set([
  // Fix #8: these keys don't start with "jv_" but ARE app-owned and MUST be isolated between
  // dev and prod. Without this, a developer who dismissed the data-disclosure banner in dev
  // mode would never see it in production (the prod read would see the dev-written value).
  DATA_DISCLOSURE_SEEN_KEY,
  THEME_KEY,
  "jv_last_synced", // fix #8: isolate last-synced timestamp between dev and prod
]);

export function storageKey(k) {
  if (!IS_DEV) return k;
  if (k.startsWith("jv_") || APP_CONSTANT_KEYS.has(k)) return DEV_PREFIX + k;
  return k;
}

// ═══════════════════════════════════════════════════════════════
// GEMINI KEY (sessionStorage — never in bundle or localStorage)
// ═══════════════════════════════════════════════════════════════
// GEMINI_SESSION_KEY is intentionally NOT prefixed with "jv_" (it lives in sessionStorage,
// not localStorage), but we still apply dev/prod isolation via a direct IS_DEV check so
// a dev tab and a prod tab open simultaneously don't share the same Gemini key slot.
const GEMINI_SESSION_KEY = IS_DEV ? "ritmol_dev_gemini_key" : "ritmol_gemini_key";

export function getGeminiApiKey() {
  try { return sessionStorage.getItem(GEMINI_SESSION_KEY) || ""; } catch { return ""; }
}

export function setGeminiApiKey(key) {
  try {
    if (key && typeof key === "string" && key.trim()) {
      sessionStorage.setItem(GEMINI_SESSION_KEY, key.trim());
    } else {
      sessionStorage.removeItem(GEMINI_SESSION_KEY);
    }
  } catch {}
}
