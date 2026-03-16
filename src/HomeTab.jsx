import { useState, useEffect, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { localDateFromUTC, nowHour, sanitizeForDisplay } from "./utils/storage";

// ── HUD panel wrapper ──────────────────────────────────────────
// Gives every card a Solo Leveling–style chamfered corner with a
// subtle notch cut from the top-right, matching the manhwa aesthetic.
function HudPanel({ children, style = {}, accent = false }) {
  const clipPath = "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)";
  return (
    <div style={{
      position: "relative",
      border: accent ? "2px solid #fff" : "1.5px solid rgba(255,255,255,0.55)",
      background: "var(--hud-bg, rgba(0,0,0,0.85))",
      clipPath,
      padding: "14px 16px",
      ...style,
    }}>
      {/* chamfer accent line */}
      <div style={{
        position: "absolute", top: 0, right: 0, width: "10px", height: "10px",
        borderBottom: accent ? "2px solid #fff" : "1.5px solid rgba(255,255,255,0.55)",
        borderLeft: accent ? "2px solid #fff" : "1.5px solid rgba(255,255,255,0.55)",
        background: "transparent",
        pointerEvents: "none",
      }} />
      {children}
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: "'Share Tech Mono', monospace",
      fontSize: "10px",
      letterSpacing: "3px",
      color: "rgba(255,255,255,0.5)",
      textTransform: "uppercase",
      marginBottom: "6px",
      paddingLeft: "2px",
    }}>
      {children}
    </div>
  );
}

