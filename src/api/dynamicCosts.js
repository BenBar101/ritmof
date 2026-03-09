import { callGemini } from "./gemini";
import { LS, storageKey, today } from "../utils/storage";
import { DAILY_TOKEN_LIMIT, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "../constants";
import { getLevel, getXpPerLevel } from "../utils/xp";

// Ask AI to update dynamic costs (xpPerLevel, gachaCost, streakShieldCost) after level-up, gacha pull, or shield use.
// event: "level_up" | "gacha_pull" | "streak_shield_use". Returns partial costs to merge into state.dynamicCosts.
export async function updateDynamicCosts(apiKey, state, event, onTokensUsed) {
  if (!apiKey) return {};
  // Honour the daily token budget.
  const storedUsage = LS.get(storageKey("jv_token_usage"));
  if (storedUsage && storedUsage.date === today() && storedUsage.tokens >= DAILY_TOKEN_LIMIT) return {};
  const d = state.dynamicCosts || {};
  const xpPerLevel = d.xpPerLevel ?? DEFAULT_XP_PER_LEVEL;
  const gachaCost = d.gachaCost ?? DEFAULT_GACHA_COST;
  const streakShieldCost = d.streakShieldCost ?? DEFAULT_STREAK_SHIELD_COST;
  const level = getLevel(state.xp, xpPerLevel);
  const now = new Date();
  const day = now.getDay();
  const weekend = day === 0 || day === 6;
  const month = now.getMonth(), date = now.getDate();
  const holidayHint = (month === 11 && date === 25) ? "Christmas" : (month === 0 && date === 1) ? "New Year" : (month === 6 && date === 4) ? "US Independence Day" : null;
  const VALID_EVENTS = new Set(["level_up", "gacha_pull", "streak_shield_use"]);
  // Whitelist the event string before embedding it in the prompt.
  const safeEvent = VALID_EVENTS.has(event) ? event : "unknown";
  const prompt = `You are the RITMOL system adjusting economy parameters. Event: ${safeEvent}.
Current costs: xpPerLevel=${xpPerLevel}, gachaCost=${gachaCost}, streakShieldCost=${streakShieldCost}. Hunter level=${level}, total XP=${state.xp}.
Context: today is weekday=${!weekend}${holidayHint ? ", holiday=" + holidayHint : ""}. You may raise costs after level-up/gacha/shield use, or offer discounts (e.g. weekends, holidays).
Keep values within these strict bounds: xpPerLevel 200–10000, gachaCost 50–5000, streakShieldCost 100–5000.
Typical reasonable values: xpPerLevel 300–1500, gachaCost 80–400, streakShieldCost 150–600.
Respond ONLY with a JSON object with any of: xpPerLevel, gachaCost, streakShieldCost (only include keys you want to change). Example: {"gachaCost": 180} or {"xpPerLevel": 550, "streakShieldCost": 320}. No explanation.`;

  try {
    const { text, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You output only valid JSON with numeric values.", true);
    if (onTokensUsed && tokensUsed > 0) onTokensUsed(tokensUsed);
    const match = text.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : {};
    const out = {};
    if (typeof data.xpPerLevel === "number" && data.xpPerLevel >= 200 && data.xpPerLevel <= 10000) out.xpPerLevel = Math.round(data.xpPerLevel);
    if (typeof data.gachaCost === "number" && data.gachaCost >= 50 && data.gachaCost <= 5000) out.gachaCost = Math.round(data.gachaCost);
    if (typeof data.streakShieldCost === "number" && data.streakShieldCost >= 100 && data.streakShieldCost <= 5000) out.streakShieldCost = Math.round(data.streakShieldCost);
    return out;
  } catch {
    return {};
  }
}
