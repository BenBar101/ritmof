import React, { useState, useEffect, useRef, useCallback } from "react";

// Utils & storage
import { LS, storageKey, IS_DEV, getGeminiApiKey } from "./utils/storage";
import { today, nowHour, nowMin } from "./utils/storage";
import { getLevel, getLevelProgress, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { initState, flushStateToStorage } from "./utils/state";

// Constants
import { DAILY_TOKEN_LIMIT, THEME_KEY, SESSION_TYPES } from "./constants";

// API
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchDailyQuote } from "./api/quotes";
import { updateDynamicCosts } from "./api/dynamicCosts";

// Sync
import { SyncManager } from "./sync/SyncManager";

// Components
import Onboarding from "./Onboarding";
import { TopBar, BottomNav, Banner } from "./Layout";
import { GlobalStyles, ErrorBoundary } from "./GlobalStyles";
import {
  Modal, DailyLoginModal, SleepCheckinModal, ScreenTimeModal,
  SessionLogModal, LevelUpModal, AchievementToast,
} from "./Modals";

// Tabs
import HomeTab from "./HomeTab";
import HabitsTab from "./HabitsTab";
import TasksTab from "./TasksTab";
import ChatTab from "./ChatTab";
import ProfileTab from "./ProfileTab";

// ─────────────────────────────────────────────────────────────────
// KEYS CONFIG GATE (shown when Gemini key isn't loaded yet)
// ─────────────────────────────────────────────────────────────────
import { APP_ICON_URL } from "./utils/storage";

