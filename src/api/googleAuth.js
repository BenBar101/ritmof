// ═══════════════════════════════════════════════════════════════
// Google OAuth (PKCE) for Generative Language API
// ═══════════════════════════════════════════════════════════════

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import {
  GOOGLE_AUTH_SCOPE_GEMINI,
  OAUTH_REDIRECT_SCHEME,
  GOOGLE_OAUTH_TOKEN_URL,
} from "../config.js";
import { getGeminiApiKey } from "../utils/db";

const SS_GOOGLE_ACCESS_TOKEN = "ritmol_google_access_token";
const SS_GOOGLE_TOKEN_EXPIRY = "ritmol_google_token_expiry";
const SS_PKCE_VERIFIER = "ritmol_google_pkce_verifier";
const SS_OAUTH_STATE = "ritmol_google_oauth_state";
const LS_GOOGLE_REFRESH_TOKEN = "ritmol_google_refresh_token";

const REFRESH_KEY_NATIVE = "ritmol_google_refresh";

function isNative() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

async function secureSetRefresh(value) {
  if (!value) return;
  if (isNative()) {
    try {
      await SecureStoragePlugin.set({ key: REFRESH_KEY_NATIVE, value });
    } catch {
      try { localStorage.setItem(LS_GOOGLE_REFRESH_TOKEN, value); } catch { /* ignore */ }
    }
  } else {
    try { localStorage.setItem(LS_GOOGLE_REFRESH_TOKEN, value); } catch { /* ignore */ }
  }
}

async function secureGetRefresh() {
  if (isNative()) {
    try {
      const { value } = await SecureStoragePlugin.get({ key: REFRESH_KEY_NATIVE });
      if (value) return value;
    } catch { /* fall through */ }
  }
  try { return localStorage.getItem(LS_GOOGLE_REFRESH_TOKEN); } catch { return null; }
}

async function secureRemoveRefresh() {
  if (isNative()) {
    try { await SecureStoragePlugin.remove({ key: REFRESH_KEY_NATIVE }); } catch { /* ignore */ }
  }
  try { localStorage.removeItem(LS_GOOGLE_REFRESH_TOKEN); } catch { /* ignore */ }
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

export function isGoogleAuthConnected() {
  try {
    const exp = Number(sessionStorage.getItem(SS_GOOGLE_TOKEN_EXPIRY) || 0);
    const tok = sessionStorage.getItem(SS_GOOGLE_ACCESS_TOKEN);
    if (tok && exp > Date.now() + 60_000) return true;
  } catch { /* ignore */ }
  try {
    if (localStorage.getItem(LS_GOOGLE_REFRESH_TOKEN)) return true;
  } catch { /* ignore */ }
  if (isNative()) {
    // async check skipped — best-effort sync path assumes disconnected until refresh
  }
  return false;
}

function redirectUriWeb() {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
  return `${window.location.origin}${base}/google-callback`;
}

export function startGoogleOAuthFlow(clientId) {
  if (!clientId || typeof clientId !== "string") {
    throw new Error("GOOGLE_AUTH_NO_CLIENT_ID");
  }
  const verifier = generateCodeVerifier();
  sessionStorage.setItem(SS_PKCE_VERIFIER, verifier);
  const rawNonce = new Uint8Array(32);
  crypto.getRandomValues(rawNonce);
  const oauthState = btoa(String.fromCharCode(...rawNonce))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  sessionStorage.setItem(SS_OAUTH_STATE, oauthState);

  const redirect = isNative()
    ? `${OAUTH_REDIRECT_SCHEME}://auth/google`
    : redirectUriWeb();

  generateCodeChallenge(verifier).then((challenge) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: `${GOOGLE_AUTH_SCOPE_GEMINI} openid email`,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: oauthState,
      access_type: "offline",
      prompt: "consent",
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    if (isNative()) {
      Browser.open({ url }).catch(() => { window.location.href = url; });
    } else {
      window.location.href = url;
    }
  });
}

