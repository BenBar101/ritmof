// ═══════════════════════════════════════════════════════════════
// useAppState
//
// Owns:
//  - All React state (single useState)
//  - IndexedDB persistence via idb.js (single write-through path)
//  - The "write-through" setState wrapper that persists atomically
//
// WHY THIS EXISTS:
//  The original App.jsx had two competing flush paths:
//   1. 25 individual useEffect hooks, each watching one slice
//   2. flushStateToStorage() called from sync paths
//  These ran at different render cycles and caused race conditions
//  where Pull would overwrite state that was mid-flush.
//
//  This hook makes the persistent store always a mirror of the last
//  committed state — written synchronously inside the setState
//  updater, not in a downstream effect. That means:
//   - No render cycle gap where storage lags React state
//   - Sync paths can read storage and get current data
//   - No duplicate flush logic to maintain
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useRef, useEffect } from "react";
import { storageKey, idbSet, localDateFromUTC } from "../utils/db";
import { initState } from "../utils/state";
import { DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "../constants";
import { WIDGET_UPDATE_DEBOUNCE_MS } from "../config.js";
import { getLevel, getRank } from "../utils/xp";
import { RitmolWidget } from "../plugins/RitmolWidget.js";

let _persistErrorCount = 0;

function persistState(s) {
  if (!s) return;
  try {
    if (s.profile) {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _gk, aiApiKey: _ak, ...rest } = s.profile;
      idbSet(storageKey("jv_profile"), rest);
    }
    idbSet(storageKey("jv_xp"),                 s.xp);
    idbSet(storageKey("jv_streak"),             s.streak);
    idbSet(storageKey("jv_shields"),            s.streakShields);
    idbSet(storageKey("jv_last_login"),         s.lastLoginDate);
    idbSet(storageKey("jv_habits"),             s.habits);
    idbSet(storageKey("jv_habit_log"),          s.habitLog);
    idbSet(storageKey("jv_tasks"),              s.tasks);
    idbSet(storageKey("jv_goals"),              s.goals);
    idbSet(storageKey("jv_sessions"),           s.sessions);
    idbSet(storageKey("jv_achievements"),       s.achievements);
    idbSet(storageKey("jv_gacha"),              s.gachaCollection);
    idbSet(storageKey("jv_cal_events"),         s.calendarEvents);
    idbSet(storageKey("jv_chat"),               s.chatHistory);
    idbSet(storageKey("jv_daily_goal"),         s.dailyGoal);
    idbSet(storageKey("jv_sleep_log"),          s.sleepLog);
    idbSet(storageKey("jv_screen_log"),         s.screenTimeLog);
    idbSet(storageKey("jv_missions"),                s.dailyMissions);
    idbSet(storageKey("jv_mission_date"),            s.lastMissionDate);
    idbSet(storageKey("jv_weekly_missions"),         s.weeklyMissions ?? null);
    idbSet(storageKey("jv_weekly_mission_date"),     s.lastWeeklyMissionDate ?? null);
    idbSet(storageKey("jv_monthly_missions"),        s.monthlyMissions ?? null);
    idbSet(storageKey("jv_monthly_mission_date"),    s.lastMonthlyMissionDate ?? null);
    idbSet(storageKey("jv_chronicles"),              s.chronicles);
    idbSet(storageKey("jv_token_usage"),        s.tokenUsage);
    idbSet(storageKey("jv_timers"),             Array.isArray(s.activeTimers)
      ? s.activeTimers.filter(t =>
          typeof t.endsAt === "number" &&
          t.endsAt > Date.now() - 3_600_000 &&
          t.endsAt <= Date.now() + 28_800_000  // 8 h max — mirrors TimerSchema ceiling
        )
      : []);
    idbSet(storageKey("jv_gcal_connected"),     s.gCalConnected);
    idbSet(storageKey("jv_gcal_selected_ids"),  s.gCalSelectedIds);
    idbSet(storageKey("jv_gcal_last_sync"),     s.gCalLastSync ?? null);
    idbSet(storageKey("jv_dynamic_costs"), s.dynamicCosts ?? null);
    idbSet(storageKey("jv_last_shield_use_date"), s.lastShieldUseDate ?? null);
    idbSet(storageKey("jv_last_shield_buy_date"), s.lastShieldBuyDate ?? null);
    idbSet(storageKey("jv_tutorial_done"), s.tutorialDone ?? false);
    idbSet(storageKey("jv_healthkit_enabled"), s.healthKitEnabled ?? false);
    idbSet(storageKey("jv_google_auth_connected"), s.googleAuthConnected ?? false);
    idbSet(storageKey("jv_notifications_enabled"), s.notificationsEnabled ?? false);
    idbSet(storageKey("jv_last_ai_notif_batch"), s.lastAiNotificationBatch ?? null);
    idbSet(storageKey("jv_ai_notif_log"), s.aiNotificationLog ?? {});
    idbSet(storageKey("jv_lecture_quick_log_pending"), s.lectureQuickLogPending ?? {});
    _persistErrorCount = 0;
  } catch (e) {
    _persistErrorCount += 1;
    if (e?.name === "QuotaExceededError") {
      window.dispatchEvent(new CustomEvent("ls-quota-exceeded"));
    } else if (_persistErrorCount >= 3) {
      window.dispatchEvent(new CustomEvent("ls-quota-exceeded"));
      if (import.meta.env.DEV) {
        console.error("[persistState] IDB write failed:", e?.message ?? e);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
export function useAppState() {
  // null = still loading from IDB; actual state object = ready
  const [state, _setState] = useState(null);
  const [idbReady, setIdbReady] = useState(false);
  const [rehydrateCount, setRehydrateCount] = useState(0);
  const latestStateRef = useRef(null);
  const widgetDebounceRef = useRef(null);

  useEffect(() => () => {
    if (widgetDebounceRef.current) clearTimeout(widgetDebounceRef.current);
  }, []);

  // ── Async boot: initState ──
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (cancelled) return;
      try {
        const fresh = initState();
        latestStateRef.current = fresh;
        _setState(fresh);
        setIdbReady(true);
      } catch (e) {
        console.error("[useAppState] Boot failed — using emergency state:", e);
        if (!cancelled) {
          const emergency = {
            profile: null,
            xp: 0,
            streak: 0,
            streakShields: 0,
            habits: [],
            habitLog: {},
            tasks: [],
            goals: [],
            sessions: [],
            achievements: [],
            gachaCollection: [],
            calendarEvents: [],
            chatHistory: [],
            dailyGoal: null,
            sleepLog: {},
            screenTimeLog: {},
            dailyMissions: null,
            lastMissionDate: null,
            chronicles: [],
            tokenUsage: null,
            activeTimers: [],
            gCalConnected: false,
            gCalSelectedIds: null,
            dynamicCosts: {
              xpPerLevel: DEFAULT_XP_PER_LEVEL,
              gachaCost: DEFAULT_GACHA_COST,
              streakShieldCost: DEFAULT_STREAK_SHIELD_COST,
            },
            lastShieldUseDate: null,
            lastShieldBuyDate: null,
            tutorialDone: false,
            healthKitEnabled: false,
            googleAuthConnected: false,
            notificationsEnabled: false,
            lastAiNotificationBatch: null,
            aiNotificationLog: {},
            lectureQuickLogPending: {},
          };
          latestStateRef.current = emergency;
          _setState(emergency);
          setIdbReady(true);
        }
      }
    }
    boot();
    return () => { cancelled = true; };
  }, []);

  // Write-through setState: persists to IDB synchronously
  // as part of the React state update so the two are never out of step.
  const setState = useCallback((updater) => {
    _setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      latestStateRef.current = next;
      // Write-through: persist immediately so sync push always reads fresh data.
      persistState(next);
      if (widgetDebounceRef.current) clearTimeout(widgetDebounceRef.current);
      widgetDebounceRef.current = setTimeout(() => {
        try {
          const s = latestStateRef.current;
          if (!s) return;
          const xpPerLevel = s.dynamicCosts?.xpPerLevel ?? DEFAULT_XP_PER_LEVEL;
          const level = getLevel(s.xp, xpPerLevel);
          const rankLabel = getRank(level)?.label ?? "Novice";
          const today = localDateFromUTC();
          const [ty, tm, td] = today.split("-").map((x) => parseInt(x, 10));
          const tnext = new Date(ty, tm - 1, td);
          tnext.setDate(tnext.getDate() + 1);
          const tomorrow = `${tnext.getFullYear()}-${String(tnext.getMonth() + 1).padStart(2, "0")}-${String(tnext.getDate()).padStart(2, "0")}`;
          const nextLecture = (s.calendarEvents ?? [])
            .filter((e) => e.type === "lecture" && e.start && new Date(e.start) > new Date())
            .sort((a, b) => new Date(a.start) - new Date(b.start))[0] ?? null;
          const dueTasks = (s.tasks ?? [])
            .filter((t) => !t.done && t.due && t.due <= tomorrow)
            .slice(0, 2)
            .map((t) => ({ text: (t.text ?? "").slice(0, 40) }));
          RitmolWidget.updateWidgetData({
            streak: s.streak ?? 0,
            xp: s.xp ?? 0,
            xpPerLevel,
            rankLabel,
            level,
            nextLecture: nextLecture
              ? { title: (nextLecture.title ?? "").slice(0, 40), startTime: nextLecture.start }
              : null,
            dueTasks,
          }).catch(() => {});
        } catch { /* widget writes are never fatal */ }
      }, WIDGET_UPDATE_DEBOUNCE_MS);
      return next;
    });
  }, []);

  // Called after a Pull: SyncManager.applyPayload() has written to IDB.
  // Re-populate cache from IDB then re-run initState().
  const rehydrate = useCallback(async () => {
    const fresh = initState();
    latestStateRef.current = fresh;
    _setState(fresh);
    setRehydrateCount((c) => c + 1);
    return fresh;
  }, []);

  return { state, setState, latestStateRef, rehydrate, idbReady, rehydrateCount };
}

