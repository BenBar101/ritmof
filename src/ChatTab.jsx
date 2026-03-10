import { useState, useEffect, useRef, useMemo } from "react";
import { useAppContext } from "./context/AppContext";
import { today, todayUTC, LS, storageKey } from "./utils/storage";
import { DAILY_TOKEN_LIMIT, DATA_DISCLOSURE_SEEN_KEY } from "./constants";
import { callGemini } from "./api/gemini";

// Module-level — compiled once
// eslint-disable-next-line no-control-regex
const STRIP_FOR_API_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const INJECTION_CHARS_RE = /[<>{}`"'\\]/g;
let _msgSeq = 0;

export default function ChatTab() {
  const { state, setState, profile, apiKey, executeCommands, showBanner, buildSystemPrompt, checkMissions, trackTokens } = useAppContext();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [disclosureDismissed, setDisclosureDismissed] = useState(() => !!LS.get(storageKey(DATA_DISCLOSURE_SEEN_KEY)));
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  // Fix #12: AbortController so navigating away mid-request cancels the fetch and prevents
  // trackTokens / setState from firing against an unmounted component.
  const abortRef = useRef(null);
  const mountedRef = useRef(true);

  const messages = useMemo(() => state.chatHistory || [], [state.chatHistory]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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
  }, []);

  const MAX_INPUT_LENGTH = 4000; // ~1k tokens; prevents accidental budget burn on huge pastes

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    // FIX: enforce max input length so a giant paste or voice transcript can't fire a
    // 10 000-token request and silently drain the daily budget.
    if (text.length > MAX_INPUT_LENGTH) {
      showBanner(`Message too long (max ${MAX_INPUT_LENGTH} chars).`, "alert");
      return;
    }
    if (!apiKey) { showBanner("No Gemini API key configured.", "alert"); return; }
    const usage = state.tokenUsage;
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
      date: today(),
    };
    const newHistory = [...messages, userMsg].slice(-1000);
    setState((s) => ({ ...s, chatHistory: newHistory }));
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(state, profile);
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
      const { text: raw, tokensUsed } = await callGemini(apiKey, apiMessages, systemPrompt, true, controller.signal);
      trackTokens?.(tokensUsed);

      // Robust JSON extraction: use a safer regex-based fallback instead of lastIndexOf("}")
      let parsed;
      try {
        // Try direct parse first
        const cleaned = raw.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        // Fallback: attempt to extract a JSON object block from the text.
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = { message: raw, commands: [] };
          }
        } else {
          parsed = { message: raw, commands: [] };
        }
      }

      const rawContent = parsed.message || parsed.text || String(parsed);
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
        date: today(),
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, assistantMsg].slice(-1000) }));

      if (parsed.commands?.length) {
        setTimeout(() => executeCommands(parsed.commands), 300);
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        if (mountedRef.current) setLoading(false);
        return;
      }
      const redactedMsg = (e?.message || "")
        .replace(/AIza[A-Za-z0-9_-]{34,45}/g, "[key]")
        .replace(/eyJ[\w.-]+/g, "[token]")
        .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]");
      console.error("RITMOL error:", redactedMsg);
      const safeMsg = redactedMsg.slice(0, 60) || "System error";
      const errMsg = {
        role: "assistant",
        content: `Connection error: ${safeMsg}. Check your API key in Profile → Settings.`,
        ts: Date.now(),
        seq: ++_msgSeq,
        date: today(),
      };
      if (mountedRef.current) {
        setState((s) => ({ ...s, chatHistory: [...s.chatHistory, errMsg].slice(-1000) }));
      }
    } finally {
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
    <div style={{ height: "calc(100vh - 56px - 60px)", display: "flex", flexDirection: "column" }}>
      {/* Data disclosure (one-time) */}
      {!disclosureDismissed && (
        <div style={{
          padding: "10px 16px", background: "#1a1a1a", borderBottom: "1px solid #222",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#888",
          display: "flex", alignItems: "flex-start", gap: "8px",
        }}>
          <span style={{ flex: 1 }}>
            RITMOL sends your habits, tasks, goals, sleep, and calendar summary to Google&apos;s Gemini API to personalize responses. No data is stored by us beyond your chat history.
          </span>
          <button
            type="button"
            onClick={() => { LS.set(storageKey(DATA_DISCLOSURE_SEEN_KEY), "1"); setDisclosureDismissed(true); }}
            style={{ padding: "2px 8px", border: "1px solid #444", background: "transparent", color: "#666", cursor: "pointer", flexShrink: 0 }}
          >
            Got it
          </button>
        </div>
      )}
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>◈</div>
            <div style={{ fontSize: "14px", marginBottom: "6px" }}>RITMOL ONLINE</div>
            <div style={{ fontSize: "11px", color: "#555" }}>System ready. Awaiting Hunter input.</div>
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
          <div style={{ display: "flex", gap: "6px", padding: "8px 0" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                width: "6px", height: "6px", background: "#555",
                animation: `pulse 1s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length < 3 && (
        <div style={{ padding: "0 16px 8px", display: "flex", gap: "6px", overflowX: "auto" }}>
          {chips.map((c) => (
            <button type="button" key={c} onClick={() => sendMessage(c)} style={{
              padding: "6px 12px", border: "1px solid #333",
              background: "transparent", color: "#777",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
              whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0,
            }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a1a", display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
          maxLength={MAX_INPUT_LENGTH}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Message RITMOL..."
          rows={2}
          style={{
            flex: 1, background: "#111", border: "1px solid #222",
            color: "#e8e8e8", padding: "10px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px",
            outline: "none", resize: "none", borderRadius: "0",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <button type="button" onClick={toggleVoice} style={{
            width: "40px", height: "40px", border: `1px solid ${isListening ? "#fff" : "#333"}`,
            background: isListening ? "#fff" : "transparent",
            color: isListening ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
          }}>
            {isListening ? "■" : "◎"}
          </button>
          <button type="button" onClick={() => sendMessage(input)} disabled={loading} style={{
            width: "40px", height: "40px", border: "1px solid #555",
            background: loading ? "#111" : "#fff",
            color: loading ? "#333" : "#000",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
          }}>
            ›
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg }) {
  const isRitmol = msg.role === "assistant";
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
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px" }}>
          RITMOL ◈
        </div>
      )}
      <div style={{
        maxWidth: "85%", padding: "10px 12px",
        background: isRitmol ? "#0d0d0d" : "#1a1a1a",
        border: isRitmol ? "1px solid #222" : "1px solid #333",
        fontFamily: isRitmol ? "'Share Tech Mono', monospace" : "'Share Tech Mono', monospace",
        fontSize: "13px", lineHeight: "1.5", color: "#e8e8e8",
      }}>
        {safeContent}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════
