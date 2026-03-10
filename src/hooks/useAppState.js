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
import { storageKey } from "../utils/storage";
import { idbSet, idbGetAll } from "../utils/idb";
import { initState } from "../utils/state";
import { migrateLocalStorageToIdb } from "../utils/migrate";

function persistState(s) {
  if (!s?.profile) return;

  const profileToSave = s.profile ? (() => {
    // eslint-disable-next-line no-unused-vars
    const { geminiKey: _g, ...rest } = s.profile;
    return rest;
  })() : null;
  idbSet(storageKey("jv_profile"),            profileToSave);
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
  idbSet(storageKey("jv_missions"),           s.dailyMissions);
  idbSet(storageKey("jv_mission_date"),       s.lastMissionDate);
  idbSet(storageKey("jv_chronicles"),         s.chronicles);
  idbSet(storageKey("jv_token_usage"),        s.tokenUsage);
  idbSet(storageKey("jv_timers"),             Array.isArray(s.activeTimers) ? s.activeTimers : []);
  idbSet(storageKey("jv_habit_suggestions"),  Array.isArray(s.pendingHabitSuggestions) ? s.pendingHabitSuggestions : []);
  idbSet(storageKey("jv_gcal_connected"),     s.gCalConnected);
  idbSet(storageKey("jv_habits_init"),        s.habitsInitialized);
  if (s.dynamicCosts) idbSet(storageKey("jv_dynamic_costs"), s.dynamicCosts);
  idbSet(storageKey("jv_last_shield_use_date"), s.lastShieldUseDate ?? null);
  idbSet(storageKey("jv_last_shield_buy_date"), s.lastShieldBuyDate ?? null);
}

// ─────────────────────────────────────────────────────────────
export function useAppState() {
  // null = still loading from IDB; actual state object = ready
  const [state, _setState] = useState(null);
  const [idbReady, setIdbReady] = useState(false);
  const latestStateRef = useRef(null);

  // ── Async boot: migrate (if needed) → populate IDB cache → initState ──
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        // 1. Populate in-memory cache from IDB (must happen before initState)
        await idbGetAll();
        // 2. Migrate from localStorage if this is an existing user's first
        //    run after the IDB migration ships. No-op for new users.
        await migrateLocalStorageToIdb();
        // 3. Now idbGet() is synchronous and populated — initState() is safe
        if (!cancelled) {
          const fresh = initState();
          latestStateRef.current = fresh;
          _setState(fresh);
          setIdbReady(true);
        }
      } catch (e) {
        console.error("[useAppState] Boot failed:", e);
        // Last-resort: try initState() anyway. If THAT also fails, fall back to a
        // minimal empty state so the app can surface an error instead of hanging
        // forever on the INITIALISING screen.
        if (!cancelled) {
          try {
            const fresh = initState();
            latestStateRef.current = fresh;
            _setState(fresh);
            setIdbReady(true);
          } catch (innerE) {
            console.error("[useAppState] initState failed in fallback:", innerE);
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
              pendingHabitSuggestions: [],
              gCalConnected: false,
              habitsInitialized: false,
            };
            latestStateRef.current = emergency;
            _setState(emergency);
            setIdbReady(true);
          }
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
      return next;
    });
  }, []);

  // Called after a Pull: SyncManager.applyPayload() has written to IDB.
  // Re-populate cache from IDB then re-run initState().
  const rehydrate = useCallback(async () => {
    await idbGetAll(); // repopulate cache with what Pull just wrote
    const fresh = initState();
    latestStateRef.current = fresh;
    _setState(fresh);
    return fresh;
  }, []);

  return { state, setState, latestStateRef, rehydrate, idbReady };
}

