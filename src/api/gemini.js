// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
// Accepts an optional AbortSignal so callers (ChatTab, HabitsTab, etc.) can cancel
// in-flight requests when the component unmounts or the user navigates away.

// ── Client-side hard rate cap: 12 calls per 60-second sliding window ─────────
//
// This cap is enforced BEFORE any request leaves the browser. When the cap is
// reached, callGemini throws a RateLimitedError immediately instead of queuing
// or hitting the Gemini API. All call sites (chat, gacha, missions, habits, costs)
// go through callGemini, so this is the single choke point.
//
// RateLimitedError carries `retryAfterMs` — the milliseconds until the oldest
// call in the window ages out and a slot opens up. UI components use this to
// display a running countdown.
//
// Cap is 12 (Google free-tier Gemini 2.5 Flash allows 15 RPM; we stay 3 under
// to leave headroom for multi-tab usage). The previous cap of 3 was far too
// tight: on a new-user cold load, several background calls fire within ~20 s
// (weekly missions, dynamic costs, monthly missions, habit init) —
// all within the same 60-second window — causing RateLimitedError for every
// new user before they could interact with the app at all.
// Timestamps are persisted to sessionStorage so a hard-reload within the same
// browser session doesn't reset the window and let the burst fire again.

export const RATE_LIMIT_CAP = 12;      // max calls per window (Google free tier: 15 RPM)
export const RATE_LIMIT_WINDOW_MS = 60_000; // window size in ms

export class RateLimitedError extends Error {
  constructor(retryAfterMs) {
    super("CLIENT_RATE_LIMITED");
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs; // ms until next slot opens
  }
}

// Timestamps (Date.now()) of the most recent RATE_LIMIT_CAP calls.
// Module-level so it survives across React re-renders and hook instances.
// Seeded from sessionStorage on load so a hard page-reload within the same
// browser session doesn't reset the window and allow the startup burst to
// re-fire immediately.
const _SS_KEY = "ritmol_rl_timestamps";
function _loadTimestamps() {
  try {
    const raw = sessionStorage.getItem(_SS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    // Only keep timestamps still inside the current window.
    return parsed.filter((t) => typeof t === "number" && now - t < RATE_LIMIT_WINDOW_MS);
  } catch {
    return [];
  }
}
function _saveTimestamps(ts) {
  try { sessionStorage.setItem(_SS_KEY, JSON.stringify(ts)); } catch { /* ignore quota */ }
}

const _callTimestamps = _loadTimestamps();

/**
 * Returns the current rate-limit status.
 * { limited: false } — a call can proceed now.
 * { limited: true, retryAfterMs: N } — blocked for N more milliseconds.
 */
export function getRateLimitStatus() {
  const now = Date.now();
  // Drop timestamps older than the window
  while (_callTimestamps.length && now - _callTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
    _callTimestamps.shift();
  }
  if (_callTimestamps.length < RATE_LIMIT_CAP) {
    return { limited: false };
  }
  // Oldest call in window + window size = when the next slot opens
  const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - _callTimestamps[0]);
  return { limited: true, retryAfterMs: Math.max(0, retryAfterMs) };
}

/** Record a call timestamp (called just before a real request fires). */
function _recordCall() {
  const now = Date.now();
  // Trim stale entries first
  while (_callTimestamps.length && now - _callTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
    _callTimestamps.shift();
  }
  _callTimestamps.push(now);
  _saveTimestamps(_callTimestamps);
}

/**
 * Clears the sliding-window call history.
 * Call this when the API key changes so the new key starts with a clean slate.
 */
export function clearRateLimitWindow() {
  _callTimestamps.length = 0;
  try { sessionStorage.removeItem(_SS_KEY); } catch { /* ignore */ }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _callTimestamps.length = 0;
    try { sessionStorage.removeItem(_SS_KEY); } catch { /* ignore */ }
  });
}

