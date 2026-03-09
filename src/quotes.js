import { IS_DEV, DEV_PREFIX, LS, storageKey, today } from "./utils/storage";

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

// Extract candidate author name tokens from a free-text "books/authors" string.
function _extractAuthorTokens(booksStr) {
  if (!booksStr || typeof booksStr !== "string") return [];
  return booksStr
    .split(/[,;|\/\n]+/)
    .map(s => s.trim().split(/\s+/).pop()) // last word of each segment
    .filter(t => t && t.length >= 4)
    .slice(0, 5); // cap: no more than 5 attempts
}

export async function fetchDailyQuote(_apiKey, profile, _onTokens) {
  // _apiKey and _onTokens kept in signature for call-site compatibility but unused —
  // Quotable is free and consumes no Gemini tokens.
  const key = storageKey(`jv_quote_${today()}`);

  // Evict stale quote cache keys from previous days
  try {
    const quotePrefix = IS_DEV ? `${DEV_PREFIX}jv_quote_` : "jv_quote_";
    const staleKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(quotePrefix) && k !== key) staleKeys.push(k);
    }
    staleKeys.forEach((k) => localStorage.removeItem(k));
  } catch {}

  const cached = LS.get(key);
  if (cached) return cached;

  if (_quoteInFlight) return null;
  _quoteInFlight = true;

  // FIX: create a fresh timeout signal per fetch instead of one shared signal.
  // A single AbortSignal.timeout(8000) starts counting immediately — if the first
  // fetch takes 5 s the fallback fetch only has 3 s remaining, causing spurious
  // timeouts. Each call now gets its own independent 8-second budget.
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
          hit = { quote: q.content, author: q.author, source: q.authorSlug || "" };
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
        if (fallbackRes.ok) {
          const fallbackArr = await fallbackRes.json();
          const q = Array.isArray(fallbackArr) ? fallbackArr[0] : fallbackArr?.results?.[0];
          if (q?.content && q?.author) {
            hit = { quote: q.content, author: q.author, source: q.authorSlug || "" };
          }
        }
      } catch {}
    }

    if (hit) {
      const safe = {
        quote:  String(hit.quote).slice(0, 500),
        author: String(hit.author).slice(0, 100),
        source: String(hit.source).slice(0, 100),
        confident: true,
      };
      LS.set(key, safe);
      return safe;
    }
  } finally {
    _quoteInFlight = false;
  }
  return null;
}
