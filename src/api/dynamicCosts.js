import { callGemini } from "./gemini";
import { storageKey, todayUTC } from "../utils/storage";
import { idbGet } from "../utils/db";
import { DAILY_TOKEN_LIMIT, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST } from "../constants";
import { getLevel } from "../utils/xp";

let _dcInFlight = false;

// Ask AI to update dynamic costs (xpPerLevel, gachaCost, streakShieldCost) after level-up, gacha pull, or shield use.
// event: "level_up" | "gacha_pull" | "streak_shield_use". Returns partial costs to merge into state.dynamicCosts.
export async function updateDynamicCosts(apiKey, state, event, onTokensUsed) {
  if (_dcInFlight) return {};
  _dcInFlight = true;
  let _dcTimeout;
  try {
    if (!apiKey) return {};
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return {};
    // Honour the daily token budget.
    const storedUsage = idbGet(storageKey("jv_token_usage"), null);
    if (storedUsage && storedUsage.date === todayUTC() && storedUsage.tokens >= DAILY_TOKEN_LIMIT) return {};
    const d = state.dynamicCosts || {};
    const xpPerLevel = Math.floor(
      Math.max(200, Math.min(10000, Number(d.xpPerLevel ?? DEFAULT_XP_PER_LEVEL) || DEFAULT_XP_PER_LEVEL)),
    );
    const gachaCost = Math.floor(
      Math.max(50, Math.min(5000, Number(d.gachaCost ?? DEFAULT_GACHA_COST) || DEFAULT_GACHA_COST)),
    );
    const streakShieldCost = Math.floor(
      Math.max(
        100,
        Math.min(5000, Number(d.streakShieldCost ?? DEFAULT_STREAK_SHIELD_COST) || DEFAULT_STREAK_SHIELD_COST),
      ),
    );
    const level = Math.floor(Math.max(0, Number(getLevel(state.xp, xpPerLevel)) || 0));
    const now = new Date();
    const day = now.getUTCDay();
    const weekend = day === 0 || day === 6;
    const month = now.getUTCMonth(), date = now.getUTCDate();
    const holidayHint = (month === 11 && date === 25) ? "Christmas" : (month === 0 && date === 1) ? "New Year" : (month === 6 && date === 4) ? "US Independence Day" : null;
    const safeHolidayHint = holidayHint ? holidayHint.replace(/[^a-zA-Z]/g, "").slice(0, 30) : null;
    const VALID_EVENTS = new Set(["level_up", "gacha_pull", "streak_shield_use", "streak_shield_buy"]);
    // Whitelist the event string before embedding it in the prompt.
    const safeEvent = VALID_EVENTS.has(event) ? event : "unknown";
    const safeTotalXp = Math.floor(Math.max(0, Number(state.xp) || 0));
    const contextJson = JSON.stringify({ event: safeEvent, weekend: !weekend, holiday: safeHolidayHint });
    const prompt = `You are the RITMOL system adjusting economy parameters.
Context: ${contextJson}
Current costs: xpPerLevel=${xpPerLevel}, gachaCost=${gachaCost}, streakShieldCost=${streakShieldCost}. Hunter level=${level}, total XP=${safeTotalXp}.
Keep values within these strict bounds: xpPerLevel 200–10000, gachaCost 50–5000, streakShieldCost 100–5000.
Typical reasonable values: xpPerLevel 300–1500, gachaCost 80–400, streakShieldCost 150–600.
Respond ONLY with a JSON object with any of: xpPerLevel, gachaCost, streakShieldCost (only include keys you want to change). Example: {"gachaCost": 180} or {"xpPerLevel": 550, "streakShieldCost": 320}. No explanation.`;

    // _dcInFlight is already true here (set at function entry).
    // The outer try/finally resets it unconditionally even on synchronous throws.
    const _dcAbort = new AbortController();
    _dcTimeout = setTimeout(() => _dcAbort.abort(), 15000);
    let callResult;
    try {
      callResult = await callGemini(
        apiKey,
        [{ role: "user", content: prompt }],
        "You output only valid JSON with numeric values.",
        true,
        _dcAbort.signal,
      );
    } catch (err) {
      if (err?.name !== "AbortError") {
        const raw = err?.message ?? String(err ?? "");
        const safeMsg = raw
          .replace(/AIza[A-Za-z0-9_-]{35,45}/g, "[key]")
          .replace(/eyJ[\w.-]+/g, "[token]")
          .slice(0, 100);
        console.warn("[dynamicCosts] Failed to update dynamic costs:", safeMsg);
      }
      return {};
    }
    const { text, tokensUsed } = callResult;
    if (onTokensUsed && tokensUsed > 0) onTokensUsed(tokensUsed);
    const match = text.match(/\{[\s\S]*\}/);
    let rawParsed;
    try {
      rawParsed = match ? JSON.parse(match[0]) : {};
    } catch {
      rawParsed = {};
    }
    const { isSafeSyncValue } = await import("../sync/SyncManager.js");
    const data = (rawParsed && typeof rawParsed === "object" && !Array.isArray(rawParsed) && isSafeSyncValue(rawParsed)) ? rawParsed : {};
    const out = {};
    if (typeof data.xpPerLevel === "number" && data.xpPerLevel >= 200 && data.xpPerLevel <= 10000) {
      const proposed = Math.round(data.xpPerLevel);
      out.xpPerLevel = Math.max(Math.min(proposed, xpPerLevel * 2), Math.max(Math.ceil(xpPerLevel / 2), 300));
    }
    if (typeof data.gachaCost === "number" && data.gachaCost >= 50 && data.gachaCost <= 5000) {
      const proposed = Math.round(data.gachaCost);
      out.gachaCost = Math.max(Math.min(proposed, gachaCost * 2), Math.ceil(gachaCost / 2));
    }
    if (typeof data.streakShieldCost === "number" && data.streakShieldCost >= 100 && data.streakShieldCost <= 5000) {
      const proposed = Math.round(data.streakShieldCost);
      out.streakShieldCost = Math.max(Math.min(proposed, streakShieldCost * 2), Math.ceil(streakShieldCost / 2));
    }
    return out;
  } finally {
    if (_dcTimeout != null) clearTimeout(_dcTimeout);
    _dcInFlight = false;
  }
}

export function resetDcInFlight() {
  _dcInFlight = false;
}

// Reset the in-flight flag when Vite HMR hot-swaps this module in development.
// Without this, an in-progress request at swap time leaves _dcInFlight latched
// true on the old module binding, silencing economy updates for that dev session.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _dcInFlight = false;
  });
}