// Retryable HTTP status codes — transient server errors only, NOT 429.
// 429 (rate limit) is thrown immediately so callers decide whether to retry;
// auto-retrying 429 inside callGemini causes request storms when the app
// fires multiple parallel calls (missions, gacha) on first load.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
// Only 2 attempts (1 retry) — enough for a transient 5xx without hammering the API.
const MAX_ATTEMPTS = 2;
// Base delay in ms for exponential backoff.
const BASE_DELAY_MS = 1500;

// ── Two-lane request queue ────────────────────────────────────
//
// INTERACTIVE lane (chat, gacha, habits):
//   Calls queue immediately and fire with MIN_GAP_MS between them.
//
// BACKGROUND lane (mission generation):
//   Calls DO NOT join the shared chain. Instead they poll until the
//   interactive lane has been idle for BG_IDLE_MS, then fire — and
//   they still respect MIN_GAP_MS from the last request of either lane.
//   This means a chat message sent at any point always takes priority:
//   the background call keeps waiting until the interactive lane is quiet.
//
// Both lanes share _lastRequestTime so the API never sees two requests
// closer than MIN_GAP_MS regardless of which lane fired last.

const MIN_GAP_MS   = 4000;   // minimum gap between any two requests (both lanes)
const BG_IDLE_MS   = 10000;  // background fires only after interactive lane idle this long
const BG_POLL_MS   = 1000;   // how often background checks if it can proceed

let _interactiveTail  = Promise.resolve(); // interactive calls chain onto this
let _backgroundTail   = Promise.resolve(); // background calls chain onto this (serialized)
// Initialise to 0 (epoch) so the background lane's BG_IDLE_MS idle check is measured
// from the first real API call, not from module load. Initialising to Date.now() caused
// background calls to fire immediately after BG_IDLE_MS elapsed from page load even when
// no real request had ever gone out, defeating the idle-wait intent.
let _lastRequestTime  = 0;

function enqueueInteractive(fn) {
  const result = _interactiveTail.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - _lastRequestTime);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastRequestTime = Date.now();
    return fn();
  });
  _interactiveTail = result.catch(() => {});
  return result;
}

function enqueueBackground(fn, signal) {
  // Background calls chain onto _backgroundTail so they are serialized among
  // themselves. Each one also polls _lastRequestTime to ensure the interactive
  // lane has been quiet for BG_IDLE_MS before it fires.
  const result = _backgroundTail.then(() => new Promise((resolve, reject) => {
    function attempt() {
      if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      const idleMs = Date.now() - _lastRequestTime;
      if (idleMs >= BG_IDLE_MS) {
        // Also enforce MIN_GAP_MS in case a background call just fired
        const gapWait = MIN_GAP_MS - idleMs;
        const fire = () => { _lastRequestTime = Date.now(); resolve(fn()); };
        if (gapWait > 0) setTimeout(fire, gapWait);
        else fire();
      } else {
        setTimeout(attempt, BG_POLL_MS);
      }
    }
    attempt();
  }));
  _backgroundTail = result.catch(() => {});
  return result;
}

// Reset queue state on Vite HMR hot-swap so dev-mode file saves don't leave
// stale queue tails or timestamps that cause post-HMR calls to wait unnecessarily.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _interactiveTail = Promise.resolve();
    _backgroundTail  = Promise.resolve();
    _lastRequestTime = 0;
  });
}

