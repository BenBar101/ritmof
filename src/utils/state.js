import { LS, storageKey, today } from "./storage";
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

// Safe numeric flush helper — prevents NaN / Infinity from reaching localStorage.
// Used by flushStateToStorage for numeric fields that flow through awardXP or
// streak math.
function safeFlushNum(v, min, max, fallback) {
  return safeNum(v, min, max, fallback);
}

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
export function initState() {
  return {
    profile: LS.get(storageKey("jv_profile"), null),
    // Fix [ST-1]: clamp numeric values so a corrupt localStorage entry
    // (NaN, Infinity, negative) does not propagate into React state.
    xp:           safeNum(LS.get(storageKey("jv_xp"),      0), 0, 100_000_000, 0),
    streak:       safeNum(LS.get(storageKey("jv_streak"),   0), 0, 36500,       0),
    streakShields:safeNum(LS.get(storageKey("jv_shields"),  0), 0, 10000,       0),
    lastLoginDate: LS.get(storageKey("jv_last_login"), null),
    habits: LS.get(storageKey("jv_habits"), DEFAULT_HABITS),
    habitLog: LS.get(storageKey("jv_habit_log"), {}), // { "YYYY-MM-DD": ["habitId",...] }
    tasks: LS.get(storageKey("jv_tasks"), []),
    goals: LS.get(storageKey("jv_goals"), []),
    sessions: LS.get(storageKey("jv_sessions"), []),
    achievements: LS.get(storageKey("jv_achievements"), []),
    gachaCollection: LS.get(storageKey("jv_gacha"), []),
    calendarEvents: LS.get(storageKey("jv_cal_events"), []),
    chatHistory: LS.get(storageKey("jv_chat"), []),
    dailyGoal: LS.get(storageKey("jv_daily_goal"), ""),
    activeTimers: LS.get(storageKey("jv_timers"), []),
    sleepLog: LS.get(storageKey("jv_sleep_log"), {}),
    screenTimeLog: LS.get(storageKey("jv_screen_log"), {}),
    dailyMissions: LS.get(storageKey("jv_missions"), null),
    lastMissionDate: LS.get(storageKey("jv_mission_date"), null),
    pendingHabitSuggestions: LS.get(storageKey("jv_habit_suggestions"), []),
    chronicles: LS.get(storageKey("jv_chronicles"), []),
    gCalConnected: LS.get(storageKey("jv_gcal_connected"), false),
    // Fix [ST-2]: include aiXpToday: 0 and warnedAt: [] in the default so
    // consuming code (consumeAiXpBudget, trackTokens) always sees a fully-formed
    // object and never reads undefined.aiXpToday.
    tokenUsage: LS.get(storageKey("jv_token_usage"), { date: today(), tokens: 0, aiXpToday: 0, warnedAt: [] }),
    habitsInitialized: LS.get(storageKey("jv_habits_init"), false),
    dynamicCosts: LS.get(storageKey("jv_dynamic_costs"), null) || { xpPerLevel: DEFAULT_XP_PER_LEVEL, gachaCost: DEFAULT_GACHA_COST, streakShieldCost: DEFAULT_STREAK_SHIELD_COST },
    lastShieldUseDate: LS.get(storageKey("jv_last_shield_use_date"), null),
    lastShieldBuyDate: LS.get(storageKey("jv_last_shield_buy_date"), null),
    syncFileConnected: false, // updated async after mount by SyncManager.getHandle()
  };
}

// ═══════════════════════════════════════════════════════════════
// FLUSH STATE → LOCALSTORAGE
// ═══════════════════════════════════════════════════════════════
// Single authoritative function so no state field is ever missed in sync paths.
export function flushStateToStorage(s) {
  if (!s?.profile) return;
  // eslint-disable-next-line no-unused-vars
  const { geminiKey: _stripped, ...profileToSave } = s.profile;
  LS.set(storageKey("jv_profile"),           profileToSave);
  // Fix [ST-1]: clamp numeric values before writing to localStorage.
  // If awardXP somehow received a bad amount (e.g. from a corrupted habit.xp),
  // state.xp could be NaN. Writing NaN to localStorage persists the corruption
  // across sessions. safeFlushNum catches this and writes 0 instead.
  LS.set(storageKey("jv_xp"),                safeFlushNum(s.xp,            0, 100_000_000, 0));
  LS.set(storageKey("jv_streak"),            safeFlushNum(s.streak,        0, 36500,       0));
  LS.set(storageKey("jv_shields"),           safeFlushNum(s.streakShields, 0, 10000,       0));
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
  LS.set(
    storageKey("jv_timers"),
    Array.isArray(s.activeTimers) ? s.activeTimers : [],
  );
  LS.set(
    storageKey("jv_habit_suggestions"),
    Array.isArray(s.pendingHabitSuggestions) ? s.pendingHabitSuggestions : [],
  );
  LS.set(storageKey("jv_gcal_connected"),    s.gCalConnected);
  LS.set(storageKey("jv_habits_init"),       s.habitsInitialized);
  if (s.dynamicCosts) LS.set(storageKey("jv_dynamic_costs"), s.dynamicCosts);
  // Always write lastShieldUseDate including null — null means "no shield used yet".
  LS.set(storageKey("jv_last_shield_use_date"), s.lastShieldUseDate ?? null);
  LS.set(storageKey("jv_last_shield_buy_date"), s.lastShieldBuyDate ?? null);
}
