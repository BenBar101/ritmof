import { useState, useEffect, useRef } from "react";
import { today, nowHour } from "./utils/storage";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { DAILY_TOKEN_LIMIT } from "./constants";

// eslint-disable-next-line no-unused-vars
export default function HomeTab({ state, setState, profile, _apiKey, _level, rank, dailyQuote, _awardXP, logHabit, showBanner, _showToast, _executeCommands, setTab, _buildSystemPrompt }) {
  const todayLog = state.habitLog[today()] || [];
  const totalHabits = state.habits.length;
  const doneHabits = todayLog.length;

  const upcomingExams = (state.calendarEvents || []).filter((e) => {
    if (e.type !== "exam") return false;
    if (typeof e.start !== "string" || !e.start) return false;
    const startMs = new Date(e.start).getTime();
    if (isNaN(startMs)) return false;
    const diff = (startMs - Date.now()) / 86400000;
    return diff >= 0 && diff <= 5;
  });

  const hour = nowHour();
  const greeting = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";

  const pendingTasks = (state.tasks || []).filter((t) => !t.done).length;
  const totalAchievements = (state.achievements || []).length;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* Greeting */}
      <div style={{ borderBottom: "1px solid #222", paddingBottom: "12px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "3px" }}>{greeting}</div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "22px", fontWeight: "bold", marginTop: "2px" }}>
          {profile?.name || "Hunter"}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#666", marginTop: "2px" }}>
          {rank.badge} {rank.decor} {rank.title}
        </div>
      </div>

      {/* Daily quote */}
      {dailyQuote && (
        <div style={{
          background: "radial-gradient(circle, #1a1a1a 1px, transparent 1px) 0 0 / 12px 12px",
          border: "1px solid #333", padding: "16px",
        }}>
          <div style={{ fontFamily: "'IM Fell English', serif", fontSize: "13px", fontStyle: "italic", color: "#ccc", lineHeight: "1.6" }}>
            &ldquo;{sanitizeForPrompt(dailyQuote.quote ?? "", 500)}&rdquo;
          </div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", marginTop: "8px" }}>
            — {sanitizeForPrompt(dailyQuote.author ?? "", 100)}
          </div>
        </div>
      )}

      {/* Exam warning */}
      {upcomingExams.map((exam) => {
        const days = Math.ceil((new Date(exam.start) - Date.now()) / 86400000);
        const safeTitle = sanitizeForPrompt(exam.title ?? "", 200);
        return (
          <div key={exam.id} style={{
            border: "2px solid #fff", padding: "12px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#0d0d0d",
          }}>
            <div style={{ fontSize: "9px", color: "#888", letterSpacing: "2px" }}>EXAM WARNING</div>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>⚠ {safeTitle}</div>
            <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>T-{days} days. Prepare accordingly.</div>
          </div>
        );
      })}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
        {[
          { label: "HABITS", value: `${doneHabits}/${totalHabits}` },
          { label: "TASKS", value: pendingTasks },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "ACHIEV", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} style={{
            border: "1px solid #222", padding: "8px", textAlign: "center",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "8px", color: "#555", letterSpacing: "1px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Token usage */}
      <TokenUsageBar usage={state.tokenUsage} />

      {/* Habit ring */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", border: "1px solid #1a1a1a", padding: "12px" }}>
        <HabitRing done={doneHabits} total={totalHabits} />
        <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "11px", color: "#888" }}>TODAY&apos;S PROTOCOLS</div>
          <div style={{ fontSize: "20px", fontWeight: "bold" }}>{doneHabits} / {totalHabits}</div>
          <div style={{ fontSize: "10px", color: "#555" }}>{totalHabits - doneHabits} remaining</div>
        </div>
      </div>

      {/* Daily goal */}
      {state.dailyGoal && (
        <div style={{ border: "1px solid #333", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px" }}>DAILY OBJECTIVE</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {sanitizeForPrompt(state.dailyGoal ?? "", 200)
              .replace(/['"\\]/g, "")
              .replace(/[\u27E8\u27E9\u276C-\u276F\uFE3D\uFE3E\u2329\u232A]/g, "")}
          </div>
        </div>
      )}

      {/* Daily missions */}
      {state.dailyMissions && (
        <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#666", letterSpacing: "2px", marginBottom: "10px" }}>
            DAILY MISSIONS
          </div>
          {state.dailyMissions.map((m) => (
            <div key={m.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "6px 0", borderBottom: "1px solid #111",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
              color: m.done ? "#444" : "#ccc",
              textDecoration: m.done ? "line-through" : "none",
            }}>
              <span>{m.done ? "✓" : "○"} {m.desc}</span>
              <span style={{ color: "#666" }}>+{m.xp}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick habits */}
      <div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "10px" }}>
          QUICK PROTOCOLS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
          {state.habits.slice(0, 6).map((h) => {
            const done = todayLog.includes(h.id);
            return (
              <button
                key={h.id}
                onClick={(e) => !done && logHabit(h.id, e)}
                style={{
                  padding: "10px 4px", border: `1px solid ${done ? "#fff" : "#333"}`,
                  background: done ? "#fff" : "transparent",
                  color: done ? "#000" : "#ccc",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
                  textAlign: "center", cursor: done ? "default" : "pointer",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: "16px" }}>{h.icon}</div>
                <div style={{ fontSize: "8px", marginTop: "2px" }}>{h.label.split(" ").slice(0, 2).join(" ")}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active timers */}
      {(state.activeTimers || []).length > 0 && (
        <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#555", letterSpacing: "2px", marginBottom: "8px" }}>
            ACTIVE TIMERS
          </div>
          {state.activeTimers.map((timer) => (
            <CountdownTimer
              key={timer.id}
              timer={timer}
              onExpire={() => {
                setState((s) => ({ ...s, activeTimers: s.activeTimers.filter((t) => t.id !== timer.id) }));
                const safeLabel = sanitizeForPrompt(timer.label ?? "", 200);
                showBanner(`Timer complete: ${safeLabel}`, "success");
              }}
            />
          ))}
        </div>
      )}

      {/* Quick action chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {[
          { label: "→ RITMOL", action: () => setTab("chat") },
          { label: "⊞ TASKS", action: () => setTab("tasks") },
          { label: "◉ HABITS", action: () => setTab("habits") },
        ].map((c) => (
          <button key={c.label} onClick={c.action} style={{
            padding: "6px 14px", border: "1px solid #333",
            background: "transparent", color: "#888",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
            letterSpacing: "1px", cursor: "pointer",
          }}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TokenUsageBar({ usage }) {
  if (!usage) return null;
  // Fix: use DAILY_TOKEN_LIMIT (the actual enforcement ceiling) so the bar fills to 100%
  // when AI features are disabled — not 5% (50k/1M). Showing "% of 1M" while blocking at
  // 50k meant the bar never appeared to reach critical even when the budget was exhausted.
  const DISPLAY_LIMIT = DAILY_TOKEN_LIMIT;
  const isToday = usage?.date === today();
  const tokens = isToday ? (usage?.tokens || 0) : 0;
  const pct = Math.min(100, (tokens / DISPLAY_LIMIT) * 100);
  const pctDisplay = pct < 0.1 ? "<0.1" : pct.toFixed(1);
  const color = pct > 80 ? "#fff" : pct > 50 ? "#aaa" : "#555";

  return (
    <div style={{ border: "1px solid #1a1a1a", padding: "8px 12px", fontFamily: "'Share Tech Mono', monospace" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#444", marginBottom: "4px" }}>
        <span>NEURAL ENERGY TODAY</span>
        <span style={{ color }}>~{pctDisplay}% of {(DISPLAY_LIMIT / 1000).toFixed(0)}k</span>
      </div>
      <div style={{ height: "2px", background: "#1a1a1a" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s" }} />
      </div>
      <div style={{ fontSize: "8px", color: "#333", marginTop: "3px" }}>
        ~{tokens.toLocaleString()} tokens used · resets midnight
      </div>
      {!isToday && (
        <div style={{ fontSize: "8px", color: "#2a4a2a", marginTop: "3px" }}>
          ↺ Budget reset for today
        </div>
      )}
    </div>
  );
}

function HabitRing({ done, total }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width="72" height="72" style={{ flexShrink: 0 }}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="#1a1a1a" strokeWidth="4" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="#fff" strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="butt" transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 0.5s" }}
      />
      <text x="36" y="40" textAnchor="middle" fill="#fff"
        style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px" }}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function CountdownTimer({ timer, onExpire }) {
  const [remaining, setRemaining] = useState(Math.max(0, timer.endsAt - Date.now()));
  // Keep onExpire in a ref so the interval callback always calls the latest version
  // without needing to be restarted when the parent re-renders with a new inline function.
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    if (timer.endsAt <= Date.now()) {
      onExpireRef.current();
      return;
    }
    const iv = setInterval(() => {
      const r = Math.max(0, timer.endsAt - Date.now());
      setRemaining(r);
      if (r === 0) { clearInterval(iv); onExpireRef.current(); }
    }, 1000);
    return () => clearInterval(iv);
  }, [timer.endsAt]); // onExpire accessed via ref — no stale closure risk
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", padding: "4px 0", display: "flex", justifyContent: "space-between" }}>
      <span>{sanitizeForPrompt(timer.emoji ?? "", 2)} {sanitizeForPrompt(timer.label ?? "", 200)}</span>
      <span style={{ color: remaining < 60000 ? "#fff" : "#888" }}>{mins}:{secs.toString().padStart(2, "0")}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HABITS TAB
