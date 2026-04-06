import { STATIC_WEEKLY_MISSION_TEMPLATES } from "../data/staticWeeklyMissions.js";
import { STATIC_MONTHLY_MISSION_TEMPLATES } from "../data/staticMonthlyMissions.js";

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {'weekly'|'monthly'} period
 * @param {string} periodKey e.g. 2026-W14 or 2026-04
 * @param {{ name?: string }|null} profile
 * @returns {Array<{ id: string, desc: string, type: string, target: number, xp: number, done: boolean }>}
 */
export function pickStaticPeriodMissions(period, periodKey, profile) {
  const templates = period === "weekly" ? STATIC_WEEKLY_MISSION_TEMPLATES : STATIC_MONTHLY_MISSION_TEMPLATES;
  const count = period === "weekly" ? 5 : 3;
  const seed = `${periodKey}|${profile?.name || "hunter"}`;
  const base = hashStr(seed);

  const out = [];
  const n = templates.length;
  for (let i = 0; i < count; i++) {
    const idx = (base + i * 2654435761) % n;
    const t = templates[idx];
    out.push({
      id: `${period}_static_${periodKey}_${i}`,
      desc: t.desc,
      type: t.type,
      target: t.target,
      xp: t.xp,
      done: false,
    });
  }
  return out;
}
