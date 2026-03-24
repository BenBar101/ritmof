import React, { useState, useEffect, useRef, useCallback } from "react";

// Hooks
import { useAppState }   from "./hooks/useAppState";
import { useUI }         from "./hooks/useUI";
import { useSync }       from "./hooks/useSync";
import { useGameEngine } from "./hooks/useGameEngine";
import { useNotifications } from "./hooks/useNotifications";
import { useAiNotifications } from "./hooks/useAiNotifications";
import { useDailyLogin } from "./hooks/useDailyLogin";
import { useHealthKit } from "./hooks/useHealthKit";

// Context
import { AppContext } from "./context/AppContext";

// Utils
import { LS, storageKey, IS_DEV, getGeminiApiKey, setGeminiApiKey, todayUTC, localDateFromUTC, APP_ICON_URL } from "./utils/db";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "./constants";
import { GEMINI_DAILY_TOKEN_LIMIT, OAUTH_REDIRECT_SCHEME } from "./config.js";
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchGCalEvents, loadGoogleGIS, GCAL_SCOPE } from "./api/gcal";
import { callGemini, RateLimitedError, clearRateLimitWindow } from "./api/gemini";
import { isSafeSyncValue } from "./sync/SyncManager";
import { verifyOAuthState } from "./api/dropbox";
import { App as CapApp } from "@capacitor/app";
import {
  handleGoogleOAuthCallback,
  getActiveAiToken,
} from "./api/googleAuth";
import { SyncManager } from "./sync/SyncManager";

const MISSION_DEFS = [
  { id: "m1", desc: "Complete 3 habits",  target: 3,  type: "habits",  xp: 100, done: false },
  { id: "m2", desc: "Complete 6 habits",  target: 6,  type: "habits",  xp: 200, done: false },
  { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits",  xp: 500, done: false },
  { id: "m4", desc: "Log a study session",target: 1,  type: "session", xp: 75,  done: false },
  { id: "m5", desc: "Complete a task",    target: 1,  type: "task",    xp: 50,  done: false },
  { id: "m6", desc: "Open RITMOL chat",   target: 1,  type: "chat",    xp: 25,  done: false },
];

// ── ISO week key: "YYYY-Www" using local date ──────────────────
function localWeekKey() {
  const d = new Date();
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const week = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Month key: "YYYY-MM" using local date ──────────────────────
function localMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Ask Gemini to generate weekly or monthly missions ──────────
async function generateAiMissions(apiKey, profile, period, trackTokens, signal) {
  const isWeekly = period === "weekly";
  const count    = isWeekly ? 5 : 3;
  const xpRange  = isWeekly ? "150-400" : "500-1500";
  const major     = (profile?.major     || "").replace(/[<>"'`]/g, "").slice(0, 40);
  const interests = (profile?.interests || "").replace(/[<>"'`]/g, "").slice(0, 50);
  const context   = [major, interests].filter(Boolean).join(", ") || "STEM";

  // Compact prompt — every token in the request is billed, so keep it tight.
  // The system instruction is short and purely structural; all context goes in
  // the user turn so the model has one focused input to parse.
  const prompt =
    `${context}. ` +
    `${count} ${isWeekly ? "weekly" : "monthly"} RPG missions XP ${xpRange}. ` +
    `Reply JSON array only: [{"id":"1","desc":"short text","type":"habits","target":5,"xp":200}]`;

  // Hard 20-second race so the promise always resolves.
  // Mission responses are tiny JSON arrays — 256 output tokens is more than enough
  // for 5 missions and eliminates ~768 tokens of unnecessary output budget per call.
  const hardTimeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error("mission_timeout")), 20000)
  );

  try {
    const { text, tokensUsed } = await Promise.race([
      callGemini(
        apiKey,
        [{ role: "user", content: prompt }],
        "JSON array only. No markdown. No explanation.",
        false,
        signal,
        256,  // missions are small — cap output tokens to save budget
        true, // background = true: yields to interactive calls (chat, gacha)
      ),
      hardTimeout,
    ]);
    if (trackTokens && tokensUsed) trackTokens(tokensUsed);

    const stripped = text.replace(/```[\w]*\n?/g, "").trim();
    const match = stripped.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      // Return null to signal parse failure (distinct from "empty result").
      return null;
    }
    if (!Array.isArray(parsed) || !parsed.length) return [];
    // Prototype-pollution guard — mirrors every other JSON parse site in the codebase.
    if (!isSafeSyncValue(parsed)) return [];

    return parsed.slice(0, count).map((m, i) => ({
      id: `${period}_ai_${i}_${Date.now()}`,
      // eslint-disable-next-line no-control-regex
      desc: typeof m.desc === "string" ? m.desc.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[<>"'`&]/g, "").slice(0, 200) : "Complete the mission",
      type: ["habits","session","task","streak","custom"].includes(m.type) ? m.type : "custom",
      target: typeof m.target === "number" ? Math.min(Math.max(1, Math.round(m.target)), 100) : 1,
      xp: typeof m.xp === "number" ? Math.min(Math.max(50, Math.round(m.xp)), 2000) : 200,
      done: false,
      ai: true,
    }));
  } catch (err) {
    // Re-throw abort and rate-limit errors so tryGenerate can handle them
    // correctly — abort should not advance the date key, and 429 should not
    // either (so the next session retries rather than showing empty missions forever).
    if (err?.name === "AbortError") throw err;
    if (err?.message?.includes("429")) throw err;
    if (err instanceof RateLimitedError) throw err;  // treat same as 429 — back off and retry next session
    return [];
  }
}

