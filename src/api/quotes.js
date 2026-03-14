import { IS_DEV, DEV_PREFIX, LS, storageKey } from "../utils/storage";

// Local-date helper so quote cache rollover aligns with user's local midnight.
const localToday = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

// ═══════════════════════════════════════════════════════════════
// DAILY QUOTE  (Quotable API — no tokens consumed)
// ═══════════════════════════════════════════════════════════════
// Uses the free, open Quotable REST API (https://api.quotable.kameswari.in)
// instead of asking Gemini to hallucinate quotes, which:
//   (a) wastes daily token budget
//   (b) produces unverifiable, sometimes fabricated attributions
//
// In-flight guard: stored on a module-level ref that is reset on each call-site abort.
let _quoteInFlight = false;

// Quotable tags that fit the STEM / stoic / self-improvement theme of RITMOL.
const QUOTABLE_FALLBACK_TAGS = ["technology","science","education","wisdom","inspirational","philosophy"];

const EMERGENCY_FALLBACK = {
  quote: "The secret of getting ahead is getting started.",
  author: "Mark Twain",
  source: "",
  confident: false, // signals to HomeTab that this is a static fallback
};

// Wait out a 429. Reads Retry-After header (seconds); defaults to 10 s.
// Never waits more than 15 s so the app does not hang.
async function _wait429(res) {
  const retryAfter = parseInt(res.headers?.get?.("Retry-After") ?? "10", 10);
  const ms = Math.min(isNaN(retryAfter) ? 10_000 : retryAfter * 1000, 15_000);
  await new Promise((r) => setTimeout(r, ms));
}

// Extract candidate author name tokens from a free-text "books/authors" string.
function _extractAuthorTokens(booksStr) {
  if (!booksStr || typeof booksStr !== "string") return [];
  return booksStr
    .split(/[,;|/\n]+/)
    .map(s => s.trim().split(/\s+/).pop()) // last word of each segment
    .filter(t => t && t.length >= 4)
    .slice(0, 5); // cap: no more than 5 attempts
}

// eslint-disable-next-line no-unused-vars
export async function fetchDailyQuote(_apiKey, profile, _onTokens) {
  // _apiKey and _onTokens kept in signature for call-site compatibility but unused —
  // Quotable is free and consumes no Gemini tokens.
  const key = storageKey(`jv_quote_${localToday()}`);

  // Evict stale quote cache keys from previous days.
  // Fix: collect all keys first BEFORE deleting — iterating localStorage while
  // modifying it is undefined behaviour in some browsers (key indices can shift).
  try {
    const quotePrefix = IS_DEV ? `${DEV_PREFIX}jv_quote_` : "jv_quote_";
    const staleKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(quotePrefix) && k !== key) staleKeys.push(k);
    }
    // Delete only after the snapshot is complete.
    staleKeys.forEach((k) => localStorage.removeItem(k));
  } catch { /* localStorage may be unavailable — silently skip eviction */ }

  // Quote cache stays in localStorage intentionally — it is ephemeral,
  // evicted daily, and not part of the IDB user data store.
  const cached = LS.get(key);
  if (cached) return cached;

  if (_quoteInFlight) return null;
  // Do not attempt network calls when offline and do not cache the static fallback —
  // return null so the caller displays the fallback transiently without writing it
  // to localStorage. The next mount will retry once connectivity is restored.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return null;
  }
  _quoteInFlight = true;

  // Validate quote shape before caching to avoid storing malformed objects
  function isValidQuote(q) {
    return q && typeof q.quote === "string" && q.quote.trim() &&
           typeof q.author === "string" && q.author.trim();
  }

  // Create a fresh timeout signal per fetch so each attempt gets its own independent budget.
  const makeSignal = () => AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;

  try {
    // ── Step 1: try to find a quote by an author from the user's books/interests ──
    const tokens = _extractAuthorTokens(profile?.books || "");
    let hit = null;

    for (const token of tokens) {
      if (hit) break;
      try {
        const searchUrl = `https://api.quotable.kameswari.in/search/authors?query=${encodeURIComponent(token)}&limit=3`;
        const searchRes = await fetch(searchUrl, { signal: makeSignal() });
        if (!searchRes.ok) continue;
        const searchData = await searchRes.json();
        const authors = searchData.results || [];
        if (!authors.length) continue;

        const match = authors.find(a => a.slug && a.slug.toLowerCase().includes(token.toLowerCase())) || authors[0];
        if (!match?.slug) continue;

        const quoteUrl = `https://api.quotable.kameswari.in/quotes/random?author=${encodeURIComponent(match.slug)}&maxLength=250&limit=1`;
        const quoteRes = await fetch(quoteUrl, { signal: makeSignal() });
        if (!quoteRes.ok) continue;
        const quoteArr = await quoteRes.json();
        const q = Array.isArray(quoteArr) ? quoteArr[0] : quoteArr?.results?.[0];
        if (q?.content && q?.author) {
          const candidate = { quote: q.content, author: q.author, source: q.authorSlug || "" };
          if (isValidQuote(candidate)) hit = candidate;
        }
      } catch {
        // Network error on one token — try the next
      }
    }

    // ── Step 2: fall back to a themed random quote if author lookup missed ──
    if (!hit) {
      const tag = QUOTABLE_FALLBACK_TAGS[Math.floor(Math.random() * QUOTABLE_FALLBACK_TAGS.length)];
      const fallbackUrl = `https://api.quotable.kameswari.in/quotes/random?tags=${tag}&maxLength=200&limit=1`;
      try {
        const fallbackRes = await fetch(fallbackUrl, { signal: makeSignal() });
        if (fallbackRes.status === 429) {
          // Rate-limited — wait and retry once
          await _wait429(fallbackRes);
          const retryRes = await fetch(fallbackUrl, { signal: makeSignal() });
          if (retryRes.ok) {
            const fallbackArr = await retryRes.json();
            const q = Array.isArray(fallbackArr) ? fallbackArr[0] : fallbackArr?.results?.[0];
            if (q?.content && q?.author) {
              const candidate = { quote: q.content, author: q.author, source: q.authorSlug || "" };
              if (isValidQuote(candidate)) hit = candidate;
            }
          }
        } else if (fallbackRes.ok) {
          const fallbackArr = await fallbackRes.json();
          const q = Array.isArray(fallbackArr) ? fallbackArr[0] : fallbackArr?.results?.[0];
          if (q?.content && q?.author) {
            const candidate = { quote: q.content, author: q.author, source: q.authorSlug || "" };
            if (isValidQuote(candidate)) hit = candidate;
          }
        }
      } catch { /* Network error on token lookup — try next */ }
    }

    if (hit) {
      // Strip control characters and limit lengths before persisting to localStorage.
      // A compromised or spoofed API response should not be able to store content that
      // could be injected into the system prompt or rendered with unexpected characters.
      // eslint-disable-next-line no-control-regex
      const stripCtrl = (s) => String(s).replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").replace(/[<>]/g, "");
      const safe = {
        quote:  stripCtrl(hit.quote).slice(0, 500),
        author: stripCtrl(hit.author).slice(0, 100),
        source: stripCtrl(hit.source).slice(0, 100),
        confident: true,
      };
      LS.set(key, safe);
      return safe;
    }
  } catch {
    // Outer catch: unexpected error — fall through to reset flag and return null.
  } finally {
    // Always reset the in-flight flag so future calls are not permanently blocked.
    _quoteInFlight = false;
  }
  // All network paths failed — cache and return the static emergency fallback
  // so the quote area is never permanently blank.
  LS.set(key, EMERGENCY_FALLBACK);
  return EMERGENCY_FALLBACK;
}
