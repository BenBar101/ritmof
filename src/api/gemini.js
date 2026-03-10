// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
// Accepts an optional AbortSignal so callers (ChatTab, HabitsTab, etc.) can cancel
// in-flight requests when the component unmounts or the user navigates away.
export async function callGemini(apiKey, messages, systemPrompt, jsonMode = false, signal = undefined) {
  // Fix #10: guard against null/undefined/empty key so callers get a clear error
  // instead of a cryptic 400 from the API with "x-goog-api-key: null".
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini API key is missing or empty.");
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const finalSystem = jsonMode
    ? systemPrompt + "\n\nCRITICAL: Your entire response must be a single valid JSON object. No markdown, no backticks, no explanation outside the JSON. Start with { and end with }."
    : systemPrompt;

  const body = {
    contents,
    systemInstruction: { parts: [{ text: finalSystem }] },
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      // Fix: set response_mime_type when jsonMode is requested so the API enforces
      // valid JSON output — this prevents partial/malformed JSON responses that
      // crash the JSON.parse call in callers.
      ...(jsonMode ? { response_mime_type: "application/json" } : {}),
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
      const errBody = await res.text().catch(() => "");
      const safeBody = errBody
        .replace(/eyJ[\w.-]+/g, "[token]")
        .replace(/AIza[A-Za-z0-9_-]{34,45}/g, "[key]")
        .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]")
        .replace(/[A-Za-z0-9_-]{40,}/g, "[token]");
      const slicedBody = safeBody.slice(0, 200);
      const safeErrorMsg = (`Gemini ${res.status}: ${slicedBody}`)
        .replace(/AIza[A-Za-z0-9_-]{34,45}/g, "[key]")
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
      ? (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0)
      : Math.ceil((enc.encode(JSON.stringify(body)).length + enc.encode(text).length) / 4);

    return { text, tokensUsed };
  } finally {
    try {
      _cleanup?.();
    } catch {
      // cleanup errors must never propagate
    }
  }
}
