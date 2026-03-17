import { IS_DEV, DEV_PREFIX, LS, storageKey } from "../utils/db";
import { callGemini } from "./gemini";

// Local-date helper so quote cache rollover aligns with user's local midnight.
const localToday = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const EMERGENCY_FALLBACKS = [
  { quote: "The secret of getting ahead is getting started.", author: "Mark Twain", source: "", confident: false },
  { quote: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin", source: "", confident: false },
  { quote: "The mind is not a vessel to be filled, but a fire to be kindled.", author: "Plutarch", source: "", confident: false },
  { quote: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle", source: "", confident: false },
];

// In-flight guard
let _quoteInFlight = false;

const stripCtrl = (s) =>
  String(s)
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[<>]/g, "");

function isValidQuote(q) {
  return q && typeof q.quote === "string" && q.quote.trim().length > 10
    && typeof q.author === "string" && q.author.trim().length > 0;
}

async function _generateQuoteWithGemini(apiKey, profile, onTokens) {
  const books     = (profile?.books     || "").trim();
  const interests = (profile?.interests || "").trim();
  const major     = (profile?.major     || "").trim();
  const name      = (profile?.name      || "Hunter").trim();
  const combined  = [books, interests, major].filter(Boolean).join(", ");

  // Simple numeric hash of the profile context for a stable cache key (no btoa/unicode issues)
  const cacheInput = combined || "default";
  let h = 0;
  for (let i = 0; i < cacheInput.length; i++) { h = (Math.imul(31, h) + cacheInput.charCodeAt(i)) | 0; }
  const resolvedKey = storageKey(`jv_quote_gem_${localToday()}_${Math.abs(h).toString(36)}`);
  const cached = LS.get(resolvedKey);
  if (cached && isValidQuote(cached)) return cached;

  if (!apiKey) return null;

  const contextLine = combined
    ? `Hunter profile: major="${major}", books and interests="${combined}".`
    : `The hunter has no specific profile yet.`;

  const prompt =
    `${contextLine}\n` +
    `Generate ONE real, verbatim quote that would resonate deeply with someone who studies ${major || "science"} and loves ${combined || "knowledge"}.\n` +
    `Rules:\n` +
    `- Must be a REAL quote by a REAL, verifiable author (not invented).\n` +
    `- Prefer authors, scientists, philosophers or characters from the hunter's stated books and interests when possible.\n` +
    `- The quote should feel personally relevant to ${name}, not generic.\n` +
    `- 15 to 80 words maximum.\n` +
    `Respond ONLY with valid JSON: {"quote":"...","author":"First Last","source":"book title or context if applicable, empty string if none"}`;

  try {
    const { text, tokensUsed } = await callGemini(
      apiKey,
      [{ role: "user", content: prompt }],
      "You are a literary curator. Return only a raw JSON object with quote, author, and source fields. No markdown, no backticks.",
      false, // jsonMode=false — we parse manually; avoids response_mime_type breaking the call
      AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
    );

    if (onTokens && tokensUsed) onTokens(tokensUsed);

    const clean = text.replace(/```json|```/gi, "").trim();
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error("no JSON object");
    const parsed = JSON.parse(objMatch[0]);

    if (isValidQuote(parsed)) {
      const safe = {
        quote:  stripCtrl(parsed.quote).slice(0, 500),
        author: stripCtrl(parsed.author).slice(0, 100),
        source: stripCtrl(parsed.source || "").slice(0, 100),
        confident: true,
      };
      LS.set(resolvedKey, safe);
      return safe;
    }
  } catch {
    // Gemini unavailable or parse failed
  }
  return null;
}

export async function fetchDailyQuote(apiKey, profile, onTokens) {
  const key = storageKey(`jv_quote_v2_${localToday()}`);

  try {
    const quotePrefix = IS_DEV ? `${DEV_PREFIX}jv_quote_` : "jv_quote_";
    const gemPrefix   = IS_DEV ? `${DEV_PREFIX}jv_quote_gem_` : "jv_quote_gem_";
    const staleKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if ((k.startsWith(quotePrefix) || k.startsWith(gemPrefix)) && k !== key) staleKeys.push(k);
    }
    staleKeys.forEach((k) => localStorage.removeItem(k));
  } catch { /* localStorage may be unavailable */ }

  const cached = LS.get(key);
  if (cached && isValidQuote(cached)) return cached;

  if (_quoteInFlight) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  _quoteInFlight = true;

  try {
    const geminiQuote = await _generateQuoteWithGemini(apiKey, profile, onTokens);
    if (geminiQuote) {
      LS.set(key, geminiQuote);
      return geminiQuote;
    }
  } catch {
    // unexpected outer error
  } finally {
    _quoteInFlight = false;
  }

  const fallback = EMERGENCY_FALLBACKS[Math.floor(Math.random() * EMERGENCY_FALLBACKS.length)];
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[RITMOL] Daily quote: Gemini unavailable; using static fallback.");
  }
  LS.set(key, fallback);
  return fallback;
}
