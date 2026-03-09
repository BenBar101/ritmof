import { DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST, RANKS, FOCUS_LEVELS, SESSION_TYPES } from "../constants";

// ═══════════════════════════════════════════════════════════════
// XP & LEVEL UTILS
// ═══════════════════════════════════════════════════════════════
export function getLevel(xp, xpPerLevel = DEFAULT_XP_PER_LEVEL) { return Math.floor(xp / xpPerLevel); }
export function getLevelProgress(xp, xpPerLevel = DEFAULT_XP_PER_LEVEL) { return xp % xpPerLevel; }

export function getRank(level) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (level >= RANKS[i].min) return RANKS[i];
  }
  return RANKS[0];
}

export function calcSessionXP(type, durationMins, focusId, streakDays) {
  const sType = SESSION_TYPES.find((s) => s.id === type) || SESSION_TYPES[0];
  const focus = FOCUS_LEVELS.find((f) => f.id === focusId) || FOCUS_LEVELS[1];
  const base = sType.baseXP * focus.mult;
  const durationBonus = Math.floor(durationMins / 30) * 10;
  const streakBonus = streakDays >= 7 ? 1.5 : streakDays >= 3 ? 1.25 : 1.0;
  return Math.round((base + durationBonus) * streakBonus);
}

export function getXpPerLevel(state) { return state.dynamicCosts?.xpPerLevel ?? DEFAULT_XP_PER_LEVEL; }
export function getGachaCost(state) { return state.dynamicCosts?.gachaCost ?? DEFAULT_GACHA_COST; }
export function getStreakShieldCost(state) { return state.dynamicCosts?.streakShieldCost ?? DEFAULT_STREAK_SHIELD_COST; }
