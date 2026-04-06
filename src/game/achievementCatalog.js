/**
 * Static achievement definitions — evaluated locally (no AI).
 * `condition` receives state snapshot + helpers.
 */

import { localDateFromUTC } from "../utils/db";
import { getLevel as getLevelFromXp } from "../utils/xp";

/**
 * @param {object} s app state
 * @returns {boolean}
 */
function habitsTodayCount(s) {
  const t = localDateFromUTC();
  return (s.habitLog?.[t] || []).length;
}

function totalHabitsLogged(s) {
  let n = 0;
  for (const ids of Object.values(s.habitLog || {})) {
    n += (ids || []).length;
  }
  return n;
}

/** @type {Array<{ id: string, title: string, desc?: string, flavorText?: string, icon?: string, xp?: number, rarity?: string, hidden?: boolean, condition: (s: object) => boolean }>} */
export const ACHIEVEMENT_CATALOG = [
  {
    id: "static_first_habit",
    title: "First Log",
    desc: "Complete one habit in a day.",
    icon: "◉",
    xp: 15,
    rarity: "common",
    hidden: false,
    condition: (s) => habitsTodayCount(s) >= 1,
  },
  {
    id: "static_all_habits_day",
    title: "Full Circuit",
    desc: "Complete every habit in one day.",
    icon: "◎",
    xp: 50,
    rarity: "rare",
    hidden: false,
    condition: (s) => {
      const total = (s.habits || []).length;
      if (total === 0) return false;
      return habitsTodayCount(s) >= total;
    },
  },
  {
    id: "static_streak_7",
    title: "Week Unbroken",
    desc: "Reach a 7-day streak.",
    icon: "◇",
    xp: 75,
    rarity: "rare",
    hidden: true,
    condition: (s) => (s.streak || 0) >= 7,
  },
  {
    id: "static_streak_30",
    title: "Month Forged",
    desc: "Reach a 30-day streak.",
    icon: "◈",
    xp: 200,
    rarity: "epic",
    hidden: true,
    condition: (s) => (s.streak || 0) >= 30,
  },
  {
    id: "static_sessions_10",
    title: "Ten Sessions",
    desc: "Log 10 study sessions total.",
    icon: "▣",
    xp: 40,
    rarity: "common",
    hidden: true,
    condition: (s) => (s.sessions || []).length >= 10,
  },
  {
    id: "static_tasks_25",
    title: "Task Grinder",
    desc: "Complete 25 tasks (cumulative).",
    icon: "✓",
    xp: 60,
    rarity: "rare",
    hidden: true,
    condition: (s) => (s.tasks || []).filter((t) => t.done).length >= 25,
  },
  {
    id: "static_habits_100",
    title: "Hundred Marks",
    desc: "Log 100 habit completions all-time.",
    icon: "✧",
    xp: 100,
    rarity: "epic",
    hidden: true,
    condition: (s) => totalHabitsLogged(s) >= 100,
  },
  {
    id: "static_level_10",
    title: "Double Digits",
    desc: "Reach level 10.",
    icon: "⌂",
    xp: 80,
    rarity: "rare",
    hidden: true,
    condition: (s, xpPerLevel) => getLevelFromXp(s.xp || 0, xpPerLevel) >= 10,
  },
];

/**
 * @param {object} state
 * @param {number} xpPerLevel from getXpPerLevel(state)
 * @returns {string[]} ids newly satisfied (caller dedupes against state.achievements)
 */
export function evaluateAchievementCatalog(state, xpPerLevel) {
  const unlockedIds = [];
  const have = new Set((state.achievements || []).map((a) => a.id));
  for (const def of ACHIEVEMENT_CATALOG) {
    if (have.has(def.id)) continue;
    const ok = def.id === "static_level_10"
      ? def.condition(state, xpPerLevel)
      : def.condition(state);
    if (ok) unlockedIds.push(def.id);
  }
  return unlockedIds;
}

export function getAchievementDef(id) {
  return ACHIEVEMENT_CATALOG.find((d) => d.id === id);
}
