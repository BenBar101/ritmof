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
import { LS, storageKey, IS_DEV, getGeminiApiKey, setGeminiApiKey, todayUTC, localDateFromUTC, APP_ICON_URL } from "./utils/storage";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "./constants";
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchDailyQuote } from "./api/quotes";
import { FSAPI_SUPPORTED } from "./sync/SyncManager";
import { verifyOAuthState } from "./api/dropbox";

const MISSION_DEFS = [
  { id: "m1", desc: "Complete 3 habits",  target: 3,  type: "habits",  xp: 100, done: false },
  { id: "m2", desc: "Complete 6 habits",  target: 6,  type: "habits",  xp: 200, done: false },
  { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits",  xp: 500, done: false },
  { id: "m4", desc: "Log a study session",target: 1,  type: "session", xp: 75,  done: false },
  { id: "m5", desc: "Complete a task",    target: 1,  type: "task",    xp: 50,  done: false },
  { id: "m6", desc: "Open RITMOL chat",   target: 1,  type: "chat",    xp: 25,  done: false },
];

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

  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const btnPrimary = {
    width: "100%", padding: "13px", border: "2px solid #fff", background: "#fff", color: "#000",
    ...mono, fontSize: "11px", letterSpacing: "2px", cursor: "pointer", marginBottom: "10px",
  };
  const btnSecondary = {
    width: "100%", padding: "11px", border: "1px solid #444", background: "transparent", color: "#888",
    ...mono, fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
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
        NO_HANDLE:            "No sync file linked yet.",
        CORRUPT_FILE:         "Sync file is corrupt or not valid JSON.",
        SYNC_SCHEMA_OUTDATED: "Sync file was written by an older version of RITMOL.",
        SYNC_FILE_TOO_LARGE:  "Sync file exceeds 10 MB.",
        SYNC_BUSY:            "Sync already in progress. Please wait.",
        IDB_NOT_READY:        "Still loading, try again in a moment.",
      };
      setSyncError(msgs[e?.message] ?? "Pull failed. Check your sync file and try again.");
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "32px 24px", background: "#0a0a0a",
      color: "#e8e8e8", ...mono,
    }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 44, height: 44, marginBottom: "20px", marginTop: "24px" }} />
      <div style={{ fontSize: "11px", color: "#555", letterSpacing: "3px", marginBottom: "6px" }}>RITMOL</div>
      <div style={{ fontSize: "20px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "6px" }}>
        {mode === "gemini" ? "GEMINI API KEY" : mode === "syncthing" ? "LOAD FROM FILE" : "SETUP REQUIRED"}
      </div>
      <div style={{ fontSize: "12px", color: "#666", marginBottom: "28px" }}>
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
                <div style={{ fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "10px" }}>
                  RETURNING USER? PULL FROM SYNC
                </div>
                <button type="button" onClick={handleConnectDropbox} style={btnPrimary}>
                  CONNECT DROPBOX ↗
                </button>
                {dropboxError && <div style={{ color: "#c44", fontSize: "10px", marginBottom: "10px" }}>⚠ {dropboxError}</div>}
                {FSAPI_SUPPORTED && (
                  <button type="button" onClick={() => setMode("syncthing")} style={{ ...btnSecondary, marginBottom: "24px" }}>
                    LOAD FROM SYNCTHING FILE
                  </button>
                )}
                <div style={{ height: "1px", background: "#222", marginBottom: "24px" }} />
              </>
            )}
            <div style={{ fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "10px" }}>
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
            <div style={{ fontSize: "11px", color: "#888", lineHeight: "1.8", marginBottom: "16px" }}>
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
                opacity: (!syncFileLinked || syncStatus === "syncing") ? 0.4 : 1,
                cursor: (!syncFileLinked || syncStatus === "syncing") ? "not-allowed" : "pointer",
                marginBottom: "12px",
              }}
            >
              {syncStatus === "syncing" ? "LOADING..." : syncStatus === "synced" ? "✓ LOADED — RELOADING…" : "PULL FROM FILE ↓"}
            </button>
            {syncError && <div style={{ color: "#c44", fontSize: "10px", marginBottom: "8px" }}>⚠ {syncError}</div>}
            <button type="button" onClick={() => { setMode("choose"); setSyncError(""); setSyncStatus("idle"); }} style={btnSecondary}>
              ← BACK
            </button>
          </>
        )}

      </div>

      <div style={{ fontSize: "10px", color: "#333", marginTop: "32px" }}>
        RITMOL v1.0 // ZERO TELEMETRY
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
  const [dailyQuote, setDailyQuote] = useState(null);
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
  }, [handleDropboxCallback, showBanner]);

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
    meta.setAttribute("content", theme === "light" ? "#f0f0f0" : "#0a0a0a");
  }, [theme]);

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
      // Use localDateFromUTC() to match useGameEngine.checkMissions which reads
      // mission progress against the local calendar date (habit log, session, task doneDate).
      // Using todayUTC() here caused the reset and progress-check to use different date keys
      // in non-UTC timezones, resulting in missions that could never complete.
      const t = localDateFromUTC();
      if (s.lastMissionDate === t) return s;
      return { ...s, dailyMissions: [...MISSION_DEFS], lastMissionDate: t };
    });
    resetMissions();
    const id = setInterval(resetMissions, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable (useCallback with [] dep); !!profile is the only meaningful trigger
  }, [!!profile, setState]);

  const quoteFetchedRef = useRef(false);
  useEffect(() => {
    if (!profile || quoteFetchedRef.current) return;
    quoteFetchedRef.current = true;
    fetchDailyQuote(null, profile, null)
      .then((result) => {
        if (result === null) {
          // fetchDailyQuote returns null when offline (no cache yet) or in-flight.
          // Do not set the hardcoded fallback — let the quote area stay blank so
          // the next mount (e.g. after regaining connectivity) can retry.
          quoteFetchedRef.current = false;
          return;
        }
        setDailyQuote(result);
      })
      .catch(() => {
        // Network error after fetch was attempted (connectivity was present but
        // request failed). Show the static fallback — do not reset the ref so
        // we do not hammer a flaky network on every render.
        setDailyQuote({
          quote: "The secret of getting ahead is getting started.",
          author: "Mark Twain",
        });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile]);

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
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "#0a0a0a",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          color: "#333", letterSpacing: "2px",
        }}>
          INITIALISING...
        </div>
      </ErrorBoundary>
    );
  }


  if (showGeminiKeySetup) {
    return (
      <ErrorBoundary>
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "flex-start", padding: "24px", background: "#0a0a0a",
        }}>
          <div style={{
            width: "100%", maxWidth: "380px", padding: "24px",
            background: "#050505", border: "1px solid #444",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "11px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>
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
  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <Onboarding
          onComplete={(profile) => {
            setState((s) => ({ ...s, profile }));
            setShowOnboarding(false);
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
  if (!profile && !showOnboarding) {
    return (
      <ErrorBoundary>
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "#0a0a0a",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          color: "#333", letterSpacing: "2px",
        }}>
          INITIALISING...
        </div>
      </ErrorBoundary>
    );
  }

  // ── Context value ────────────────────────────────────────
  const ctx = {
    state, setState, latestStateRef, profile, apiKey, theme, setTheme,
    level, rank, xpPerLevel, gachaCost, streakShieldCost,
    awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef,
    showBanner, showToast, setModal,
    syncStatus, lastSynced, syncFileConnected, dropboxConnected, confirmForgetSync,
    syncPush, syncPull, pickSyncFile, forgetSyncFile,
    connectDropbox, handleDropboxCallback, disconnectDropbox,
    dailyQuote, buildSystemPrompt, setTab,
    rehydrateCount,
  };

  return (
    <AppContext.Provider value={ctx}>
      <GlobalStyles />
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0a0a0a", color: "#e8e8e8", overflow: "hidden" }}>
        {isReloading && (
          <div
            aria-label="Syncing — please wait"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: "rgba(0,0,0,0.85)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Share Tech Mono', monospace",
              pointerEvents: "all",
            }}
          >
            <div style={{ fontSize: "11px", color: "#666", letterSpacing: "3px" }}>SYNC COMPLETE</div>
            <div style={{ fontSize: "13px", color: "#aaa", marginTop: "8px" }}>Reloading…</div>
          </div>
        )}
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}
        {IS_DEV && (
          <div style={{ background: "#2a2a0a", color: "#b8b830", fontSize: "10px", letterSpacing: "1px", padding: "4px 12px", textAlign: "center", borderBottom: "1px solid #444" }}>
            DEV MODE — separate localStorage (ritmol_dev_*)
          </div>
        )}
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} streak={state.streak} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} syncFileConnected={syncFileConnected} isReloading={isReloading} />
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "70px", paddingTop: "56px" }}>
          {tab === "home"    && <ErrorBoundary key="home"><HomeTab /></ErrorBoundary>}
          {tab === "habits"  && <ErrorBoundary key="habits"><HabitsTab /></ErrorBoundary>}
          {tab === "tasks"   && <ErrorBoundary key="tasks"><TasksTab /></ErrorBoundary>}
          {tab === "chat"    && <ErrorBoundary key="chat"><ChatTab /></ErrorBoundary>}
          {tab === "profile" && <ErrorBoundary key="profile"><ProfileTab /></ErrorBoundary>}
        </div>
        <BottomNav tab={tab} setTab={setTab} />

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
        <button type="button" onClick={() => setModal({ type: "session_log" })}
          style={{ position: "fixed", bottom: "80px", right: "16px", zIndex: 100, width: "48px", height: "48px", borderRadius: "0", background: "#fff", color: "#000", fontFamily: "'Share Tech Mono', monospace", fontSize: "18px", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}
          title="Log Study Session">▶</button>
      </div>
    </AppContext.Provider>
  );
}

export { GlobalStyles, ErrorBoundary };
