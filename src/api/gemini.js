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
    effectiveSignal = AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 200)}`);
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
    _cleanup?.();
  }
}
