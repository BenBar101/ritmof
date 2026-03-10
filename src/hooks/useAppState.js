// ═══════════════════════════════════════════════════════════════
// useAppState
//
// Owns:
//  - All React state (single useState)
//  - localStorage persistence (one useEffect, not 25)
//  - The "write-through" setState wrapper that persists atomically
//
// WHY THIS EXISTS:
//  The original App.jsx had two competing flush paths:
//   1. 25 individual useEffect hooks, each watching one slice
//   2. flushStateToStorage() called from sync paths
//  These ran at different render cycles and caused race conditions
//  where Pull would overwrite state that was mid-flush.
//
//  This hook makes localStorage always a mirror of the last
//  committed state — written synchronously inside the setState
//  updater, not in a downstream effect. That means:
//   - No render cycle gap where localStorage lags React state
//   - Sync paths can read localStorage and get current data
//   - No duplicate flush logic to maintain
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useRef } from "react";
import { LS, storageKey } from "../utils/storage";
import { initState } from "../utils/state";

// ── Per-field persist helpers ─────────────────────────────────
// These are kept thin intentionally. The goal is one clear
// mapping from state field → storage key, not business logic.
function persistState(s) {
  if (!s?.profile) return;

  // eslint-disable-next-line no-unused-vars
  const { geminiKey: _g, ...profileToSave } = s.profile;
  LS.set(storageKey("jv_profile"), profileToSave);

  // Numeric fields — already validated upstream by awardXP / streakMath
  LS.set(storageKey("jv_xp"),      s.xp);
  LS.set(storageKey("jv_streak"),  s.streak);
  LS.set(storageKey("jv_shields"), s.streakShields);

  LS.set(storageKey("jv_last_login"),        s.lastLoginDate);
  LS.set(storageKey("jv_habits"),            s.habits);
  LS.set(storageKey("jv_habit_log"),         s.habitLog);
  LS.set(storageKey("jv_tasks"),             s.tasks);
  LS.set(storageKey("jv_goals"),             s.goals);
  LS.set(storageKey("jv_sessions"),          s.sessions);
  LS.set(storageKey("jv_achievements"),      s.achievements);
  LS.set(storageKey("jv_gacha"),             s.gachaCollection);
  LS.set(storageKey("jv_cal_events"),        s.calendarEvents);
  LS.set(storageKey("jv_chat"),              s.chatHistory);
  LS.set(storageKey("jv_daily_goal"),        s.dailyGoal);
  LS.set(storageKey("jv_sleep_log"),         s.sleepLog);
  LS.set(storageKey("jv_screen_log"),        s.screenTimeLog);
  LS.set(storageKey("jv_missions"),          s.dailyMissions);
  LS.set(storageKey("jv_mission_date"),      s.lastMissionDate);
  LS.set(storageKey("jv_chronicles"),        s.chronicles);
  LS.set(storageKey("jv_token_usage"),       s.tokenUsage);
  LS.set(storageKey("jv_timers"),            Array.isArray(s.activeTimers) ? s.activeTimers : []);
  LS.set(storageKey("jv_habit_suggestions"), Array.isArray(s.pendingHabitSuggestions) ? s.pendingHabitSuggestions : []);
  LS.set(storageKey("jv_gcal_connected"),    s.gCalConnected);
  LS.set(storageKey("jv_habits_init"),       s.habitsInitialized);
  if (s.dynamicCosts) LS.set(storageKey("jv_dynamic_costs"), s.dynamicCosts);
  LS.set(storageKey("jv_last_shield_use_date"), s.lastShieldUseDate ?? null);
  LS.set(storageKey("jv_last_shield_buy_date"), s.lastShieldBuyDate ?? null);
}

// ─────────────────────────────────────────────────────────────
export function useAppState() {
  const [state, _setState] = useState(initState);

  // Ref always holds the latest state for use inside async closures
  // (sync push, scheduled timers) without needing to list state as
  // a dependency of every effect.
  const latestStateRef = useRef(state);

  // Write-through setState: persists to localStorage synchronously
  // as part of the React state update so the two are never out of step.
  const setState = useCallback((updater) => {
    _setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      latestStateRef.current = next;
      // Write-through: persist immediately so sync push always reads fresh data.
      // This replaces all 25 individual useEffect flushes in the original App.jsx.
      persistState(next);
      return next;
    });
  }, []);

  // Called after a Pull to reload from localStorage without any
  // async setState/initState race. The Pull already wrote to LS;
  // we just re-read it.
  const rehydrate = useCallback(() => {
    const fresh = initState();
    latestStateRef.current = fresh;
    _setState(fresh);
    return fresh;
  }, []);

  return { state, setState, latestStateRef, rehydrate };
}