export async function handleGoogleOAuthCallback(code, state) {
  const storedState = sessionStorage.getItem(SS_OAUTH_STATE);
  sessionStorage.removeItem(SS_OAUTH_STATE);
  if (!storedState || storedState !== state) {
    throw new Error("GOOGLE_AUTH_STATE_MISMATCH");
  }
  const verifier = sessionStorage.getItem(SS_PKCE_VERIFIER);
  if (!verifier) throw new Error("GOOGLE_AUTH_CODE_EXCHANGE_FAILED");

  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
  const redirect = isNative()
    ? `${OAUTH_REDIRECT_SCHEME}://auth/google`
    : redirectUriWeb();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirect,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("GOOGLE_AUTH_CODE_EXCHANGE_FAILED");
  }
  if (!data.refresh_token) {
    throw new Error("GOOGLE_AUTH_NO_REFRESH_TOKEN");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  sessionStorage.setItem(SS_GOOGLE_ACCESS_TOKEN, data.access_token);
  sessionStorage.setItem(SS_GOOGLE_TOKEN_EXPIRY, String(Date.now() + expiresIn * 1000));
  await secureSetRefresh(data.refresh_token);
  try { sessionStorage.removeItem(SS_PKCE_VERIFIER); } catch { /* ignore */ }
}

export async function refreshGoogleToken(clientId) {
  if (!clientId) throw new Error("GOOGLE_AUTH_REFRESH_FAILED");
  const refreshToken = await secureGetRefresh();
  if (!refreshToken) throw new Error("GOOGLE_AUTH_REFRESH_FAILED");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error("GOOGLE_AUTH_REFRESH_FAILED");
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  sessionStorage.setItem(SS_GOOGLE_ACCESS_TOKEN, data.access_token);
  sessionStorage.setItem(SS_GOOGLE_TOKEN_EXPIRY, String(Date.now() + expiresIn * 1000));
  if (data.refresh_token) {
    await secureSetRefresh(data.refresh_token);
  }
  return data.access_token;
}

export function getGoogleAccessToken() {
  try {
    const exp = Number(sessionStorage.getItem(SS_GOOGLE_TOKEN_EXPIRY) || 0);
    const tok = sessionStorage.getItem(SS_GOOGLE_ACCESS_TOKEN);
    if (tok && exp > Date.now() + 60_000) return tok;
  } catch { /* ignore */ }
  return null;
}

export function revokeGoogleAuth() {
  try {
    sessionStorage.removeItem(SS_GOOGLE_ACCESS_TOKEN);
    sessionStorage.removeItem(SS_GOOGLE_TOKEN_EXPIRY);
    sessionStorage.removeItem(SS_PKCE_VERIFIER);
    sessionStorage.removeItem(SS_OAUTH_STATE);
  } catch { /* ignore */ }
  secureRemoveRefresh().catch(() => {});
  try {
    localStorage.removeItem(LS_GOOGLE_REFRESH_TOKEN);
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("ritmol:google-auth-revoked"));
}

export async function ensureFreshGoogleToken(clientId) {
  const cur = getGoogleAccessToken();
  if (cur) return cur;
  return refreshGoogleToken(clientId);
}

/** Resolves OAuth token or raw AIza key for Gemini calls. */
export async function getActiveAiToken(googleAuthConnected, clientId) {
  if (googleAuthConnected && clientId) {
    try {
      return await ensureFreshGoogleToken(clientId);
    } catch (e) {
      const msg = e?.message || "";
      if (msg === "GOOGLE_AUTH_REFRESH_FAILED" || msg === "GOOGLE_AUTH_NO_REFRESH_TOKEN") {
        throw e;
      }
    }
  }
  const key = getGeminiApiKey();
  if (key && String(key).trim()) return String(key).trim();
  return null;
}