export default function HomeTab() {
  const { state, setState, rank, dailyQuote, logHabit, showBanner, setTab, profile, theme, setModal } = useAppContext();
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

  const pendingTasks = (state.tasks || []).filter((t) => !t.done);
  const totalAchievements = (state.achievements || []).length;

  const isLight = theme === "light";
  const hudBg = isLight ? "rgba(240,240,240,0.9)" : "rgba(0,0,0,0.85)";
  const textPrimary = isLight ? "#000" : "#fff";
  const textDim = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";
  const borderAccent = isLight ? "#000" : "#fff";
  const borderMid = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";

  // inject CSS variable for HudPanel
  const hudStyle = { "--hud-bg": hudBg } ;

  return (
    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px", ...hudStyle }}>

      {/* ── IDENTITY PANEL ──────────────────────────────────── */}
      <div style={{
        borderBottom: `2px solid ${borderAccent}`,
        paddingBottom: "14px",
        fontFamily: "'Share Tech Mono', monospace",
      }}>
        <div style={{ fontSize: "10px", letterSpacing: "3px", color: textDim, marginBottom: "4px" }}>
          {greeting}
        </div>
        <div style={{ fontSize: "clamp(22px, 7vw, 32px)", fontWeight: "bold", letterSpacing: "2px", color: textPrimary }}>
          {profile?.name || "Hunter"}
        </div>
        <div style={{ fontSize: "14px", fontWeight: "bold", letterSpacing: "2px", color: textPrimary, marginTop: "2px" }}>
          {rank.badge} {rank.decor} {rank.title}
        </div>

        {/* Quote inline under rank — no separate panel */}
        {dailyQuote && (
          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${borderMid}` }}>
            <div style={{
              fontFamily: "'IM Fell English', serif",
              fontSize: "14px", fontStyle: "italic",
              color: textDim, lineHeight: "1.6",
            }}>
              &ldquo;{sanitizeForDisplay(dailyQuote.quote ?? "", 300)}&rdquo;
              <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", marginLeft: "8px", fontStyle: "normal" }}>
                — {sanitizeForDisplay(dailyQuote.author ?? "", 60)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── EXAM WARNING ────────────────────────────────────── */}
      {upcomingExams.map((exam) => {
        const rawDiff = (new Date(exam.start) - Date.now()) / 86400000;
        const days = rawDiff <= 0 ? 0 : Math.ceil(rawDiff);
        if (rawDiff < -0.05) return null;
        const safeTitle = sanitizeForDisplay(exam.title ?? "", 200);
        return (
          <HudPanel key={exam.id} accent style={{ "--hud-bg": hudBg }}>
            <SectionLabel>⚠ EXAM WARNING</SectionLabel>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "15px", fontWeight: "bold", color: textPrimary }}>
              {safeTitle}
            </div>
            <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: textDim, marginTop: "3px" }}>
              T-{days} days · Prepare accordingly
            </div>
          </HudPanel>
        );
      })}

      {/* ── STATS ROW ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
        {[
          { label: "HABITS", value: `${doneHabits}/${totalHabits}` },
          { label: "TASKS", value: pendingTasks.length },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "ACHIEV", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} style={{
            border: `1.5px solid ${borderMid}`,
            padding: "10px 6px", textAlign: "center",
            fontFamily: "'Share Tech Mono', monospace",
            clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
            background: hudBg,
            position: "relative",
          }}>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: textPrimary }}>{s.value}</div>
            <div style={{ fontSize: "9px", color: textDim, letterSpacing: "1.5px", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── LOG STUDY SESSION CTA ───────────────────────────── */}
      <button
        type="button"
        onClick={() => setModal({ type: "session_log" })}
        style={{
          display: "flex", alignItems: "center", gap: "12px",
          border: `1.5px solid ${borderMid}`,
          background: hudBg,
          padding: "12px 16px",
          cursor: "pointer",
          clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
          textAlign: "left", width: "100%",
        }}
      >
        <div style={{
          width: "36px", height: "36px", flexShrink: 0,
          border: `1.5px solid ${borderAccent}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "18px",
          color: textPrimary, background: isLight ? "#000" : "#fff",
          clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
        }}>
          <span style={{ color: isLight ? "#fff" : "#000" }}>▶</span>
        </div>
        <div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", fontWeight: "bold", letterSpacing: "1.5px", color: textPrimary }}>
            LOG STUDY SESSION
          </div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: textDim, marginTop: "2px" }}>
            Lecture · Tirgul · Homework · Prep → earn XP
          </div>
        </div>
      </button>

      {/* ── OPEN TASKS (up to 3) ────────────────────────────── */}
      {pendingTasks.length > 0 && (
        <div>
          <SectionLabel>OPEN TASKS</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {pendingTasks.slice(0, 3).map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTab("tasks")}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  border: `1.5px solid ${borderMid}`,
                  background: hudBg, padding: "10px 12px",
                  cursor: "pointer", textAlign: "left", width: "100%",
                  clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
                }}
              >
                <div style={{
                  width: "8px", height: "8px", border: `1.5px solid ${borderAccent}`,
                  flexShrink: 0, background: "transparent",
                }} />
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", color: textPrimary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sanitizeForDisplay(t.title ?? t.text ?? "", 80)}
                </div>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: textDim, flexShrink: 0 }}>›</div>
              </button>
            ))}
            {pendingTasks.length > 3 && (
              <button type="button" onClick={() => setTab("tasks")} style={{
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
                color: textDim, letterSpacing: "2px", background: "none",
                border: "none", cursor: "pointer", textAlign: "left", padding: "4px 2px",
              }}>
                +{pendingTasks.length - 3} MORE  →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── DAILY MISSIONS ──────────────────────────────────── */}
      {state.dailyMissions && (
        <div>
          <SectionLabel>DAILY MISSIONS</SectionLabel>
          <HudPanel style={{ padding: "10px 14px", "--hud-bg": hudBg }}>
            {state.dailyMissions.map((m, i) => (
              <div key={m.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 0",
                borderBottom: i < state.dailyMissions.length - 1 ? `1px solid ${borderMid}` : "none",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
                color: m.done ? textDim : textPrimary,
                textDecoration: m.done ? "line-through" : "none",
              }}>
                <span>
                  <span style={{ marginRight: "8px", fontSize: "10px" }}>{m.done ? "✓" : "○"}</span>
                  {m.desc}
                </span>
                <span style={{ color: m.done ? textDim : textPrimary, fontWeight: "bold", marginLeft: "12px", flexShrink: 0 }}>+{m.xp}</span>
              </div>
            ))}
          </HudPanel>
        </div>
      )}

      {/* ── HABITS RING ─────────────────────────────────────── */}
      <div>
        <SectionLabel>TODAY&apos;S HABITS</SectionLabel>
        <HudPanel accent style={{ "--hud-bg": hudBg }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <HabitRing done={doneHabits} total={totalHabits} theme={theme} />
            <div style={{ fontFamily: "'Share Tech Mono', monospace" }}>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: textPrimary }}>{doneHabits} / {totalHabits}</div>
              <div style={{ fontSize: "11px", color: textDim, marginTop: "2px" }}>
                {totalHabits - doneHabits > 0 ? `${totalHabits - doneHabits} remaining` : "All complete ✓"}
              </div>
            </div>
            <button type="button" onClick={() => setTab("habits")} style={{
              marginLeft: "auto", fontFamily: "'Share Tech Mono', monospace",
              fontSize: "11px", color: textDim, background: "none", border: "none",
              cursor: "pointer", letterSpacing: "1px",
            }}>
              VIEW ALL ›
            </button>
          </div>
        </HudPanel>
      </div>

      {/* ── DAILY OBJECTIVE ─────────────────────────────────── */}
      {state.dailyGoal && (
        <HudPanel style={{ "--hud-bg": hudBg }}>
          <SectionLabel>DAILY OBJECTIVE</SectionLabel>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", color: textPrimary, lineHeight: "1.6" }}>
            {sanitizeForDisplay(state.dailyGoal ?? "", 200)}
          </div>
        </HudPanel>
      )}

      {/* ── ACTIVE TIMERS ───────────────────────────────────── */}
      {(state.activeTimers || []).filter((t) => typeof t.endsAt === "number" && t.endsAt > Date.now() + 1000).length > 0 && (
        <div>
          <SectionLabel>ACTIVE TIMERS</SectionLabel>
          <HudPanel style={{ "--hud-bg": hudBg }}>
            {(state.activeTimers || []).filter((t) => typeof t.endsAt === "number" && t.endsAt > Date.now() + 1000).map((timer) => (
              <CountdownTimer
                key={timer.id}
                timer={timer}
                textPrimary={textPrimary}
                borderMid={borderMid}
                onExpire={() => {
                  setState((s) => ({ ...s, activeTimers: s.activeTimers.filter((t) => t.id !== timer.id) }));
                  const safeLabel = sanitizeForDisplay(timer.label ?? "", 200);
                  showBanner(`Timer complete: ${safeLabel}`, "success");
                }}
              />
            ))}
          </HudPanel>
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

function CountdownTimer({ timer, onExpire, textPrimary = "#fff", borderMid = "rgba(255,255,255,0.55)" }) {
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
    <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", padding: "9px 0", display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${borderMid}` }}>
      <span style={{ color: textPrimary }}>{sanitizeForDisplay(timer.emoji ?? "", 2)} {sanitizeForDisplay(timer.label ?? "", 200)}</span>
      <span style={{ color: textPrimary, fontWeight: "bold" }}>{mins}:{secs.toString().padStart(2, "0")}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HABITS TAB
