import { useState } from "react";
import { useAppContext } from "./context/AppContext";
import { localDateFromUTC } from "./utils/db";
import { STYLE_CSS } from "./constants";
import GeometricCorners from "./GeometricCorners";

export default function HabitsTab() {
  const { state, setState, logHabit, showBanner } = useAppContext();
  const todayLog = state.habitLog[localDateFromUTC()] || [];
  const categories = ["body", "mind", "work"];

  function deleteHabit(id) {
    setState((s) => ({ ...s, habits: s.habits.filter((h) => h.id !== id) }));
    showBanner("Habit removed.", "info");
  }

  // ── Custom habit form state ──────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHabit, setNewHabit] = useState({ label: "", category: "mind", xp: 25, icon: "◈" });

  function addCustomHabit() {
    const label = newHabit.label.trim();
    if (!label) { showBanner("Enter a habit name.", "alert"); return; }
    if (state.habits.length >= 100) { showBanner("Max 100 habits reached.", "alert"); return; }
    const safeCategory = ["body","mind","work"].includes(newHabit.category) ? newHabit.category : "mind";
    // Auto-assign style based on category so users don't need to think about it
    const categoryStyleMap = { body: "geometric", mind: "dots", work: "ascii" };
    const safe = {
      id: `habit_custom_${crypto.randomUUID()}`,
      // eslint-disable-next-line no-control-regex
      label: label.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "").replace(/[<>"'`&]/g, "").slice(0, 80),
      category: safeCategory,
      xp: Math.min(Math.max(5, Math.round(Number(newHabit.xp) || 25)), 200),
      icon: typeof newHabit.icon === "string" ? [...newHabit.icon].slice(0, 2).join("") || "◈" : "◈",
      style: categoryStyleMap[safeCategory] || "ascii",
      desc: "",
      addedBy: "user",
    };
    setState((s) => ({ ...s, habits: [...s.habits, safe] }));
    setNewHabit({ label: "", category: "mind", xp: 25, icon: "◈" });
    setShowAddForm(false);
    showBanner(`Habit "${safe.label}" added. +${safe.xp} XP per completion.`, "success");
  }

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace", borderBottom: "3px solid #fff", paddingBottom: "16px" }}>
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", fontWeight: "bold" }}>[ HABIT LOG ]</div>
        <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "4px" }}>HABITS</div>
        <div style={{ fontSize: "15px", color: "#fff", marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{todayLog.length}/{state.habits.length} completed today</span>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            style={{
              fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "1px",
              border: "2px solid #fff", background: showAddForm ? "#fff" : "#000",
              color: showAddForm ? "#000" : "#fff", padding: "6px 14px",
              cursor: "pointer", minHeight: "36px",
            }}
          >
            {showAddForm ? "CANCEL" : "+ ADD HABIT"}
          </button>
        </div>
      </div>

      {/* ── Add Habit Form ─────────────────────────────────── */}
      {showAddForm && (
        <div style={{
          border: "2px solid #fff", padding: "18px", fontFamily: "'Share Tech Mono', monospace",
          display: "flex", flexDirection: "column", gap: "12px", background: "#000",
        }}>
          <div style={{ fontSize: "13px", letterSpacing: "2px", color: "#fff", fontWeight: "bold" }}>NEW CUSTOM HABIT</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", color: "#aaa", letterSpacing: "1px" }}>HABIT NAME *</label>
            <input
              type="text"
              value={newHabit.label}
              onChange={(e) => setNewHabit((h) => ({ ...h, label: e.target.value.slice(0, 80) }))}
              placeholder="e.g. Morning run"
              maxLength={80}
              style={{
                background: "#000", border: "2px solid #fff", color: "#fff", padding: "10px",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "15px", outline: "none", width: "100%",
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", color: "#aaa", letterSpacing: "1px" }}>CATEGORY</label>
              <select
                value={newHabit.category}
                onChange={(e) => setNewHabit((h) => ({ ...h, category: e.target.value }))}
                style={{ background: "#000", border: "2px solid #fff", color: "#fff", padding: "10px", fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", outline: "none" }}
              >
                <option value="body">BODY</option>
                <option value="mind">MIND</option>
                <option value="work">WORK</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", color: "#aaa", letterSpacing: "1px" }}>XP REWARD</label>
              <input
                type="number"
                value={newHabit.xp}
                min={5} max={200}
                onChange={(e) => setNewHabit((h) => ({ ...h, xp: Number(e.target.value) }))}
                style={{ background: "#000", border: "2px solid #fff", color: "#fff", padding: "10px", fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", outline: "none", width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", color: "#aaa", letterSpacing: "1px" }}>ICON (1 char)</label>
              <input
                type="text"
                value={newHabit.icon}
                maxLength={2}
                onChange={(e) => setNewHabit((h) => ({ ...h, icon: e.target.value }))}
                style={{ background: "#000", border: "2px solid #fff", color: "#fff", padding: "10px", fontFamily: "'Share Tech Mono', monospace", fontSize: "18px", outline: "none", width: "100%", textAlign: "center" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", color: "#aaa", letterSpacing: "1px" }}>TYPE</label>
              <select
                value={newHabit.category}
                onChange={(e) => setNewHabit((h) => ({ ...h, category: e.target.value }))}
                style={{ background: "#000", border: "2px solid #fff", color: "#fff", padding: "10px", fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", outline: "none" }}
              >
                <option value="body">BODY</option>
                <option value="mind">MIND</option>
                <option value="work">WORK</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={addCustomHabit}
            style={{
              width: "100%", padding: "14px", border: "none", background: "#fff", color: "#000",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "15px", letterSpacing: "2px",
              cursor: "pointer", fontWeight: "bold", minHeight: "48px",
            }}
          >
            ✓ CREATE HABIT
          </button>
        </div>
      )}

      {/* Streak bonus indicator */}
      {state.streak >= 3 && (
        <div style={{
          border: "3px solid #fff", padding: "14px 16px",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
          display: "flex", justifyContent: "space-between", fontWeight: "bold",
          background: "#000",
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
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff", letterSpacing: "3px", marginBottom: "12px", textTransform: "uppercase", borderBottom: "2px solid #fff", paddingBottom: "6px", fontWeight: "bold" }}>
              {cat.toUpperCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {catHabits.map((habit) => {
                const done = todayLog.includes(habit.id);
                const s = STYLE_CSS[habit.style] || STYLE_CSS.ascii;
                return (
                  <div key={habit.id} style={{
                    border: "2px solid #fff",
                    background: done ? "#fff" : "#000",
                    padding: "16px",
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
                        <div style={{ fontSize: "17px", fontWeight: "bold", textDecoration: done ? "line-through" : "none", color: done ? "#000" : "#fff" }}>
                          {habit.label}
                        </div>
                        <div style={{ fontSize: "16px", color: "#fff", marginTop: "4px", lineHeight: "1.6", textDecoration: done ? "line-through" : "none" }}>
                          +{habit.xp} XP {habit.addedBy === "ritmol" ? "· RITMOL" : ""}
                          {habit.desc && !done ? ` · ${habit.desc}` : ""}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHabit(habit.id)}
                      style={{ color: done ? "#000" : "#fff", fontSize: "22px", padding: "8px", background: done ? "#fff" : "none", border: done ? "2px solid #fff" : "none", minHeight: "48px", minWidth: "48px" }}
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
