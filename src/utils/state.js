import { LS, storageKey, today } from "./storage";
import { DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST, DEFAULT_HABITS } from "../constants";

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
export function initState() {
  return {
    profile: LS.get(storageKey("jv_profile"), null),
    xp: LS.get(storageKey("jv_xp"), 0),
    streak: LS.get(storageKey("jv_streak"), 0),
    streakShields: LS.get(storageKey("jv_shields"), 0),
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
    tokenUsage: LS.get(storageKey("jv_token_usage"), { date: today(), tokens: 0 }),
    habitsInitialized: LS.get(storageKey("jv_habits_init"), false),
    dynamicCosts: LS.get(storageKey("jv_dynamic_costs"), null) || { xpPerLevel: DEFAULT_XP_PER_LEVEL, gachaCost: DEFAULT_GACHA_COST, streakShieldCost: DEFAULT_STREAK_SHIELD_COST },
    lastShieldUseDate: LS.get(storageKey("jv_last_shield_use_date"), null),
    syncFileConnected: false, // updated async after mount by SyncManager.getHandle()
  };
}

// ═══════════════════════════════════════════════════════════════
// FLUSH STATE → LOCALSTORAGE
// ═══════════════════════════════════════════════════════════════
// Single authoritative function so no state field is ever missed in sync paths.
export function flushStateToStorage(s) {
  if (!s?.profile) return;
  const { geminiKey: _stripped, ...profileToSave } = s.profile;
  LS.set(storageKey("jv_profile"),           profileToSave);
  LS.set(storageKey("jv_xp"),                s.xp);
  LS.set(storageKey("jv_streak"),            s.streak);
  LS.set(storageKey("jv_shields"),           s.streakShields);
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
  LS.set(storageKey("jv_timers"),            s.activeTimers);
  LS.set(storageKey("jv_habit_suggestions"), s.pendingHabitSuggestions);
  // NOTE: jv_gcal_connected is omitted here — persisted by its own granular useEffect in App.
  if (s.dynamicCosts) LS.set(storageKey("jv_dynamic_costs"), s.dynamicCosts);
  // Always write lastShieldUseDate including null — null means "no shield used yet".
  LS.set(storageKey("jv_last_shield_use_date"), s.lastShieldUseDate ?? null);
}
