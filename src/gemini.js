// ═══════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════
// Fix #12: accepts an optional AbortSignal so callers (ChatTab, HabitsTab, etc.) can cancel
// in-flight requests when the component unmounts or the user navigates away. Without this,
// a slow request would still call trackTokens and setState after the component is gone.
export async function callGemini(apiKey, messages, systemPrompt, jsonMode = false, signal = undefined) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Inject JSON instruction into system prompt instead of relying on responseMimeType
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

  // Fix: if the caller passes no signal (e.g. updateDynamicCosts), create a 30-second timeout
  // so a hung Gemini request never blocks indefinitely.
  const timeoutSignal = AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined;
  const effectiveSignal = signal
    ? (typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeoutSignal].filter(Boolean)) : signal)
    : timeoutSignal;

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

  // Fix #5: use UTF-8 byte length for the fallback estimate.
  const enc = new TextEncoder();
  const tokensUsed = data.usageMetadata
    ? (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0)
    : Math.ceil((enc.encode(JSON.stringify(body)).length + enc.encode(text).length) / 4);

  return { text, tokensUsed };
}
