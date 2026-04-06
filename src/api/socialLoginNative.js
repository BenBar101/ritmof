// ═══════════════════════════════════════════════════════════════
// Single SocialLogin.initialize() for native: Google + Dropbox OAuth2
// ═══════════════════════════════════════════════════════════════

import { Capacitor } from "@capacitor/core";
import {
  DROPBOX_OAUTH_URL,
  DROPBOX_TOKEN_URL,
  OAUTH_REDIRECT_SCHEME,
} from "../config.js";

export function isCapacitorNative() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

function webClientIdFromEnv() {
  return (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID || "").trim();
}

function iosClientIdFromEnv() {
  return (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_IOS_CLIENT_ID || "").trim();
}

function dropboxAppKeyFromEnv() {
  return (typeof import.meta !== "undefined" && import.meta.env?.VITE_DROPBOX_APP_KEY || "").trim();
}

function buildSocialLoginInitPayload() {
  const platform = Capacitor.getPlatform();
  const payload = {};

  const webId = webClientIdFromEnv();
  const iosId = iosClientIdFromEnv();
  if (webId) {
    if (platform === "ios" && iosId) {
      payload.google = {
        iOSClientId: iosId,
        iOSServerClientId: webId,
      };
    } else if (platform === "android") {
      payload.google = { webClientId: webId };
    }
  }

  const dbx = dropboxAppKeyFromEnv();
  if (dbx && dbx !== "undefined") {
    const redirectUrl = `${OAUTH_REDIRECT_SCHEME}://auth/dropbox`;
    payload.oauth2 = {
      dropbox: {
        appId: dbx,
        clientId: dbx,
        authorizationBaseUrl: DROPBOX_OAUTH_URL,
        accessTokenEndpoint: DROPBOX_TOKEN_URL,
        redirectUrl,
        pkceEnabled: true,
        additionalParameters: {
          token_access_type: "offline",
        },
      },
    };
  }

  return payload;
}

let socialLoginInitPromise = null;
let lastInitPayloadJson = null;

/** Initializes @capgo/capacitor-social-login (Google + OAuth2 Dropbox when env allows). */
export async function ensureSocialLoginPluginsInitialized() {
  if (!isCapacitorNative()) return;
  const payload = buildSocialLoginInitPayload();
  const serialized = JSON.stringify(payload);
  if (serialized !== lastInitPayloadJson) {
    lastInitPayloadJson = serialized;
    socialLoginInitPromise = null;
  }
  if (socialLoginInitPromise) return socialLoginInitPromise;
  if (Object.keys(payload).length === 0) return;

  socialLoginInitPromise = (async () => {
    const { SocialLogin } = await import("@capgo/capacitor-social-login");
    await SocialLogin.initialize(payload);
  })();

  return socialLoginInitPromise;
}
