// ═══════════════════════════════════════════════════════════════
// RITMOL CENTRAL CONFIG
// Single source of truth for all tunable operational constants.
// RULE: if changing this value requires a grep to find all callsites,
//       it belongs here. Game design values live in constants.js.
// ═══════════════════════════════════════════════════════════════

// ── App identity ───────────────────────────────────────────────
// Changing APP_BUNDLE_ID requires updating: Dropbox App Console,
// Google Cloud OAuth credentials, iOS App Group entitlement,
// capacitor.config.ts, and both native plugin registrations.
export const APP_BUNDLE_ID = "com.ritmol.app";
export const OAUTH_REDIRECT_SCHEME = "ritmol";

// ── Gemini API ─────────────────────────────────────────────────
// GEMINI_MODEL: update when Google deprecates the current model.
// Check: https://ai.google.dev/gemini-api/docs/models
export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com";
// GEMINI_API_VERSION: update when Google promotes v1beta → v1.
export const GEMINI_API_VERSION = "v1beta";
// GEMINI_REQUEST_TIMEOUT_MS: abort fetch if no response in this many ms.
export const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
// GEMINI_RATE_LIMIT_CAP: Google free tier is 15 RPM; stay 3 under for
// multi-tab headroom. Update if you upgrade to a paid tier.
export const GEMINI_RATE_LIMIT_CAP = 12;
export const GEMINI_RATE_LIMIT_WINDOW_MS = 60_000;
// GEMINI_DAILY_TOKEN_LIMIT: soft client-side daily cap for Gemini usage tokens.
// Counts **Gemini API usage tokens** (sum of usageMetadata totals per UTC day) — the
// same units Google reports; not a generic cross-provider metric.
// Google free tier is ~1M TPM / 1500 RPD; raise when you upgrade quotas.
export const GEMINI_DAILY_TOKEN_LIMIT = 80_000;
/** Same value and units as GEMINI_DAILY_TOKEN_LIMIT (legacy alias). */
export const AI_DAILY_TOKEN_LIMIT = GEMINI_DAILY_TOKEN_LIMIT;
export const GEMINI_AI_XP_LIMIT = 5_000;
// Budget for AI notification generation calls (per call, not per day).
export const GEMINI_NOTIF_INPUT_TOKENS = 300;
export const GEMINI_NOTIF_OUTPUT_TOKENS = 200;
// Suspend AI notification generation when daily tokens exceed this
// fraction of AI_DAILY_TOKEN_LIMIT (0.875 = 87.5%).
export const GEMINI_NOTIF_TOKEN_THRESHOLD = 0.875;

// ── Google OAuth ───────────────────────────────────────────────
// Gemini OAuth (PKCE + native) includes Calendar so one consent covers both.
// GIS TokenClient remains a fallback when Calendar is used without Google-for-Gemini.
// Update here if Google changes scope strings.
export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_AUTH_SCOPE_GEMINI = "https://www.googleapis.com/auth/generative-language.retriever";

// ── Google Calendar API ────────────────────────────────────────
export const GCAL_API_BASE_URL = "https://www.googleapis.com/calendar/v3";

// ── Dropbox API ────────────────────────────────────────────────
// Update these if Dropbox changes their API domain (historically stable).
export const DROPBOX_OAUTH_URL = "https://www.dropbox.com/oauth2/authorize";
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_UPLOAD_URL = "https://content.dropboxapi.com/2/files/upload";
export const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
export const DROPBOX_METADATA_URL = "https://api.dropboxapi.com/2/files/get_metadata";
export const DROPBOX_CREATE_FOLDER_URL = "https://api.dropboxapi.com/2/files/create_folder_v2";

// ── Sync ───────────────────────────────────────────────────────
// Bump SYNC_SCHEMA_VERSION when the ritmol-data.json payload shape changes
// in a backward-incompatible way. Also update the Zod schema ceiling in
// schemas.js. Old files with a lower version are rejected on Pull.
export const SYNC_SCHEMA_VERSION = 3;
export const SYNC_FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Notifications ──────────────────────────────────────────────
// Waking hours: AI notifications are only generated and scheduled
// between NOTIF_WAKING_START_HOUR and NOTIF_WAKING_END_HOUR (local time).
export const NOTIF_WAKING_START_HOUR = 8;
export const NOTIF_WAKING_END_HOUR = 22;
// How often (in hours) the app calls Gemini to generate the next
// notification batch. Must divide evenly into the waking window.
export const NOTIF_AI_INTERVAL_HOURS = 2;

// ── Widgets ────────────────────────────────────────────────────
// Debounce for widget data writes after state change — prevents
// hammering the native bridge on rapid successive setState calls.
export const WIDGET_UPDATE_DEBOUNCE_MS = 500;

// ── Limits ─────────────────────────────────────────────────────
export const MAX_HABITS_TOTAL = 100;

// Google OAuth token endpoint (operational URL — belongs in config).
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
