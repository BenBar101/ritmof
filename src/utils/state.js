import { storageKey, todayUTC } from "./db";
import { idbGet } from "./db";
import { DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST, DEFAULT_HABITS } from "../constants";

// ─────────────────────────────────────────────────────────────────
// Safe numeric read helper
// Fix [ST-1]: LS.get can return NaN, null, Infinity, or a string for numeric keys
// if the stored value was corrupted by a previous bug or a crafted sync file that
// slipped past validators. Reading such values raw and doing arithmetic on them
// (e.g. xp + amount) permanently corrupts state.
//   safeNum(v, min, max, fallback) — clamps to [min, max]; returns fallback if
//   the value is not a finite number.
// ─────────────────────────────────────────────────────────────────
function safeNum(v, min, max, fallback) {
  if (typeof v === "number" && isFinite(v) && v >= min && v <= max) return v;
  // Accept coercible-to-number strings (e.g. "42") written by old code versions.
  const n = Number(v);
  if (isFinite(n) && n >= min && n <= max) return n;
  return fallback;
}

// NOTE: state persistence is handled exclusively by persistState() in hooks/useAppState.js via write-through setState.
// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
export function initState() {
  return {
    profile: idbGet(storageKey("jv_profile"), null),
    // Fix [ST-1]: clamp numeric values so a corrupt localStorage entry
    // (NaN, Infinity, negative) does not propagate into React state.
    xp:           safeNum(idbGet(storageKey("jv_xp"),      0), 0, 10_000_000, 0),
    streak:       safeNum(idbGet(storageKey("jv_streak"),   0), 0, 3650,        0),
    streakShields:safeNum(idbGet(storageKey("jv_shields"),  0), 0, 50,         0),
    lastLoginDate: idbGet(storageKey("jv_last_login"), null),
    habits: idbGet(storageKey("jv_habits"), DEFAULT_HABITS),
    habitLog: idbGet(storageKey("jv_habit_log"), {}), // { "YYYY-MM-DD": ["habitId",...] }
    tasks: idbGet(storageKey("jv_tasks"), []),
    goals: idbGet(storageKey("jv_goals"), []),
    sessions: idbGet(storageKey("jv_sessions"), []),
    achievements: idbGet(storageKey("jv_achievements"), []),
    gachaCollection: idbGet(storageKey("jv_gacha"), []),
    calendarEvents: idbGet(storageKey("jv_cal_events"), []),
    chatHistory: idbGet(storageKey("jv_chat"), []),
    dailyGoal: idbGet(storageKey("jv_daily_goal"), ""),
    activeTimers: idbGet(storageKey("jv_timers"), []),
    sleepLog: idbGet(storageKey("jv_sleep_log"), {}),
    screenTimeLog: idbGet(storageKey("jv_screen_log"), {}),
    dailyMissions: idbGet(storageKey("jv_missions"), null),
    lastMissionDate: idbGet(storageKey("jv_mission_date"), null),
    weeklyMissions: idbGet(storageKey("jv_weekly_missions"), null),
    lastWeeklyMissionDate: idbGet(storageKey("jv_weekly_mission_date"), null),
    monthlyMissions: idbGet(storageKey("jv_monthly_missions"), null),
    lastMonthlyMissionDate: idbGet(storageKey("jv_monthly_mission_date"), null),
    chronicles: idbGet(storageKey("jv_chronicles"), []),
    gCalConnected: idbGet(storageKey("jv_gcal_connected"), false),
    gCalSelectedIds: idbGet(storageKey("jv_gcal_selected_ids"), null),
    gCalLastSync: idbGet(storageKey("jv_gcal_last_sync"), null), // ISO date string of last successful auto-sync
    // Fix [ST-2]: include aiXpToday: 0 and warnedAt: [] in the default so
    // consuming code (consumeAiXpBudget, trackTokens) always sees a fully-formed
    // object and never reads undefined.aiXpToday.
    tokenUsage: idbGet(storageKey("jv_token_usage"), { date: todayUTC(), tokens: 0, aiXpToday: 0, warnedAt: [] }),
    dynamicCosts: idbGet(storageKey("jv_dynamic_costs"), null) || { xpPerLevel: DEFAULT_XP_PER_LEVEL, gachaCost: DEFAULT_GACHA_COST, streakShieldCost: DEFAULT_STREAK_SHIELD_COST },
    lastShieldUseDate: idbGet(storageKey("jv_last_shield_use_date"), null),
    lastShieldBuyDate: idbGet(storageKey("jv_last_shield_buy_date"), null),
    syncFileConnected: false, // updated async after mount by SyncManager.getHandle()
  };
}

