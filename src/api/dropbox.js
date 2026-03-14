// ═══════════════════════════════════════════════════════════════
// DROPBOX API — OAuth PKCE flow + upload/download transport
// ═══════════════════════════════════════════════════════════════
// Requires VITE_DROPBOX_APP_KEY in .env (create an app at dropbox.com/developers/apps).
// REDIRECT_URI must exactly match the Redirect URI registered in the Dropbox app console
// (e.g. https://your-domain.com/dropbox-callback or http://localhost:5173/dropbox-callback).
// ═══════════════════════════════════════════════════════════════

const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY;
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
    sessionStorage.setItem(SS_ACCESS_TOKEN, access_token);
    sessionStorage.setItem(SS_REFRESH_TOKEN, refresh_token ?? sessionStorage.getItem(SS_REFRESH_TOKEN) ?? "");
    const expiresAt = Date.now() + (expires_in ?? 0) * 1000;
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
  generateCodeChallenge(verifier).then((challenge) => {
    const params = new URLSearchParams({
      client_id: DROPBOX_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
      state: "dropbox",
    });
    window.location.href = `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  });
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
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${DROPBOX_CLIENT_ID}:`)}`,
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
      throw new Error("DROPBOX_AUTH_REQUIRED");
    }
    setTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in ?? 14400,
    });
    return true;
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

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${DROPBOX_CLIENT_ID}:`)}`,
    },
    body: body.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
    throw new Error("DROPBOX_TOKEN_EXPIRED");
  }
  setTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refreshToken,
    expires_in: data.expires_in ?? 14400,
  });
  return true;
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

  const res = await fetch(METADATA_ENDPOINT, {
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
}

export async function downloadFile() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  const res = await fetch(DOWNLOAD_ENDPOINT, {
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
}

export async function uploadFile(text) {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  const meta = await getMetadata().catch((e) => {
    if (e.message === "DROPBOX_FILE_NOT_FOUND") return null;
    throw e;
  });
  const storedRev = sessionStorage.getItem(SS_LAST_REV);
  if (meta != null && storedRev != null && meta.rev !== storedRev) {
    throw new Error("DROPBOX_CONFLICT");
  }

  const res = await fetch(UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path: SYNC_FILE_PATH,
        mode: { ".tag": "overwrite" },
      }),
    },
    body: text,
  });

  if (res.status === 401) throw new Error("DROPBOX_TOKEN_EXPIRED");
  if (res.status === 507) throw new Error("DROPBOX_QUOTA_EXCEEDED");
  if (res.status === 409) {
    const err = await res.json().catch(() => ({}));
    const tag = err?.error?.[".tag"];
    if (tag === "too_many_write_operations" || tag === "insufficient_space") {
      throw new Error("DROPBOX_QUOTA_EXCEEDED");
    }
    throw new Error("DROPBOX_CONFLICT");
  }
  if (!res.ok) throw new Error("DROPBOX_QUOTA_EXCEEDED");

  const data = await res.json().catch(() => ({}));
  if (data.rev) {
    try { sessionStorage.setItem(SS_LAST_REV, data.rev); } catch { /* ignore */ }
  }
}

export async function ensureFolderExists() {
  const tokens = getTokens();
  if (!tokens) throw new Error("DROPBOX_AUTH_REQUIRED");

  const res = await fetch(CREATE_FOLDER_ENDPOINT, {
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
}
