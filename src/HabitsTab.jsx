import { useState, useEffect, useRef } from "react";
import { today, LS, storageKey } from "../utils/storage";
import { STYLE_CSS, DAILY_TOKEN_LIMIT } from "../constants";
import { callGemini } from "../api/gemini";
import GeometricCorners from "../components/GeometricCorners";

export default function HabitsTab({ state, setState, logHabit, awardXP, showBanner, profile, apiKey, trackTokens }) {
  const todayLog = state.habitLog[today()] || [];
  const categories = ["body", "mind", "work"];
  const [initializing, setInitializing] = useState(false);
  // Abort controller so navigating away mid-init cancels the Gemini request.
  const habitInitAbortRef = useRef(null);

  // First-open: ask RITMOL to generate personalized habits
  useEffect(() => {
    if (state.habitsInitialized || !apiKey || !profile || initializing) return;
    const usage = state.tokenUsage;
    if (usage && usage.date === today() && usage.tokens >= DAILY_TOKEN_LIMIT) return;
    setInitializing(true);

    // Cancel any previous in-flight request and start a fresh one.
    habitInitAbortRef.current?.abort();
    const controller = new AbortController();
    habitInitAbortRef.current = controller;

    const prompt = `You are RITMOL initializing a personalized habit protocol for a new hunter.

Hunter profile:
- Name: ${profile?.name ?? "Hunter"}
- Major: ${profile?.major ?? ""}
- Books/Interests: ${profile?.books ?? ""}, ${profile?.interests ?? ""}
- Semester goal: ${profile.semesterGoal}

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
      .then(({ text, tokensUsed }) => {
        if (controller.signal.aborted) return; // unmounted — discard
        trackTokens?.(tokensUsed);
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) throw new Error("Expected array from Gemini");
        const newHabits = JSON.parse(match[0]);
        if (!Array.isArray(newHabits)) throw new Error("Expected array from Gemini");
        setState((s) => ({
          ...s,
          habits: [
            ...s.habits,
            // Fix #3 (security): construct each habit explicitly — never spread the raw AI
            // object so unexpected keys (including __proto__) cannot pollute state.
            ...newHabits.map(h => ({
              id:       typeof h.id === "string" ? h.id.slice(0, 60).replace(/[^a-zA-Z0-9_-]/g, "_") : `habit_ai_${crypto.randomUUID()}`,
              label:    typeof h.label === "string" ? h.label.slice(0, 80) : "Habit",
              category: ["body","mind","work"].includes(h.category) ? h.category : "mind",
              xp:       typeof h.xp === "number" ? Math.min(Math.max(1, Math.round(h.xp)), 200) : 25,
              icon:     typeof h.icon === "string" ? h.icon.slice(0, 2) : "◈",
              style:    ["ascii","dots","geometric","typewriter"].includes(h.style) ? h.style : "ascii",
              desc:     typeof h.desc === "string" ? h.desc.slice(0, 200) : "",
              addedBy:  "ritmol",
            })),
          ],
          habitsInitialized: true,
        }));
        showBanner("RITMOL has initialized your protocol stack.", "success");
      })
      .catch(() => {
        setState((s) => ({ ...s, habitsInitialized: true }));
        showBanner("Could not load personalized habits. Using defaults.", "info");
      })
      .finally(() => setInitializing(false));
  }, [state.habitsInitialized, apiKey]);

  // Cancel any in-flight habit-init request on unmount.
  useEffect(() => () => { habitInitAbortRef.current?.abort(); }, []);

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