// Components
import Onboarding, { GeminiKeySetupScreen } from "./Onboarding";
import { TopBar, BottomNav, Banner } from "./Layout";
import { GlobalStyles, ErrorBoundary } from "./GlobalStyles";
import {
  DailyLoginModal, SleepCheckinModal, ScreenTimeModal,
  SessionLogModal, LevelUpModal, AchievementToast,
} from "./Modals";

// Tabs
import HomeTab    from "./HomeTab";
import HabitsTab  from "./HabitsTab";
import TasksTab   from "./TasksTab";
import ChatTab    from "./ChatTab";
import ProfileTab from "./ProfileTab";
import SettingsTab from "./SettingsTab";
import TutorialOverlay from "./TutorialOverlay";

// ─────────────────────────────────────────────────────────────
// KEYS CONFIG GATE
// ─────────────────────────────────────────────────────────────
// KeysConfigGate is intentionally removed.
// Missing-key handling is done inline in the main App render (after hooks run)
// so it has access to connectDropbox, syncPull, pickSyncFile, setShowGeminiKeySetup, etc.

// ─────────────────────────────────────────────────────────────
// MISSING KEY GATE
// Shown when there is no Gemini API key in sessionStorage.
// Rendered inside the main App (after hooks run) so it has access
// to connectDropbox, syncPull, pickSyncFile, etc.
// ─────────────────────────────────────────────────────────────
function MissingKeyGate({ connectDropbox, dropboxConnected, onGeminiKeySaved }) {
  const [mode, setMode]           = useState("choose"); // "choose" | "gemini" | "import"
  const importInputRef = useRef(null);
  const [syncError, setSyncError]           = useState("");
  const [dropboxError, setDropboxError]     = useState("");

  // Detect standalone PWA mode (iOS "Add to Home Screen").
  // On iOS, localStorage is NOT shared between Safari browser and the installed
  // PWA — they are separate storage partitions. So a user who authenticated in
  // Safari will need to reconnect once inside the PWA. We detect this context
  // and surface a single-tap reconnect prompt instead of the full onboarding.
  const isPWA = typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches;

  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const btnPrimary = {
    width: "100%", padding: "16px", border: "2px solid #fff", background: "#fff", color: "#000",
    ...mono, fontSize: "16px", letterSpacing: "2px", cursor: "pointer", marginBottom: "10px",
    minHeight: "56px",
  };
  const btnSecondary = {
    width: "100%", padding: "13px", border: "2px solid #fff", background: "transparent", color: "#fff",
    ...mono, fontSize: "14px", letterSpacing: "1px", cursor: "pointer", marginBottom: "10px",
  };

  function handleConnectDropbox() {
    setDropboxError("");
    try {
      connectDropbox();
    } catch (e) {
      if (e?.message === "DROPBOX_NOT_CONFIGURED") {
        setDropboxError("Dropbox is not configured in this build. Enter your Gemini key manually instead.");
      } else {
        setDropboxError("Could not start Dropbox connection. Try again.");
      }
    }
  }

  async function handleImportFile(e) {
    setSyncError("");
    const file = e.target.files?.[0];
    try { e.target.value = ""; } catch { /* ignore */ }
    if (!file) return;
    window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
    try {
      await SyncManager.importFile(file);
      window.location.reload();
    } catch (err) {
      const msgs = {
        CORRUPT_FILE: "Import failed: file is corrupt or not valid JSON.",
        SYNC_FILE_TOO_LARGE: "Import failed: file exceeds 10 MB.",
        SYNC_BUSY: "Sync already in progress. Please wait.",
        IDB_NOT_READY: "Still loading — try again in a moment.",
      };
      setSyncError(msgs[err?.message] ?? "Import failed.");
    }
  }

  // PWA reconnect: if running as installed PWA, show a focused one-tap
  // reconnect screen. iOS partitions localStorage between Safari browser
  // and the PWA, so the user must re-auth once per PWA install — but we
  // make it a single tap rather than full onboarding.
  if (isPWA && mode === "choose" && !dropboxConnected) {
    return (
      <div style={{
        height: "calc(var(--vh, 1vh) * 100)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "32px 24px", background: "#000", color: "#fff", ...mono,
      }}>
        <img src={APP_ICON_URL} alt="" style={{ width: 44, height: 44, marginBottom: "24px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />

        {/* Geometric corner accent */}
        <div style={{ position: "relative", width: "100%", maxWidth: "340px", border: "2px solid #fff", padding: "28px 24px", marginBottom: "32px" }}>
          <div style={{ position: "absolute", top: -1, left: -1, width: 16, height: 16, borderRight: "2px solid #000", borderBottom: "2px solid #000", background: "#000" }} />
          <div style={{ position: "absolute", bottom: -1, right: -1, width: 16, height: 16, borderLeft: "2px solid #000", borderTop: "2px solid #000", background: "#000" }} />

          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#fff", marginBottom: "10px", opacity: 0.6 }}>RITMOL // PWA</div>
          <div style={{ fontSize: "22px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "8px" }}>WELCOME BACK</div>
          <div style={{ fontSize: "14px", color: "#fff", lineHeight: "1.7", marginBottom: "0", opacity: 0.8 }}>
            Tap below to reconnect Dropbox and restore your data. This is a one-time step each time you install the app.
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: "340px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <button type="button" onClick={handleConnectDropbox} style={{ ...btnPrimary, marginBottom: 0, fontSize: "15px", letterSpacing: "2px" }}>
            ◈ RECONNECT DROPBOX
          </button>
          {dropboxError && (
            <div style={{ color: "#fff", fontSize: "13px", fontWeight: "bold", border: "2px solid #fff", padding: "10px" }}>
              [ ERR ] {dropboxError}
            </div>
          )}
          <div style={{ height: "1px", background: "#333" }} />
          <button type="button" onClick={() => setMode("gemini")} style={{ ...btnSecondary, marginBottom: 0, fontSize: "13px" }}>
            ENTER GEMINI KEY MANUALLY
          </button>
          <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
          <button type="button" onClick={() => importInputRef.current?.click()} style={{ ...btnSecondary, marginBottom: 0, fontSize: "13px" }}>
            IMPORT JSON FILE
          </button>
        </div>

        <div style={{ marginTop: "32px", fontSize: "11px", color: "#fff", letterSpacing: "2px", opacity: 0.4 }}>
          ZERO TELEMETRY // LOCAL FIRST
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "calc(var(--vh, 1vh) * 100)", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "32px 24px", background: "#000",
      color: "#fff", ...mono,
    }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 44, height: 44, marginBottom: "20px", marginTop: "24px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "6px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ RITMOL ]</div>
      <div style={{ fontSize: "20px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "6px" }}>
        {mode === "gemini" ? "GEMINI API KEY" : mode === "import" ? "IMPORT FILE" : "SETUP REQUIRED"}
      </div>
      <div style={{ fontSize: "16px", color: "#fff", marginBottom: "28px", fontFamily: "'Share Tech Mono', monospace" }}>
        {mode === "gemini"   ? "Enter your key to enable AI features." :
         mode === "import" ? "Import a ritmol-data.json backup." :
         "A Gemini API key is needed to continue."}
      </div>

      <div style={{ width: "100%", maxWidth: "360px" }}>

        {/* ── Choose mode ── */}
        {mode === "choose" && (
          <>
            {!dropboxConnected && (
              <>
                <div style={{ fontSize: "13px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>
                  RETURNING USER? PULL FROM SYNC
                </div>
                <button type="button" onClick={handleConnectDropbox} style={btnPrimary}>
                  CONNECT DROPBOX ↗
                </button>
                {dropboxError && <div style={{ color: "#fff", fontSize: "16px", marginBottom: "10px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {dropboxError}</div>}
                <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
                <button type="button" onClick={() => importInputRef.current?.click()} style={{ ...btnSecondary, marginBottom: "24px" }}>
                  IMPORT JSON FILE
                </button>
                <div style={{ height: "1px", background: "#222", marginBottom: "24px" }} />
              </>
            )}
            <div style={{ fontSize: "13px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>
              NEW USER? ENTER KEY MANUALLY
            </div>
            <button type="button" onClick={() => setMode("gemini")} style={btnPrimary}>
              ENTER GEMINI API KEY
            </button>
          </>
        )}

        {/* ── Gemini key entry ── */}
        {mode === "gemini" && (
          <>
            <GeminiKeySetupScreen onSave={onGeminiKeySaved} />
            <button type="button" onClick={() => setMode("choose")} style={{ ...btnSecondary, marginTop: "12px" }}>
              ← BACK
            </button>
          </>
        )}

        {/* ── Import file ── */}
        {mode === "import" && (
          <>
            <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.8", marginBottom: "16px", fontFamily: "'Share Tech Mono', monospace" }}>
              Select a <code>ritmol-data.json</code> export to restore your data and Gemini key (if present in the file).
            </div>
            <input ref={importInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleImportFile} />
            <button type="button" onClick={() => importInputRef.current?.click()} style={btnPrimary}>
              CHOOSE FILE
            </button>
            {syncError && <div style={{ color: "#fff", fontSize: "16px", marginBottom: "8px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {syncError}</div>}
            <button type="button" onClick={() => { setMode("choose"); setSyncError(""); }} style={{ ...btnSecondary, marginTop: "12px" }}>
              ← BACK
            </button>
          </>
        )}

      </div>

      <div style={{ fontSize: "16px", color: "#fff", marginTop: "32px", letterSpacing: "2px", fontFamily: "'Share Tech Mono', monospace" }}>
        RITMOL v1.0 // ZERO TELEMETRY
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SYNCING SCREEN — E-ink safe static loading
// ─────────────────────────────────────────────────────────────
function SyncingScreen({ theme = "dark" }) {
  const isLight = theme === "light";
  const bg     = isLight ? "#f0f0f0" : "#000";
  const text   = isLight ? "#000"    : "#fff";
  const border = isLight ? "rgba(0,0,0,0.35)"   : "rgba(255,255,255,0.35)";
  const track  = isLight ? "rgba(0,0,0,0.12)"   : "rgba(255,255,255,0.12)";
  return (
    <div style={{
      minHeight: "calc(var(--vh, 1vh) * 100)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: bg, fontFamily: "'Share Tech Mono', monospace",
    }}>
      <div style={{ fontSize: "11px", color: text, letterSpacing: "4px", marginBottom: "32px", opacity: 0.5 }}>
        RITMOL
      </div>
      <div style={{
        fontSize: "13px", fontWeight: "bold", color: text,
        letterSpacing: "3px", marginBottom: "24px",
        border: `1.5px solid ${border}`,
        padding: "20px 36px",
        clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)",
      }}>
        LOADING...
      </div>
      <div style={{
        width: "120px", height: "2px", background: track,
      }} />
      <div style={{ fontSize: "10px", color: text, letterSpacing: "3px", marginTop: "20px", opacity: 0.45 }}>
        INITIALISING SYSTEM
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const { state, setState, latestStateRef, rehydrate, idbReady, rehydrateCount } = useAppState();
  const [tab, setTab]               = useState("home");
  const [theme, setThemeState]      = useState(() => LS.get(storageKey(THEME_KEY), "dark"));
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGeminiKeySetup, setShowGeminiKeySetup] = useState(false);
  const setTheme = useCallback((t) => { LS.set(storageKey(THEME_KEY), t); setThemeState(t); }, []);

  const { modal, setModal, toast, setToast, banner, setBanner, levelUpData, setLevelUpData, showToast, showBanner } = useUI();

  const profile          = state?.profile;
  // apiKey is read from sessionStorage on every render. After a sync Pull that
  // writes a new key into sessionStorage, rehydrate() triggers a re-render and
  // this call observes the updated value — there is at most a single render
  // where the old key remains in scope.
  const apiKey           = getGeminiApiKey();
  const googleClientId   = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
  const getAiToken = useCallback(async () => {
    try {
      const g = latestStateRef.current?.googleAuthConnected;
      return await getActiveAiToken(g, googleClientId);
    } catch (e) {
      if (e?.message === "GOOGLE_AUTH_REFRESH_FAILED" || e?.message === "GOOGLE_AUTH_NO_REFRESH_TOKEN") {
        showBanner("Google session expired. Reconnect in Settings → AI Connection.", "alert");
        const k = getGeminiApiKey();
        return k && String(k).trim() ? k : null;
      }
      throw e;
    }
  }, [googleClientId, showBanner, latestStateRef]);
  const hasAiAuth =
    !!(apiKey && String(apiKey).trim()) || !!state?.googleAuthConnected;

  const xpPerLevel       = state ? getXpPerLevel(state) : DEFAULT_XP_PER_LEVEL;
  const level            = state ? getLevel(state.xp, xpPerLevel) : 0;
  const rank             = getRank(level);
  const gachaCost        = state ? getGachaCost(state) : DEFAULT_GACHA_COST;
  const streakShieldCost = state ? getStreakShieldCost(state) : DEFAULT_STREAK_SHIELD_COST;

  const { awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef, lastLevelUpXpRef } =
    useGameEngine({ setState, latestStateRef, showBanner, showToast, setLevelUpData, getAiToken });

  const { dropboxConnected, syncStatus, lastSynced, syncPush, syncPull, connectDropbox, handleDropboxCallback, disconnectDropbox, isReloading } =
    useSync({ latestStateRef, rehydrate, showBanner });

  const { scheduleAiNotification, requestNotificationPermission } = useNotifications({
    state, profile, showBanner, setModal, setState,
  });
  useAiNotifications({ latestStateRef, getAiToken, setState, scheduleAiNotification });
  useHealthKit({ latestStateRef, setState, showBanner });

  // OAuth callback: when returning from Dropbox, exchange code and pull.
  // Two landing scenarios:
  //   1. Direct: the host serves all routes (Vercel, local dev). Dropbox lands on
  //      /dropbox-callback?code=X&state=Y → code/state are in window.location.search.
  //   2. GitHub Pages 404 redirect: 404.html encodes the original URL as
  //      /?q=%2Fritmol%2Fdropbox-callback%3Fcode%3DX%26state%3DY
  //      The q= value is a full path+query string, so we must extract its search
  //      part before parsing it as URLSearchParams.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let code = params.get("code");
    let stateParam = params.get("state");

    // Scenario 2: GitHub Pages 404 → q= redirect.
    // Only attempt extraction when the current path doesn't already look like the
    // callback route (avoids double-processing on direct landings).
    if ((!code || !stateParam) && params.get("q")) {
      try {
        const decoded = decodeURIComponent(params.get("q"));
        // decoded may be a full path like "/ritmol/dropbox-callback?code=X&state=Y"
        // or a bare query string like "code=X&state=Y". Handle both.
        let search = decoded;
        if (decoded.includes("?")) {
          // It's a path+query — check it's actually the callback path, then extract search.
          const [pathPart, queryPart] = decoded.split("?");
          if (pathPart.includes("dropbox-callback")) {
            search = queryPart;
          } else {
            search = ""; // not a dropbox callback redirect — ignore
          }
        }
        if (search) {
          const qParams = new URLSearchParams(search);
          code = code || qParams.get("code");
          stateParam = stateParam || qParams.get("state");
        }
      } catch { /* ignore malformed q */ }
    }

    // For direct landings (scenario 1), also guard on the current path so we
    // don't accidentally consume code/state params on non-callback pages.
    const isCallbackPath = window.location.pathname.includes("dropbox-callback");
    const hasDirectParams = isCallbackPath && params.get("code") && params.get("state");
    const hasQParams = !!code && !!stateParam && !hasDirectParams;

    if ((hasDirectParams || hasQParams) && code && stateParam) {
      window.history.replaceState({}, "", window.location.pathname.replace(/\/dropbox-callback\/?$/, "") || "/");
      if (!verifyOAuthState(stateParam)) {
        showBanner("OAuth state mismatch. Please try connecting Dropbox again.", "alert");
        return;
      }
      handleDropboxCallback(code, {
        // If onboarding is active, let its own Gemini step handle key entry
        // rather than showing the standalone key setup screen on top of it.
        onNeedsGeminiKey: () => { if (!showOnboarding) setShowGeminiKeySetup(true); },
      });
    }
  }, [handleDropboxCallback, showBanner, showOnboarding]);

  // Google OAuth return (web / Capacitor)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let code = params.get("code");
    let st = params.get("state");
    if ((!code || !st) && params.get("q")) {
      try {
        const decoded = decodeURIComponent(params.get("q"));
        let search = decoded;
        if (decoded.includes("?")) {
          const [pathPart, queryPart] = decoded.split("?");
          if (pathPart.includes("google-callback")) search = queryPart;
          else search = "";
        }
        if (search) {
          const qParams = new URLSearchParams(search);
          code = code || qParams.get("code");
          st = st || qParams.get("state");
        }
      } catch { /* ignore */ }
    }
    const pathOk = window.location.pathname.includes("google-callback");
    const pending = (() => {
      try { return sessionStorage.getItem("ritmol_google_oauth_state"); } catch { return null; }
    })();
    if (code && st && (pathOk || pending)) {
      window.history.replaceState({}, "", window.location.pathname.replace(/\/google-callback\/?$/, "") || "/");
      handleGoogleOAuthCallback(code, st)
        .then(() => setState((s) => ({ ...s, googleAuthConnected: true })))
        .catch((err) => showBanner(`Google connection failed: ${err.message}`, "alert"));
    }
  }, [setState, showBanner]);

  useEffect(() => {
    let sub;
    (async () => {
      sub = await CapApp.addListener("appUrlOpen", ({ url }) => {
        try {
          if (url.startsWith(`${OAUTH_REDIRECT_SCHEME}://auth/google`)) {
            const u = new URL(url);
            handleGoogleOAuthCallback(u.searchParams.get("code") || "", u.searchParams.get("state") || "")
              .then(() => setState((s) => ({ ...s, googleAuthConnected: true })))
              .catch((err) => showBanner(`Google connection failed: ${err.message}`, "alert"));
          }
          if (url.startsWith(`${OAUTH_REDIRECT_SCHEME}://auth/dropbox`)) {
            const u = new URL(url);
            const c = u.searchParams.get("code");
            const st = u.searchParams.get("state");
            if (c && st && verifyOAuthState(st)) {
              handleDropboxCallback(c, {
                onNeedsGeminiKey: () => { if (!showOnboarding) setShowGeminiKeySetup(true); },
              });
            }
          }
        } catch { /* ignore */ }
      });
    })();
    return () => { try { sub?.remove?.(); } catch { /* ignore */ } };
  }, [handleDropboxCallback, showBanner, showOnboarding, setState]);

  useEffect(() => {
    const onRevoke = () => setState((s) => ({ ...s, googleAuthConnected: false }));
    window.addEventListener("ritmol:google-auth-revoked", onRevoke);
    return () => window.removeEventListener("ritmol:google-auth-revoked", onRevoke);
  }, [setState]);

  useDailyLogin({ profile, setState, setModal, setLevelUpData, showBanner, trackTokens, lastLevelUpXpRef });

  // Handle "mark reminded" event dispatched by useNotifications (web + native)
  useEffect(() => {
    const handler = (e) => {
      const ids = new Set(e.detail?.ids || []);
      setState((s) => ({ ...s, calendarEvents: (s.calendarEvents || []).map((ev) => ids.has(ev.id) ? { ...ev, reminded: true } : ev) }));
    };
    window.addEventListener("ritmol:mark-reminded", handler);
    return () => window.removeEventListener("ritmol:mark-reminded", handler);
  }, [setState]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "theme-color"); document.head.appendChild(meta); }
    meta.setAttribute("content", theme === "light" ? "#f0f0f0" : "#000");
  }, [theme]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      document.title = "RITMOL-DEV";
    }
  }, []);

  useEffect(() => {
    if (!profile?.geminiKey) return;
    setState((s) => {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _g, ...rest } = s.profile || {};
      return { ...s, profile: rest };
    });
  }, [profile?.geminiKey, setState]);

  useEffect(() => {
    if (!profile) return;
    const resetMissions = () => setState((s) => {
      const t = localDateFromUTC();
      if (s.lastMissionDate === t) return s;
      return { ...s, dailyMissions: [...MISSION_DEFS], lastMissionDate: t };
    });
    resetMissions();
    const id = setInterval(resetMissions, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, setState]);

  // ── Weekly & Monthly AI missions ───────────────────────────
  // Session-persistent guards — survive page reload within the same browser session.
  // Using sessionStorage means a refresh won't re-fire all background AI calls and
  // blow the free-tier RPM limit. Keys are namespaced by period so a new week/month
  // automatically gets a fresh attempt.
  const missionAttemptedRef = useRef({ weekly: false, monthly: false, _seeded: false });
  const missionGenRef = useRef({ weekly: false, monthly: false });
  if (!missionAttemptedRef.current._seeded) {
    try {
      missionAttemptedRef.current.weekly  = sessionStorage.getItem(`ritmol_mission_attempted_weekly_${localWeekKey()}`)  === "1";
      missionAttemptedRef.current.monthly = sessionStorage.getItem(`ritmol_mission_attempted_monthly_${localMonthKey()}`) === "1";
    } catch { /* sessionStorage unavailable */ }
    missionAttemptedRef.current._seeded = true;
  }

  useEffect(() => {
    if (!profile || !hasAiAuth) return;

    const wk = localWeekKey();
    const mo = localMonthKey();
    const abortControllers = { weekly: new AbortController(), monthly: new AbortController() };

    function tryGenerate(period) {
      const key     = period === "weekly" ? "weeklyMissions"         : "monthlyMissions";
      const dateKey = period === "weekly" ? "lastWeeklyMissionDate"  : "lastMonthlyMissionDate";
      const currentPeriodKey = period === "weekly" ? wk : mo;

      // Already in-flight or already attempted this session — never retry on 429
      if (missionGenRef.current[period] || missionAttemptedRef.current[period]) return;

      // Read current values directly from state (closure is fresh on each effect run)
      const currentMissions = period === "weekly" ? state?.weeklyMissions : state?.monthlyMissions;
      const currentDateKey  = period === "weekly" ? state?.lastWeeklyMissionDate : state?.lastMonthlyMissionDate;

      // Already have valid missions for this period — skip
      if (currentDateKey === currentPeriodKey && Array.isArray(currentMissions) && currentMissions.length > 0) return;

      // Skip if token budget exhausted
      const usage = state?.tokenUsage;
      if (usage && usage.date === todayUTC() && usage.tokens >= GEMINI_DAILY_TOKEN_LIMIT) return;

      // Mark attempted immediately — before the async call — so no re-render can sneak in a second call.
      // Also persist to sessionStorage so a page reload within the same session doesn't re-fire.
      missionAttemptedRef.current[period] = true;
      missionGenRef.current[period] = true;
      try {
        sessionStorage.setItem(`ritmol_mission_attempted_${period}_${currentPeriodKey}`, "1");
      } catch { /* sessionStorage unavailable */ }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        missionAttemptedRef.current[period] = false;
        missionGenRef.current[period] = false;
        try { sessionStorage.removeItem(`ritmol_mission_attempted_${period}_${currentPeriodKey}`); } catch { /* ignore */ }
        return;
      }

      getAiToken()
        .then((key) => {
          if (!key) throw new Error("NO_KEY");
          return generateAiMissions(key, profile, period, trackTokens, abortControllers[period].signal);
        })
        .then((missions) => {
          if (missions === null) {
            // Parse failure — write empty array but do NOT advance the date key
            // so the next app load retries generation.
            setState((s) => ({ ...s, [key]: [] }));
            return;
          }
          setState((s) => ({
            ...s,
            [key]: Array.isArray(missions) && missions.length ? missions : [],
            [dateKey]: currentPeriodKey,
          }));
        })
        .catch((err) => {
          // On abort (effect cleanup) or 429 (rate limit): clear the attempted flag
          // so the next session can retry, and do NOT advance the date key.
          const isAbort = err?.name === "AbortError";
          const isNoKey = err?.message === "NO_KEY";
          const isRateLimit = err?.message?.includes("429") || err instanceof RateLimitedError;
          if (isNoKey) {
            missionAttemptedRef.current[period] = false;
            try { sessionStorage.removeItem(`ritmol_mission_attempted_${period}_${currentPeriodKey}`); } catch { /* ignore */ }
            return;
          }
          if (isAbort || isRateLimit) {
            missionAttemptedRef.current[period] = false;
            try { sessionStorage.removeItem(`ritmol_mission_attempted_${period}_${currentPeriodKey}`); } catch { /* ignore */ }
            // On 429 specifically, write [] so the UI shows "no missions" this session
            // rather than a permanent spinner, but leave dateKey unset so next load retries.
            if (isRateLimit) setState((s) => ({ ...s, [key]: [] }));
            return;
          }
          // Other errors: write [] so the UI shows "no missions" instead of spinning forever.
          // Do NOT change the date key on failure — next app load can retry.
          setState((s) => ({ ...s, [key]: [] }));
        })
        .finally(() => { missionGenRef.current[period] = false; });
    }

    tryGenerate("weekly");
    // Stagger monthly by 20 s — gives the weekly call and dynamic-costs calls
    // time to clear the queue before monthly fires. The previous 8 s gap was too tight
    // when multiple other background calls were also starting up simultaneously,
    // causing back-to-back requests that triggered 429s on free-tier keys.
    const monthlyTimer = setTimeout(() => tryGenerate("monthly"), 20000);
    return () => {
      clearTimeout(monthlyTimer);
      abortControllers.weekly.abort();
      abortControllers.monthly.abort();
    };
  // Only re-run when profile or AI auth first becomes available — never on state changes.
  // profile.name is intentionally omitted: a name change does not warrant new missions,
  // and including it caused spurious re-runs that fired duplicate API calls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, !!hasAiAuth]);

  // ── Daily Google Calendar auto-sync ──────────────────────────
  // Fires once per day when the user has already connected GCal.
  // Uses a silent token request (prompt: "") so no popup appears —
  // Google reuses the existing session if the user has already consented.
  // On success:
  //   • fetches the rolling 14-day window of events
  //   • drops all past events (both GCal and manual) to keep the AI context lean
  //   • stamps gCalLastSync so it won't fire again today
  // On any failure (token expired, offline, etc.) it silently skips —
  // the user can always re-sync manually from the Calendar tab.
  const gCalAutoSyncRef = useRef(false);
  useEffect(() => {
    if (!profile || !state?.gCalConnected || !state?.gCalSelectedIds?.length) return;
    if (gCalAutoSyncRef.current) return;

    const todayStr = todayUTC();
    if (state.gCalLastSync === todayStr) return; // already synced today

    gCalAutoSyncRef.current = true;

    const clientId = profile?.googleClientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) { gCalAutoSyncRef.current = false; return; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { gCalAutoSyncRef.current = false; return; }

    (async () => {
      try {
        await loadGoogleGIS();
        const tokenResponse = await new Promise((resolve, reject) => {
          const tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: GCAL_SCOPE,
            // Empty prompt = silent re-auth using existing Google session.
            // If the session has expired this will reject and we skip silently.
            callback: (resp) => { if (resp.error) reject(new Error(resp.error)); else resolve(resp); },
          });
          tokenClient.requestAccessToken({ prompt: "" });
        });

        const accessToken = tokenResponse?.access_token;
        if (!accessToken) return;

        const freshEvents = await fetchGCalEvents(accessToken, state.gCalSelectedIds);
        const nowMs = Date.now();

        setState((s) => {
          // Keep only manual events that haven't started yet — past ones are pruned too.
          const keptManual = (s.calendarEvents || []).filter(
            (e) => e.source === "manual" && e.start && new Date(e.start).getTime() >= nowMs
          );
          return {
            ...s,
            calendarEvents: [...keptManual, ...freshEvents],
            gCalLastSync: todayStr,
          };
        });
      } catch {
        // Silent failure — user will see stale events until they sync manually.
        gCalAutoSyncRef.current = false;
      }
    })();
  // Run once on mount when profile and gCalConnected are ready.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, !!state?.gCalConnected]);

  useEffect(() => {
    const handler = () => showBanner("SYSTEM ALERT: Storage full! (~5MB). Clear old chat history or sessions.", "alert");
    window.addEventListener("ls-quota-exceeded", handler);
    return () => window.removeEventListener("ls-quota-exceeded", handler);
  }, [showBanner]);

  // Initialize onboarding flag once — only fires when IDB is first ready.
  // Using a ref guard prevents a subsequent setState() call (e.g. after a sync
  // pull) from re-triggering onboarding if profile is momentarily absent.
  const onboardingInitedRef = useRef(false);
  useEffect(() => {
    if (!idbReady || !state || onboardingInitedRef.current) return;
    onboardingInitedRef.current = true;
    setShowOnboarding(!state.profile);
  }, [idbReady, state]);

  // ── Render guards ────────────────────────────────────────
  if (!idbReady || state === null) {
    return (
      <ErrorBoundary>
        <SyncingScreen theme={theme} />
      </ErrorBoundary>
    );
  }


  // Onboarding must be checked BEFORE the !apiKey gate.
  // New users hit onboarding first (which has its own Dropbox → Gemini → profile
  // flow). The !apiKey gate is only for returning users whose sessionStorage
  // was cleared (e.g. new browser tab) without a sync file to pull from.
  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <Onboarding
          setState={setState}
          healthKitEnabled={state?.healthKitEnabled}
          onComplete={async (profile) => {
            setState((s) => ({ ...s, profile }));
            setShowOnboarding(false);
            // Clear the sliding rate-limit window so any background calls that fired
            // during onboarding (habit init, costs) don't eat into the new
            // user's first interactive session slots.
            clearRateLimitWindow();
            // Push immediately so the Gemini key (in sessionStorage) and the
            // new profile are written to Dropbox in one shot. Without this,
            // a fresh tab after onboarding shows MissingKeyGate because the
            // key never made it into the sync file.
            try { await syncPush(); } catch { /* non-fatal — user can push manually */ }
          }}
          onGeminiKeySaved={async (key, profile) => {
            setGeminiApiKey(key);
            if (profile) setState((s) => ({ ...s, profile }));
            await syncPush();
          }}
          connectDropbox={connectDropbox}
        />
      </ErrorBoundary>
    );
  }

  if (showGeminiKeySetup) {
    return (
      <ErrorBoundary>
        <div style={{
          minHeight: "calc(var(--vh, 1vh) * 100)", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "flex-start", padding: "24px", background: "#000",
        }}>
          <div style={{
            width: "100%", maxWidth: "380px", padding: "24px",
            background: "#000", border: "2px solid #fff",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "8px", fontWeight: "bold" }}>
              CONFIGURE AI
            </div>
            <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "18px", letterSpacing: "1px" }}>
              GEMINI API KEY
            </div>
            <GeminiKeySetupScreen
              onSave={async (key) => {
                setGeminiApiKey(key);
                await syncPush();
                setShowGeminiKeySetup(false);
              }}
            />
          </div>
        </div>
      </ErrorBoundary>
    );
  }
  if (!hasAiAuth) {
    // While the auto-pull on mount is in flight (Dropbox connected, pulling key),
    // show a loading screen instead of MissingKeyGate so the user never sees a
    // jarring "setup required" flash on a normal returning-user open.
    if (syncStatus === "syncing" || isReloading) {
      return (
        <ErrorBoundary>
          <SyncingScreen theme={theme} />
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
        <MissingKeyGate
          connectDropbox={connectDropbox}
          dropboxConnected={dropboxConnected}
          onGeminiKeySaved={async (key) => {
            setGeminiApiKey(key);
            await syncPush();
          }}
        />
      </ErrorBoundary>
    );
  }
  if (!profile && !showOnboarding) {
    return (
      <ErrorBoundary>
        <SyncingScreen theme={theme} />
      </ErrorBoundary>
    );
  }

  // ── Context value ────────────────────────────────────────
  const ctx = {
    state, setState, latestStateRef, rehydrate, profile, apiKey, theme, setTheme,
    level, rank, xpPerLevel, gachaCost, streakShieldCost,
    awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef,
    showBanner, showToast, setModal,
    syncStatus, lastSynced, dropboxConnected,
    syncPush, syncPull,
    connectDropbox, handleDropboxCallback, disconnectDropbox,
    buildSystemPrompt, setTab,
    rehydrateCount,
    getAiToken,
    hasAiAuth,
    requestNotificationPermission,
  };

  return (
    <AppContext.Provider value={ctx}>
      <GlobalStyles />
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: "#000", color: "#fff", overflow: "hidden", ...(isReloading ? { pointerEvents: "none", userSelect: "none" } : {}) }}>
        {isReloading && (
          <div
            aria-label="Syncing — please wait"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: theme === "light" ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.96)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Share Tech Mono', monospace",
              pointerEvents: "auto",
              userSelect: "none",
            }}
          >
            <div style={{ fontSize: "11px", color: theme === "light" ? "#000" : "#fff", letterSpacing: "3px", fontWeight: "bold", opacity: 0.7 }}>SYNC COMPLETE</div>
            <div style={{ fontSize: "16px", color: theme === "light" ? "#000" : "#fff", marginTop: "10px", fontWeight: "bold", letterSpacing: "3px" }}>[ RELOADING... ]</div>
            <div style={{
              width: "80px", height: "2px", marginTop: "16px",
              background: theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", left: "-40%", width: "40%", height: "100%",
                background: theme === "light" ? "#000" : "#fff",
                animation: "scan 1.2s linear infinite",
              }} />
            </div>
          </div>
        )}
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} theme={theme} />}
        {IS_DEV && (
          <div style={{ background: "#000", color: "#fff", fontSize: "16px", letterSpacing: "2px", padding: "8px 12px", textAlign: "center", borderBottom: "2px solid #fff", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>
            DEV MODE — separate localStorage (ritmol_dev_*)
          </div>
        )}
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} dropboxConnected={dropboxConnected || (IS_DEV && typeof window !== "undefined" && window.__RITMOL_TEST__)} isReloading={isReloading} theme={theme} onOpenSettings={() => setTab("settings")} />
        <div data-scroll="" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}>
          {tab === "home"     && <ErrorBoundary key="home"><HomeTab /></ErrorBoundary>}
          {tab === "habits"   && <ErrorBoundary key="habits"><HabitsTab /></ErrorBoundary>}
          {tab === "tasks"    && <ErrorBoundary key="tasks"><TasksTab /></ErrorBoundary>}
          {tab === "chat"     && <ErrorBoundary key="chat"><ChatTab /></ErrorBoundary>}
          {tab === "profile"  && <ErrorBoundary key="profile"><ProfileTab /></ErrorBoundary>}
          {tab === "settings" && <ErrorBoundary key="settings"><SettingsTab /></ErrorBoundary>}
        </div>
        <BottomNav tab={tab} setTab={setTab} theme={theme} />
        {state.tutorialDone === false && !showOnboarding && (
          <TutorialOverlay
            tab={tab}
            setTab={setTab}
            onDone={() => setState((s) => ({ ...s, tutorialDone: true }))}
          />
        )}

        {modal?.type === "daily_login"  && (
          <ErrorBoundary>
            <DailyLoginModal data={modal} onClose={() => setModal(null)} theme={theme} />
          </ErrorBoundary>
        )}
        {modal?.type === "sleep_checkin" && (
          <ErrorBoundary>
            <SleepCheckinModal onClose={() => setModal(null)} theme={theme} onSubmit={(data) => {
              const safeHours   = Math.min(Math.max(0, Number(data.hours)   || 0), 24);
              const safeQuality = Math.min(Math.max(1, Number(data.quality) || 1), 5);
              const safeRested  = typeof data.rested === "boolean" ? data.rested : false;
              setState((s) => {
                const t = localDateFromUTC(); // match scheduler's localDateFromUTC() check
                return ({ ...s, sleepLog: { ...s.sleepLog, [t]: { hours: safeHours, quality: safeQuality, rested: safeRested } } });
              });
              awardXP(20, null, true); showBanner("Sleep data logged. +20 XP", "success"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {modal?.type === "screen_time" && (
          <ErrorBoundary>
            <ScreenTimeModal period={modal.period} onClose={() => setModal(null)} theme={theme} onSubmit={(mins) => {
              const safeMins = Math.min(Math.max(0, Number(mins) || 0), 480);
              setState((s) => {
                const key = localDateFromUTC(); // match scheduler's localDateFromUTC() check
                // Allowlist modal.period so arbitrary strings cannot become IDB sub-keys.
                const safePeriod = modal.period === "afternoon" || modal.period === "evening"
                  ? modal.period
                  : "afternoon";
                return {
                  ...s,
                  screenTimeLog: {
                    ...s.screenTimeLog,
                    [key]: { ...(s.screenTimeLog?.[key] || {}), [safePeriod]: safeMins },
                  },
                };
              });
              const xp = safeMins < 60 ? 40 : safeMins < 120 ? 25 : safeMins < 180 ? 15 : 10;
              awardXP(xp, null, true); showBanner(`Screen time logged. ${safeMins < 60 ? "Impressive discipline." : "Noted."} +${xp} XP`, safeMins < 60 ? "success" : "info"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {modal?.type === "session_log" && (
          <ErrorBoundary>
            <SessionLogModal onClose={() => setModal(null)} state={state} theme={theme} onSubmit={(session) => {
              const xp = calcSessionXP(session.type, session.duration, session.focus, state.streak);
              // eslint-disable-next-line no-control-regex
              const san = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[<>"'`&]/g, "").slice(0, max) : "";
              const newSession = {
                id: `session_${crypto.randomUUID()}`,
                date: todayUTC(),
                xp,
                type: SESSION_TYPES.find((s) => s.id === session.type) ? session.type : SESSION_TYPES[0].id,
                course: san(session.course, 100),
                duration: Math.min(Math.max(0, Number(session.duration) || 0), 600),
                focus: ["low", "medium", "high"].includes(session.focus) ? session.focus : "medium",
                notes: san(session.notes, 300),
              };
              setState((s) => {
                if ((s.sessions || []).length >= 10000) return s;
                return { ...s, sessions: [...(s.sessions || []), newSession] };
              });
              awardXP(xp, null, true);
              showBanner(`${SESSION_TYPES.find((s) => s.id === session.type)?.label} logged. +${xp} XP`, "success");
              checkMissions("session"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {levelUpData && (
          <ErrorBoundary>
            <LevelUpModal data={levelUpData} onClose={() => setLevelUpData(null)} theme={theme} />
          </ErrorBoundary>
        )}
        {toast && (
          <ErrorBoundary>
            <AchievementToast key={toast._id} toast={toast} onClose={() => setToast(null)} theme={theme} />
          </ErrorBoundary>
        )}
      </div>
    </AppContext.Provider>
  );
}

export { GlobalStyles, ErrorBoundary };
