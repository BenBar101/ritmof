import { IS_DEV, DEV_PREFIX, LS, storageKey } from "../utils/db";
import { callGemini } from "./gemini";

// Local-date helper so quote cache rollover aligns with user's local midnight.
const localToday = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

// ═══════════════════════════════════════════════════════════════
// DAILY QUOTE  (Quotable API — minimal tokens consumed)
// ═══════════════════════════════════════════════════════════════
// Strategy:
//   1. If the user has a Gemini key, use a tiny Gemini call (~50 in / ~30 out tokens)
//      to resolve book titles, topics, and interests into real author names that the
//      Quotable API can search. E.g. "Dune" → "Frank Herbert", "physics" → ["Richard
//      Feynman", "Carl Sagan"]. Result is cached for the day so it only runs once.
//   2. Search Quotable by each resolved author name.
//   3. Fall back to a themed random quote (technology, science, philosophy, etc.)
//      if no author matches — still zero Gemini tokens for the fallback path.
//
// In-flight guard: stored on a module-level ref that is reset on each call-site abort.
let _quoteInFlight = false;

// Quotable tags that fit the STEM / stoic / self-improvement theme of RITMOL.
const QUOTABLE_FALLBACK_TAGS = ["technology", "science", "education", "wisdom", "inspirational", "philosophy"];

const EMERGENCY_FALLBACK = {
  quote: "The secret of getting ahead is getting started.",
  author: "Mark Twain",
  source: "",
  confident: false,
};

// Wait out a 429. Reads Retry-After header (seconds); defaults to 10 s.
async function _wait429(res) {
  const retryAfter = parseInt(res.headers?.get?.("Retry-After") ?? "10", 10);
  const ms = Math.min(isNaN(retryAfter) ? 10_000 : retryAfter * 1000, 15_000);
  await new Promise((r) => setTimeout(r, ms));
}

// Static mapping: common majors/fields → quote-worthy authors (used when Gemini unavailable).
const MAJOR_TO_AUTHORS = {
  physics: ["Richard Feynman", "Carl Sagan", "Stephen Hawking"],
  "computer science": ["Alan Turing", "Edsger Dijkstra", "Grace Hopper"],
  cs: ["Alan Turing", "Edsger Dijkstra", "Grace Hopper"],
  mathematics: ["Albert Einstein", "Kurt Gödel", "Paul Erdős"],
  math: ["Albert Einstein", "Kurt Gödel", "Paul Erdős"],
  philosophy: ["Marcus Aurelius", "Seneca", "Epictetus"],
  chemistry: ["Marie Curie", "Linus Pauling", "Richard Feynman"],
  biology: ["Charles Darwin", "Richard Dawkins", "Carl Sagan"],
  engineering: ["Elon Musk", "Nikola Tesla", "Buckminster Fuller"],
  psychology: ["Carl Jung", "Viktor Frankl", "William James"],
  economics: ["Adam Smith", "John Maynard Keynes", "Milton Friedman"],
  literature: ["George Orwell", "Ursula Le Guin", "Toni Morrison"],
};

// ── Step 0: use Gemini to resolve books/interests/major → author names ───────
// Returns an array of author name strings. Cached in localStorage for the day.
// Falls back to major mapping + raw extraction if Gemini is unavailable or fails.
async function _resolveAuthors(apiKey, profile, onTokens) {
  const books     = (profile?.books     || "").trim();
  const interests = (profile?.interests || "").trim();
  const major     = (profile?.major     || "").trim();
  const combined  = [books, interests, major].filter(Boolean).join(", ");
  if (!combined) return [];

  // Cache key: resolved author list for today
  const resolvedKey = storageKey(`jv_quote_authors_${localToday()}`);
  const cached = LS.get(resolvedKey);
  if (cached && Array.isArray(cached)) return cached;

  // If we have a Gemini key, ask it to map titles/topics → authors
  if (apiKey) {
    try {
      const prompt =
        `The user's major, books, and interests: "${combined}"\n` +
        `List up to 6 real authors whose quotes would resonate with someone with this background. ` +
        `For book titles, return the book's author. For majors like "Physics" or "Computer Science", return 2-3 well-known authors in that field. ` +
        `Return ONLY a JSON array of author name strings, nothing else. Example: ["Frank Herbert","Richard Feynman","Marcus Aurelius"]`;

      const { text, tokensUsed } = await callGemini(
        apiKey,
        [{ role: "user", content: prompt }],
        "You map books and interests to author names. Respond only with a JSON array of strings.",
        true, // jsonMode
        AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      );

      if (onTokens && tokensUsed) onTokens(tokensUsed);

      // Parse — strip any accidental markdown fences
      const clean = text.replace(/```json|```/gi, "").trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.length && parsed.every(s => typeof s === "string")) {
        // eslint-disable-next-line no-control-regex
        const safe = parsed.map(s => s.replace(/[<>\u0000-\u001F]/g, "").slice(0, 80)).filter(Boolean).slice(0, 6);
        LS.set(resolvedKey, safe);
        return safe;
      }
    } catch {
      // Gemini unavailable or parse failed — fall through to raw extraction
    }
  }

  // No Gemini key (or failed): use major mapping + "by X" extraction + segment tokens.
  const candidates = [];

  // 1. Map major/field to known authors
  const majorNorm = major.toLowerCase().replace(/\s+/g, " ").trim();
  const majorKey = Object.keys(MAJOR_TO_AUTHORS).find((k) => majorNorm.includes(k));
  if (majorKey && MAJOR_TO_AUTHORS[majorKey]) {
    candidates.push(...MAJOR_TO_AUTHORS[majorKey]);
  }

  // 2. Extract "by Author Name" or "Author Name" from books (e.g. "Dune by Frank Herbert")
  const byMatch = books.match(/\bby\s+([A-Za-z][A-Za-z\s.-]{2,50})(?=[,.\n]|$)/g);
  if (byMatch) {
    for (const m of byMatch.slice(0, 3)) {
      const name = m.replace(/^\s*by\s+/i, "").trim();
      if (name && name.length >= 3 && !candidates.includes(name)) candidates.push(name);
    }
  }

  // 3. Split interests/books into segments; use multi-word segments as author guesses
  const segments = combined.split(/[,;\n|/]+/).map((s) => s.trim()).filter((t) => t.length >= 3);
  for (const seg of segments) {
    if (candidates.length >= 6) break;
    const words = seg.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length >= 2) {
      const asAuthor = words.slice(-2).join(" ");
      if (!candidates.includes(asAuthor)) candidates.push(asAuthor);
    } else if (seg.length >= 4 && !candidates.includes(seg)) {
      candidates.push(seg);
    }
  }

  const raw = [...new Set(candidates)].slice(0, 6);
  return raw;
}

