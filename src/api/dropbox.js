// ═══════════════════════════════════════════════════════════════
// DROPBOX API — OAuth PKCE flow + upload/download transport
// ═══════════════════════════════════════════════════════════════
// Requires VITE_DROPBOX_APP_KEY in .env (create an app at dropbox.com/developers/apps).
// REDIRECT_URI must exactly match the Redirect URI registered in the Dropbox app console
// (e.g. https://your-domain.com/dropbox-callback or http://localhost:5173/dropbox-callback).
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

const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY;

// Redact the App Key from any string before it reaches a log or thrown message.
// The key is compile-time inlined; this prevents it appearing in console output.
// eslint-disable-next-line no-unused-vars -- kept for defensive use when adding debug logging
function _redactAppKey(str) {
  if (!DROPBOX_CLIENT_ID || typeof str !== "string") return str;
  return str.split(DROPBOX_CLIENT_ID).join("[app_key]");
}
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
const REDIRECT_URI = `${window.location.origin}${BASE}/dropbox-callback`;
const SYNC_FILE_PATH = "/Apps/RITMOL/ritmol-data.json";
const TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token";
const UPLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/upload";
const DOWNLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/download";
const METADATA_ENDPOINT = "https://api.dropboxapi.com/2/files/get_metadata";
const CREATE_FOLDER_ENDPOINT = "https://api.dropboxapi.com/2/files/create_folder_v2";

const PREFIX = import.meta.env.DEV ? "ritmol_dev_" : "ritmol_";
const SS_ACCESS_TOKEN = `${PREFIX}dbx_access_token`;
const SS_REFRESH_TOKEN = `${PREFIX}dbx_refresh_token`;
const SS_EXPIRES_AT = `${PREFIX}dbx_expires_at`;
const SS_LAST_REV = `${PREFIX}dbx_last_rev`;
const SS_CODE_VERIFIER = `${PREFIX}dbx_code_verifier`;
const SS_OAUTH_STATE = `${PREFIX}dbx_oauth_state`;

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
    const refreshToken = sessionStorage.getItem(SS_REFRESH_TOKEN);
    const expiresAt = sessionStorage.getItem(SS_EXPIRES_AT);
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

export function setTokens({ access_token, refresh_token, expires_in }) {
  try {
    if (!access_token || typeof access_token !== "string") return;
    sessionStorage.setItem(SS_ACCESS_TOKEN, access_token);

    // Only write a new refresh_token if the incoming value is a non-empty string.
    // Fall back to the existing stored token. Never store an empty string.
    const resolvedRefresh =
      (typeof refresh_token === "string" && refresh_token.length > 0)
        ? refresh_token
        : (sessionStorage.getItem(SS_REFRESH_TOKEN) || null);
    if (resolvedRefresh) {
      sessionStorage.setItem(SS_REFRESH_TOKEN, resolvedRefresh);
    }

    const expiresAt = Date.now() + (typeof expires_in === "number" && expires_in > 0 ? expires_in : 14_400) * 1000;
    sessionStorage.setItem(SS_EXPIRES_AT, String(expiresAt));
  } catch {
    /* sessionStorage unavailable */
  }
}

export function clearTokens() {
  try {
    sessionStorage.removeItem(SS_ACCESS_TOKEN);
    sessionStorage.removeItem(SS_REFRESH_TOKEN);
    sessionStorage.removeItem(SS_EXPIRES_AT);
    sessionStorage.removeItem(SS_LAST_REV);
    sessionStorage.removeItem(SS_CODE_VERIFIER);
    sessionStorage.removeItem(SS_OAUTH_STATE);
  } catch {
    /* ignore */
  }
}

export function isAuthenticated() {
  return getTokens() !== null;
}

export function startOAuthFlow() {
  const verifier = generateCodeVerifier();
  sessionStorage.setItem(SS_CODE_VERIFIER, verifier);

  // Generate a random CSRF nonce and persist it so the callback can verify it.
  const rawNonce = new Uint8Array(32);
  crypto.getRandomValues(rawNonce);
  const oauthState = btoa(String.fromCharCode(...rawNonce))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  sessionStorage.setItem(SS_OAUTH_STATE, oauthState);

  generateCodeChallenge(verifier).then((challenge) => {
    const params = new URLSearchParams({
      client_id: DROPBOX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      state: oauthState,
    });
    window.location.href = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  });
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

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  try {
    const res = await _fetchWithTimeout(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${DROPBOX_CLIENT_ID}:`)}`,
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
  const tokens = getTokens();
  if (!tokens?.refreshToken) throw new Error("DROPBOX_TOKEN_EXPIRED");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  try {
    const res = await _fetchWithTimeout(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${DROPBOX_CLIENT_ID}:`)}`,
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
        refresh_token: data.refresh_token ?? tokens.refreshToken,
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
  const tokens = getTokens();
  if (!tokens) return;
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expiresAt - bufferMs <= Date.now()) {
    await refreshAccessToken();
  }
}

export async function getMetadata() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  try {
    const res = await _fetchWithTimeout(METADATA_ENDPOINT, {
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
    const res = await _fetchWithTimeout(DOWNLOAD_ENDPOINT, {
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
    try { sessionStorage.setItem(SS_LAST_REV, rev); } catch { /* ignore */ }
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

  const storedRev = sessionStorage.getItem(SS_LAST_REV);

  // Choose upload mode:
  //   - If we have a stored rev from a previous pull/push, use "update" mode
  //     with update_rev so Dropbox atomically rejects the upload if the remote
  //     file changed — no separate getMetadata() round-trip needed.
  //   - If no stored rev exists (first push), use "overwrite" mode.
  const uploadMode = storedRev
    ? { ".tag": "update", update: storedRev }
    : { ".tag": "overwrite" };

  try {
    const res = await _fetchWithTimeout(UPLOAD_ENDPOINT, {
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
      try { sessionStorage.setItem(SS_LAST_REV, data.rev); } catch { /* ignore */ }
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
    const res = await _fetchWithTimeout(CREATE_FOLDER_ENDPOINT, {
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
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    const conflictTag = err?.error?.path?.conflict?.[".tag"];
    if (conflictTag === "folder" || err?.error?.[".tag"] === "path") return;
  }
  throw new Error("DROPBOX_AUTH_REQUIRED");
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") {
      throw new Error("DROPBOX_TIMEOUT");
    }
    throw e;
  }
}