function KeysConfigGate() {
  const missing = [];
  if (!getGeminiApiKey()) missing.push("geminiKey");
  if (missing.length === 0) return null;
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "#0a0a0a", color: "#e8e8e8", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
    }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 48, height: 48, marginBottom: "16px", display: "block" }} />
      <div style={{ fontSize: "11px", color: "#666", letterSpacing: "2px", marginBottom: "16px" }}>RITMOL — CONFIGURATION REQUIRED</div>
      <div style={{ color: "#c44", fontSize: "12px", maxWidth: "420px", lineHeight: "1.8" }}>
        No Gemini API key found in this session. Add <code>"geminiKey": "AIza..."</code> to your{" "}
        <code>ritmol-data.json</code> sync file, then use <strong>Pull ↓</strong> (Profile → Settings) to load it.
        The key is never stored in the build or in GitHub — it lives only in your Syncthing file and this tab's sessionStorage.
      </div>
      <div style={{ fontSize: "10px", color: "#555", marginTop: "24px" }}>See README — Gemini API Key section.</div>
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
  const [isLoading, setIsLoading] = useState(false);
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
  useEffect(() => { LS.set(storageKey("jv_timers"), state.activeTimers); }, [state.activeTimers]);
  useEffect(() => { LS.set(storageKey("jv_sleep_log"), state.sleepLog); }, [state.sleepLog]);
  useEffect(() => { LS.set(storageKey("jv_screen_log"), state.screenTimeLog); }, [state.screenTimeLog]);
  useEffect(() => { LS.set(storageKey("jv_missions"), state.dailyMissions); }, [state.dailyMissions]);
  useEffect(() => { LS.set(storageKey("jv_mission_date"), state.lastMissionDate); }, [state.lastMissionDate]);
  useEffect(() => { LS.set(storageKey("jv_habit_suggestions"), state.pendingHabitSuggestions); }, [state.pendingHabitSuggestions]);
  useEffect(() => { LS.set(storageKey("jv_chronicles"), state.chronicles); }, [state.chronicles]);
  useEffect(() => { LS.set(storageKey("jv_gcal_connected"), state.gCalConnected); }, [state.gCalConnected]);
  useEffect(() => { LS.set(storageKey("jv_token_usage"), state.tokenUsage); }, [state.tokenUsage]);
  useEffect(() => { LS.set(storageKey("jv_habits_init"), state.habitsInitialized); }, [state.habitsInitialized]);
  useEffect(() => { if (state.dynamicCosts) LS.set(storageKey("jv_dynamic_costs"), state.dynamicCosts); }, [state.dynamicCosts]);
  useEffect(() => { LS.set(storageKey("jv_last_shield_use_date"), state.lastShieldUseDate ?? null); }, [state.lastShieldUseDate]);

  // ── Syncthing: keep a ref to latest state and push on tab hide ──
  const latestStateRef = useRef(null);
  useEffect(() => { latestStateRef.current = state; }, [state]);

  useEffect(() => {
    const push = async () => {
      const handle = await SyncManager.getHandle().catch(() => null);
      if (!handle) return;
      const s = latestStateRef.current;
      if (!s?.profile) return;
      flushStateToStorage(s);
      try {
        const ts = await SyncManager.push();
        LS.set(storageKey("jv_last_synced"), String(ts));
        setSyncStatus("synced");
        setLastSynced(ts);
      } catch (e) {
        console.warn("Syncthing push on hide failed:", e.message);
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "hidden") push(); };
    const handlePageHide   = () => push();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  // ── Manual push/pull/pick sync file ──
  async function syncPush() {
    setSyncStatus("syncing");
    try {
      const s = latestStateRef.current;
      flushStateToStorage(s);
      const ts = await SyncManager.push();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pushed to Syncthing file.", "success");
    } catch (e) {
      setSyncStatus("error");
      if (e.message === "NO_HANDLE") showBanner("No sync file selected. Pick one in Profile → Settings.", "alert");
      else if (e.message === "PERMISSION_DENIED") showBanner("Write permission denied. Try again and allow access.", "alert");
      else showBanner(`Push failed: ${(e.message || "").slice(0, 80)}`, "alert");
    }
  }

  async function syncPull() {
    setSyncStatus("syncing");
    try {
      const ts = await SyncManager.pull();
      setState(initState);
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
      else showBanner(`Pull failed: ${(e.message || "").slice(0, 80)}`, "alert");
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
  useEffect(() => () => clearTimeout(confirmForgetSyncTimerRef.current), []);
  async function forgetSyncFile() {
    if (!confirmForgetSync) {
      setConfirmForgetSync(true);
      confirmForgetSyncTimerRef.current = setTimeout(() => setConfirmForgetSync(false), 4000);
      return;
    }
    clearTimeout(confirmForgetSyncTimerRef.current);
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
    const t = today();
    const lastLogin = (latestStateRef.current ?? state).lastLoginDate;
    if (lastLogin !== t && !_loginInProgressRef.current) {
      _loginInProgressRef.current = true;
      handleDailyLogin(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // ── Daily missions init ──
  useEffect(() => {
    if (!profile) return;
    const t = today();
    const lastMissionDate = (latestStateRef.current ?? state).lastMissionDate;
    if (lastMissionDate !== t) {
      const missions = generateDailyMissions();
      setState((s) => ({ ...s, dailyMissions: missions, lastMissionDate: t }));
    }
  }, [profile, state.lastMissionDate]);

  // ── Token tracker ──
  const TOKEN_WARN_THRESHOLDS = [0.5, 0.8, 0.99];
  const DAILY_AI_XP_LIMIT = 5000;
  function trackTokens(amount) {
    const t = today();
    setState((s) => {
      const usage = s.tokenUsage || { date: t, tokens: 0 };
      const fresh = usage.date !== t ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 } : usage;
      const prevTokens = fresh.tokens;
      const newTokens = prevTokens + amount;
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
  }

  function canCallGemini() {
    const usage = (latestStateRef.current ?? state).tokenUsage;
    if (!usage || usage.date !== today()) return true;
    return usage.tokens < DAILY_TOKEN_LIMIT;
  }

  function consumeAiXpBudget(requested) {
    const t = today();
    const stateSource = latestStateRef.current ?? state;
    const usage = stateSource.tokenUsage || { date: t, tokens: 0 };
    const fresh = usage.date !== t ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 } : usage;
    const alreadyAwarded = fresh.aiXpToday || 0;
    const remaining = Math.max(0, DAILY_AI_XP_LIMIT - alreadyAwarded);
    const allowed = Math.min(requested, remaining);
    if (allowed > 0) {
      const updated = { ...fresh, aiXpToday: alreadyAwarded + allowed };
      if (latestStateRef.current) {
        latestStateRef.current = { ...latestStateRef.current, tokenUsage: updated };
      }
      setState((s) => ({ ...s, tokenUsage: updated }));
      LS.set(storageKey("jv_token_usage"), updated);
    }
    return allowed;
  }

  // ── Fetch daily quote ──
  useEffect(() => {
    if (!profile) return;
    fetchDailyQuote(null, profile, null).then(setDailyQuote);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

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
        const diff = (new Date(e.start) - Date.now()) / 60000;
        return diff > 0 && diff <= 120 && !e.reminded;
      });
      if (upcoming.length > 0) {
        showBanner(`${upcoming[0].title} starts in ${Math.round((new Date(upcoming[0].start) - Date.now()) / 60000)} minutes.`, "warning");
        setState((s) => ({
          ...s,
          calendarEvents: s.calendarEvents.map((e) =>
            upcoming.find((u) => u.id === e.id) ? { ...e, reminded: true } : e
          ),
        }));
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [profile]);

  // ── Streak panic check ──
  useEffect(() => {
    if (!profile) return;
    const h = nowHour();
    const todayLog = state.habitLog[today()] || [];
    if (h >= 21 && todayLog.length === 0 && state.streak > 0) {
      showBanner("⚠ Hunter. Your streak expires at midnight. 0 habits logged.", "alert");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, state.habitLog, state.streak]);

  // ── Daily login handler ──
  function handleDailyLogin(t) {
    setState((s) => {
      const effectiveDate = t;
      const parseDateLocal = (ds) => {
        if (!ds) return new Date(NaN);
        const [y, m, d] = ds.split("-").map(Number);
        return new Date(y, m - 1, d);
      };
      const d = parseDateLocal(effectiveDate);
      d.setDate(d.getDate() - 1);
      const yesterday = d.toLocaleDateString("en-CA");
      let newStreak = s.streak;
      let newShields = s.streakShields;
      let bannerMsg = null;

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

      const loginXP = 50 + newStreak * 10;
      const newXP = s.xp + loginXP;
      const xpPl = getXpPerLevel(s);
      const oldLevel = getLevel(s.xp, xpPl);
      const newLevel = getLevel(newXP, xpPl);
      const usedShield = newShields < s.streakShields;
      const newLastShieldUseDate = usedShield ? effectiveDate : s.lastShieldUseDate;

      if (newLevel > oldLevel) {
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
      _loginInProgressRef.current = false;
      return { ...s, streak: newStreak, streakShields: newShields, lastLoginDate: effectiveDate, lastShieldUseDate: newLastShieldUseDate, xp: newXP };
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
    const currentState = latestStateRef.current ?? state;
    const xpPl = getXpPerLevel(currentState);
    const oldLevel = getLevel(currentState.xp, xpPl);
    const newXP = currentState.xp + amount;
    const newLevel = getLevel(newXP, xpPl);
    const didLevelUp = newLevel > oldLevel && !silent;
    const snapshotForApi = didLevelUp
      ? { ...currentState, xp: newXP, dynamicCosts: currentState.dynamicCosts }
      : null;

    setState((s) => ({ ...s, xp: s.xp + amount }));

    if (didLevelUp) {
      setTimeout(() => {
        setLevelUpData({ level: newLevel, rank: getRank(newLevel) });
        updateDynamicCosts(getGeminiApiKey(), snapshotForApi, "level_up", trackTokens).then((costs) => {
          if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
        }).catch(() => {});
      }, 300);
    }
  }

  // ── Mission checker ──
  function checkMissions(type) {
    const t = today();
    let pendingToasts = [];
    let pendingLevelUp = null;

    setState((s) => {
      if (!s.dailyMissions) return s;
      const todayLog = s.habitLog[t] || [];
      let bonusXP = 0;
      const toastsThisRun = [];
      const updated = s.dailyMissions.map((m) => {
        if (m.done) return m;
        let progress = 0;
        if (m.type === "habits") progress = todayLog.length;
        if (m.type === "session") progress = (s.sessions || []).filter((ss) => ss.date === t).length;
        if (m.type === "task") progress = (s.tasks || []).filter((tk) => tk.doneDate === t).length;
        if (m.type === "chat") progress = (s.chatHistory || []).some(msg => msg.role === "user" && msg.date === t) ? 1 : 0;
        if (progress >= m.target) {
          bonusXP += m.xp;
          toastsThisRun.push({ icon: "◈", title: "Mission Complete", desc: m.desc, xp: m.xp, rarity: "common" });
          return { ...m, done: true };
        }
        return m;
      });

      const newXP = s.xp + bonusXP;
      if (bonusXP > 0) {
        const xpPl = getXpPerLevel(s);
        const oldLevel = getLevel(s.xp, xpPl);
        const newLevel = getLevel(newXP, xpPl);
        if (newLevel > oldLevel) {
          pendingLevelUp = { level: newLevel, rank: getRank(newLevel), snapshot: { ...s, xp: newXP, dailyMissions: updated, dynamicCosts: s.dynamicCosts } };
        }
      }
      pendingToasts = toastsThisRun;
      return { ...s, dailyMissions: updated, xp: s.xp + bonusXP };
    });

    if (pendingToasts.length) {
      pendingToasts.forEach((toast, i) => setTimeout(() => showToast(toast), 200 + i * 5500));
    }
    if (pendingLevelUp) {
      const { level, rank, snapshot } = pendingLevelUp;
      setTimeout(() => {
        setLevelUpData({ level, rank });
        updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokens).then((costs) => {
          if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
        }).catch(() => {});
      }, 300);
    }
  }

  // ── UI helpers ──
  const showToast = useCallback((data) => {
    clearTimeout(toastTimer.current);
    setToast(data);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const showBanner = useCallback((text, type = "info") => {
    clearTimeout(bannerTimer.current);
    setBanner({ text, type });
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

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
      const ach = { ...data, unlockedAt: Date.now() };
      setTimeout(() => showToast({ ...ach, isAchievement: true }), 300);
      return { ...s, achievements: [...(s.achievements || []), ach] };
    });
    if (!skipXP && data.xp > 0) awardXP(data.xp, null, true);
  }

  // ── Habit logger ──
  function logHabit(habitId, event) {
    if (actionLocksRef.current.has(habitId)) return;
    actionLocksRef.current.add(habitId);
    setTimeout(() => actionLocksRef.current.delete(habitId), 500);
    const t = today();
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit) return;
    const logResult = { didLog: false, xp: habit.xp };
    setState((s) => {
      const log = s.habitLog[t] || [];
      if (log.includes(habitId)) return s;
      logResult.didLog = true;
      return { ...s, habitLog: { ...s.habitLog, [t]: [...log, habitId] } };
    });
    if (logResult.didLog) {
      awardXP(logResult.xp, event);
      checkMissions("habits");
    }
  }

  // ── AI command executor ──
  function executeCommands(commands) {
    if (!Array.isArray(commands) || commands.length === 0) return;
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
      const noControl = s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "");
      return noControl.slice(0, max).replace(/[<>"`&]/g, "");
    };

    commands.forEach((cmd) => {
      if (!cmd || typeof cmd !== "object" || Array.isArray(cmd)) return;
      if (!VALID_CMDS.has(cmd.cmd)) return;
      switch (cmd.cmd) {
        case "add_task":
          if (tasksAdded >= MAX_TASKS_PER_RUN) break;
          tasksAdded++;
          setState((s) => {
            if ((s.tasks || []).length >= MAX_TASKS_TOTAL) return s;
            return {
              ...s,
              tasks: [...(s.tasks || []), {
                id: `t_${crypto.randomUUID()}`,
                text: sanitizeStr(cmd.text),
                priority: ["low","medium","high"].includes(cmd.priority) ? cmd.priority : "medium",
                due: typeof cmd.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cmd.due) ? cmd.due : null,
                done: false,
                addedBy: "ritmol",
              }],
            };
          });
          pendingBanners.push([`Task added: ${sanitizeStr(cmd.text, 60)}`, "info"]);
          break;
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
          const amount = Math.min(Math.max(0, Number(cmd.amount) || 0), MAX_XP_PER_CMD);
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
        case "set_daily_goal":
          setState((s) => ({ ...s, dailyGoal: sanitizeStr(cmd.text) }));
          break;
        case "add_habit": {
          const incomingLabel = sanitizeStr(cmd.label);
          setState((s) => {
            if (s.habits.find((h) => sanitizeStr(h.label) === incomingLabel)) return s;
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
          const achXP = Math.min(Math.max(0, Number(cmd.xp) || 50), MAX_XP_PER_CMD);
          const cappedAchXP = Math.min(achXP, Math.max(0, MAX_XP_PER_RESPONSE - totalXPThisRun));
          const allowedAchXP = consumeAiXpBudget(cappedAchXP);
          totalXPThisRun += allowedAchXP;
          unlockAchievement({
            id:         sanitizeStr(cmd.id, 100),
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
              emoji: typeof cmd.emoji === "string" ? cmd.emoji.slice(0, 2) : "◈",
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
    return <KeysConfigGate />;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onComplete={(profile) => {
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
          <HomeTab
            state={state} setState={setState} profile={profile} apiKey={apiKey}
            level={level} rank={rank} dailyQuote={dailyQuote}
            awardXP={awardXP} logHabit={logHabit}
            showBanner={showBanner} showToast={showToast}
            executeCommands={executeCommands} setTab={setTab}
            buildSystemPrompt={buildSystemPrompt}
          />
        )}
        {tab === "habits" && (
          <HabitsTab
            state={state} setState={setState} logHabit={logHabit}
            awardXP={awardXP} showBanner={showBanner}
            profile={profile} apiKey={apiKey} trackTokens={trackTokens}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            state={state} setState={setState}
            awardXP={awardXP} showBanner={showBanner} checkMissions={checkMissions}
            actionLocksRef={actionLocksRef}
          />
        )}
        {tab === "chat" && (
          <ChatTab
            state={state} setState={setState} profile={profile} apiKey={apiKey}
            executeCommands={executeCommands} showBanner={showBanner}
            buildSystemPrompt={buildSystemPrompt} checkMissions={checkMissions}
            awardXP={awardXP} trackTokens={trackTokens}
          />
        )}
        {tab === "profile" && (
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
            setState((s) => ({ ...s, sleepLog: { ...s.sleepLog, [today()]: data } }));
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
            setState((s) => ({
              ...s,
              screenTimeLog: {
                ...s.screenTimeLog,
                [today()]: { ...(s.screenTimeLog?.[today()] || {}), [modal.period]: mins },
              },
            }));
            const xp = mins < 60 ? 40 : mins < 120 ? 25 : mins < 180 ? 15 : 10;
            awardXP(xp, null, true);
            showBanner(`Screen time logged. ${mins < 60 ? "Impressive discipline." : "Noted."} +${xp} XP`, mins < 60 ? "success" : "info");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "session_log" && (
        <SessionLogModal
          onClose={() => setModal(null)}
          state={state}
          onSubmit={(session) => {
            const xp = calcSessionXP(session.type, session.duration, session.focus, state.streak);
            const newSession = { ...session, id: `session_${crypto.randomUUID()}`, date: today(), xp };
            setState((s) => ({ ...s, sessions: [...(s.sessions || []), newSession] }));
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
      {toast && <AchievementToast toast={toast} onClose={() => setToast(null)} />}

      {/* Session log FAB */}
      <button
        onClick={() => setModal({ type: "session_log" })}
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
