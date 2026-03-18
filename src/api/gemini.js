// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
// Accepts an optional AbortSignal so callers (ChatTab, HabitsTab, etc.) can cancel
// in-flight requests when the component unmounts or the user navigates away.

// Retryable HTTP status codes — transient server errors only, NOT 429.
// 429 (rate limit) is thrown immediately so callers decide whether to retry;
// auto-retrying 429 inside callGemini causes request storms when the app
// fires multiple parallel calls (missions, quotes, gacha) on first load.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
// Only 2 attempts (1 retry) — enough for a transient 5xx without hammering the API.
const MAX_ATTEMPTS = 2;
// Base delay in ms for exponential backoff.
const BASE_DELAY_MS = 1500;

// ── Global request queue ─────────────────────────────────────
// All callGemini calls are serialized through this queue so concurrent
// triggers (level-up + mission complete + gacha on first load) never fire
// simultaneously and cause 429s. Each request waits for the previous one
// to finish, then observes a minimum gap before sending.
const MIN_GAP_MS = 4000; // minimum ms between consecutive requests
let _queueTail = Promise.resolve(); // chain every call onto this
let _lastRequestTime = 0;

function enqueue(fn) {
  const result = _queueTail.then(async () => {
    const now = Date.now();
    const wait = MIN_GAP_MS - (now - _lastRequestTime);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastRequestTime = Date.now();
    return fn();
  });
  // Swallow rejections on the tail so one failure doesn't break the queue.
  _queueTail = result.catch(() => {});
  return result;
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

export async function callGemini(apiKey, messages, systemPrompt, jsonMode = false, signal = undefined, maxOutputTokens = 1024) {
  // Fix #10: guard against null/undefined/empty key so callers get a clear error
  // instead of a cryptic 400 from the API with "x-goog-api-key: null".
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is missing or empty.");
  }
  // Always work with the trimmed key so whitespace from paste/storage never causes 403.
  apiKey = apiKey.trim();
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
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
    },
  };

  // Fix #8: On browsers without AbortSignal.any (Firefox < 124, older Safari), combining
  // a caller signal with a timeout signal silently dropped the timeout. We now use a
  // manual setTimeout fallback so the 30-second timeout always fires on all browsers.
  let effectiveSignal;
  let _cleanup = null;

  if (signal && typeof AbortSignal.any === "function") {
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
    // No caller signal provided.
    if (AbortSignal.timeout) {
      effectiveSignal = AbortSignal.timeout(30000);
    } else {
      // Fix: AbortSignal.timeout is unavailable (older browsers) and no caller signal
      // was provided. Without this fallback the fetch would run with NO timeout at all,
      // potentially hanging forever. Use a manual AbortController so the 30-second
      // deadline always fires regardless of browser support.
      const fallback = new AbortController();
      const tid = setTimeout(() => fallback.abort(), 30000);
      effectiveSignal = fallback.signal;
      _cleanup = () => clearTimeout(tid);
    }
  }

  try {
    return await enqueue(async () => {
      let lastError;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Honour cancellation before every attempt (including the first).
        if (effectiveSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        // Wait before retrying (never before the first attempt).
        if (attempt > 0) {
          await sleep(retryDelay(attempt - 1), effectiveSignal);
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
          // Respect Retry-After header if the server sends one (common with 429).
          const retryAfterSec = res.headers?.get?.("Retry-After");
          const retryAfterMs = retryAfterSec ? parseFloat(retryAfterSec) * 1000 : null;

          if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
            const waitMs = retryAfterMs ?? retryDelay(attempt);
            await sleep(waitMs, effectiveSignal);
            lastError = new Error(`Gemini ${res.status} (retrying…)`);
            continue;
          }

          const errBody = await res.text().catch(() => "");
          const safeBody = errBody
            .replace(/eyJ[\w.-]+/g, "[token]")
            .replace(/AIza[A-Za-z0-9_-]{20,60}/g, "[key]")
            .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]")
            .replace(/[A-Za-z0-9_-]{40,}/g, "[token]");
          const slicedBody = safeBody.slice(0, 200);
          const safeErrorMsg = (`Gemini ${res.status}: ${slicedBody}`)
            .replace(/AIza[A-Za-z0-9_-]{20,60}/g, "[key]")
            .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]");
          throw new Error(safeErrorMsg);
        }

        const data = await res.json();

        if (data.promptFeedback?.blockReason) {
          throw new Error(`Blocked: ${data.promptFeedback.blockReason}`);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!text) throw new Error("Empty response from Gemini");

        const enc = new TextEncoder();
        const tokensUsed = data.usageMetadata
          ? (data.usageMetadata.totalTokenCount ||
             (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0))
          : Math.ceil((enc.encode(JSON.stringify(body)).length + enc.encode(text).length) / 4);

        return { text, tokensUsed };
      }

      // All attempts exhausted — surface the last retryable error clearly.
      throw lastError ?? new Error("Gemini request failed after retries.");
    });
  } finally {
    try {
      _cleanup?.();
    } catch {
      // cleanup errors must never propagate
    }
  }
}
