import { useState, useEffect, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { todayUTC, localDateFromUTC } from "./utils/storage";
import { STYLE_CSS, DAILY_TOKEN_LIMIT } from "./constants";
import { callGemini } from "./api/gemini";
// Fix [H-1]: import the canonical sanitizeForPrompt instead of maintaining a local copy.
// The duplicate copy diverged from the canonical version and missed the U+2028/2029 and
// single-quote fixes. A single canonical implementation ensures all prompt-injection fixes
// apply everywhere simultaneously.
import { sanitizeForPrompt } from "./api/systemPrompt";
import GeometricCorners from "./GeometricCorners";

export default function HabitsTab() {
  const { state, setState, logHabit, showBanner, profile, apiKey, trackTokens, rehydrateCount } = useAppContext();
  const todayLog = state.habitLog[localDateFromUTC()] || [];
  const categories = ["body", "mind", "work"];
  const [initializing, setInitializing] = useState(false);
  // Abort controller so navigating away mid-init cancels the Gemini request.
  const habitInitAbortRef = useRef(null);

  // First-open: ask RITMOL to generate personalized habits
  useEffect(() => {
    if (state.habitsInitialized || !apiKey || !profile || initializing) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const usage = state.tokenUsage;
    if (usage && usage.date === todayUTC() && usage.tokens >= DAILY_TOKEN_LIMIT) return;
    let mounted = true;
    setInitializing(true);

    // Cancel any previous in-flight request and start a fresh one.
    habitInitAbortRef.current?.abort();
    const controller = new AbortController();
    habitInitAbortRef.current = controller;

    // Fix [H-1]: use canonical sanitizeForPrompt (imported from systemPrompt.js above)
    // so all prompt-injection fixes (U+2028/2029, single-quote, zero-width chars) apply
    // here. The local copy previously defined inline was missing those fixes.

    const safeBooksInterests = `${sanitizeForPrompt(profile?.books ?? "", 100)}, ${sanitizeForPrompt(profile?.interests ?? "", 100)}`.slice(0, 200);

    const prompt = `You are RITMOL initializing a personalized habit protocol for a new hunter.

Hunter profile:
- Name: ${sanitizeForPrompt(profile?.name ?? "Hunter", 60)}
- Major: ${sanitizeForPrompt(profile?.major ?? "", 80)}
- Books/Interests: ${safeBooksInterests}
- Semester goal: ${sanitizeForPrompt(profile?.semesterGoal ?? "", 200)}

Current base habits (keep these, don't duplicate): water, sleep11, wake7, sunlight, read, deepwork, journal

Generate 8-12 additional personalized habits for this hunter. Consider:
- Their major/field (e.g. CS student → no-distraction coding blocks; physics → problem sets; etc.)
- Their interests (e.g. weightlifting → progressive overload log; chess → tactics puzzles)
- General student wellbeing: morning routine, physical health, social recovery, focus hygiene
- The habits should feel EARNED and SPECIFIC, not generic
- Include at least 2 body habits (physical training, recovery), 2 mind habits, 2 work habits
- Style mapping: body habits → "dots" or "geometric", CS/work habits → "ascii", reading/prep → "dots", writing/reflection → "typewriter", math/physics → "geometric", fitness → "geometric"
- XP range: 15-60 depending on difficulty

Respond ONLY with JSON array:
[
  { "id": "unique_id", "label": "Habit name", "category": "body|mind|work", "xp": 25, "icon": "single char", "style": "ascii|dots|geometric|typewriter", "desc": "one line why this matters for them" }
]`;

    callGemini(apiKey, [{ role: "user", content: prompt }],
      "You generate personalized habit protocols. Respond only in JSON.", true, controller.signal)
      .then(async ({ text, tokensUsed }) => {
        if (controller.signal.aborted || !mounted) return;
        trackTokens?.(tokensUsed);
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error("Expected array from Gemini");
        let newHabits;
        try {
          newHabits = JSON.parse(match[0]);
        } catch {
          throw new Error("Expected array from Gemini");
        }
        if (!Array.isArray(newHabits)) throw new Error("Expected array from Gemini");
        // Prototype-pollution guard: reject any parsed value that contains __proto__,
        // constructor, or prototype keys at any depth before the mapper runs.
        const { isSafeSyncValue } = await import("./sync/SyncManager.js");
        if (!isSafeSyncValue(newHabits)) throw new Error("Expected array from Gemini");
        if (!mounted) return;
        setState((s) => ({
          ...s,
          habits: [
            ...s.habits,
            // Fix #3 (security): construct each habit explicitly — never spread the raw AI
            // object so unexpected keys (including __proto__) cannot pollute state.
            ...newHabits.map(h => ({
              id:       typeof h.id === "string" ? h.id.slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, "_") : `habit_ai_${crypto.randomUUID()}`,
              // eslint-disable-next-line no-control-regex
              label:    typeof h.label === "string" ? h.label.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "").replace(/[<>"'`&]/g, "").slice(0, 80) : "Habit",
              category: ["body","mind","work"].includes(h.category) ? h.category : "mind",
              xp:       typeof h.xp === "number" ? Math.min(Math.max(1, Math.round(h.xp)), 200) : 25,
              icon:     typeof h.icon === "string" ? [...h.icon].slice(0, 2).join("") : "◈",
              style:    ["ascii","dots","geometric","typewriter"].includes(h.style) ? h.style : "ascii",
              // eslint-disable-next-line no-control-regex
              desc:     typeof h.desc === "string" ? h.desc.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "").replace(/[<>"'`&]/g, "").slice(0, 200) : "",
              addedBy:  "ritmol",
            })),
          ],
          habitsInitialized: true,
        }));
        if (!mounted) return;
        showBanner("RITMOL has initialized your protocol stack.", "success");
      })
      .catch((err) => {
        // Fix [H-2]: a transient network error or API outage previously set
        // habitsInitialized: true permanently, blocking all future retries.
        // Only treat definitive failures (auth errors, rate limits, explicit
        // model errors) as permanent. Transient failures (network, timeout,
        // AbortError from unmount) leave habitsInitialized: false so the next
        // mount attempt will retry.
        const msg = err?.message || "";
        const isAbort = err?.name === "AbortError";
        const isPermanent = !isAbort && (
          msg.includes("403") ||
          msg.includes("401") ||
          msg.includes("API key") ||
          msg.includes("Blocked:")
        );
        if (isPermanent) {
          if (!mounted) return;
          setState((s) => ({ ...s, habitsInitialized: true }));
          showBanner("Could not load personalized habits. Using defaults.", "info");
        } else if (!isAbort) {
          if (!mounted) return;
          showBanner("Could not load personalized habits. Will retry next time.", "info");
        }
        // AbortError = component unmounted mid-request; silently discard.
      })
      .finally(() => {
        if (mounted) setInitializing(false);
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only re-run when habits init, api key, profile identity, or rehydrate changes
  }, [state.habitsInitialized, apiKey, profile?.name ?? "", profile?.major ?? "", rehydrateCount]);

  function deleteHabit(id) {
    setState((s) => ({ ...s, habits: s.habits.filter((h) => h.id !== id) }));
    showBanner("Habit protocol removed.", "info");
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px" }}>PROTOCOL LOG</div>
        <div style={{ fontSize: "20px", fontWeight: "bold", marginTop: "2px" }}>HABITS</div>
        <div style={{ fontSize: "11px", color: "#555", marginTop: "2px" }}>
          {todayLog.length}/{state.habits.length} completed today
        </div>
      </div>

      {initializing && (
        <div style={{
          border: "1px solid #333", padding: "14px", fontFamily: "'Share Tech Mono', monospace",
          fontSize: "11px", color: "#666", textAlign: "center",
          background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
        }}>
          <div style={{ marginBottom: "6px" }}>◈ RITMOL ANALYZING HUNTER PROFILE...</div>
          <div style={{ fontSize: "10px", color: "#444" }}>Generating personalized protocol stack</div>
        </div>
      )}

      {/* Streak bonus indicator */}
      {state.streak >= 3 && (
        <div style={{
          border: "1px solid #555", padding: "8px 12px",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>STREAK BONUS ACTIVE</span>
          <span>{state.streak >= 7 ? "+50% XP" : "+25% XP"}</span>
        </div>
      )}

      {categories.map((cat) => {
        const catHabits = state.habits.filter((h) => h.category === cat);
        if (!catHabits.length) return null;
        return (
          <div key={cat}>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555", letterSpacing: "3px", marginBottom: "8px", textTransform: "uppercase" }}>
              ── {cat} ──────────────
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {catHabits.map((habit) => {
                const done = todayLog.includes(habit.id);
                const s = STYLE_CSS[habit.style] || STYLE_CSS.ascii;
                return (
                  <div key={habit.id} style={{
                    border: done ? "1px solid #fff" : s.border,
                    background: done ? "#fff" : s.background,
                    padding: "12px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    position: "relative", overflow: "hidden",
                  }}>
                    <GeometricCorners style={done ? "none" : habit.style} small />
                    <button
                      type="button"
                      onClick={(e) => !done && logHabit(habit.id, e)}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        flex: 1, background: "none", border: "none",
                        color: done ? "#000" : "#e8e8e8",
                        fontFamily: s.fontFamily, cursor: done ? "default" : "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "20px", width: "24px", textAlign: "center" }}>{done ? "✓" : habit.icon}</span>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: done ? "bold" : "normal", textDecoration: done ? "line-through" : "none" }}>
                          {habit.label}
                        </div>
                        <div style={{ fontSize: "10px", color: done ? "#666" : "#555", marginTop: "1px" }}>
                          +{habit.xp} XP {habit.addedBy === "ritmol" ? "· RITMOL" : ""}
                          {habit.desc && !done ? ` · ${habit.desc}` : ""}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHabit(habit.id)}
                      style={{ color: done ? "#666" : "#444", fontSize: "14px", padding: "4px", background: "none", border: "none" }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TASKS TAB
// ═══════════════════════════════════════════════════════════════
