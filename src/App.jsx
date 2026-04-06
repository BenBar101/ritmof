import React, { useState, useEffect, useRef, useCallback } from "react";

// Hooks
import { useAppState }   from "./hooks/useAppState";
import { useUI }         from "./hooks/useUI";
import { useSync }       from "./hooks/useSync";
import { useGameEngine } from "./hooks/useGameEngine";
import { useNotifications } from "./hooks/useNotifications";
import { useDailyLogin } from "./hooks/useDailyLogin";
import { useHealthKit } from "./hooks/useHealthKit";

// Context
import { AppContext } from "./context/AppContext";

// Utils
import { LS, storageKey, IS_DEV, todayUTC, localDateFromUTC } from "./utils/db";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "./constants";
import { OAUTH_REDIRECT_SCHEME } from "./config.js";
import { fetchGCalEvents, requestGcalAccessToken } from "./api/gcal";
import { clearRateLimitWindow } from "./api/gemini";
import { localWeekKey, localMonthKey } from "./utils/missionPeriod.js";
import { pickStaticPeriodMissions } from "./game/pickStaticPeriodMissions.js";
import { verifyOAuthState } from "./api/dropbox";
import { App as CapApp } from "@capacitor/app";
import { handleGoogleOAuthCallback } from "./api/googleAuth";
const MISSION_DEFS = [
  { id: "m1", desc: "Complete 3 habits",  target: 3,  type: "habits",  xp: 100, done: false },
  { id: "m2", desc: "Complete 6 habits",  target: 6,  type: "habits",  xp: 200, done: false },
  { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits",  xp: 500, done: false },
  { id: "m4", desc: "Log a study session",target: 1,  type: "session", xp: 75,  done: false },
  { id: "m5", desc: "Complete a task",    target: 1,  type: "task",    xp: 50,  done: false },
  { id: "m6", desc: "Complete 4 habits",  target: 4,  type: "habits",  xp: 25,  done: false },
];

// Components
import Onboarding from "./Onboarding";
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
import ProfileTab from "./ProfileTab";
import SettingsTab from "./SettingsTab";
import TutorialOverlay from "./TutorialOverlay";
import CalendarOverlay from "./CalendarOverlay";

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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [theme, setThemeState]      = useState(() => LS.get(storageKey(THEME_KEY), "dark"));
  const [showOnboarding, setShowOnboarding] = useState(false);
  const setTheme = useCallback((t) => { LS.set(storageKey(THEME_KEY), t); setThemeState(t); }, []);

  const { modal, setModal, toast, setToast, banner, setBanner, levelUpData, setLevelUpData, showToast, showBanner } = useUI();

  const profile          = state?.profile;
  const xpPerLevel       = state ? getXpPerLevel(state) : DEFAULT_XP_PER_LEVEL;
  const level            = state ? getLevel(state.xp, xpPerLevel) : 0;
  const rank             = getRank(level);
  const gachaCost        = state ? getGachaCost(state) : DEFAULT_GACHA_COST;
  const streakShieldCost = state ? getStreakShieldCost(state) : DEFAULT_STREAK_SHIELD_COST;

  const { awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef, lastLevelUpXpRef } =
    useGameEngine({ setState, latestStateRef, showBanner, showToast, setLevelUpData });

  const { dropboxConnected, syncStatus, lastSynced, syncPush, syncPull, connectDropbox, handleDropboxCallback, disconnectDropbox, isReloading } =
    useSync({ latestStateRef, rehydrate, showBanner });

  const { requestNotificationPermission } = useNotifications({
    state, profile, showBanner, setModal, setState,
  });
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
      handleDropboxCallback(code, {});
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
              handleDropboxCallback(c, {});
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

  useDailyLogin({ profile, setState, setModal, setLevelUpData, showBanner, lastLevelUpXpRef });

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
    if (!profile?.geminiKey && !profile?.aiApiKey) return;
    setState((s) => {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _g, aiApiKey: _a, ...rest } = s.profile || {};
      return { ...s, profile: rest };
    });
  }, [profile?.geminiKey, profile?.aiApiKey, setState]);

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

  // ── Weekly & Monthly missions (static pools, rotated per period) ──
  useEffect(() => {
    if (!profile) return;
    const wk = localWeekKey();
    const mo = localMonthKey();
    setState((s) => {
      const updates = {};
      if (s.lastWeeklyMissionDate !== wk || !Array.isArray(s.weeklyMissions) || s.weeklyMissions.length === 0) {
        updates.weeklyMissions = pickStaticPeriodMissions("weekly", wk, profile);
        updates.lastWeeklyMissionDate = wk;
      }
      if (s.lastMonthlyMissionDate !== mo || !Array.isArray(s.monthlyMissions) || s.monthlyMissions.length === 0) {
        updates.monthlyMissions = pickStaticPeriodMissions("monthly", mo, profile);
        updates.lastMonthlyMissionDate = mo;
      }
      if (Object.keys(updates).length === 0) return s;
      return { ...s, ...updates };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, setState]);

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
        const tokenResponse = await requestGcalAccessToken(clientId, { promptConsent: false });

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
    const handler = () => showBanner("SYSTEM ALERT: Storage full! (~5MB). Clear old sessions or free space.", "alert");
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
            try { await syncPush(); } catch { /* non-fatal — user can push manually */ }
          }}
          connectDropbox={connectDropbox}
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
    state, setState, latestStateRef, rehydrate, profile, theme, setTheme,
    level, rank, xpPerLevel, gachaCost, streakShieldCost,
    awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef,
    showBanner, showToast, setModal,
    syncStatus, lastSynced, dropboxConnected,
    syncPush, syncPull,
    connectDropbox, handleDropboxCallback, disconnectDropbox,
    setTab,
    rehydrateCount,
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
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} dropboxConnected={dropboxConnected || (IS_DEV && typeof window !== "undefined" && window.__RITMOL_TEST__)} isReloading={isReloading} theme={theme} onOpenSettings={() => setTab("settings")} onOpenCalendar={() => setCalendarOpen(true)} gcalConnected={!!state.gCalConnected} />
        <div data-scroll="" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}>
          {tab === "home"     && <ErrorBoundary key="home"><HomeTab /></ErrorBoundary>}
          {tab === "habits"   && <ErrorBoundary key="habits"><HabitsTab /></ErrorBoundary>}
          {tab === "tasks"    && <ErrorBoundary key="tasks"><TasksTab /></ErrorBoundary>}
          {tab === "profile"  && <ErrorBoundary key="profile"><ProfileTab /></ErrorBoundary>}
          {tab === "settings" && <ErrorBoundary key="settings"><SettingsTab /></ErrorBoundary>}
        </div>
        <BottomNav tab={tab} setTab={setTab} theme={theme} />
        {calendarOpen && (
          <CalendarOverlay theme={theme} onClose={() => setCalendarOpen(false)} />
        )}
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
