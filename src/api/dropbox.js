// ═══════════════════════════════════════════════════════════════
// DROPBOX API — OAuth PKCE flow + upload/download transport
// ═══════════════════════════════════════════════════════════════
// Requires VITE_DROPBOX_APP_KEY in .env (create an app at dropbox.com/developers/apps).
// REDIRECT_URI must exactly match the Redirect URI registered in the Dropbox app console.
// Web: https://your-domain.com/dropbox-callback (or localhost for dev).
// Native (Capacitor): ritmol://auth/dropbox — add both in the Dropbox app settings.
// ═══════════════════════════════════════════════════════════════
//
// SECURITY NOTE: VITE_DROPBOX_APP_KEY is inlined into the production bundle by Vite
// via import.meta.env replacement at build time. The key is therefore visible in the
// compiled JS to any user who inspects the Network tab or deobfuscates the bundle.
// This is inherent to all public-client OAuth apps (PKCE is the mitigation, not secrecy).
//
// RESIDUAL THREAT MODEL:
//   - An attacker who copies the App Key cannot complete the PKCE exchange without the
//     code_verifier stored in sessionStorage — the key alone is insufficient.
//   - Token endpoint responses (handleOAuthCallback, refreshAccessToken) may echo back
//     the client_id in error payloads; never serialize `data` from those responses into
//     thrown messages or console output (enforced: throw uses fixed error codes only).
//   - _redactAppKey() is available for any future debug-logging path that might
//     inadvertently surface the key; call it before any console.warn/error that
//     interpolates a string containing Dropbox API response data.
//
// Mitigations:
//   1. Restrict Redirect URIs to your exact production origin in the Dropbox app console.
//   2. Use "Scoped access" with files.content.read + files.content.write only.
//   3. Rotate the App Key immediately if it appears in a public repository or HAR export.
//   4. Remove the eslint-disable comment on _redactAppKey and call it in any new log path.
//
// ═══════════════════════════════════════════════════════════════

import {
  DROPBOX_OAUTH_URL,
  DROPBOX_TOKEN_URL,
  DROPBOX_UPLOAD_URL,
  DROPBOX_DOWNLOAD_URL,
  DROPBOX_METADATA_URL,
  DROPBOX_CREATE_FOLDER_URL,
  OAUTH_REDIRECT_SCHEME,
} from "../config.js";
import { ensureSocialLoginPluginsInitialized } from "./socialLoginNative.js";

const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY;

// Guard: if VITE_DROPBOX_APP_KEY was not set at build time, all Dropbox functions
// will fail with cryptic errors. Throw immediately so the misconfiguration is
// surfaced clearly in the console on first load, not buried in an OAuth callback.
if (!DROPBOX_CLIENT_ID || DROPBOX_CLIENT_ID === "undefined") {
  // Use console.warn not console.error so it doesn't trip error-monitoring alerts
  // on intentional builds where Dropbox is not used.
  console.warn(
    "[RITMOL] VITE_DROPBOX_APP_KEY is not set. " +
    "Dropbox sync will not work. " +
    "Add VITE_DROPBOX_APP_KEY to your .env file and rebuild. " +
    "See .env.example for instructions."
  );
}

// Redact the App Key from any string before it reaches a log or thrown message.
// The key is compile-time inlined; this prevents it appearing in console output.
// eslint-disable-next-line no-unused-vars -- kept for defensive use when adding debug logging
function _redactAppKey(str) {
  if (!DROPBOX_CLIENT_ID || typeof str !== "string") return str;
  return str.split(DROPBOX_CLIENT_ID).join("[app_key]");
}

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
const SYNC_FILE_PATH = "/Apps/RITMOL/ritmol-data.json";

/** Must match between authorize redirect and token exchange (web vs Capacitor native). */
export function getDropboxRedirectUri() {
  const isNative = typeof window !== "undefined" &&
    window?.Capacitor?.isNativePlatform?.();
  return isNative
    ? `${OAUTH_REDIRECT_SCHEME}://auth/dropbox`
    : `${window.location.origin}${BASE}/dropbox-callback`;
}

const PREFIX = import.meta.env.DEV ? "ritmol_dev_" : "ritmol_";
// Access token is short-lived and security-sensitive — keep in sessionStorage.
const SS_ACCESS_TOKEN = `${PREFIX}dbx_access_token`;
const SS_CODE_VERIFIER = `${PREFIX}dbx_code_verifier`;
const SS_OAUTH_STATE = `${PREFIX}dbx_oauth_state`;
const SS_LAST_REV = `${PREFIX}dbx_last_rev`;

