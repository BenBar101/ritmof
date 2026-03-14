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
import { LS, storageKey, IS_DEV, getGeminiApiKey, setGeminiApiKey, todayUTC, APP_ICON_URL } from "./utils/storage";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "./constants";
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchDailyQuote } from "./api/quotes";
import { SyncManager, FSAPI_SUPPORTED } from "./sync/SyncManager";

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
function KeysConfigGate({ resetPullMutex }) {
  const [syncFileConnected, setSyncFileConnected] = useState(false);
  const [syncChecking,      setSyncChecking]      = useState(true);
  const [syncError,         setSyncError]         = useState("");
  const [syncStatus,        setSyncStatus]        = useState("idle");
  const hasMissingKey = !getGeminiApiKey();

  useEffect(() => {
    if (!hasMissingKey || !FSAPI_SUPPORTED) { setSyncChecking(false); return; }
    let cancelled = false;
    SyncManager.getHandle()
      .then((h) => { if (!cancelled) { setSyncFileConnected(!!h); setSyncChecking(false); } })
      .catch(() => { if (!cancelled) setSyncChecking(false); });
    return () => { cancelled = true; };
  }, [hasMissingKey]);

  async function handlePickSyncFile() {
    if (!FSAPI_SUPPORTED) return;
    setSyncError("");
    try { await SyncManager.pickFile(); setSyncFileConnected(true); }
    catch (e) { if (e.name !== "AbortError") setSyncError("Could not link file. Try again."); }
  }

  async function handleLoadFromFile() {
    if (!FSAPI_SUPPORTED) return;
    setSyncError(""); setSyncStatus("syncing");
    window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
    try {
      await SyncManager.pull();
      LS.set(storageKey("jv_last_synced"), String(Date.now()));
      setSyncStatus("synced");
      // Wait briefly for any fire-and-forget IDB writes triggered by Pull to
      // flush, then attempt a hard reload. If reload is blocked (CSP, tests),
      // fall back to replacing location without query/hash so the new data is
      // picked up without leaving the app in a half-reloaded state.
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          try {
            window.location.href = window.location.origin + window.location.pathname;
          } catch {
            // As a last resort, do nothing — state has already been updated
            // from the sync payload, so the app remains usable even without
            // a full reload. Release pull mutex so auto-push can resume if
            // we're in a context that uses it.
            resetPullMutex?.();
          }
        }
      }, 250);
    } catch (e) {
      setSyncStatus("error");
      const msgs = { NO_HANDLE: "No sync file linked yet.", CORRUPT_FILE: "Sync file is corrupt or not valid JSON.", SYNC_SCHEMA_OUTDATED: "Sync file was written by an older version of RITMOL.", SYNC_FILE_TOO_LARGE: "Sync file exceeds 10 MB. Check the file.", SYNC_BUSY: "Sync already in progress. Please wait." };
      setSyncError(msgs[e.message] ?? "Pull failed. Check your sync file and try again.");
    }
  }

  if (!hasMissingKey) return null;
  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const btnBase = { width: "100%", padding: "10px", ...mono, fontSize: "11px", letterSpacing: "2px", cursor: "pointer" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a0a", color: "#e8e8e8", ...mono, padding: "24px", textAlign: "center" }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 48, height: 48, marginBottom: "16px" }} />
      <div style={{ fontSize: "11px", color: "#666", letterSpacing: "2px", marginBottom: "16px" }}>RITMOL — CONFIGURATION REQUIRED</div>
      <div style={{ color: "#c44", fontSize: "12px", maxWidth: "420px", lineHeight: "1.8", marginBottom: "20px" }}>
        No Gemini API key found. Add <code>&ldquo;geminiKey&rdquo;: &ldquo;AIza...&rdquo;</code> to your <code>ritmol-data.json</code> and link it below.
      </div>
      {FSAPI_SUPPORTED ? (
        <div style={{ maxWidth: "420px", width: "100%", textAlign: "left", border: "1px solid #333", padding: "16px", fontSize: "11px", color: "#aaa" }}>
          <div style={{ fontSize: "10px", color: "#777", letterSpacing: "2px", marginBottom: "8px" }}>STEP 1 — LINK YOUR SYNC FILE</div>
          <div style={{ marginBottom: "10px", lineHeight: "1.8" }}>Pick <code>ritmol-data.json</code> inside your Syncthing folder.</div>
          <button type="button" onClick={handlePickSyncFile} disabled={syncChecking} style={{ ...btnBase, border: "2px solid #fff", background: "#fff", color: "#000", marginBottom: "10px" }}>
            {syncFileConnected ? "✓ SYNC FILE LINKED" : "LINK SYNCTHING FILE →"}
          </button>
          <div style={{ fontSize: "10px", color: "#777", marginTop: "8px", lineHeight: "1.6" }}>STEP 2 — After your file contains <code>geminiKey</code>, load it:</div>
          <button type="button" onClick={handleLoadFromFile} disabled={!syncFileConnected || syncStatus === "syncing"} style={{ ...btnBase, marginTop: "8px", border: "1px solid #444", background: !syncFileConnected || syncStatus === "syncing" ? "#151515" : "transparent", color: !syncFileConnected || syncStatus === "syncing" ? "#444" : "#ccc" }}>
            {syncStatus === "syncing"
              ? "LOADING FROM FILE..."
              : syncStatus === "synced"
              ? "✓ LOADED — RELOADING…"
              : "LOAD KEY FROM SYNC FILE ↓"}
          </button>
          {syncError && <div style={{ marginTop: "8px", color: "#c44", fontSize: "10px" }}>⚠ {syncError}</div>}
        </div>
      ) : (
        <div style={{ fontSize: "11px", color: "#777", maxWidth: "420px", lineHeight: "1.8" }}>
          Your browser does not support direct file access. Use <strong>Download / Import</strong> in Profile → Settings after setup.
        </div>
      )}
      <div style={{ fontSize: "10px", color: "#555", marginTop: "24px" }}>See README — Gemini API Key & Sync sections.</div>
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

  const { syncFileConnected, dropboxConnected, syncStatus, lastSynced, confirmForgetSync, syncPush, syncPull, pickSyncFile, forgetSyncFile, connectDropbox, handleDropboxCallback, disconnectDropbox, resetPullMutex } =
    useSync({ latestStateRef, rehydrate, showBanner });

  // OAuth callback: when returning from Dropbox, exchange code and pull
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const stateParam = params.get("state");
    if (code && stateParam === "dropbox") {
      window.history.replaceState({}, "", window.location.pathname);
      handleDropboxCallback(code, {
        onNeedsGeminiKey: () => setShowGeminiKeySetup(true),
      });
    }
  }, [handleDropboxCallback]);

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
      const t = todayUTC();
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
      .then(setDailyQuote)
      .catch(() => {
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

  // Initialize onboarding flag once IDB-backed state is ready.
  useEffect(() => {
    if (!idbReady || !state) return;
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
  if (!apiKey) return <ErrorBoundary><KeysConfigGate resetPullMutex={resetPullMutex} /></ErrorBoundary>;
  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={(profile) => {
          setState((s) => ({ ...s, profile }));
          setShowOnboarding(false);
        }}
        showGeminiKeySetup={showGeminiKeySetup}
        onGeminiKeySaved={async (key, profile) => {
          setGeminiApiKey(key);
          if (profile) setState((s) => ({ ...s, profile }));
          await syncPush();
          setShowGeminiKeySetup(false);
          setShowOnboarding(false);
        }}
        connectDropbox={connectDropbox}
      />
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
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}
        {IS_DEV && (
          <div style={{ background: "#2a2a0a", color: "#b8b830", fontSize: "10px", letterSpacing: "1px", padding: "4px 12px", textAlign: "center", borderBottom: "1px solid #444" }}>
            DEV MODE — separate localStorage (ritmol_dev_*)
          </div>
        )}
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} streak={state.streak} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} syncFileConnected={syncFileConnected} />
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
              setState((s) => ({ ...s, sleepLog: { ...s.sleepLog, [todayUTC()]: { hours: safeHours, quality: safeQuality, rested: safeRested } } }));
              awardXP(20, null, true); showBanner("Sleep data logged. +20 XP", "success"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {modal?.type === "screen_time" && (
          <ErrorBoundary>
            <ScreenTimeModal period={modal.period} onClose={() => setModal(null)} onSubmit={(mins) => {
              const safeMins = Math.min(Math.max(0, Number(mins) || 0), 480);
              setState((s) => {
                const key = todayUTC();
                return {
                  ...s,
                  screenTimeLog: {
                    ...s.screenTimeLog,
                    [key]: { ...(s.screenTimeLog?.[key] || {}), [modal.period]: safeMins },
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
