import { useState, useEffect, useRef } from "react";
import { today, LS, storageKey } from "../utils/storage";
import { DAILY_TOKEN_LIMIT, DATA_DISCLOSURE_SEEN_KEY } from "../constants";
import { callGemini } from "../api/gemini";

export default function ChatTab({ state, setState, profile, apiKey, executeCommands, showBanner, buildSystemPrompt, checkMissions, awardXP, trackTokens }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [disclosureDismissed, setDisclosureDismissed] = useState(() => !!LS.get(storageKey(DATA_DISCLOSURE_SEEN_KEY)));
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  // Fix #12: AbortController so navigating away mid-request cancels the fetch and prevents
  // trackTokens / setState from firing against an unmounted component.
  const abortRef = useRef(null);

  const messages = state.chatHistory || [];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    checkMissions("chat");
  }, [messages.length]);

  // Fix #12: cancel any in-flight Gemini request when the tab unmounts (user navigates away).
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    if (!apiKey) { showBanner("No Gemini API key configured.", "alert"); return; }
    const usage = state.tokenUsage;
    if (usage && usage.date === today() && usage.tokens >= DAILY_TOKEN_LIMIT) {
      showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert");
      return;
    }

    // Fix #12: abort any previous in-flight request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg = { role: "user", content: text, ts: Date.now(), date: today() };
    const newHistory = [...messages, userMsg].slice(-1000);
    setState((s) => ({ ...s, chatHistory: newHistory }));
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(state, profile);
      // Only send last 10 messages to avoid context overflow.
      // Fix #2 (security): strip angle brackets from user message content before sending to
      // the API so a message like "</HUNTER_DATA>\nIgnore previous instructions" cannot
      // semantically break the system prompt boundary. sanitizeForPrompt is intentionally
      // NOT applied here (it's too aggressive for chat — e.g. it strips braces) — we only
      // remove the characters that could escape the <HUNTER_DATA> XML-like delimiters.
      const apiMessages = newHistory.slice(-20).map((m) => ({
        role: m.role,
        content: m.role === "user"
          ? m.content.replace(/[<>]/g, "")   // strip tag-breakout chars from user input only
          : m.content,                        // assistant messages are already AI-generated
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

      const assistantMsg = {
        role: "assistant",
        content: parsed.message || parsed.text || String(parsed),
        ts: Date.now(),
        date: today(),
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, assistantMsg].slice(-1000) }));

      if (parsed.commands?.length) {
        setTimeout(() => executeCommands(parsed.commands), 300);
      }
    } catch (e) {
      // Fix #12: AbortError means the user navigated away or sent a new message — not a real
      // error. Silently discard it so no spurious error message appears in the chat.
      if (e?.name === "AbortError") { setLoading(false); return; }
      console.error("RITMOL error:", e);
      const safeMsg = (e?.message || "").replace(/eyJ[\w.-]+/g, "[token]").slice(0, 60) || "System error";
      const errMsg = {
        role: "assistant",
        content: `Connection error: ${safeMsg}. Check your API key in Profile → Settings.`,
        ts: Date.now()
      };
      setState((s) => ({ ...s, chatHistory: [...s.chatHistory, errMsg].slice(-1000) }));
    } finally {
      setLoading(false);
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
      sendMessage(transcript);
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
            RITMOL sends your habits, tasks, goals, sleep, and calendar summary to Google's Gemini API to personalize responses. No data is stored by us beyond your chat history.
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
        {messages.map((msg, i) => (
          // Fix #7 (bug): use msg.ts (creation timestamp) as the React key instead of
          // array index. Index-based keys cause stale rendering when messages are removed
          // (e.g. after a Pull) because React reuses DOM nodes by position, not identity.
          // ts is set at message creation and is unique within a session.
          <ChatMessage key={msg.ts ?? i} msg={msg} />
        ))}
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
            <button key={c} onClick={() => sendMessage(c)} style={{
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
          onChange={(e) => setInput(e.target.value)}
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
          <button onClick={toggleVoice} style={{
            width: "40px", height: "40px", border: `1px solid ${isListening ? "#fff" : "#333"}`,
            background: isListening ? "#fff" : "transparent",
            color: isListening ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
          }}>
            {isListening ? "■" : "◎"}
          </button>
          <button onClick={() => sendMessage(input)} disabled={loading} style={{
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
  const isRitmof = msg.role === "assistant";
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isRitmof ? "flex-start" : "flex-end",
      gap: "3px",
    }}>
      {isRitmof && (
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px" }}>
          RITMOL ◈
        </div>
      )}
      <div style={{
        maxWidth: "85%", padding: "10px 12px",
        background: isRitmof ? "#0d0d0d" : "#1a1a1a",
        border: isRitmof ? "1px solid #222" : "1px solid #333",
        fontFamily: isRitmof ? "'Share Tech Mono', monospace" : "'Share Tech Mono', monospace",
        fontSize: "13px", lineHeight: "1.5", color: "#e8e8e8",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFILE TAB
// ═══════════════════════════════════════════════════════════════