// Refresh token and expiry live in localStorage so auth survives tab/browser close.
// The refresh token alone cannot be exchanged without the PKCE code_verifier
// (which is ephemeral / sessionStorage-only), so persisting it in localStorage
// does not materially weaken the security model beyond the access token itself.
const LS_REFRESH_TOKEN = `${PREFIX}dbx_refresh_token`;
const LS_EXPIRES_AT = `${PREFIX}dbx_expires_at`;
// Last-seen file revision — persisted in localStorage so it survives browser close.
// Previously stored in sessionStorage; migration below handles existing values.
const LS_LAST_REV = `${PREFIX}dbx_last_rev`;

// ── One-time migration: move tokens from sessionStorage → localStorage ──────
// Old code stored refresh_token and expires_at in sessionStorage, which cleared
// on browser close. This runs once at module load and migrates any existing
// values so returning users don't have to re-authenticate.
;(() => {
  try {
    // Old sessionStorage keys (same names, different storage)
    const oldRefresh  = sessionStorage.getItem(LS_REFRESH_TOKEN);
    const oldExpires  = sessionStorage.getItem(LS_EXPIRES_AT);
    const oldRev      = sessionStorage.getItem(SS_LAST_REV);
    if (oldRefresh && !localStorage.getItem(LS_REFRESH_TOKEN)) {
      localStorage.setItem(LS_REFRESH_TOKEN, oldRefresh);
      if (oldExpires) localStorage.setItem(LS_EXPIRES_AT, oldExpires);
    }
    if (oldRev && !localStorage.getItem(LS_LAST_REV)) {
      localStorage.setItem(LS_LAST_REV, oldRev);
    }
  } catch { /* ignore — storage may be unavailable */ }
})();

async function _fetchWithTimeout(url, options = {}, ms = 20_000) {
  let timeoutSignal;
  let _tid;
  let _fallbackController;

  if (typeof AbortSignal.timeout === "function") {
    timeoutSignal = AbortSignal.timeout(ms);
  } else {
    _fallbackController = new AbortController();
    _tid = setTimeout(() => _fallbackController.abort(), ms);
    timeoutSignal = _fallbackController.signal;
  }

  let effectiveSignal;
  if (options.signal) {
    effectiveSignal =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
  } else {
    effectiveSignal = timeoutSignal;
  }

  try {
    return await fetch(url, { ...options, signal: effectiveSignal });
  } finally {
    if (_tid !== undefined) clearTimeout(_tid);
  }
}

function generateCodeVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
    .slice(0, 128);
}

