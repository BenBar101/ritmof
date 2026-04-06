import { useState, useEffect, useRef, useMemo } from "react";
import { useAppContext } from "./context/AppContext";
import { localDateFromUTC, nowHour, sanitizeForDisplay } from "./utils/db";

// ── HUD panel wrapper ──────────────────────────────────────────
// Primary panel: .system-frame (1px border). accent → chamfered corners only.
function HudPanel({ children, style = {}, accent = false }) {
  return (
    <div
      className={accent ? "system-frame system-frame--cut" : "system-frame"}
      style={{
        padding: "14px 16px",
        marginBottom: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────
// .system-header + .system-divider (sleek sans + thin rule + diamond).
function SectionLabel({ children }) {
  return (
    <div className="system-header" style={{ fontSize: "11px", marginBottom: "8px" }}>
      <span>{children}</span>
      <div className="system-divider" />
    </div>
  );
}

export default function HomeTab() {
  const { state, setState, rank, showBanner, setTab, profile, theme, setModal } = useAppContext();
  const activeTimers = useMemo(
    () => (state.activeTimers || []).filter(
      (t) => typeof t.endsAt === "number" && t.endsAt > Date.now() + 1000
    ),
    [state.activeTimers]
  );
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

  const pendingTasks = (state.tasks || [])
    .filter((t) => !t.done)
    .sort((a, b) => {
      // Timed tasks (with due date) come first, sorted closest → furthest.
      // Undated tasks follow in original order.
      if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });
  const totalAchievements = (state.achievements || []).length;

  const isLight = theme === "light";
  const textPrimary = isLight ? "#000" : "#fff";
  const textDim = isLight ? "#555" : "#888";
  const borderAccent = isLight ? "#000" : "#fff";
  const borderMid = isLight ? "#555" : "#888";

  // Inverted CTA: light theme → black fill / white frame / white text; dark → opposite.
  const logCtaBg = isLight ? "#000" : "#fff";
  const logCtaFrame = isLight ? "#fff" : "#000";
  const logCtaText = logCtaFrame;
  // Avoid #aaa/#555 in inline color (GlobalStyles light theme remaps those for contrast on gray UIs).
  const logCtaDim = isLight ? "#c9c9c9" : "#575757";
  const logCtaIconBg = isLight ? "#fff" : "#000";
  const logCtaIconFg = isLight ? "#000" : "#fff";

  return (
    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* ── IDENTITY PANEL ──────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${borderAccent}`,
        paddingBottom: "14px",
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
      </div>

      {/* ── EXAM WARNING ────────────────────────────────────── */}
      {upcomingExams.map((exam) => {
        const rawDiff = (new Date(exam.start) - Date.now()) / 86400000;
        const days = rawDiff <= 0 ? 0 : Math.ceil(rawDiff);
        if (rawDiff < -0.05) return null;
        const safeTitle = sanitizeForDisplay(exam.title ?? "", 200);
        return (
          <HudPanel key={exam.id} accent>
            <SectionLabel>⚠ EXAM WARNING</SectionLabel>
            <div style={{ fontSize: "15px", fontWeight: "700", color: textPrimary, letterSpacing: "0.02em" }}>
              {safeTitle}
            </div>
            <div style={{ fontSize: "12px", color: textDim, marginTop: "3px" }}>
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
          { label: "ACHIEVEMENTS", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} className="system-frame" style={{
            padding: "10px 6px", textAlign: "center",
            position: "relative",
            marginBottom: 0,
          }}>
            <div className="type-system" style={{ fontSize: "20px", fontWeight: "bold", color: textPrimary }}>{s.value}</div>
            <div style={{ fontSize: "9px", color: textDim, letterSpacing: "1.5px", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── LOG STUDY SESSION CTA ───────────────────────────── */}
      <button
        type="button"
        className="inverted-cta"
        onClick={() => setModal({ type: "session_log" })}
        style={{
          display: "flex", alignItems: "center", gap: "12px",
          border: `2px solid ${logCtaFrame}`,
          background: logCtaBg,
          padding: "12px 16px",
          cursor: "pointer",
          clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
          textAlign: "left", width: "100%",
        }}
      >
        <div
          className="type-system"
          style={{
            width: "36px", height: "36px", flexShrink: 0,
            border: `2px solid ${logCtaFrame}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "18px",
            background: logCtaIconBg,
            clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%)",
          }}
        >
          <span style={{ color: logCtaIconFg }}>▶</span>
        </div>
        <div>
          <div style={{ fontSize: "13px", fontWeight: "700", letterSpacing: "0.1em", color: logCtaText }}>
            LOG STUDY SESSION
          </div>
          <div style={{ fontSize: "11px", color: logCtaDim, marginTop: "2px", opacity: 0.9 }}>
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
                  border: `2px solid ${borderAccent}`,
                  background: isLight ? "#f0f0f0" : "#000", padding: "10px 12px",
                  cursor: "pointer", textAlign: "left", width: "100%",
                  clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
                }}
              >
                <div style={{
                  width: "8px", height: "8px", border: `1.5px solid ${borderAccent}`,
                  flexShrink: 0, background: "transparent",
                }} />
                <div style={{ fontSize: "13px", color: textPrimary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {sanitizeForDisplay(t.title ?? t.text ?? "", 80)}
                </div>
                {t.due && (() => {
                  const dl = Math.ceil((new Date(t.due) - Date.now()) / 86400000);
                  const label = dl < 0 ? "OVERDUE" : dl === 0 ? "TODAY" : dl === 1 ? "TMRW" : dl + "d";
                  const urgent = dl <= 0;
                  return (
                    <span className="status-badge" data-urgent={urgent ? "true" : undefined} style={{ flexShrink: 0 }}>
                      {label}
                    </span>
                  );
                })()}
                <div className="type-system" style={{ fontSize: "10px", color: textDim, flexShrink: 0 }}>›</div>
              </button>
            ))}
            {pendingTasks.length > 3 && (
              <button type="button" onClick={() => setTab("tasks")} style={{
                fontSize: "11px",
                color: textDim, letterSpacing: "0.12em", background: "none",
                border: "none", cursor: "pointer", textAlign: "left", padding: "4px 2px",
                fontWeight: 600,
              }}>
                +{pendingTasks.length - 3} MORE  →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── HABITS RING ─────────────────────────────────────── */}
      <div>
        <SectionLabel>TODAY&apos;S HABITS</SectionLabel>
        <HudPanel accent>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <HabitRing done={doneHabits} total={totalHabits} theme={theme} />
            <div>
              <div className="type-system" style={{ fontSize: "24px", fontWeight: "bold", color: textPrimary }}>{doneHabits} / {totalHabits}</div>
              <div style={{ fontSize: "11px", color: textDim, marginTop: "2px" }}>
                {totalHabits - doneHabits > 0 ? `${totalHabits - doneHabits} remaining` : "All complete ✓"}
              </div>
            </div>
            <button type="button" onClick={() => setTab("habits")} style={{
              marginLeft: "auto",
              fontSize: "11px", color: textDim, background: "none", border: "none",
              cursor: "pointer", letterSpacing: "0.1em", fontWeight: 600,
            }}>
              VIEW ALL ›
            </button>
          </div>
        </HudPanel>
      </div>

      {/* ── DAILY OBJECTIVE ─────────────────────────────────── */}
      {state.dailyGoal && (
        <HudPanel>
          <SectionLabel>DAILY OBJECTIVE</SectionLabel>
          <div style={{ fontSize: "13px", color: textPrimary, lineHeight: "1.65" }}>
            {sanitizeForDisplay(state.dailyGoal ?? "", 200)}
          </div>
        </HudPanel>
      )}

      {/* ── ACTIVE TIMERS ───────────────────────────────────── */}
      {activeTimers.length > 0 && (
        <div>
          <SectionLabel>ACTIVE TIMERS</SectionLabel>
          <HudPanel>
            {activeTimers.map((timer) => (
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
  return (
    <svg width="80" height="80" style={{ flexShrink: 0 }}>
      <circle cx="40" cy="40" r={r} fill="none" stroke={trackColor} strokeWidth="6" />
      <circle cx="40" cy="40" r={r} fill="none" stroke={fillColor} strokeWidth="6"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="butt" transform="rotate(-90 40 40)"
      />
      <text x="40" y="46" textAnchor="middle" fill={textColor}
        className="type-system"
        style={{ fontSize: "18px", fontWeight: "bold" }}
      >
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
    <div className="type-system" style={{ fontSize: "13px", padding: "9px 0", display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${borderMid}` }}>
      <span style={{ color: textPrimary }}>{sanitizeForDisplay(timer.emoji ?? "", 2)} {sanitizeForDisplay(timer.label ?? "", 200)}</span>
      <span style={{ color: textPrimary, fontWeight: "bold" }}>{mins}:{secs.toString().padStart(2, "0")}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HABITS TAB