function retryDelay(attempt) {
  // Exponential backoff: 1s, 2s, 4s — plus up to 500ms random jitter each time.
  return BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const tid = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(tid); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

export async function callGemini(apiKey, messages, systemPrompt, jsonMode = false, signal = undefined, maxOutputTokens = 1024, background = false) {
  // Fix #10: guard against null/undefined/empty key so callers get a clear error
  // instead of a cryptic 400 from the API with "x-goog-api-key: null".
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is missing or empty.");
  }
  // Always work with the trimmed key so whitespace from paste/storage never causes 403.
  apiKey = apiKey.trim();

  // Use gemini-2.5-flash (GA, not preview) — matches the README spec and has
  // better free-tier limits than the old gemini-2.0-flash-001 endpoint.
  // Free tier: 15 RPM, 1M TPM, 1500 RPD.
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const finalSystem = jsonMode
    ? systemPrompt + "\n\nCRITICAL: Your entire response must be valid JSON only. No markdown, no backticks, no explanation. Return only the raw JSON value requested."
    : systemPrompt;

  const body = {
    contents,
    systemInstruction: { parts: [{ text: finalSystem }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: Math.min(Math.max(64, Math.round(maxOutputTokens)), 8192),
      // Force valid JSON output at the API level when jsonMode is requested.
      // This is far more reliable than prompt-based enforcement — the model
      // cannot return markdown fences, prose preambles, or malformed JSON.
      // Supported on gemini-2.5-flash and all current Gemini 1.5+ models.
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  // The AbortSignal / timeout is created INSIDE the enqueue callback so the
  // 30-second clock starts only when the request actually fires, not when it
  // enters the queue. A call that waits 20s in the background lane must not
  // arrive with a pre-expired signal.

  return await (background ? (fn) => enqueueBackground(fn, signal) : enqueueInteractive)(async () => {
    // ── Build the effective abort signal for this specific attempt ──
    let effectiveSignal;
    let _cleanup = null;

    if (signal && typeof AbortSignal.any === "function") {
      // Fix #8: combine caller signal + fresh timeout signal.
      const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
      effectiveSignal = timeoutSignal ? AbortSignal.any([signal, timeoutSignal]) : signal;
    } else if (signal) {
      // Browser lacks AbortSignal.any — combine manually.
      const combined = new AbortController();
      const abort = () => combined.abort();
      signal.addEventListener("abort", abort, { once: true });
      const tid = setTimeout(abort, 30000);
      effectiveSignal = combined.signal;
      _cleanup = () => {
        clearTimeout(tid);
        signal.removeEventListener("abort", abort);
      };
    } else {
      // No caller signal provided — use a standalone 30s timeout.
      if (AbortSignal.timeout) {
        effectiveSignal = AbortSignal.timeout(30000);
      } else {
        // AbortSignal.timeout unavailable (older browsers) — manual fallback so the
        // fetch never hangs forever.
        const fallback = new AbortController();
        const tid = setTimeout(() => fallback.abort(), 30000);
        effectiveSignal = fallback.signal;
        _cleanup = () => clearTimeout(tid);
      }
    }

    try {
      let lastError;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Honour cancellation before every attempt (including the first).
        if (effectiveSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Wait before retrying (never before the first attempt).
        if (attempt > 0) {
          await sleep(retryDelay(attempt - 1), effectiveSignal);
        }

        // ── Client-side hard rate cap ──
        // Only on first attempt so a server-side 5xx retry does not burn a slot.
        if (attempt === 0) {
          const rlStatus = getRateLimitStatus();
          if (rlStatus.limited) throw new RateLimitedError(rlStatus.retryAfterMs);
          _recordCall();
        }

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // NOTE: The API key is visible in the browser's DevTools Network tab.
            // This is unavoidable for a purely client-side app; warn users in the README
            // not to share screenshots of request headers or HAR files.
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
          signal: effectiveSignal,
        });

        if (!res.ok) {
          // Read Retry-After header before consuming the body.
          const retryAfterSec = res.headers?.get?.("Retry-After");
          const retryAfterMs = retryAfterSec ? parseFloat(retryAfterSec) * 1000 : null;

          if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
            const waitMs = retryAfterMs ?? retryDelay(attempt);
            await sleep(waitMs, effectiveSignal);
            lastError = new Error(`Gemini ${res.status} (retrying…)`);
            continue;
          }

          // ── 429 handling ──────────────────────────────────────────────────────
          // Parse body as JSON first to extract the machine-readable status field
          // ("RATE_LIMIT_EXCEEDED" vs "RESOURCE_EXHAUSTED") before sanitizing.
          // Previously a blanket 40-char regex wiped out Google's error message
          // entirely, making all 429s completely opaque and impossible to diagnose.
          if (res.status === 429) {
            const rawText = await res.text().catch(() => "");
            let geminiStatus = "";
            try {
              const parsed = JSON.parse(rawText);
              geminiStatus = parsed?.error?.status ?? "";
            } catch { /* not JSON — leave geminiStatus empty */ }

            // RESOURCE_EXHAUSTED = daily RPD or TPM quota consumed.
            // This does NOT clear until midnight Pacific (Google's reset time).
            if (geminiStatus === "RESOURCE_EXHAUSTED") {
              throw new Error(
                "Gemini 429: RESOURCE_EXHAUSTED — daily request or token quota used up. " +
                "AI features will resume at Google's daily reset (~midnight Pacific). " +
                "Check your quota in Google Cloud Console → Generative Language API → Quotas."
              );
            }

            // RATE_LIMIT_EXCEEDED (or unclassified 429) = RPM burst limit hit.
            // Temporary — back off and retry after Retry-After seconds.
            const waitSec = retryAfterMs ? Math.ceil(retryAfterMs / 1000) : 60;
            const rlErr = new Error(
              `Gemini 429: RATE_LIMIT_EXCEEDED — too many requests per minute. ` +
              `Retry in ~${waitSec}s. If this happens often, check for multiple ` +
              `open tabs (each tab has its own rate counter).`
            );
            // Attach retryAfterMs so callers (ChatTab) can show a countdown timer.
            rlErr.retryAfterMs = retryAfterMs ?? 60_000;
            rlErr.isGemini429 = true;
            throw rlErr;
          }

          // Other non-retryable errors (400, 401, 403, etc.).
          // Sanitize body but only redact very long tokens (60+ chars) —
          // not Google's short error status strings like "INVALID_ARGUMENT".
          const errBody = await res.text().catch(() => "");
          const safeBody = errBody
            .replace(/eyJ[\w.-]+/g, "[token]")
            .replace(/AIza[A-Za-z0-9_-]{20,60}/g, "[key]")
            .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]")
            .replace(/[A-Za-z0-9_-]{60,}/g, "[token]");
          const slicedBody = safeBody.slice(0, 300);
          const safeErrorMsg = (`Gemini ${res.status}: ${slicedBody}`)
            .replace(/AIza[A-Za-z0-9_-]{20,60}/g, "[key]")
            .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]");
          throw new Error(safeErrorMsg);
        }

        const data = await res.json();

        if (data.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
        }

        const candidate = data.candidates?.[0];
        // Join all parts — Gemini sometimes splits the response across multiple parts,
        // especially with responseMimeType set. Reading only parts[0] truncates the output.
        const text = (candidate?.content?.parts ?? [])
          .map(p => p?.text ?? "")
          .join("") || "";
        if (!text) throw new Error("Empty response from Gemini");

        // Detect genuine mid-response truncation from hitting the token limit.
        // Gemini 2.5 Flash with responseMimeType set often returns finishReason
        // MAX_TOKENS even for fully-formed JSON responses. Only throw if the text
        // is provably incomplete: first try to JSON-parse it (most reliable signal),
        // then fall back to bracket/quote tail checks.
        const finishReason = candidate?.finishReason ?? "";
        if (finishReason === "MAX_TOKENS") {
          const trimmed = text.trimEnd();
          let looksComplete = false;
          // 1. If it parses as JSON it's definitely complete.
          if (!looksComplete) {
            try { JSON.parse(trimmed); looksComplete = true; } catch { /* not JSON or truncated */ }
          }
          // 2. Structural tail check for non-JSON modes.
          if (!looksComplete) {
            looksComplete = trimmed.endsWith("}") || trimmed.endsWith("]") || trimmed.endsWith("\"");
          }
          if (!looksComplete) {
            throw new Error("Gemini response truncated (MAX_TOKENS) — increase maxOutputTokens or shorten the prompt.");
          }
        }

        const enc = new TextEncoder();
        const tokensUsed = data.usageMetadata
          ? (data.usageMetadata.totalTokenCount ||
             (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0))
          : Math.ceil((enc.encode(JSON.stringify(body)).length + enc.encode(text).length) / 4);

        return { text, tokensUsed };
      }

      // All attempts exhausted — surface the last retryable error clearly.
      throw lastError ?? new Error("Gemini request failed after retries.");
    } finally {
      try {
        _cleanup?.();
      } catch {
        // cleanup errors must never propagate
      }
    }
  });
}