async function generateCodeChallenge(verifier) {
  const enc = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function getTokens() {
  try {
    const accessToken = sessionStorage.getItem(SS_ACCESS_TOKEN);
    const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
    const expiresAt = localStorage.getItem(LS_EXPIRES_AT);
    // All three must be present for a usable token set.
    // After a browser close/reopen, accessToken will be absent — callers must
    // run ensureFreshToken() first to re-hydrate the access token from the
    // refresh token before calling API functions that need Bearer auth.
    if (!accessToken || !refreshToken || !expiresAt) return null;
    if (refreshToken.length === 0) return null;
    return {
      accessToken,
      refreshToken,
      expiresAt: Number(expiresAt),
    };
  } catch {
    return null;
  }
}

/**
 * Returns true if a refresh token is stored, meaning the user has previously
 * authenticated and a new access token can be obtained without re-doing OAuth.
 * Use this for "are we connected?" checks. Use getTokens() only when you need
 * the actual access token for an API call (i.e. after ensureFreshToken()).
 */
export function hasRefreshToken() {
  try {
    const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
    return typeof refreshToken === "string" && refreshToken.length > 0;
  } catch {
    return false;
  }
}

export function setTokens({ access_token, refresh_token, expires_in }) {
  try {
    if (!access_token || typeof access_token !== "string") return;
    sessionStorage.setItem(SS_ACCESS_TOKEN, access_token);

    // Only write a new refresh_token if the incoming value is a non-empty string.
    // Fall back to the existing stored token. Never store an empty string.
    const resolvedRefresh =
      (typeof refresh_token === "string" && refresh_token.length > 0)
        ? refresh_token
        : (localStorage.getItem(LS_REFRESH_TOKEN) || null);
    if (resolvedRefresh) {
      localStorage.setItem(LS_REFRESH_TOKEN, resolvedRefresh);
    }

    const expiresAt = Date.now() + (typeof expires_in === "number" && expires_in > 0 ? expires_in : 14_400) * 1000;
    localStorage.setItem(LS_EXPIRES_AT, String(expiresAt));
  } catch {
    /* localStorage/sessionStorage unavailable */
  }
}

export function clearTokens() {
  try {
    sessionStorage.removeItem(SS_ACCESS_TOKEN);
    sessionStorage.removeItem(SS_CODE_VERIFIER);
    sessionStorage.removeItem(SS_OAUTH_STATE);
    localStorage.removeItem(LS_LAST_REV);
    localStorage.removeItem(LS_REFRESH_TOKEN);
    localStorage.removeItem(LS_EXPIRES_AT);
  } catch {
    /* ignore */
  }
}

export function isAuthenticated() {
  // True if we have a refresh token — meaning we can get a fresh access token
  // without re-doing OAuth. The access token itself may be absent after a
  // browser close (sessionStorage cleared); ensureFreshToken() handles that.
  return hasRefreshToken();
}

async function startNativeDropboxOAuthFlow() {
  await ensureSocialLoginPluginsInitialized();
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  const res = await SocialLogin.login({
    provider: "oauth2",
    options: { providerId: "dropbox" },
  });
  if (res.provider !== "oauth2") throw new Error("DROPBOX_AUTH_REQUIRED");
  const r = res.result;
  const token = r.accessToken?.token;
  if (!token) throw new Error("DROPBOX_AUTH_REQUIRED");
  const refreshToken = r.refreshToken ?? r.accessToken?.refreshToken ?? null;
  const expiresIn =
    typeof r.expiresIn === "number"
      ? r.expiresIn
      : (typeof r.accessToken?.expiresIn === "number" ? r.accessToken.expiresIn : 14_400);
  setTokens({
    access_token: token,
    refresh_token: refreshToken,
    expires_in: expiresIn,
  });
}

/**
 * Start Dropbox OAuth (web: full-page redirect; native: in-app browser / ASWebAuthenticationSession).
 */
export async function startOAuthFlow() {
  if (!DROPBOX_CLIENT_ID || DROPBOX_CLIENT_ID === "undefined") {
    throw new Error("DROPBOX_NOT_CONFIGURED");
  }
  const isNative =
    typeof window !== "undefined" && window?.Capacitor?.isNativePlatform?.();
  if (isNative) {
    await startNativeDropboxOAuthFlow();
    return;
  }

  const verifier = generateCodeVerifier();
  sessionStorage.setItem(SS_CODE_VERIFIER, verifier);

  const rawNonce = new Uint8Array(32);
  crypto.getRandomValues(rawNonce);
  const oauthState = btoa(String.fromCharCode(...rawNonce))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  sessionStorage.setItem(SS_OAUTH_STATE, oauthState);

  const challenge = await generateCodeChallenge(verifier);
  const redirectUri = getDropboxRedirectUri();
  const params = new URLSearchParams({
    client_id: DROPBOX_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
    state: oauthState,
  });
  window.location.href = `${DROPBOX_OAUTH_URL}?${params.toString()}`;
}

export function verifyOAuthState(returnedState) {
  try {
    const stored = sessionStorage.getItem(SS_OAUTH_STATE);
    sessionStorage.removeItem(SS_OAUTH_STATE);
    return (
      typeof stored === "string" &&
      stored.length > 0 &&
      stored === returnedState
    );
  } catch {
    return false;
  }
}

export async function handleOAuthCallback(code) {
  const verifier = sessionStorage.getItem(SS_CODE_VERIFIER);
  if (!verifier) throw new Error("DROPBOX_AUTH_REQUIRED");

  // PKCE public-client flow: client_id goes in the request body.
  // Do NOT send an Authorization: Basic header — Dropbox rejects it with 400
  // when there is no client secret (which there isn't for PKCE apps).
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getDropboxRedirectUri(),
    code_verifier: verifier,
    client_id: DROPBOX_CLIENT_ID,
  });

  try {
    const res = await _fetchWithTimeout(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    // NOTE: data may echo back client_id — never serialize data into a thrown message or log.
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
      throw new Error("DROPBOX_AUTH_REQUIRED");
    }
    try {
      setTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in ?? 14400,
      });
    } catch {
      // setTokens is best-effort; sessionStorage failure should not surface token values.
    }
    return true;
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  } finally {
    try {
      sessionStorage.removeItem(SS_CODE_VERIFIER);
    } catch {
      /* ignore */
    }
  }
}

export async function refreshAccessToken() {
  // Read the refresh token directly from localStorage — getTokens() would return null
  // when the access token is absent (new session), but we still need the refresh token.
  const refreshToken = (() => {
    try { return localStorage.getItem(LS_REFRESH_TOKEN); } catch { return null; }
  })();
  if (!refreshToken) throw new Error("DROPBOX_TOKEN_EXPIRED");

  // PKCE public-client flow: client_id goes in the request body.
  // Do NOT send an Authorization: Basic header — Dropbox rejects it with 400
  // when there is no client secret (which there isn't for PKCE apps).
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: DROPBOX_CLIENT_ID,
  });

  try {
    const res = await _fetchWithTimeout(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    // NOTE: data may echo back client_id — never serialize data into a thrown message or log.
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
      throw new Error("DROPBOX_TOKEN_EXPIRED");
    }
    try {
      setTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? refreshToken,
        expires_in: data.expires_in ?? 14400,
      });
    } catch {
      // setTokens is best-effort; sessionStorage failure should not surface token values.
    }
    return true;
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}

