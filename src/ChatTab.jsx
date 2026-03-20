import { useState, useEffect, useRef, useMemo } from "react";
import { useAppContext } from "./context/AppContext";
import { todayUTC, localDateFromUTC, LS, storageKey } from "./utils/db";
import { DAILY_TOKEN_LIMIT, DATA_DISCLOSURE_SEEN_KEY } from "./constants";
import { callGemini, RateLimitedError, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_CAP } from "./api/gemini";
import { isSafeSyncValue } from "./sync/SyncManager";

function NeuralEnergyBar({ usage, theme }) {
  if (!usage || typeof usage.date !== "string") return null;
  const isToday = usage.date === todayUTC();
  const tokens = isToday ? (usage.tokens || 0) : 0;
  const pct = Math.min(100, (tokens / DAILY_TOKEN_LIMIT) * 100);
  const pctDisplay = pct < 0.1 ? "<0.1" : pct.toFixed(1);
  const isLight = theme === "light";
  const textColor = isLight ? "#000" : "#fff";
  const trackColor = isLight ? "#ccc" : "#333";
  const fillColor = isLight ? "#000" : "#fff";
  const borderColor = isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)";
  return (
    <div style={{
      padding: "8px 16px",
      borderBottom: `1.5px solid ${borderColor}`,
      fontFamily: "'Share Tech Mono', monospace",
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      <span style={{ fontSize: "10px", letterSpacing: "2px", color: textColor, opacity: 0.6, flexShrink: 0 }}>NEURAL ENERGY</span>
      <div style={{ flex: 1, height: "4px", background: trackColor, position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: fillColor, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: "10px", color: textColor, opacity: 0.6, flexShrink: 0 }}>{pctDisplay}%</span>
    </div>
  );
}

// Module-level — compiled once
// eslint-disable-next-line no-control-regex
const STRIP_FOR_API_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const INJECTION_CHARS_RE = /[<>{}`"'\\]/g;
let _msgSeq = 0;

export default function ChatTab() {
  const { state, setState, latestStateRef, profile, apiKey, executeCommands, showBanner, buildSystemPrompt, checkMissions, trackTokens, theme } = useAppContext();
  const fg  = theme === "light" ? "#000" : "#fff";
  const bg  = theme === "light" ? "#f0f0f0" : "#000";
  const dim = theme === "light" ? "#555" : "#aaa";
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [disclosureDismissed, setDisclosureDismissed] = useState(() => !!LS.get(storageKey(DATA_DISCLOSURE_SEEN_KEY)));
  // Client-side rate-limit countdown: null = not limited, number = Date.now() target when limit lifts
  const [rateLimitedUntil, setRateLimitedUntil] = useState(null);
  const rateLimitTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  // Fix #12: AbortController so navigating away mid-request cancels the fetch and prevents
  // trackTokens / setState from firing against an unmounted component.
  const abortRef = useRef(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  // Countdown ticker: updates every second while rate-limited so the UI re-renders the timer
  useEffect(() => {
    if (!rateLimitedUntil) return;
    const tick = () => {
      if (!mountedRef.current) return;
      if (Date.now() >= rateLimitedUntil) {
        setRateLimitedUntil(null);
        return;
      }
      rateLimitTimerRef.current = setTimeout(tick, 500);
    };
    rateLimitTimerRef.current = setTimeout(tick, 500);
    return () => clearTimeout(rateLimitTimerRef.current);
  }, [rateLimitedUntil]);

  const messages = useMemo(() => state.chatHistory || [], [state.chatHistory]);
  const latestHistoryRef = useRef(messages);
  useEffect(() => { latestHistoryRef.current = messages; }, [messages]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "instant" }); }, [messages]);

  const userMsgCount = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages],
  );

  useEffect(() => {
    // userMsgCount only increments on user messages — assistant replies do not
    // change it, so this effect runs exactly once per user turn. Safe to call
    // checkMissions("chat") here without double-counting.
    if (userMsgCount > 0) checkMissions("chat");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userMsgCount]); // only fires on new user messages

  // Fix #12: cancel any in-flight Gemini request when the tab unmounts (user navigates away).
  useEffect(() => () => {
    mountedRef.current = false;
    abortRef.current?.abort();
    try { recognitionRef.current?.stop(); } catch { /* ignore — recognition may already be stopped */ }
  }, []);

  const MAX_INPUT_LENGTH = 4000; // ~1k tokens; prevents accidental budget burn on huge pastes

  async function sendMessage(text) {
    if (!text.trim() || loading || inFlightRef.current) return;
    // Block send while client-side rate cap is active
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) return;
    // FIX: enforce max input length so a giant paste or voice transcript can't fire a
    // 10 000-token request and silently drain the daily budget.
    if (text.length > MAX_INPUT_LENGTH) {
      showBanner(`Message too long (max ${MAX_INPUT_LENGTH} chars).`, "alert");
      return;
    }
    if (!apiKey) { showBanner("No Gemini API key configured.", "alert"); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { showBanner("SYSTEM: No network connection. AI offline.", "alert"); return; }
    const usage = latestStateRef?.current?.tokenUsage ?? state.tokenUsage;
    if (usage && usage.date === todayUTC() && usage.tokens >= DAILY_TOKEN_LIMIT) {
      showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert");
      return;
    }

    // Fix #12: abort any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sanitizedUserContent = text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .replace(/[\u2039\u203A\u27E8\u27E9\u276C-\u276F\uFE3D\uFE3E\u2329\u232A]/g, "") // angle homoglyphs
      .slice(0, MAX_INPUT_LENGTH);
    const userMsg = {
      role: "user",
      content: sanitizedUserContent,
      ts: Date.now(),
      seq: ++_msgSeq,
      date: localDateFromUTC(),
    };
    const newHistory = [...latestHistoryRef.current, userMsg].slice(-1000);
    setState((s) => ({ ...s, chatHistory: newHistory }));
    setInput("");
    inFlightRef.current = true;
    setLoading(true);

    try {
      // NOTE: state here is the pre-setState snapshot. buildSystemPrompt must tolerate stale refs —
      // all string fields must be sanitized inside buildSystemPrompt, not assumed clean here.
      const systemPrompt = buildSystemPrompt(latestStateRef?.current ?? state, profile);
      // Fix [C-2]: use the canonical sanitization set (control chars + injection chars)
      // when re-sending stored messages to the API, not just angle brackets. Old stored
      // messages may predate sanitization, and assistant messages could have been tampered
      // via a crafted sync file. This prevents stored injections from breaking out of the
      // HUNTER_DATA boundary on replay into future API calls.
      const stripForApi = (s) => typeof s === "string"
        ? s.replace(STRIP_FOR_API_RE, "").replace(INJECTION_CHARS_RE, "").slice(0, 2000)
        : "";
      const apiMessages = newHistory.slice(-20).map((m) => ({
        role: m.role,
        content: stripForApi(m.content),
      }));
      // Increased from default 1024 to 4096 to support large task-list responses
      // (e.g. 10+ prepare-to-lecture tasks). The response is batched client-side
      // into chunks of 5 by the command dispatcher below, so the AI only needs to
      // produce one large JSON blob — we just need enough tokens to fit it.
      const { text: raw, tokensUsed } = await callGemini(apiKey, apiMessages, systemPrompt, true, controller.signal, 4096);
      trackTokens?.(tokensUsed);

      // Robust JSON extraction — tries multiple strategies before falling back to plain text.
      // The goal is: always show only `parsed.message` in chat, never raw JSON or command payloads.
      let parsed;

      const tryParseJson = (str) => {
        try { return JSON.parse(str); } catch { return null; }
      };

      // Strategy 1: strip markdown fences and parse directly
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      parsed = tryParseJson(cleaned);

      // Strategy 2: find the outermost {...} block (handles preamble text before the JSON)
      if (!parsed) {
        // Find the first { and match to its closing } by tracking brace depth
        const start = cleaned.indexOf("{");
        if (start !== -1) {
          let depth = 0, end = -1;
          for (let i = start; i < cleaned.length; i++) {
            if (cleaned[i] === "{") depth++;
            else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end !== -1) parsed = tryParseJson(cleaned.slice(start, end + 1));
        }
      }

      // Strategy 3: try the raw string unchanged (handles double-encoded responses)
      if (!parsed) parsed = tryParseJson(raw);

      // Strategy 4: genuine plain-text fallback — show the text but scrub any leaked JSON
      if (!parsed) {
        // Remove any JSON-like object blocks so command payloads never appear as chat text
        const scrubbed = raw
          .replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, "")
          .replace(/\{[\s\S]*?"cmd"\s*:[\s\S]*?\}/g, "")  // remove command objects
          .replace(/\{[\s\S]*?"commands"\s*:[\s\S]*?\}/g, "") // remove wrapper objects
          .replace(/```/g, "")
          .trim();
        parsed = { message: scrubbed || "...", commands: [] };
      }

      // Prototype-pollution guard: reject parsed objects with __proto__ / constructor / prototype keys.
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!isSafeSyncValue(parsed)) {
          parsed = { message: String(parsed), commands: [] };
        }
      }

      // Extract the human-readable message — never fall through to raw JSON string
      let rawContent = parsed.message || parsed.text || "";
      if (!rawContent || typeof rawContent !== "string") {
        // If we still have no message, use a safe empty fallback rather than stringifying the object
        rawContent = "";
      }
      // Fix: sanitize AI-returned message content before persisting to localStorage and
      // the sync file using the same canonical strip set used when replaying history
      // into the API, so line/paragraph separators and BiDi controls cannot linger in
      // stored chat entries.
      const safeContent = rawContent
        .replace(STRIP_FOR_API_RE, "")
        .slice(0, 2000);

      const assistantMsg = {
        role: "assistant",
        content: safeContent,
        ts: Date.now(),
        seq: ++_msgSeq,
        date: localDateFromUTC(),
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, assistantMsg].slice(-1000) }));

      if (parsed.commands?.length) {
        // Split commands into small batches and fire them sequentially with a short
        // delay between each. This prevents large task lists (e.g. "prepare-to-lecture
        // tasks for every lecture this week") from overflowing a single executeCommands
        // run and silently dropping tasks, while also avoiding a burst of synchronous
        // setState calls that can cause React to skip intermediate renders.
        //
        // Non-task commands (award_xp, announce, set_daily_goal, etc.) are separated
        // out and always run first so the AI's message + XP land before the task list.
        const TASK_BATCH_SIZE = 5;
        const BATCH_DELAY_MS  = 350; // enough for React to flush between batches

        const taskCmds    = parsed.commands.filter((c) => c?.cmd === "add_task");
        const nonTaskCmds = parsed.commands.filter((c) => c?.cmd !== "add_task");

        // Fire non-task commands immediately (keeps XP, banners, etc. instant)
        if (nonTaskCmds.length) {
          setTimeout(() => executeCommands(nonTaskCmds), 300);
        }

        // Chunk task commands into batches and stagger them
        for (let i = 0; i < taskCmds.length; i += TASK_BATCH_SIZE) {
          const batch = taskCmds.slice(i, i + TASK_BATCH_SIZE);
          const batchIndex = Math.ceil(i / TASK_BATCH_SIZE);
          const delay = 300 + (batchIndex + (nonTaskCmds.length ? 1 : 0)) * BATCH_DELAY_MS;
          setTimeout(() => executeCommands(batch), delay);
        }
      }
    } catch (e) {
      if (e instanceof RateLimitedError) {
        // Client-side cap hit — set countdown and show in-chat message with timer.
        const unlocksAt = Date.now() + e.retryAfterMs;
        if (mountedRef.current) setRateLimitedUntil(unlocksAt);
        const secsLeft = Math.ceil(e.retryAfterMs / 1000);
        const rateLimitMsg = {
          role: "assistant",
          content: `⏳ SYSTEM: Rate cap reached (${RATE_LIMIT_CAP} calls/min). AI functions locked for ${secsLeft}s. Retry when the timer clears.`,
          ts: Date.now(),
          seq: ++_msgSeq,
          date: localDateFromUTC(),
          isError: true,
          isRateLimit: true,
          rateLimitUnlocksAt: unlocksAt,
        };
        if (mountedRef.current) {
          setState((s) => ({ ...s, chatHistory: [...s.chatHistory, rateLimitMsg].slice(-1000) }));
          setLoading(false);
          inFlightRef.current = false;
        }
        return;
      }

      // Server-side 429 (RATE_LIMIT_EXCEEDED from Gemini) — also triggers countdown.
      if (e?.isGemini429 && e?.retryAfterMs) {
        const unlocksAt = Date.now() + e.retryAfterMs;
        if (mountedRef.current) setRateLimitedUntil(unlocksAt);
        const secsLeft = Math.ceil(e.retryAfterMs / 1000);
        const rlMsg = {
          role: "assistant",
          content: `⏳ SYSTEM: Gemini RPM limit hit. AI locked for ~${secsLeft}s. ` +
            `If this keeps happening, check for multiple open tabs — each tab counts separately against your API quota.`,
          ts: Date.now(),
          seq: ++_msgSeq,
          date: localDateFromUTC(),
          isError: true,
          isRateLimit: true,
          rateLimitUnlocksAt: unlocksAt,
        };
        if (mountedRef.current) {
          setState((s) => ({ ...s, chatHistory: [...s.chatHistory, rlMsg].slice(-1000) }));
          setLoading(false);
          inFlightRef.current = false;
        }
        return;
      }

      if (e?.name === "AbortError") {
        if (mountedRef.current) setLoading(false);
        return;
      }

      const rawMsg = e?.message || "";
      const redactedMsg = rawMsg
        .replace(/AIza[A-Za-z0-9_-]{35,45}/g, "[key]")
        .replace(/eyJ[\w.-]+/g, "[token]")
        .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]");

      // Map known error patterns to friendly in-chat messages.
      // Order matters: check most-specific patterns first.
      let friendlyMsg;
      if (redactedMsg.includes("RESOURCE_EXHAUSTED")) {
        friendlyMsg = "Daily Gemini quota used up — AI features will resume at Google's daily reset (~midnight Pacific). " +
          "Check Google Cloud Console → Generative Language API → Quotas if this seems wrong.";
      } else if (redactedMsg.includes("RATE_LIMIT_EXCEEDED")) {
        friendlyMsg = "Gemini RPM limit hit — too many requests per minute. Wait ~60s and try again. " +
          "If this keeps happening, check for multiple open tabs.";
      } else if (redactedMsg.includes("429")) {
        friendlyMsg = "Gemini rate limit hit — wait a minute and try again.";
      } else if (redactedMsg.includes("401") || redactedMsg.includes("403") || redactedMsg.toLowerCase().includes("api key")) {
        friendlyMsg = "Invalid API key — check your Gemini key in Profile → Settings.";
      } else if (redactedMsg.includes("400")) {
        friendlyMsg = "Bad request — the message couldn't be processed. Try rephrasing.";
      } else if (redactedMsg.toLowerCase().includes("blocked")) {
        friendlyMsg = "Message blocked by Gemini safety filters. Try rephrasing.";
      } else if (navigator.onLine === false || redactedMsg.toLowerCase().includes("network") || redactedMsg.toLowerCase().includes("failed to fetch")) {
        friendlyMsg = "No network connection — check your internet and try again.";
      } else if (redactedMsg.toLowerCase().includes("timeout") || redactedMsg.toLowerCase().includes("aborted")) {
        friendlyMsg = "Request timed out — Gemini took too long. Try again.";
      } else if (redactedMsg.toLowerCase().includes("retries")) {
        friendlyMsg = "Gemini is busy right now. Wait a moment and try again.";
      } else {
        friendlyMsg = "Something went wrong. Try again in a moment.";
      }

      const errMsg = {
        role: "assistant",
        content: `⚠ ${friendlyMsg}`,
        ts: Date.now(),
        seq: ++_msgSeq,
        date: localDateFromUTC(),
        isError: true,
      };
      if (mountedRef.current) {
        setState((s) => ({ ...s, chatHistory: [...s.chatHistory, errMsg].slice(-1000) }));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }

  function toggleVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { showBanner("Voice input not supported on this device.", "info"); return; }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const r = new SpeechRecognition();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      // Fix: enforce the same MAX_INPUT_LENGTH cap on voice transcripts as on typed input —
      // an unusually long transcript could bypass the typed-input guard and burn the token budget.
      const trimmed = transcript.slice(0, MAX_INPUT_LENGTH);
      sendMessage(trimmed);
      setIsListening(false);
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
    setIsListening(true);
  }

  const chips = [
    "What should I focus on today?",
    "Assign me study tasks",
    "How's my progress?",
    "I just finished my homework",
    "Motivate me",
  ];

  return (
    <div style={{ height: "calc(var(--vh, 1vh) * 100 - 56px - 60px)", display: "flex", flexDirection: "column" }}>
      {/* Data disclosure (one-time) */}
      {!disclosureDismissed && (
        <div style={{
          padding: "16px", background: bg, borderBottom: `3px solid ${fg}`,
          fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: fg,
          display: "flex", alignItems: "flex-start", gap: "12px", lineHeight: "1.6",
        }}>
          <span style={{ flex: 1 }}>
            RITMOL sends your habits, tasks, goals, sleep, and calendar summary to Google&apos;s Gemini API to personalize responses. No data is stored by us beyond your chat history.
          </span>
          <button
            type="button"
            onClick={() => { LS.set(storageKey(DATA_DISCLOSURE_SEEN_KEY), "1"); setDisclosureDismissed(true); }}
            style={{ padding: "10px 16px", border: `2px solid ${fg}`, background: "transparent", color: fg, cursor: "pointer", flexShrink: 0, minHeight: "48px", fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", fontWeight: "bold" }}
          >
            GOT IT
          </button>
        </div>
      )}
      {/* Neural Energy */}
      <NeuralEnergyBar usage={state.tokenUsage} theme={theme} />
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "64px", marginBottom: "16px" }}>◈</div>
            <div style={{ fontSize: "28px", marginBottom: "8px", fontWeight: "bold", letterSpacing: "3px" }}>[ RITMOL ONLINE ]</div>
            <div style={{ fontSize: "18px", color: fg }}>SYSTEM READY. AWAITING HUNTER INPUT.</div>
          </div>
        )}
        {messages.map((msg, i) => {
          const hasStableSeq = msg.ts != null && msg.seq != null;
          const key = hasStableSeq
            ? `${msg.ts}_${msg.seq}_${msg.role}`
            : `${msg.ts ?? "legacy"}_${msg.role}_${i}`;
          return <ChatMessage key={key} msg={msg} />;
        })}
        {loading && (
          <div style={{
            border: "2px solid #fff", padding: "14px 20px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
            color: fg, fontWeight: "bold", display: "inline-block",
            alignSelf: "flex-start",
          }}>
            PROCESSING...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length < 3 && (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: "8px", overflowX: "auto", pointerEvents: loading ? "none" : "auto" }}>
          {chips.map((c) => (
            <button type="button" key={c} disabled={loading} onClick={() => sendMessage(c)} style={{
              padding: "10px 16px", border: loading ? `2px solid ${dim}` : `2px solid ${fg}`,
              background: "transparent", color: fg,
              fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
              whiteSpace: "nowrap", cursor: loading ? "default" : "pointer", flexShrink: 0,
              minHeight: "48px",
            }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Rate-limit countdown banner */}
      {rateLimitedUntil && Date.now() < rateLimitedUntil && (
        <div style={{
          padding: "8px 16px", borderTop: "2px solid #fff",
          background: bg, display: "flex", alignItems: "center", gap: "10px",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px",
        }}>
          <span style={{ color: fg, opacity: 0.5 }}>⏳ RATE CAP — WAIT</span>
          <span style={{
            color: fg, fontWeight: "bold", fontSize: "14px",
            minWidth: "32px", textAlign: "center",
          }}>
            {Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000))}s
          </span>
          <div style={{ flex: 1, height: "2px", background: "#333", position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, height: "100%", background: fg,
              width: `${Math.max(0, Math.min(100, ((rateLimitedUntil - Date.now()) / RATE_LIMIT_WINDOW_MS) * 100))}%`,
              transition: "width 0.5s linear",
            }} />
          </div>
          <span style={{ color: fg, opacity: 0.5 }}>AI LOCKED</span>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "3px solid #fff", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
          maxLength={MAX_INPUT_LENGTH}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!rateLimitedUntil || Date.now() >= rateLimitedUntil) sendMessage(input);
            }
          }}
          placeholder={rateLimitedUntil && Date.now() < rateLimitedUntil ? "Rate cap active — please wait..." : "Message RITMOL..."}
          rows={2}
          style={{
            flex: 1, background: bg, border: `2px solid ${fg}`,
            color: fg, padding: "12px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
            outline: "none", resize: "none", borderRadius: "0",
            lineHeight: "1.6",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <button type="button" onClick={toggleVoice} style={{
            width: "48px", height: "48px", border: "2px solid #fff",
            background: isListening ? "#fff" : "transparent",
            color: isListening ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "18px",
          }}>
            {isListening ? "■" : "◎"}
          </button>
          <button type="button" onClick={() => sendMessage(input)}
            disabled={loading || (rateLimitedUntil && Date.now() < rateLimitedUntil)}
            style={{
              width: "48px", height: "48px",
              border: (loading || (rateLimitedUntil && Date.now() < rateLimitedUntil)) ? "2px solid #444" : "2px solid #fff",
              background: (loading || (rateLimitedUntil && Date.now() < rateLimitedUntil)) ? "#000" : "#fff",
              color: (loading || (rateLimitedUntil && Date.now() < rateLimitedUntil)) ? "#444" : "#000",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "20px",
              cursor: (loading || (rateLimitedUntil && Date.now() < rateLimitedUntil)) ? "not-allowed" : "pointer",
            }}>
            {rateLimitedUntil && Date.now() < rateLimitedUntil ? "⏳" : "›"}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              title="Clear chat history"
              onClick={() => {
                if (window.confirm("Clear all chat history? RITMOL will lose context of this conversation.")) {
                  setState((s) => ({ ...s, chatHistory: [] }));
                }
              }}
              disabled={loading}
              style={{
                width: "48px", height: "48px", border: "1px solid #555",
                background: "transparent", color: "#888",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
                cursor: loading ? "default" : "pointer",
              }}
              aria-label="Clear chat"
            >
              ⌫
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg }) {
  const isRitmol = msg.role === "assistant";
  const isError  = msg.isError === true;
  // Defence-in-depth: strip control characters and BiDi overrides / zero-width chars
  // from displayed content to prevent visual spoofing or odd terminal behaviours even
  // though React escapes HTML in text nodes. Do not strip printable ASCII like &, <, >
  // here — React's escaping is sufficient and users expect to see these characters.
  const safeContent = typeof msg.content === "string"
    ? msg.content
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, "")
        .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    : String(msg.content ?? "");
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isRitmol ? "flex-start" : "flex-end",
      gap: "3px",
    }}>
      {isRitmol && (
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", color: isError ? "#ff9900" : "#fff", letterSpacing: "2px", fontWeight: "bold" }}>
          {isError ? "RITMOL !" : "RITMOL ◈"}
        </div>
      )}
      <div style={{
        maxWidth: "88%", padding: "14px 16px",
        border: isError ? "2px solid #ff9900" : isRitmol ? "2px solid #fff" : "2px solid #000",
        fontFamily: "'Share Tech Mono', monospace",
        fontSize: "16px", lineHeight: "1.6",
        color: isError ? "#ff9900" : isRitmol ? "#fff" : "#000",
        background: isRitmol ? "#000" : "#fff",
      }}>
        {safeContent}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════
