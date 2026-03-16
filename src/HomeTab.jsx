import { useState, useEffect, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { localDateFromUTC, todayUTC, nowHour, sanitizeForDisplay } from "./utils/storage";
import { DAILY_TOKEN_LIMIT } from "./constants";

export default function HomeTab() {
  const { state, setState, rank, dailyQuote, logHabit, showBanner, setTab, profile, theme } = useAppContext();
  const todayLog = state.habitLog[localDateFromUTC()] || [];
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
      <div style={{ borderBottom: "3px solid #fff", paddingBottom: "16px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", letterSpacing: "3px", fontWeight: "bold" }}>[ {greeting} ]</div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "clamp(24px, 8vw, 36px)", fontWeight: "bold", marginTop: "4px", letterSpacing: "2px" }}>
          {profile?.name || "Hunter"}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "18px", color: "#fff", marginTop: "4px", letterSpacing: "2px", fontWeight: "bold" }}>
          {rank.badge} {rank.decor} {rank.title}
        </div>
      </div>

      {/* Daily quote */}
      {dailyQuote && (
        <div style={{
          background: "#000",
          border: "2px solid #fff", padding: "20px",
        }}>
          <div style={{ fontFamily: "'IM Fell English', serif", fontSize: "18px", fontStyle: "italic", color: "#fff", lineHeight: "1.7" }}>
            &ldquo;{sanitizeForDisplay(dailyQuote.quote ?? "", 500)}&rdquo;
          </div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", marginTop: "12px" }}>
            — {sanitizeForDisplay(dailyQuote.author ?? "", 100)}
          </div>
        </div>
      )}

      {/* Exam warning */}
      {upcomingExams.map((exam) => {
        const rawDiff = (new Date(exam.start) - Date.now()) / 86400000;
        const days = rawDiff <= 0 ? 0 : Math.ceil(rawDiff);
        if (rawDiff < -0.05) return null;
        const safeTitle = sanitizeForDisplay(exam.title ?? "", 200);
        return (
          <div key={exam.id} style={{
            border: "2px solid #fff", padding: "14px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#000",
          }}>
            <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", marginBottom: "4px", fontWeight: "bold" }}>[ EXAM WARNING ]</div>
            <div style={{ fontSize: "18px", marginTop: "4px", fontWeight: "bold" }}>⚠ {safeTitle}</div>
            <div style={{ fontSize: "14px", color: "#fff", marginTop: "4px" }}>T-{days} days. Prepare accordingly.</div>
          </div>
        );
      })}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
        {[
          { label: "HABITS", value: `${doneHabits}/${totalHabits}` },
          { label: "TASKS", value: pendingTasks },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "ACHIEV", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} style={{
            border: "2px solid #fff", padding: "12px", textAlign: "center",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "24px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "12px", color: "#fff", letterSpacing: "2px", marginTop: "4px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Token usage */}
      <TokenUsageBar usage={state.tokenUsage} />

      {/* Habit ring */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", border: "2px solid #fff", padding: "16px" }}>
        <HabitRing done={doneHabits} total={totalHabits} theme={theme} />
        <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "16px", color: "#fff", fontWeight: "bold" }}>[ TODAY&apos;S PROTOCOLS ]</div>
          <div style={{ fontSize: "26px", fontWeight: "bold" }}>{doneHabits} / {totalHabits}</div>
          <div style={{ fontSize: "14px", color: "#fff" }}>{totalHabits - doneHabits} remaining</div>
        </div>
      </div>

      {/* Daily goal */}
      {state.dailyGoal && (
        <div style={{ border: "2px solid #fff", padding: "16px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", marginBottom: "6px", fontWeight: "bold" }}>[ DAILY OBJECTIVE ]</div>
          <div style={{ fontSize: "17px", marginTop: "4px", lineHeight: "1.6" }}>
            {sanitizeForDisplay(state.dailyGoal ?? "", 200)}
          </div>
        </div>
      )}

      {/* Daily missions */}
      {state.dailyMissions && (
        <div style={{ border: "2px solid #fff", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff", letterSpacing: "2px", marginBottom: "12px", fontWeight: "bold" }}>
            DAILY MISSIONS
          </div>
          {state.dailyMissions.map((m) => (
            <div key={m.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 0", borderBottom: "2px solid #fff",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
              color: "#fff",
              textDecoration: m.done ? "line-through" : "none",
            }}>
              <span>{m.done ? "[ ✓ ]" : "[ _ ]"} {m.desc}</span>
              <span style={{ color: "#fff", fontWeight: "bold" }}>+{m.xp} XP</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick habits */}
      <div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff", letterSpacing: "2px", marginBottom: "12px", fontWeight: "bold" }}>
          QUICK PROTOCOLS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: "6px" }}>
          {state.habits.slice(0, 6).map((h) => {
            const done = todayLog.includes(h.id);
            return (
              <button
                key={h.id}
                onClick={(e) => !done && logHabit(h.id, e)}
                data-done={done ? "true" : undefined}
                style={{
                  padding: "14px 4px", border: done ? "3px solid #fff" : "2px solid #fff",
                  background: done ? "#fff" : "#000",
                  color: done ? "#000" : "#fff",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
                  minHeight: "64px", cursor: done ? "default" : "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: "4px",
                }}
              >
                <div style={{ fontSize: "22px" }}>{h.icon}</div>
                <div style={{ fontSize: "16px", marginTop: "4px", fontWeight: "bold" }}>{h.label.split(" ").slice(0, 2).join(" ")}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active timers */}
      {(state.activeTimers || []).filter((t) => typeof t.endsAt === "number" && t.endsAt > Date.now() + 1000).length > 0 && (
        <div style={{ border: "2px solid #fff", padding: "12px" }}>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff", letterSpacing: "2px", marginBottom: "12px", fontWeight: "bold" }}>
            ACTIVE TIMERS
          </div>
          {(state.activeTimers || []).filter((t) => typeof t.endsAt === "number" && t.endsAt > Date.now() + 1000).map((timer) => (
            <CountdownTimer
              key={timer.id}
              timer={timer}
              onExpire={() => {
                setState((s) => ({ ...s, activeTimers: s.activeTimers.filter((t) => t.id !== timer.id) }));
                const safeLabel = sanitizeForDisplay(timer.label ?? "", 200);
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
          <button type="button" key={c.label} onClick={c.action} style={{
            padding: "12px 18px", border: "2px solid #fff",
            background: "transparent", color: "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
            letterSpacing: "1px", cursor: "pointer", minHeight: "48px",
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
  if (typeof usage.date !== "string") return null;
  const DISPLAY_LIMIT = DAILY_TOKEN_LIMIT;
  const isToday = usage?.date === todayUTC();
  const tokens = isToday ? (usage?.tokens || 0) : 0;
  const pct = Math.min(100, (tokens / DISPLAY_LIMIT) * 100);
  const pctDisplay = pct < 0.1 ? "<0.1" : pct.toFixed(1);
  const barColor = "#fff";

  return (
    <div style={{ border: "2px solid #fff", padding: "12px 16px", fontFamily: "'Share Tech Mono', monospace" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", color: "#fff", marginBottom: "8px", fontWeight: "bold", letterSpacing: "1px" }}>
        <span>[ NEURAL ENERGY ]</span>
        <span>{pctDisplay}% / {(DISPLAY_LIMIT / 1000).toFixed(0)}k</span>
      </div>
      <div style={{ height: "8px", background: "#555" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor }} />
      </div>
      <div style={{ fontSize: "16px", color: "#fff", marginTop: "6px", fontFamily: "'Share Tech Mono', monospace" }}>
        {tokens.toLocaleString()} TOKENS · RESETS MIDNIGHT
      </div>
      {!isToday && (
        <div style={{ fontSize: "12px", color: "#fff", marginTop: "4px", fontWeight: "bold" }}>
          ↺ Budget reset for today
        </div>
      )}
    </div>
  );
}

function HabitRing({ done, total, theme }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const isLight = theme === "light";
  const trackColor  = isLight ? "#bbb" : "#555";
  const fillColor   = isLight ? "#000" : "#fff";
  const textColor   = isLight ? "#000" : "#fff";
  const bgFill      = isLight ? "#f0f0f0" : "#000";
  return (
    <svg width="80" height="80" style={{ flexShrink: 0 }}>
      <circle cx="40" cy="40" r={r} fill="none" stroke={trackColor} strokeWidth="6" />
      <circle cx="40" cy="40" r={r} fill="none" stroke={fillColor} strokeWidth="6"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="butt" transform="rotate(-90 40 40)"
      />
      <text x="40" y="46" textAnchor="middle" fill={textColor}
        style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "18px", fontWeight: "bold" }}>
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

   const mountedRef = useRef(true);
   const expiredRef = useRef(false);
   useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    expiredRef.current = false;
    if (timer.endsAt <= Date.now()) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        setTimeout(() => { if (mountedRef.current) onExpireRef.current(); }, 0);
      }
      return;
    }
    expiredRef.current = false;
    const iv = setInterval(() => {
      const r = Math.max(0, timer.endsAt - Date.now());
      if (mountedRef.current) setRemaining(r);
      if (r === 0 && !expiredRef.current) { expiredRef.current = true; clearInterval(iv); if (mountedRef.current) onExpireRef.current(); }
    }, 1000);
    return () => clearInterval(iv);
  }, [timer.id, timer.endsAt]); // id+endsAt avoid object-identity churn; onExpire via ref
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return (
    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", padding: "10px 0", display: "flex", justifyContent: "space-between", borderBottom: "2px solid #fff" }}>
      <span>{sanitizeForDisplay(timer.emoji ?? "", 2)} {sanitizeForDisplay(timer.label ?? "", 200)}</span>
      <span style={{ color: "#fff", fontWeight: "bold" }}>{mins}:{secs.toString().padStart(2, "0")}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HABITS TAB
