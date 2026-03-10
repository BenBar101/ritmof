import React, { useState, useEffect, useRef, useCallback } from "react";

// Utils & storage
import { LS, storageKey, IS_DEV, getGeminiApiKey, getMaxDateSeen, updateMaxDateSeen } from "./utils/storage";
import { today, todayUTC, nowHour, nowMin } from "./utils/storage";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { initState } from "./utils/state";

// Constants
import { DAILY_TOKEN_LIMIT, THEME_KEY, SESSION_TYPES } from "./constants";

// API
import { buildSystemPrompt, sanitizeForPrompt } from "./api/systemPrompt";
import { fetchDailyQuote } from "./api/quotes";
import { updateDynamicCosts } from "./api/dynamicCosts";

// Sync
import { SyncManager, FSAPI_SUPPORTED } from "./sync/SyncManager";

// Components
import Onboarding from "./Onboarding";
import { TopBar, BottomNav, Banner } from "./Layout";
import { GlobalStyles, ErrorBoundary } from "./GlobalStyles";
import {
  DailyLoginModal, SleepCheckinModal, ScreenTimeModal,
  SessionLogModal, LevelUpModal, AchievementToast,
} from "./Modals";

// Tabs
import HomeTab from "./HomeTab";
import HabitsTab from "./HabitsTab";
import TasksTab from "./TasksTab";
import ChatTab from "./ChatTab";
import ProfileTab from "./ProfileTab";

// ── Token budget constants (module-level so they're stable references) ──
const TOKEN_WARN_THRESHOLDS = [0.5, 0.8, 0.99];
const DAILY_AI_XP_LIMIT = 5000;

// ─────────────────────────────────────────────────────────────────
// KEYS CONFIG GATE (shown when Gemini key isn't loaded yet)
// ─────────────────────────────────────────────────────────────────
import { APP_ICON_URL } from "./utils/storage";