export async function ensureFreshToken() {
  // No refresh token → nothing to do (not authenticated).
  if (!hasRefreshToken()) return;
  const tokens = getTokens();
  const bufferMs = 5 * 60 * 1000;
  // Refresh if: access token is absent (new browser session, sessionStorage was cleared)
  // OR the stored token is about to expire.
  if (!tokens || tokens.expiresAt - bufferMs <= Date.now()) {
    await refreshAccessToken();
  }
}

export async function getMetadata() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  try {
    const res = await _fetchWithTimeout(DROPBOX_METADATA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: SYNC_FILE_PATH }),
  });

  if (res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err?.error?.path?.[".tag"] === "not_found") throw new Error("DROPBOX_FILE_NOT_FOUND");
    throw new Error("DROPBOX_FILE_NOT_FOUND");
  }
  if (!res.ok) throw new Error("DROPBOX_FILE_NOT_FOUND");

  const data = await res.json();
  return { rev: data.rev, size: data.size ?? 0 };
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}

export async function downloadFile() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  try {
    const res = await _fetchWithTimeout(DROPBOX_DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: SYNC_FILE_PATH }),
    },
  });

  if (res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    if (err?.error?.path?.[".tag"] === "not_found") throw new Error("DROPBOX_FILE_NOT_FOUND");
    throw new Error("DROPBOX_FILE_NOT_FOUND");
  }
  if (!res.ok) throw new Error("DROPBOX_FILE_NOT_FOUND");

  const rev = res.headers.get("Dropbox-API-Result")
    ? (() => { try { return JSON.parse(res.headers.get("Dropbox-API-Result")).rev; } catch { return null; } })()
    : null;
  if (rev) {
    try { localStorage.setItem(LS_LAST_REV, rev); } catch { /* ignore */ }
  }
  const text = await res.text();
  return { text, rev };
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}

export async function uploadFile(text) {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  const storedRev = localStorage.getItem(LS_LAST_REV);

  // Choose upload mode:
  //   - If we have a stored rev from a previous pull/push, use "update" mode
  //     with update_rev so Dropbox atomically rejects the upload if the remote
  //     file changed — no separate getMetadata() round-trip needed.
  //   - If no stored rev exists (first push), use "overwrite" mode.
  const uploadMode = storedRev
    ? { ".tag": "update", update: storedRev }
    : { ".tag": "overwrite" };

  try {
    const res = await _fetchWithTimeout(DROPBOX_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: SYNC_FILE_PATH,
          mode: uploadMode,
          autorename: false,
        }),
      },
      body: text,
    });

    if (res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
    if (res.status === 507) throw new Error("DROPBOX_QUOTA_EXCEEDED");
    if (res.status === 409) {
      const err = await res.json().catch(() => ({}));
      const tag = err?.error?.[".tag"];
      const conflictTag = err?.error?.path?.conflict?.[".tag"];
      if (tag === "too_many_write_operations" || tag === "insufficient_space" || conflictTag === "folder") {
        throw new Error("DROPBOX_QUOTA_EXCEEDED");
      }
      throw new Error("DROPBOX_CONFLICT");
    }
    if (!res.ok) throw new Error("DROPBOX_QUOTA_EXCEEDED");

    const data = await res.json().catch(() => ({}));
    if (data.rev) {
      try { localStorage.setItem(LS_LAST_REV, data.rev); } catch { /* ignore */ }
    }
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}

export async function ensureFolderExists() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  try {
    const res = await _fetchWithTimeout(DROPBOX_CREATE_FOLDER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: "/Apps/RITMOL",
      autorename: false,
    }),
  });

  if (res.ok) return;
  // 409 always means the folder already exists in create_folder_v2 — not an error.
  // Consume and discard the body to avoid browser warnings, then continue.
  if (res.status === 409) { await res.json().catch(() => {}); return; }
  // 400 can be a path issue (folder exists under different case) or bad auth.
  if (res.status === 400) {
    const err = await res.json().catch(() => ({}));
    if (err?.error?.[".tag"] === "path" || err?.error?.[".tag"] === "path_write") return;
    throw new Error("DROPBOX_TOKEN_EXPIRED");
  }
  if (res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
  // Any other status: don't hard-fail — let the upload step surface a clearer error.
  return;
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}
