import React, { useState, useEffect, useRef, useCallback } from "react";

// Hooks
import { useAppState }   from "./hooks/useAppState";
import { useUI }         from "./hooks/useUI";
import { useSync }       from "./hooks/useSync";
import { useGameEngine } from "./hooks/useGameEngine";
import { useScheduler }  from "./hooks/useScheduler";
import { useDailyLogin } from "./hooks/useDailyLogin";

// Context
import { AppContext } from "./context/AppContext";

// Utils
import { LS, storageKey, IS_DEV, getGeminiApiKey, setGeminiApiKey, todayUTC, localDateFromUTC, APP_ICON_URL } from "./utils/db";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "./constants";
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchGCalEvents, loadGoogleGIS } from "./api/gcal";
import { clearRateLimitWindow } from "./api/gemini";
import { FSAPI_SUPPORTED } from "./sync/SyncManager";
import { verifyOAuthState } from "./api/dropbox";

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
function MissingKeyGate({ connectDropbox, dropboxConnected, pickSyncFile, syncPull, resetPullMutex, onGeminiKeySaved }) {
  const [mode, setMode]           = useState("choose"); // "choose" | "gemini" | "syncthing"
  const [syncFileLinked, setSyncFileLinked] = useState(false);
  const [syncStatus, setSyncStatus]         = useState("idle"); // "idle" | "syncing" | "synced" | "error"
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

  async function handleSyncthingLink() {
    setSyncError("");
    try {
      await pickSyncFile();
      setSyncFileLinked(true);
    } catch (e) {
      if (e?.name !== "AbortError") setSyncError("Could not link file. Try again.");
    }
  }

  async function handleSyncthingPull() {
    setSyncError(""); setSyncStatus("syncing");
    window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
    try {
      await syncPull();
      setSyncStatus("synced");
      setTimeout(() => {
        try { window.location.reload(); } catch {
          try { window.location.href = window.location.origin + window.location.pathname; }
          catch { resetPullMutex?.(); }
        }
        setTimeout(() => resetPullMutex?.(), 3000);
      }, 250);
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:              "No sync file linked yet. Use the button above to link your file.",
        CORRUPT_FILE:           "Sync file is corrupt or not valid JSON. Re-export from another device.",
        SYNC_SCHEMA_OUTDATED:   "Sync file was written by an older version of RITMOL. Update the app first.",
        SYNC_FILE_TOO_LARGE:    "Sync file exceeds 10 MB. Check for unusually large chat or session history.",
        SYNC_BUSY:              "Sync already in progress. Please wait a moment and try again.",
        IDB_NOT_READY:          "Still loading — try again in a moment.",
        DROPBOX_FILE_NOT_FOUND: "No RITMOL file found in Dropbox. Push from another device first.",
        DROPBOX_OFFLINE:        "No network connection. Connect to the internet and try again.",
        DROPBOX_TOKEN_EXPIRED:  "Dropbox session expired. Reconnect Dropbox and try again.",
      };
      setSyncError(msgs[e?.message] ?? "Pull failed. Check your sync file and try again.");
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
          {FSAPI_SUPPORTED && (
            <button type="button" onClick={() => setMode("syncthing")} style={{ ...btnSecondary, marginBottom: 0, fontSize: "13px" }}>
              LOAD FROM FILE
            </button>
          )}
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
        {mode === "gemini" ? "GEMINI API KEY" : mode === "syncthing" ? "LOAD FROM FILE" : "SETUP REQUIRED"}
      </div>
      <div style={{ fontSize: "16px", color: "#fff", marginBottom: "28px", fontFamily: "'Share Tech Mono', monospace" }}>
        {mode === "gemini"   ? "Enter your key to enable AI features." :
         mode === "syncthing" ? "Pull your data file to restore your config." :
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
                {FSAPI_SUPPORTED && (
                  <button type="button" onClick={() => setMode("syncthing")} style={{ ...btnSecondary, marginBottom: "24px" }}>
                    LOAD FROM SYNCTHING FILE
                  </button>
                )}
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

        {/* ── Syncthing pull ── */}
        {mode === "syncthing" && (
          <>
            <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.8", marginBottom: "16px", fontFamily: "'Share Tech Mono', monospace" }}>
              Link your <code>ritmol-data.json</code> from your Syncthing folder, then pull to load your Gemini key and data.
            </div>
            <button type="button" onClick={handleSyncthingLink} style={btnPrimary}>
              {syncFileLinked ? "✓ FILE LINKED" : "LINK SYNC FILE →"}
            </button>
            <button
              type="button"
              onClick={handleSyncthingPull}
              disabled={!syncFileLinked || syncStatus === "syncing"}
              style={{
                ...btnSecondary,
                color: (!syncFileLinked || syncStatus === "syncing") ? "#555" : "#fff",
                border: (!syncFileLinked || syncStatus === "syncing") ? "2px solid #555" : "2px solid #fff",
                cursor: (!syncFileLinked || syncStatus === "syncing") ? "not-allowed" : "pointer",
                marginBottom: "12px",
              }}
            >
              {syncStatus === "syncing" ? "LOADING..." : syncStatus === "synced" ? "✓ LOADED — RELOADING…" : "PULL FROM FILE ↓"}
            </button>
            {syncError && <div style={{ color: "#fff", fontSize: "16px", marginBottom: "8px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {syncError}</div>}
            <button type="button" onClick={() => { setMode("choose"); setSyncError(""); setSyncStatus("idle"); }} style={btnSecondary}>
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
  const xpPerLevel       = state ? getXpPerLevel(state) : DEFAULT_XP_PER_LEVEL;
  const level            = state ? getLevel(state.xp, xpPerLevel) : 0;
  const rank             = getRank(level);
  const gachaCost        = state ? getGachaCost(state) : DEFAULT_GACHA_COST;
  const streakShieldCost = state ? getStreakShieldCost(state) : DEFAULT_STREAK_SHIELD_COST;

  const { awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef, lastLevelUpXpRef } =
    useGameEngine({ setState, latestStateRef, showBanner, showToast, setLevelUpData });

  const { syncFileConnected, dropboxConnected, syncStatus, lastSynced, confirmForgetSync, syncPush, syncPull, pickSyncFile, forgetSyncFile, connectDropbox, handleDropboxCallback, disconnectDropbox, isReloading, resetPullMutex } =
    useSync({ latestStateRef, rehydrate, showBanner });

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

  useDailyLogin({ profile, setState, setModal, setLevelUpData, showBanner, trackTokens, lastLevelUpXpRef });
  useScheduler({ state, profile, showBanner, setModal });

  // Handle "mark reminded" event dispatched by useScheduler
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
            scope: "https://www.googleapis.com/auth/calendar.readonly",
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
  if (!apiKey) {
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
          pickSyncFile={pickSyncFile}
          syncPull={syncPull}
          resetPullMutex={resetPullMutex}
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
    syncStatus, lastSynced, syncFileConnected, dropboxConnected, confirmForgetSync,
    syncPush, syncPull, pickSyncFile, forgetSyncFile,
    connectDropbox, handleDropboxCallback, disconnectDropbox,
    buildSystemPrompt, setTab,
    rehydrateCount,
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
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}
        {IS_DEV && (
          <div style={{ background: "#000", color: "#fff", fontSize: "16px", letterSpacing: "2px", padding: "8px 12px", textAlign: "center", borderBottom: "2px solid #fff", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>
            DEV MODE — separate localStorage (ritmol_dev_*)
          </div>
        )}
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} syncFileConnected={syncFileConnected || (IS_DEV && typeof window !== "undefined" && window.__RITMOL_TEST__)} isReloading={isReloading} theme={theme} onOpenSettings={() => setTab("settings")} />
        <div data-scroll="" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}>
          {tab === "home"     && <ErrorBoundary key="home"><HomeTab /></ErrorBoundary>}
          {tab === "habits"   && <ErrorBoundary key="habits"><HabitsTab /></ErrorBoundary>}
          {tab === "tasks"    && <ErrorBoundary key="tasks"><TasksTab /></ErrorBoundary>}
          {tab === "chat"     && <ErrorBoundary key="chat"><ChatTab /></ErrorBoundary>}
          {tab === "profile"  && <ErrorBoundary key="profile"><ProfileTab /></ErrorBoundary>}
          {tab === "settings" && <ErrorBoundary key="settings"><SettingsTab /></ErrorBoundary>}
        </div>
        <BottomNav tab={tab} setTab={setTab} />
        {state.tutorialDone === false && !showOnboarding && (
          <TutorialOverlay
            tab={tab}
            setTab={setTab}
            onDone={() => setState((s) => ({ ...s, tutorialDone: true }))}
          />
        )}

        {modal?.type === "daily_login"  && (
          <ErrorBoundary>
            <DailyLoginModal data={modal} onClose={() => setModal(null)} />
          </ErrorBoundary>
        )}
        {modal?.type === "sleep_checkin" && (
          <ErrorBoundary>
            <SleepCheckinModal onClose={() => setModal(null)} onSubmit={(data) => {
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
            <ScreenTimeModal period={modal.period} onClose={() => setModal(null)} onSubmit={(mins) => {
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
            <SessionLogModal onClose={() => setModal(null)} state={state} onSubmit={(session) => {
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
            <LevelUpModal data={levelUpData} onClose={() => setLevelUpData(null)} />
          </ErrorBoundary>
        )}
        {toast && (
          <ErrorBoundary>
            <AchievementToast key={toast._id} toast={toast} onClose={() => setToast(null)} />
          </ErrorBoundary>
        )}
      </div>
    </AppContext.Provider>
  );
}

export { GlobalStyles, ErrorBoundary };