function KeysConfigGate() {
  const [syncFileConnected, setSyncFileConnected] = useState(false);
  const [syncChecking, setSyncChecking] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | error | success

  // Fix: compute hasMissingKey via state/memo rather than re-computing on each render
  // so useEffect dependency is stable and doesn't trigger on unrelated re-renders.
  const hasMissingKey = !getGeminiApiKey();

  useEffect(() => {
    if (!hasMissingKey) return;
    if (!FSAPI_SUPPORTED) {
      setSyncChecking(false);
      return;
    }
    let cancelled = false;
    SyncManager.getHandle()
      .then((h) => {
        if (cancelled) return;
        setSyncFileConnected(!!h);
        setSyncChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSyncChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasMissingKey]);

  async function handlePickSyncFile() {
    if (!FSAPI_SUPPORTED) return;
    setSyncError("");
    try {
      await SyncManager.pickFile();
      setSyncFileConnected(true);
    } catch (e) {
      if (e.name === "AbortError") return;
      setSyncError("Could not link file. Try again.");
    }
  }

  async function handleLoadFromFile() {
    if (!FSAPI_SUPPORTED) return;
    setSyncError("");
    setSyncStatus("syncing");
    try {
      await SyncManager.pull();
      setSyncStatus("success");
      // Pull loads geminiKey into sessionStorage; re-render will drop this gate.
      // Delay reload slightly to avoid racing with any pending auto-push that may
      // have been scheduled via visibilitychange while the file picker was open.
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      setSyncStatus("error");
      if (e.message === "NO_HANDLE") {
        setSyncError("No sync file linked yet.");
      } else if (e.message === "CORRUPT_FILE") {
        setSyncError("Sync file is corrupt or not valid JSON.");
      } else if (e.message === "SYNC_SCHEMA_OUTDATED") {
        setSyncError("Sync file was written by an older version of RITMOL.");
      } else if (e.message === "SYNC_FILE_TOO_LARGE") {
        setSyncError("Sync file exceeds 10 MB. Check the file.");
      } else {
        setSyncError("Pull failed. Check your sync file and try again.");
      }
    }
  }

  if (!hasMissingKey) return null;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#0a0a0a", color: "#e8e8e8", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
    }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 48, height: 48, marginBottom: "16px", display: "block" }} />
      <div style={{ fontSize: "11px", color: "#666", letterSpacing: "2px", marginBottom: "16px" }}>RITMOL — CONFIGURATION REQUIRED</div>
      <div style={{ color: "#c44", fontSize: "12px", maxWidth: "420px", lineHeight: "1.8", marginBottom: "20px" }}>
        No Gemini API key found in this session. Add <code>&ldquo;geminiKey&rdquo;: &ldquo;AIza...&rdquo;</code> to your{" "}
        <code>ritmol-data.json</code> sync file, then link it below so RITMOL can read it.
        The key is never stored in the build or in GitHub — it lives only in your Syncthing file and this tab&apos;s sessionStorage.
      </div>

      {FSAPI_SUPPORTED ? (
        <div style={{ maxWidth: "420px", width: "100%", textAlign: "left", border: "1px solid #333", padding: "16px", fontSize: "11px", color: "#aaa" }}>
          <div style={{ fontSize: "10px", color: "#777", letterSpacing: "2px", marginBottom: "8px" }}>
            STEP 1 — LINK YOUR SYNC FILE
          </div>
          <div style={{ marginBottom: "10px", lineHeight: "1.8" }}>
            Pick (or create) <code>ritmol-data.json</code> inside your Syncthing folder.
          </div>
          <button
            type="button"
            onClick={handlePickSyncFile}
            disabled={syncChecking}
            style={{
              width: "100%", padding: "10px",
              border: "2px solid #fff", background: "#fff", color: "#000",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
              marginBottom: "10px",
            }}
          >
            {syncFileConnected ? "✓ SYNC FILE LINKED" : "LINK SYNCTHING FILE →"}
          </button>

          <div style={{ fontSize: "10px", color: "#777", marginTop: "8px", lineHeight: "1.6" }}>
            STEP 2 — After your file contains <code>geminiKey</code>, click below to load it:
          </div>
          <button
            type="button"
            onClick={handleLoadFromFile}
            disabled={!syncFileConnected || syncStatus === "syncing"}
            style={{
              width: "100%", padding: "10px", marginTop: "8px",
              border: "1px solid #444",
              background: !syncFileConnected || syncStatus === "syncing" ? "#151515" : "transparent",
              color: !syncFileConnected || syncStatus === "syncing" ? "#444" : "#ccc",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: !syncFileConnected || syncStatus === "syncing" ? "default" : "pointer",
            }}
          >
            {syncStatus === "syncing" ? "LOADING FROM FILE..." : "LOAD KEY FROM SYNC FILE ↓"}
          </button>

          {syncError && (
            <div style={{ marginTop: "8px", color: "#c44", fontSize: "10px" }}>
              ⚠ {syncError}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: "11px", color: "#777", maxWidth: "420px", lineHeight: "1.8" }}>
          Your browser does not support direct file access. Use <strong>Download / Import</strong> in Profile → Settings after you complete setup.
        </div>
      )}

      <div style={{ fontSize: "10px", color: "#555", marginTop: "24px" }}>See README — Gemini API Key & Sync sections.</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState(initState);
  const [tab, setTab] = useState("home");
  const [showOnboarding, setShowOnboarding] = useState(!LS.get(storageKey("jv_profile")));

  const [modal, setModal] = useState(null); // { type, data }
  const [toast, setToast] = useState(null);
  const [banner, setBanner] = useState(null);
  const [levelUpData, setLevelUpData] = useState(null);
  const [dailyQuote, setDailyQuote] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSynced, setLastSynced] = useState(LS.get(storageKey("jv_last_synced"), null));
  const [theme, setThemeState] = useState(() => LS.get(storageKey(THEME_KEY), "dark"));
  const setTheme = (t) => { LS.set(storageKey(THEME_KEY), t); setThemeState(t); };
  const toastTimer = useRef(null);
  const bannerTimer = useRef(null);
  const actionLocksRef = useRef(new Set());

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "theme-color"); document.head.appendChild(meta); }
    meta.setAttribute("content", theme === "light" ? "#f0f0f0" : "#0a0a0a");
  }, [theme]);

  const profile = state.profile;
  const apiKey = getGeminiApiKey();

  // ── Sync file state ──
  const [syncFileConnected, setSyncFileConnected] = useState(false);
  useEffect(() => {
    SyncManager.getHandle().then((h) => setSyncFileConnected(!!h));
  }, []);

  // Legacy: strip geminiKey from profile if present (from old sync or localStorage)
  useEffect(() => {
    if (profile?.geminiKey) {
      setState((s) => {
        // eslint-disable-next-line no-unused-vars
        const { geminiKey: _g, ...rest } = s.profile || {};
        return { ...s, profile: rest };
      });
    }
  }, [profile?.geminiKey]);

  const xpPerLevel = getXpPerLevel(state);
  const level = getLevel(state.xp, xpPerLevel);
  const rank = getRank(level);
  const gachaCost = getGachaCost(state);
  const streakShieldCost = getStreakShieldCost(state);

  // ── Persist state (granular — each slice only writes when it changes) ──
  useEffect(() => {
    if (!state.profile) return;
    // eslint-disable-next-line no-unused-vars
    const { geminiKey: _stripped, ...profileToSave } = state.profile;
    LS.set(storageKey("jv_profile"), profileToSave);
  }, [state.profile]);
  useEffect(() => { LS.set(storageKey("jv_xp"), state.xp); }, [state.xp]);
  useEffect(() => { LS.set(storageKey("jv_streak"), state.streak); }, [state.streak]);
  useEffect(() => { LS.set(storageKey("jv_shields"), state.streakShields); }, [state.streakShields]);
  useEffect(() => { LS.set(storageKey("jv_last_login"), state.lastLoginDate); }, [state.lastLoginDate]);
  useEffect(() => { LS.set(storageKey("jv_habits"), state.habits); }, [state.habits]);
  useEffect(() => { LS.set(storageKey("jv_habit_log"), state.habitLog); }, [state.habitLog]);
  useEffect(() => { LS.set(storageKey("jv_tasks"), state.tasks); }, [state.tasks]);
  useEffect(() => { LS.set(storageKey("jv_goals"), state.goals); }, [state.goals]);
  useEffect(() => { LS.set(storageKey("jv_sessions"), state.sessions); }, [state.sessions]);
  useEffect(() => { LS.set(storageKey("jv_achievements"), state.achievements); }, [state.achievements]);
  useEffect(() => { LS.set(storageKey("jv_gacha"), state.gachaCollection); }, [state.gachaCollection]);
  useEffect(() => { LS.set(storageKey("jv_cal_events"), state.calendarEvents); }, [state.calendarEvents]);
  useEffect(() => { LS.set(storageKey("jv_chat"), state.chatHistory); }, [state.chatHistory]);
  useEffect(() => { LS.set(storageKey("jv_daily_goal"), state.dailyGoal); }, [state.dailyGoal]);
  useEffect(() => {
    LS.set(
      storageKey("jv_timers"),
      Array.isArray(state.activeTimers) ? state.activeTimers : [],
    );
  }, [state.activeTimers]);
  useEffect(() => { LS.set(storageKey("jv_sleep_log"), state.sleepLog); }, [state.sleepLog]);
  useEffect(() => { LS.set(storageKey("jv_screen_log"), state.screenTimeLog); }, [state.screenTimeLog]);
  useEffect(() => { LS.set(storageKey("jv_missions"), state.dailyMissions); }, [state.dailyMissions]);
  useEffect(() => { LS.set(storageKey("jv_mission_date"), state.lastMissionDate); }, [state.lastMissionDate]);
  useEffect(() => {
    LS.set(
      storageKey("jv_habit_suggestions"),
      Array.isArray(state.pendingHabitSuggestions) ? state.pendingHabitSuggestions : [],
    );
  }, [state.pendingHabitSuggestions]);
  useEffect(() => { LS.set(storageKey("jv_chronicles"), state.chronicles); }, [state.chronicles]);
  useEffect(() => { LS.set(storageKey("jv_gcal_connected"), state.gCalConnected); }, [state.gCalConnected]);
  useEffect(() => { LS.set(storageKey("jv_token_usage"), state.tokenUsage); }, [state.tokenUsage]);
  useEffect(() => { LS.set(storageKey("jv_habits_init"), state.habitsInitialized); }, [state.habitsInitialized]);
  useEffect(() => { if (state.dynamicCosts) LS.set(storageKey("jv_dynamic_costs"), state.dynamicCosts); }, [state.dynamicCosts]);
  useEffect(() => { LS.set(storageKey("jv_last_shield_use_date"), state.lastShieldUseDate ?? null); }, [state.lastShieldUseDate]);
  useEffect(() => { LS.set(storageKey("jv_last_shield_buy_date"), state.lastShieldBuyDate ?? null); }, [state.lastShieldBuyDate]);

  // ── Syncthing: keep a ref to latest state and push on tab hide ──
  const latestStateRef = useRef(null);
  useEffect(() => { latestStateRef.current = state; }, [state]);

  // Fix #5: track aiXpToday in a ref that is updated synchronously within
  // consumeAiXpBudget. Using only state/latestStateRef caused a race condition
  // where multiple calls within the same executeCommands run could each read a
  // stale aiXpToday value before any setState had flushed, allowing the daily
  // AI XP cap to be exceeded.
  const aiXpTodayRef = useRef(null); // null = not yet initialised for today

  // Fix [S-2/A-3]: mutex ref that prevents the auto-push from clobbering a
  // concurrent manual Pull. Without this, alt-tabbing mid-Pull triggers
  // visibilitychange which flushes pre-Pull state to the file, then the Pull
  // completes and setState(initState()) re-reads the already-overwritten data.
  const isPullingRef = useRef(false);
  // Tracks the XP value used for the most recent level-up detection so two rapid
  // awardXP calls don't both fire a level-up from the same stale latestStateRef snapshot.
  const lastLevelUpXpRef = useRef(-1);

  useEffect(() => {
    let pushDebounceTimer = null;
    const schedulePush = () => {
      if (pushDebounceTimer) return; // already scheduled
      pushDebounceTimer = setTimeout(async () => {
        try {
          // Fix [S-2]: skip auto-push if a Pull is in progress. The Pull will
          // write its own flush once it completes.
          if (isPullingRef.current) return;
          const handle = await SyncManager.getHandle().catch(() => null);
          if (!handle) return;
          const s = latestStateRef.current;
          if (!s?.profile) return;
          // Granular persist effects keep localStorage up to date; read the
          // latest snapshot directly in SyncManager.push() to avoid races where
          // flushStateToStorage and Push see different snapshots.
          const ts = await SyncManager.push();
          LS.set(storageKey("jv_last_synced"), String(ts));
          setSyncStatus("synced");
          setLastSynced(ts);
        } catch (e) {
          console.warn("Syncthing push on hide failed:", e.message);
        } finally {
          pushDebounceTimer = null;
        }
      }, 250);
    };
    const handleVisibility = () => { if (document.visibilityState === "hidden") schedulePush(); };
    const handlePageHide   = () => schedulePush();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  // ── Manual push/pull/pick sync file ──
  async function syncPush() {
    setSyncStatus("syncing");
    try {
      const s = latestStateRef.current;
      if (!s?.profile) {
        setSyncStatus("idle");
        showBanner("Nothing to push yet. Complete onboarding first.", "info");
        return;
      }
      const ts = await SyncManager.push();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pushed to Syncthing file.", "success");
    } catch (e) {
      setSyncStatus("error");
      if (e.message === "NO_HANDLE") showBanner("No sync file selected. Pick one in Profile → Settings.", "alert");
      else if (e.message === "PERMISSION_DENIED") showBanner("Write permission denied. Try again and allow access.", "alert");
      else if (e.message === "SYNC_BUSY") showBanner("Sync already in progress. Please wait.", "warning");
      else showBanner(`Push failed: ${(e.message || "").slice(0, 80)}`, "alert");
    }
  }

  async function syncPull() {
    setSyncStatus("syncing");
    // Fix [S-2]: set mutex so the visibilitychange auto-push skips during this Pull.
    isPullingRef.current = true;
    try {
      const ts = await SyncManager.pull();
      // Reset AI XP and level-up detection refs before rehydrating state so any
      // callbacks that fire during initState() see clean values.
      aiXpTodayRef.current = null;
      lastLevelUpXpRef.current = -1;
      try {
        const freshState = initState();
        latestStateRef.current = freshState;
        setState(freshState);
      } catch (initErr) {
        console.error("[syncPull] initState failed:", initErr);
      }
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pulled data from Syncthing file.", "success");
    } catch (e) {
      setSyncStatus("error");
      if (e.message === "NO_HANDLE") showBanner("No sync file selected. Pick one in Profile → Settings.", "alert");
      else if (e.message === "CORRUPT_FILE") showBanner("Sync file is corrupt or not valid JSON. Re-export from another device.", "alert");
      else if (e.message === "SYNC_SCHEMA_OUTDATED") showBanner("Sync file was written by an older version of RITMOL. Re-export it from an up-to-date device.", "alert");
      else if (e.message === "SYNC_FILE_TOO_LARGE") showBanner("Sync file exceeds 10 MB — this is unexpected. Check the file.", "alert");
      else if (e.message === "APPLY_QUOTA_RISK") showBanner("Pull failed: local storage is almost full (~5MB). Clear old chat history or sessions first.", "alert");
      else if (e.message === "SYNC_BUSY") showBanner("Sync already in progress. Please wait.", "warning");
      else showBanner(`Pull failed: ${(e.message || "").slice(0, 80)}`, "alert");
    } finally {
      // Always release the mutex so auto-push can resume after Pull completes or fails.
      isPullingRef.current = false;
    }
  }

  async function pickSyncFile() {
    try {
      await SyncManager.pickFile();
      setSyncFileConnected(true);
      showBanner("Sync file linked. Push or Pull to sync.", "success");
    } catch (e) {
      if (e.name !== "AbortError") showBanner("Could not pick file.", "alert");
    }
  }

  const [confirmForgetSync, setConfirmForgetSync] = useState(false);
  const confirmForgetSyncTimerRef = useRef(null);
  useEffect(() => () => {
    if (confirmForgetSyncTimerRef.current !== null) {
      clearTimeout(confirmForgetSyncTimerRef.current);
      confirmForgetSyncTimerRef.current = null;
    }
  }, []);
  async function forgetSyncFile() {
    if (!confirmForgetSync) {
      setConfirmForgetSync(true);
      confirmForgetSyncTimerRef.current = setTimeout(() => {
        setConfirmForgetSync(false);
        confirmForgetSyncTimerRef.current = null;
      }, 4000);
      return;
    }
    if (confirmForgetSyncTimerRef.current !== null) {
      clearTimeout(confirmForgetSyncTimerRef.current);
      confirmForgetSyncTimerRef.current = null;
    }
    setConfirmForgetSync(false);
    await SyncManager.forget();
    setSyncFileConnected(false);
    setSyncStatus("idle");
    showBanner("Sync file unlinked.", "success");
  }

  // ── Daily login check ──
  const _loginInProgressRef = useRef(false);
  useEffect(() => {
    if (!profile) return;
    if (_loginInProgressRef.current) return;
    _loginInProgressRef.current = true;
    handleDailyLogin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile]);

  // ── Daily missions init ──
  useEffect(() => {
    if (!profile) return;
    const t = today();
    const lastMissionDate = (latestStateRef.current ?? state).lastMissionDate;
    if (lastMissionDate !== t) {
      const missions = generateDailyMissions();
      setState((s) => ({ ...s, dailyMissions: missions, lastMissionDate: t }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, state.lastMissionDate]);

  // ── UI helpers ──
  const showToast = useCallback((data) => {
    clearTimeout(toastTimer.current);
    const payload = { ...data, _id: data._id || crypto.randomUUID() };
    setToast(payload);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const showBanner = useCallback((text, type = "info") => {
    clearTimeout(bannerTimer.current);
    setBanner({ text, type });
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Token tracker ──
  const trackTokens = useCallback((amount) => {
    // Guard: reject non-numeric, NaN, negative, or unreasonably large amounts so
    // a malformed tokensUsed value cannot corrupt the daily budget counter or
    // prematurely disable AI features.
    const safeAmount = typeof amount === "number" && isFinite(amount) && amount > 0
      ? Math.min(Math.round(amount), 1_000_000)
      : 0;
    if (safeAmount === 0) return;
    const t = todayUTC();
    setState((s) => {
      const usage = s.tokenUsage || { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 };
      const fresh = usage.date !== t
        ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 }
        : { ...usage, aiXpToday: typeof usage.aiXpToday === "number" ? usage.aiXpToday : 0 };
      const prevTokens = fresh.tokens;
      const newTokens = prevTokens + safeAmount;
      const updated = { ...fresh, tokens: newTokens };
      const warnedAt = fresh.warnedAt || [];
      const newWarned = [...warnedAt];
      TOKEN_WARN_THRESHOLDS.forEach((threshold) => {
        const pct = Math.round(threshold * 100);
        if (!warnedAt.includes(pct) && prevTokens < DAILY_TOKEN_LIMIT * threshold && newTokens >= DAILY_TOKEN_LIMIT * threshold) {
          newWarned.push(pct);
          if (threshold >= 0.99) {
            setTimeout(() => showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert"), 0);
          } else {
            setTimeout(() => showBanner(`SYSTEM: Neural energy at ${pct}%. ${threshold >= 0.8 ? "Conserve wisely." : ""}`, "warning"), 0);
          }
        }
      });
      updated.warnedAt = newWarned;
      LS.set(storageKey("jv_token_usage"), updated);
      return { ...s, tokenUsage: updated };
    });
  }, [showBanner]);

  function consumeAiXpBudget(requested) {
    const t = todayUTC();
    // Fix #5: read and write aiXpTodayRef synchronously so that multiple calls within
    // the same executeCommands run see the accumulated total, not a stale snapshot.
    if (aiXpTodayRef.current === null || aiXpTodayRef.current.date !== t) {
      // Initialise from persisted localStorage on the first call of the day — this
      // is always at least as fresh as latestStateRef, which lags by one render.
      const persisted = LS.get(storageKey("jv_token_usage"));
      const baseXp = (persisted && persisted.date === t ? persisted.aiXpToday : 0) || 0;
      aiXpTodayRef.current = { date: t, value: baseXp };
    }
    const alreadyAwarded = aiXpTodayRef.current.value;
    const remaining = Math.max(0, DAILY_AI_XP_LIMIT - alreadyAwarded);
    const allowed = Math.min(requested, remaining);
    if (allowed > 0) {
      // Update ref synchronously before any async setState so the next call in the
      // same loop sees the correct accumulated total.
      aiXpTodayRef.current = { date: t, value: alreadyAwarded + allowed };
      setState((s) => {
        const usage = s.tokenUsage || { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 };
        const fresh = usage.date !== t
          ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 }
          : {
              ...usage,
              aiXpToday: typeof usage.aiXpToday === "number" ? usage.aiXpToday : 0,
              warnedAt: Array.isArray(usage.warnedAt) ? usage.warnedAt : [],
            };
        const updated = { ...fresh, aiXpToday: aiXpTodayRef.current.value };
        LS.set(storageKey("jv_token_usage"), updated);
        return { ...s, tokenUsage: updated };
      });
    }
    return allowed;
  }

  // ── Fetch daily quote ──
  // Use a ref so the effect only runs once when profile becomes available,
  // not on every render that produces a new profile object reference.
  const quoteFetchedRef = useRef(false);
  useEffect(() => {
    if (!profile || quoteFetchedRef.current) return;
    quoteFetchedRef.current = true;
    fetchDailyQuote(null, profile, null).then(setDailyQuote);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile]);

  // ── Scheduled prompts (sleep check-in, screen time, lecture reminders) ──
  const scheduledCheckStateRef = useRef({});
  useEffect(() => {
    scheduledCheckStateRef.current = {
      sleepLog: state.sleepLog,
      screenTimeLog: state.screenTimeLog,
      calendarEvents: state.calendarEvents,
    };
  }, [state.sleepLog, state.screenTimeLog, state.calendarEvents]);

  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const h = nowHour();
      const m = nowMin();
      const t = today();
      const { sleepLog, screenTimeLog, calendarEvents } = scheduledCheckStateRef.current;
      if (h === 7 && m >= 30 && m < 35 && !sleepLog?.[t]) {
        setModal({ type: "sleep_checkin" });
      }
      if (h === 13 && m >= 0 && m < 5 && !screenTimeLog?.[t]?.afternoon) {
        setModal({ type: "screen_time", period: "afternoon" });
      }
      if (h === 20 && m >= 0 && m < 5 && !screenTimeLog?.[t]?.evening) {
        setModal({ type: "screen_time", period: "evening" });
      }
      const upcoming = (calendarEvents || []).filter((e) => {
        if (e.type !== "lecture" && e.type !== "tirgul") return false;
        // Fix: guard against non-string or non-ISO start values — new Date() on an
        // arbitrary string (e.g. from a crafted sync file) can produce unexpected results.
        if (typeof e.start !== "string" || !e.start) return false;
        const diff = (new Date(e.start) - Date.now()) / 60000;
        return diff > 0 && diff <= 120 && !e.reminded;
      });
      if (upcoming.length > 0) {
        // Fix: sanitize calendar event title before embedding in banner text to avoid
        // control characters or special chars from a crafted sync file reaching the UI.
        // eslint-disable-next-line no-control-regex
        const safeTitle = String(upcoming[0].title || "Event").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").slice(0, 100);
        showBanner(`${safeTitle} starts in ${Math.round((new Date(upcoming[0].start) - Date.now()) / 60000)} minutes.`, "warning");
        setState((s) => ({
          ...s,
          calendarEvents: s.calendarEvents.map((e) =>
            upcoming.find((u) => u.id === e.id) ? { ...e, reminded: true } : e
          ),
        }));
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [profile, showBanner]);

  // ── Streak panic check ──
  useEffect(() => {
    if (!profile) return;
    const h = nowHour();
    if (h < 21) return; // Only relevant in the evening — skip entirely outside that window
    const todayLog = state.habitLog[today()] || [];
    if (todayLog.length === 0 && state.streak > 0) {
      showBanner("⚠ Hunter. Your streak expires at midnight. 0 habits logged.", "alert");
    }
  }, [profile, state.habitLog, state.streak, showBanner]);

  // ── Daily login handler ──
  function handleDailyLogin() {
    setState((s) => {
      const effectiveDate = todayUTC();
      const parseDateLocal = (ds) => {
        if (!ds) return new Date(NaN);
        const [y, m, d] = ds.split("-").map(Number);
        return new Date(y, m - 1, d);
      };
      const d = parseDateLocal(effectiveDate);
      d.setDate(d.getDate() - 1);
      const yy = d.getFullYear();
      const ym = String(d.getMonth() + 1).padStart(2, "0");
      const yd = String(d.getDate()).padStart(2, "0");
      const yesterday = `${yy}-${ym}-${yd}`;
      let newStreak = s.streak;
      let newShields = s.streakShields;
      let bannerMsg = null;

      const maxDateSeen = getMaxDateSeen();
      if (maxDateSeen && effectiveDate < maxDateSeen) {
        // Do NOT update maxDateSeen here — effectiveDate is earlier than the known
        // maximum, indicating a clock rollback. Keep the higher watermark.
        return { ...s, lastLoginDate: effectiveDate, streak: 0 };
      }
      updateMaxDateSeen(effectiveDate);

      // Reject future-dated lastLoginDate values that may have arrived via a crafted
      // sync file. Treat as if no prior login exists and reset the streak.
      if (s.lastLoginDate && s.lastLoginDate > effectiveDate) {
        return { ...s, lastLoginDate: effectiveDate, streak: 0 };
      }

      if (s.lastLoginDate === yesterday) {
        newStreak = s.streak + 1;
      } else if (s.lastLoginDate === effectiveDate) {
        // Already logged in today — no change
      } else {
        const daysSinceLast = (() => {
          if (!s.lastLoginDate) return Infinity;
          const last = parseDateLocal(s.lastLoginDate);
          const now  = parseDateLocal(effectiveDate);
          return Math.round((now - last) / 86400000);
        })();
        const missedExactlyOneDay = daysSinceLast === 2;
        const shieldUsedYesterday = s.lastShieldUseDate === yesterday;
        const canUseShield = missedExactlyOneDay && s.streakShields > 0 && !shieldUsedYesterday;

        if (canUseShield) {
          newShields = s.streakShields - 1;
          bannerMsg = "Streak shield consumed. One missed day covered. Streak preserved.";
        } else {
          newStreak = 0;
          if (!missedExactlyOneDay && daysSinceLast !== 1) {
            bannerMsg = s.streakShields > 0
              ? "Gap too large for a shield. Streak reset."
              : "Streak reset. Start again.";
          } else if (shieldUsedYesterday) {
            bannerMsg = "Shield already used yesterday. Streak reset.";
          }
        }
      }

      const loginXP = Math.min(50 + newStreak * 10, 5000); // Fix [A-2]: cap at 5000 — a crafted streak of 36500 would otherwise award 365 050 XP, triggering ~365 simultaneous level-up API calls and potentially freezing the UI.
      const newXP = s.xp + loginXP;
      const xpPl = getXpPerLevel(s);
      const oldLevel = getLevel(s.xp, xpPl);
      const newLevel = getLevel(newXP, xpPl);
      const usedShield = newShields < s.streakShields;
      const newLastShieldUseDate = usedShield ? effectiveDate : s.lastShieldUseDate;

      if (newLevel > oldLevel) {
        lastLevelUpXpRef.current = newXP;
        const snapshot = { ...s, xp: newXP, streak: newStreak, streakShields: newShields, lastLoginDate: effectiveDate, lastShieldUseDate: newLastShieldUseDate, dynamicCosts: s.dynamicCosts };
        setTimeout(() => {
          setLevelUpData({ level: newLevel, rank: getRank(newLevel) });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokens).then((costs) => {
            if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
          }).catch(() => {});
        }, 300);
      }
      if (bannerMsg) setTimeout(() => showBanner(bannerMsg, "info"), 0);
      if (usedShield) {
        setTimeout(() => {
          updateDynamicCosts(getGeminiApiKey(), { ...s, streakShields: newShields, lastShieldUseDate: effectiveDate, dynamicCosts: s.dynamicCosts }, "streak_shield_use", trackTokens).then((costs) => {
            if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
          }).catch(() => {});
        }, 0);
      }
      setTimeout(() => setModal({ type: "daily_login", xp: loginXP, streak: newStreak }), 0);
      return { ...s, streak: newStreak, streakShields: newShields, lastLoginDate: effectiveDate, lastShieldUseDate: newLastShieldUseDate, xp: newXP };
    });
    queueMicrotask(() => {
      _loginInProgressRef.current = false;
    });
  }

  function generateDailyMissions() {
    return [
      { id: "m1", desc: "Complete 3 habits",  target: 3, type: "habits",  xp: 100, done: false },
      { id: "m2", desc: "Complete 6 habits",  target: 6, type: "habits",  xp: 200, done: false },
      { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits", xp: 500, done: false },
      { id: "m4", desc: "Log a study session",target: 1, type: "session", xp: 75,  done: false },
      { id: "m5", desc: "Complete a task",    target: 1, type: "task",    xp: 50,  done: false },
      { id: "m6", desc: "Open RITMOL chat",   target: 1, type: "chat",    xp: 25,  done: false },
    ];
  }

  // ── Core XP award ──
  function awardXP(amount, event, silent = false) {
    // Fix [A-1]: validate amount before arithmetic. A corrupted habit.xp (undefined,
    // NaN, negative) would produce state.xp = NaN which is permanent — every
    // subsequent XP operation returns NaN, breaking the XP bar, level display, and
    // all level-up checks with no recovery path short of a full data reset.
    const safeAmount = typeof amount === "number" && isFinite(amount) && amount > 0
      ? Math.min(Math.round(amount), 100_000)
      : 0;
    if (safeAmount === 0) return;

    setState((s) => {
      const newXP = (s.xp || 0) + safeAmount;
      const xpPl = getXpPerLevel(s);
      const baseXpForDetection = Math.max(
        typeof s.xp === "number" && isFinite(s.xp) ? s.xp : 0,
        lastLevelUpXpRef.current === -1 ? 0 : lastLevelUpXpRef.current,
      );
      const oldLevel = getLevel(baseXpForDetection, xpPl);
      const newLevel = getLevel(newXP, xpPl);
      const didLevelUp = newLevel > oldLevel && !silent;

      if (didLevelUp) {
        lastLevelUpXpRef.current = newXP;
        const snapshot = { ...s, xp: newXP };
        setTimeout(() => {
          setLevelUpData({ level: newLevel, rank: getRank(newLevel) });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokens)
            .then((costs) => {
              if (costs && Object.keys(costs).length) {
                setState((prev) => ({
                  ...prev,
                  dynamicCosts: { ...prev.dynamicCosts, ...costs },
                }));
              }
            })
            .catch(() => {});
        }, 300);
      }

      return { ...s, xp: newXP };
    });
  }

  // ── Mission checker ──
  const checkMissions = useCallback((hintType = null) => {
    const t = today();
    // Fix [A-3]: pendingToasts and pendingLevelUp were declared as plain `let`
    // variables written inside the setState updater and read outside it. In React 18
    // Strict Mode, updaters run twice — the second (discarded) run overwrites the
    // variables, causing double-toasts in development. Use object refs with a
    // stable identity so both updater invocations write to the same container and
    // the final read outside the updater always reflects the last write.
    const pendingData = { toasts: [], levelUp: null };

    setState((s) => {
      if (!s.dailyMissions) return s;
      const todayLog = s.habitLog[t] || [];
      let bonusXP = 0;
      const toastsThisRun = [];
      const updated = s.dailyMissions.map((m) => {
        if (m.done) return m;
        if (hintType && m.type !== hintType) return m;
        let progress = 0;
        if (m.type === "habits") progress = todayLog.length;
        if (m.type === "session") progress = (s.sessions || []).filter((ss) => ss.date === t).length;
        if (m.type === "task") progress = (s.tasks || []).filter((tk) => tk.doneDate === t).length;
        if (m.type === "chat") {
          progress = (s.chatHistory || []).some(
            (msg) =>
              msg.role === "user" &&
              typeof msg.date === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(msg.date) &&
              msg.date === t
          )
            ? 1
            : 0;
        }
        if (progress >= m.target) {
          const missionXp = typeof m.xp === "number" && isFinite(m.xp) && m.xp > 0
            ? Math.min(m.xp, 2000)
            : 0;
          bonusXP += missionXp;
          toastsThisRun.push({ icon: "◈", title: "Mission Complete", desc: m.desc, xp: missionXp, rarity: "common" });
          return { ...m, done: true };
        }
        return m;
      });

      const safeBonus = Math.min(
        typeof bonusXP === "number" && isFinite(bonusXP) && bonusXP >= 0 ? bonusXP : 0,
        10_000
      );
      const newXP = Math.min(s.xp + safeBonus, 100_000_000);
      if (bonusXP > 0) {
        const xpPl = getXpPerLevel(s);
        const oldLevel = getLevel(s.xp, xpPl);
        const newLevel = getLevel(newXP, xpPl);
        if (newLevel > oldLevel) {
          pendingData.levelUp = { level: newLevel, rank: getRank(newLevel), snapshot: { ...s, xp: newXP, dailyMissions: updated, dynamicCosts: s.dynamicCosts } };
        }
      }
      pendingData.toasts = toastsThisRun;
      return { ...s, dailyMissions: updated, xp: newXP };
    });

    // queueMicrotask fires after React has committed the state update, so
    // pendingData reflects the final (non-discarded) updater invocation.
    queueMicrotask(() => {
      if (pendingData.toasts.length) {
        pendingData.toasts.forEach((toast, i) => setTimeout(() => showToast(toast), 200 + i * 5500));
      }
      if (pendingData.levelUp) {
        const { level, rank, snapshot } = pendingData.levelUp;
        setTimeout(() => {
          setLevelUpData({ level, rank });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokens).then((costs) => {
            if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
          }).catch(() => {});
        }, 300);
      }
    });
  }, [showToast, setLevelUpData, trackTokens]);

  // ── Storage quota warning ──
  useEffect(() => {
    const handleQuota = () => {
      showBanner("SYSTEM ALERT: Storage full! Browser limits reached (~5MB). Data will not be saved. Please manually clear/prune old chat history or sessions.", "alert");
    };
    window.addEventListener("ls-quota-exceeded", handleQuota);
    return () => window.removeEventListener("ls-quota-exceeded", handleQuota);
  }, [showBanner]);

  // ── Achievement unlock ──
  function unlockAchievement(data, skipXP = false) {
    setState((s) => {
      if ((s.achievements || []).find((a) => a.id === data.id)) return s;
      // Fix: cap achievements to match sync validator bound so localStorage never exceeds it.
      if ((s.achievements || []).length >= 2000) return s;
      const ach = { ...data, unlockedAt: Date.now() };
      setTimeout(() => showToast({ ...ach, isAchievement: true }), 300);
      return { ...s, achievements: [...(s.achievements || []), ach] };
    });
    if (!skipXP && data.xp > 0) awardXP(data.xp, null, true);
  }

  // ── Habit logger ──
  function logHabit(habitId, event) {
    // Guard: habitId must be a non-empty string. A corrupted sync value (object, null, etc.)
    // would not match correctly against the Set or the habits array.
    if (typeof habitId !== "string" || !habitId) return;
    if (actionLocksRef.current.has(habitId)) return;
    actionLocksRef.current.add(habitId);
    setTimeout(() => actionLocksRef.current.delete(habitId), 500);
    const t = today();
    // Use flags captured by the updater so XP is based on the authoritative habit
    // record at commit time, not a potentially stale snapshot from latestStateRef.
    let didLog = false;
    let capturedXP = 0;
    setState((s) => {
      const log = s.habitLog[t] || [];
      if (log.includes(habitId)) return s;
      const h = s.habits.find((h) => h.id === habitId);
      if (!h) return s;
      capturedXP = typeof h.xp === "number" && h.xp > 0 ? h.xp : 25;
      didLog = true;
      return { ...s, habitLog: { ...s.habitLog, [t]: [...log, habitId] } };
    });
    queueMicrotask(() => {
      if (didLog) {
        awardXP(capturedXP, event);
        checkMissions("habits");
      }
    });
  }

  // ── AI command executor ──
  function executeCommands(commands) {
    if (!Array.isArray(commands) || commands.length === 0) return;
    // Fix: cap the number of commands processed per AI response. An unbounded forEach
    // over a huge AI-returned array could freeze the UI with thousands of setState calls.
    const MAX_COMMANDS_PER_RUN = 20;
    const VALID_CMDS = new Set([
      "add_task","add_goal","complete_task","clear_done_tasks","award_xp",
      "announce","set_daily_goal","add_habit","unlock_achievement","add_timer","suggest_sessions",
    ]);
    const MAX_XP_PER_CMD        = 500;
    const MAX_XP_PER_RESPONSE   = 1500;
    const MAX_STR_LEN           = 300;
    const MAX_TASKS_PER_RUN     = 10;
    const MAX_TASKS_TOTAL       = 500;
    const MAX_GOALS_TOTAL       = 200;
    const MAX_HABITS_TOTAL      = 100;
    let tasksAdded  = 0;
    let totalXPThisRun = 0;
    const pendingBanners = [];

    const sanitizeStr = (s, max = MAX_STR_LEN) => {
      if (typeof s !== "string") return "";
      return s
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
        .replace(/[\u202A-\u202E\u2066-\u2069]/g, "") // BiDi overrides/isolates
        .slice(0, max)
        .replace(/[<>"`&']/g, "");
    };

    commands.slice(0, MAX_COMMANDS_PER_RUN).forEach((cmd) => {
      if (!cmd || typeof cmd !== "object" || Array.isArray(cmd)) return;
      if (!VALID_CMDS.has(cmd.cmd)) return;
      switch (cmd.cmd) {
        case "add_task": {
          if (tasksAdded >= MAX_TASKS_PER_RUN) break;
          const safeText = sanitizeStr(cmd.text, 500);
          if (!safeText.trim()) break;
          tasksAdded++;
          setState((s) => {
            if ((s.tasks || []).length >= MAX_TASKS_TOTAL) return s;
            return {
              ...s,
              tasks: [...(s.tasks || []), {
                id: `t_${crypto.randomUUID()}`,
                text: safeText,
                priority: ["low","medium","high"].includes(cmd.priority) ? cmd.priority : "medium",
                due: typeof cmd.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cmd.due) ? cmd.due : null,
                done: false,
                addedBy: "ritmol",
              }],
            };
          });
          pendingBanners.push([`Task added: ${sanitizeStr(cmd.text, 60)}`, "info"]);
          break;
        }
        case "add_goal":
          setState((s) => {
            if ((s.goals || []).length >= MAX_GOALS_TOTAL) return s;
            return {
              ...s,
              goals: [...(s.goals || []), {
                id: `g_${crypto.randomUUID()}`,
                title: sanitizeStr(cmd.title),
                course: sanitizeStr(cmd.course),
                due: typeof cmd.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cmd.due) ? cmd.due : null,
                done: false,
                addedBy: "ritmol",
                tasks: [],
              }],
            };
          });
          // Fix: use sanitized title (re-sanitize here to match what was stored)
          pendingBanners.push([`Goal logged: ${sanitizeStr(cmd.title, 60)}`, "success"]);
          break;
        case "complete_task": {
          const doneDate = today();
          setState((s) => {
            const tasks = [...(s.tasks || [])];
            const isValidId = typeof cmd.id === "string" && cmd.id.length <= 40 && /^[a-zA-Z0-9_]+$/.test(cmd.id);
            const idx = isValidId ? tasks.findIndex(t => t.id === cmd.id) : -1;
            if (idx >= 0 && idx < tasks.length) {
              tasks[idx] = { ...tasks[idx], done: true, doneDate };
            }
            return { ...s, tasks };
          });
          break;
        }
        case "clear_done_tasks":
          setState((s) => ({ ...s, tasks: (s.tasks || []).filter((t) => !t.done) }));
          break;
        case "award_xp": {
          const rawAmount = Number(cmd.amount);
          const amount = (isFinite(rawAmount) && rawAmount > 0)
            ? Math.min(Math.floor(rawAmount), MAX_XP_PER_CMD)
            : 0;
          const cappedByResponse = Math.min(amount, Math.max(0, MAX_XP_PER_RESPONSE - totalXPThisRun));
          const allowed = consumeAiXpBudget(cappedByResponse);
          if (allowed <= 0) break;
          totalXPThisRun += allowed;
          awardXP(allowed, null, true);
          pendingBanners.push([`${sanitizeStr(cmd.reason, 80) || "XP awarded"} +${allowed} XP`, "success"]);
          break;
        }
        case "announce":
          pendingBanners.push([sanitizeStr(cmd.text, 200), ["info","warning","success","alert"].includes(cmd.type) ? cmd.type : "info"]);
          break;
        case "set_daily_goal": {
          const safeGoal = sanitizeForPrompt(cmd.text ?? "", 500)
            .replace(/['"\\]/g, "")
            .replace(/[\u27E8\u27E9\u276C-\u276F\uFE3D\uFE3E\u2329\u232A]/g, "");
          setState((s) => ({ ...s, dailyGoal: safeGoal }));
          break;
        }
        case "add_habit": {
          const incomingLabel = sanitizeStr(cmd.label);
          setState((s) => {
            if (
              s.habits.find(
                (h) =>
                  (h.label || "").toLowerCase().trim() ===
                  (incomingLabel || "").toLowerCase().trim(),
              )
            ) {
              return s;
            }
            if (s.habits.length >= MAX_HABITS_TOTAL) return s;
            const newHabit = {
              id: `habit_${crypto.randomUUID()}`,
              label: incomingLabel,
              category: ["body","mind","work"].includes(cmd.category) ? cmd.category : "mind",
              xp: Math.min(Math.max(1, Number(cmd.xp) || 25), 200),
              icon: typeof cmd.icon === "string" ? cmd.icon.slice(0, 2) : "◈",
              style: ["ascii","dots","geometric","typewriter"].includes(cmd.style) ? cmd.style : "ascii",
              addedBy: "ritmol",
            };
            return { ...s, habits: [...s.habits, newHabit] };
          });
          pendingBanners.push([`New habit protocol: ${sanitizeStr(incomingLabel, 60)}`, "success"]);
          break;
        }
        case "unlock_achievement": {
          const safeId = sanitizeStr(cmd.id, 100);
          if (!/^[\w\-.:@]+$/.test(safeId)) break;
          const achXP = Math.min(Math.max(0, Number(cmd.xp) || 50), MAX_XP_PER_CMD);
          // achXP is subject to MAX_XP_PER_CMD (500), MAX_XP_PER_RESPONSE (1500) via totalXPThisRun,
          // and DAILY_AI_XP_LIMIT (5000) via consumeAiXpBudget — three independent caps in series.
          const cappedAchXP = Math.min(achXP, Math.max(0, MAX_XP_PER_RESPONSE - totalXPThisRun));
          const allowedAchXP = consumeAiXpBudget(cappedAchXP);
          totalXPThisRun += allowedAchXP;
          unlockAchievement({
            id:         safeId,
            title:      sanitizeStr(cmd.title),
            desc:       sanitizeStr(cmd.desc),
            flavorText: sanitizeStr(cmd.flavorText),
            icon:       typeof cmd.icon === "string" ? cmd.icon.slice(0, 2) : "◈",
            xp:         allowedAchXP,
            rarity:     ["common","rare","epic","legendary"].includes(cmd.rarity) ? cmd.rarity : "common",
          }, allowedAchXP === 0);
          break;
        }
        case "add_timer":
          setState((s) => ({
            ...s,
            activeTimers: [...(s.activeTimers || []), {
              id: `timer_${crypto.randomUUID()}`,
              label: sanitizeStr(cmd.label),
              // Fix: strip non-printable/non-emoji chars from emoji field; only allow 1-2 chars
              emoji: typeof cmd.emoji === "string" ? cmd.emoji.replace(/[<>&"'`]/g, "").slice(0, 2) : "◈",
              endsAt: Date.now() + Math.min(Math.max(1, Number(cmd.minutes) || 90), 1440) * 60000,
            }],
          }));
          break;
        case "suggest_sessions":
          pendingBanners.push(["Session protocol suggested. Check Tasks.", "info"]);
          break;
        default: break;
      }
    });

    pendingBanners.slice(0, 3).forEach(([text, type], i) => {
      setTimeout(() => showBanner(text, type), i * 4200);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  if (!getGeminiApiKey()) {
    return (
      <ErrorBoundary>
        <KeysConfigGate />
      </ErrorBoundary>
    );
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={(profile) => {
          // eslint-disable-next-line no-unused-vars
          const { geminiKey: _g, ...profileWithoutKey } = profile;
          setState((s) => ({ ...s, profile: profileWithoutKey }));
          LS.set(storageKey("jv_profile"), profileWithoutKey);
          setShowOnboarding(false);
        }}
      />
    );
  }

  if (!profile) return null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0a0a0a", color: "#e8e8e8", overflow: "hidden" }}>

      {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}

      {IS_DEV && (
        <div style={{ background: "#2a2a0a", color: "#b8b830", fontSize: "10px", letterSpacing: "1px", padding: "4px 12px", textAlign: "center", borderBottom: "1px solid #444" }}>
          DEV MODE — separate localStorage (ritmol_dev_*) · link a test copy of ritmol-data.json
        </div>
      )}

      <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} streak={state.streak} profile={profile}
        syncStatus={syncStatus} lastSynced={lastSynced}
        onPush={syncPush} onPull={syncPull} syncFileConnected={syncFileConnected} />

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "70px", paddingTop: "56px" }}>
        {tab === "home" && (
          <ErrorBoundary>
            <HomeTab
              state={state} setState={setState} profile={profile} apiKey={apiKey}
              level={level} rank={rank} dailyQuote={dailyQuote}
              awardXP={awardXP} logHabit={logHabit}
              showBanner={showBanner} showToast={showToast}
              executeCommands={executeCommands} setTab={setTab}
              buildSystemPrompt={buildSystemPrompt}
            />
          </ErrorBoundary>
        )}
        {tab === "habits" && (
          <ErrorBoundary>
            <HabitsTab
              state={state} setState={setState} logHabit={logHabit}
              awardXP={awardXP} showBanner={showBanner}
              profile={profile} apiKey={apiKey} trackTokens={trackTokens}
            />
          </ErrorBoundary>
        )}
        {tab === "tasks" && (
          <ErrorBoundary>
            <TasksTab
              state={state} setState={setState}
              awardXP={awardXP} showBanner={showBanner} checkMissions={checkMissions}
              actionLocksRef={actionLocksRef}
            />
          </ErrorBoundary>
        )}
        {tab === "chat" && (
          <ErrorBoundary>
            <ChatTab
              state={state} setState={setState} profile={profile} apiKey={apiKey}
              executeCommands={executeCommands} showBanner={showBanner}
              buildSystemPrompt={buildSystemPrompt} checkMissions={checkMissions}
              awardXP={awardXP} trackTokens={trackTokens}
            />
          </ErrorBoundary>
        )}
        {tab === "profile" && (
          <ErrorBoundary>
            <ProfileTab
              state={state} setState={setState} profile={profile}
              level={level} rank={rank} xpPerLevel={xpPerLevel} streakShieldCost={streakShieldCost} gachaCost={gachaCost}
              awardXP={awardXP}
              showBanner={showBanner} showToast={showToast}
              unlockAchievement={unlockAchievement}
              executeCommands={executeCommands}
              apiKey={apiKey} buildSystemPrompt={buildSystemPrompt}
              syncStatus={syncStatus} lastSynced={lastSynced}
              syncFileConnected={syncFileConnected}
              onPush={syncPush} onPull={syncPull}
              onPickSyncFile={pickSyncFile} onForgetSyncFile={forgetSyncFile}
              confirmForgetSync={confirmForgetSync}
              theme={theme} setTheme={setTheme}
              trackTokens={trackTokens}
              latestStateRef={latestStateRef}
            />
          </ErrorBoundary>
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} />

      {modal?.type === "daily_login" && (
        <DailyLoginModal data={modal} onClose={() => setModal(null)} />
      )}
      {modal?.type === "sleep_checkin" && (
        <SleepCheckinModal
          onClose={() => setModal(null)}
          onSubmit={(data) => {
            // Clamp incoming values — modal uses range inputs but values are validated
            // here too so a future modal change or a crafted call can't store garbage.
            const safeHours   = Math.min(Math.max(0, Number(data.hours)   || 0), 24);
            const safeQuality = Math.min(Math.max(1, Number(data.quality) || 1), 5);
            const safeRested  = typeof data.rested === "boolean" ? data.rested : false;
            setState((s) => ({ ...s, sleepLog: { ...s.sleepLog, [today()]: { hours: safeHours, quality: safeQuality, rested: safeRested } } }));
            awardXP(20, null, true);
            showBanner(`Sleep data logged. +20 XP`, "success");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "screen_time" && (
        <ScreenTimeModal
          period={modal.period}
          onClose={() => setModal(null)}
          onSubmit={(mins) => {
            const safeMins = Math.min(Math.max(0, Number(mins) || 0), 1440);
            setState((s) => ({
              ...s,
              screenTimeLog: {
                ...s.screenTimeLog,
                [today()]: { ...(s.screenTimeLog?.[today()] || {}), [modal.period]: safeMins },
              },
            }));
            const xp = safeMins < 60 ? 40 : safeMins < 120 ? 25 : safeMins < 180 ? 15 : 10;
            awardXP(xp, null, true);
            showBanner(`Screen time logged. ${safeMins < 60 ? "Impressive discipline." : "Noted."} +${xp} XP`, safeMins < 60 ? "success" : "info");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "session_log" && (
        <SessionLogModal
          onClose={() => setModal(null)}
          state={state}
          onSubmit={(session) => {
            const xp = calcSessionXP(session.type, session.duration, session.focus, modal?.streak ?? state.streak);
            // Fix: construct session explicitly (never spread raw modal object) and cap array at 10 000.
            // eslint-disable-next-line no-control-regex
            const sanitizeSessionStr = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[<>"'`&]/g, "").slice(0, max) : "";
            const newSession = {
              id:       `session_${crypto.randomUUID()}`,
              date:     today(),
              xp,
              type:     SESSION_TYPES.find(s => s.id === session.type) ? session.type : SESSION_TYPES[0].id,
              course:   sanitizeSessionStr(session.course, 100),
              duration: Math.min(Math.max(0, Number(session.duration) || 0), 600),
              focus:    ["low","medium","high"].includes(session.focus) ? session.focus : "medium",
              notes:    sanitizeSessionStr(session.notes, 300),
            };
            const MAX_SESSIONS_TOTAL = 10000;
            setState((s) => {
              if ((s.sessions || []).length >= MAX_SESSIONS_TOTAL) return s;
              return { ...s, sessions: [...(s.sessions || []), newSession] };
            });
            awardXP(xp, null, true);
            showBanner(`${SESSION_TYPES.find(s=>s.id===session.type)?.label} logged. +${xp} XP`, "success");
            checkMissions("session");
            setModal(null);
          }}
        />
      )}
      {levelUpData && (
        <LevelUpModal data={levelUpData} onClose={() => setLevelUpData(null)} />
      )}
      {toast && <AchievementToast key={toast._id} toast={toast} onClose={() => setToast(null)} />}

      {/* Session log FAB */}
      <button
        type="button"
        onClick={() => setModal({ type: "session_log", streak: state.streak })}
        style={{
          position: "fixed", bottom: "80px", right: "16px", zIndex: 100,
          width: "48px", height: "48px", borderRadius: "0",
          background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "18px",
          border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
        }}
        title="Log Study Session"
      >
        ▶
      </button>
    </div>
  );
}

export { GlobalStyles, ErrorBoundary };