// ── Quotable: search for an author and return a random quote from them ────────
const _makeSignal = () => (AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined);

async function _quoteByAuthor(authorName) {
  const searchUrl = `https://api.quotable.kameswari.in/search/authors?query=${encodeURIComponent(authorName)}&limit=5`;
  const searchRes = await fetch(searchUrl, { signal: _makeSignal() });
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const authors = searchData.results || [];
  if (!authors.length) return null;

  // Pick the best slug match: prefer one that shares a word with the query
  const words = authorName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const match = authors.find(a => a.slug && words.some(w => a.slug.toLowerCase().includes(w))) || authors[0];
  if (!match?.slug) return null;

  const quoteUrl = `https://api.quotable.kameswari.in/quotes/random?author=${encodeURIComponent(match.slug)}&maxLength=250&limit=1`;
  const quoteRes = await fetch(quoteUrl, { signal: _makeSignal() });
  if (!quoteRes.ok) return null;
  const arr = await quoteRes.json();
  const q = Array.isArray(arr) ? arr[0] : arr?.results?.[0];
  if (q?.content && q?.author) return { quote: q.content, author: q.author, source: q.authorSlug || "" };
  return null;
}

function isValidQuote(q) {
  return q && typeof q.quote === "string" && q.quote.trim() && typeof q.author === "string" && q.author.trim();
}

const stripCtrl = (s) =>
  String(s)
    // Strip control chars and zero-width/BiDi overrides; keep printable punctuation.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[<>]/g, "");

// ── Public API ────────────────────────────────────────────────────────────────
export async function fetchDailyQuote(apiKey, profile, onTokens) {
  const key = storageKey(`jv_quote_${localToday()}`);

  // Evict stale quote cache keys from previous days.
  try {
    const quotePrefix = IS_DEV ? `${DEV_PREFIX}jv_quote_` : "jv_quote_";
    const staleKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(quotePrefix) && k !== key) staleKeys.push(k);
    }
    staleKeys.forEach((k) => localStorage.removeItem(k));
  } catch { /* localStorage may be unavailable */ }

  const cached = LS.get(key);
  if (cached) return cached;

  if (_quoteInFlight) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  _quoteInFlight = true;

  try {
    // ── Step 1: resolve books/interests → author names (Gemini if available) ──
    const authors = await _resolveAuthors(apiKey, profile, onTokens);

    // ── Step 2: try each resolved author against Quotable ──────────────────────
    let hit = null;
    for (const author of authors) {
      if (hit) break;
      try {
        const q = await _quoteByAuthor(author);
        if (q && isValidQuote(q)) hit = q;
      } catch { /* network error on one author — try the next */ }
    }

    // ── Step 3: themed random fallback — try multiple tags before giving up ────
    if (!hit) {
      const tagOrder = [...QUOTABLE_FALLBACK_TAGS].sort(() => Math.random() - 0.5);
      for (const tag of tagOrder) {
        if (hit) break;
        try {
          const fallbackUrl = `https://api.quotable.kameswari.in/quotes/random?tags=${tag}&maxLength=200&limit=1`;
          let fallbackRes = await fetch(fallbackUrl, { signal: _makeSignal() });
          if (fallbackRes.status === 429) {
            await _wait429(fallbackRes);
            fallbackRes = await fetch(fallbackUrl, { signal: _makeSignal() });
          }
          if (fallbackRes.ok) {
            const arr = await fallbackRes.json();
            const q = Array.isArray(arr) ? arr[0] : arr?.results?.[0];
            if (q?.content && q?.author) {
              const candidate = { quote: q.content, author: q.author, source: q.authorSlug || "" };
              if (isValidQuote(candidate)) hit = candidate;
            }
          }
        } catch { /* network error on this tag — try next */ }
      }
    }

    if (hit) {
      const safe = {
        quote:  stripCtrl(hit.quote).slice(0, 500),
        author: stripCtrl(hit.author).slice(0, 100),
        source: stripCtrl(hit.source || "").slice(0, 100),
        confident: true,
      };
      LS.set(key, safe);
      return safe;
    }
  } catch {
    // Unexpected outer error — fall through
  } finally {
    _quoteInFlight = false;
  }

  if (typeof console !== "undefined" && console.warn) {
    console.warn("[RITMOL] Daily quote: all author/tag fetches failed; using emergency fallback.");
  }
  LS.set(key, EMERGENCY_FALLBACK);
  return EMERGENCY_FALLBACK;
}
