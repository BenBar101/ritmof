import { useState, useEffect, useRef, useMemo } from "react";
import { useAppContext } from "./context/AppContext";
import { localDateFromUTC, nowHour, sanitizeForDisplay } from "./utils/db";

// ── HUD panel wrapper ──────────────────────────────────────────
// Full 8-corner notch per design.md spec.
// The .system-frame class (injected by GlobalStyles Task 1) provides:
//   - 2px solid border
//   - the ::after inner ring (1px solid, inset 4px)
//   - clip-path with 10px notches on all 8 corners
// The accent prop widens the border to match the emphasis variant.
function HudPanel({ children, style = {}, accent = false }) {
  return (
    <div
      className="system-frame"
      style={{
        padding: "14px 16px",
        marginBottom: 0,
        ...(accent ? { border: "2px solid #fff" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────
// Renders as a .system-header row with a .system-divider line and terminal diamond.
function SectionLabel({ children }) {
  return (
    <div className="system-header" style={{ fontSize: "11px", marginBottom: "8px" }}>
      <span>{children}</span>
      <div className="system-divider" />
    </div>
  );
}

// ── Missions Panel (Daily / Weekly / Monthly tabs) ────────────
function MissionsPanel({ state, setState, textPrimary, textDim, borderMid, borderAccent }) {
  const [activeTab, setActiveTab] = useState("daily");

  const tabs = [
    { id: "daily",   label: "DAILY" },
    { id: "weekly",  label: "WEEKLY" },
    { id: "monthly", label: "MONTHLY" },
  ];

  // Determine mission list for active tab
  // null = still generating, [] = failed/empty, [...] = loaded
  const missionMap = {
    daily:   state.dailyMissions   ?? [],
    weekly:  state.weeklyMissions,   // may be null
    monthly: state.monthlyMissions,  // may be null
  };
  const missions = missionMap[activeTab] ?? [];
  const isGenerating = activeTab !== "daily" && missionMap[activeTab] === null;

  // Count done missions per tab for badge
  const countDone = (list) => (list || []).filter((m) => m.done).length;

  // Toggle mission done state (for weekly/monthly — daily is auto-tracked by game engine)
  function toggleMission(id) {
    const key = activeTab === "weekly" ? "weeklyMissions" : "monthlyMissions";
    setState((s) => ({
      ...s,
      [key]: (s[key] || []).map((m) =>
        m.id === id ? { ...m, done: !m.done } : m
      ),
    }));
  }

  return (
    <div>
      {/* Tab selector */}
      <div style={{ display: "flex", gap: "0", marginBottom: "0", borderBottom: `2px solid ${borderAccent}` }}>
        {tabs.map((t) => {
          const list = missionMap[t.id] || [];
          const done = countDone(list);
          const total = list.length;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
                letterSpacing: "1px", padding: "8px 4px",
                background: isActive ? textPrimary : "transparent",
                color: isActive ? (textPrimary === "#fff" ? "#000" : "#fff") : textDim,
                border: "none", borderBottom: isActive ? `2px solid ${textPrimary}` : "2px solid transparent",
                cursor: "pointer", fontWeight: isActive ? "bold" : "normal",
                marginBottom: "-2px",
              }}
            >
              {t.label}
              {total > 0 && (
                <span style={{ marginLeft: "4px", fontSize: "10px", opacity: 0.7 }}>
                  {done}/{total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <HudPanel style={{ padding: "10px 14px" }}>
        {isGenerating && (
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: textDim, padding: "8px 0", textAlign: "center" }}>
            ◈ RITMOL IS GENERATING {activeTab.toUpperCase()} MISSIONS...
          </div>
        )}

        {!isGenerating && missions.length === 0 && (
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: textDim, padding: "8px 0", textAlign: "center" }}>
            No {activeTab} missions yet. Check back soon.
          </div>
        )}

        {missions.map((m, i) => (
          <div
            key={m.id}
            onClick={() => activeTab !== "daily" && toggleMission(m.id)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0",
              borderBottom: i < missions.length - 1 ? `1px solid ${borderMid}` : "none",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
              color: m.done ? textDim : textPrimary,
              textDecoration: m.done ? "line-through" : "none",
              cursor: activeTab !== "daily" ? "pointer" : "default",
            }}
          >
            <span style={{ flex: 1, paddingRight: "8px" }}>
              <span style={{ marginRight: "8px", fontSize: "10px" }}>{m.done ? "✓" : "○"}</span>
              {m.desc}
              {m.ai && (
                <span style={{ marginLeft: "6px", fontSize: "9px", color: textDim, letterSpacing: "1px" }}>AI</span>
              )}
            </span>
            <span style={{ color: m.done ? textDim : textPrimary, fontWeight: "bold", flexShrink: 0 }}>
              +{m.xp}
            </span>
          </div>
        ))}
      </HudPanel>
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

  return (
    <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>

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
          { label: "ACHIEVEMENTS", value: totalAchievements },
        ].map((s) => (
          <div key={s.label} className="system-frame" style={{
            padding: "10px 6px", textAlign: "center",
            fontFamily: "'Share Tech Mono', monospace",
            position: "relative",
            marginBottom: 0,
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
          border: `2px solid ${borderAccent}`,
          background: isLight ? "#f0f0f0" : "#000",
          padding: "12px 16px",
          cursor: "pointer",
          clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
          textAlign: "left", width: "100%",
        }}
      >
        <div style={{
          width: "36px", height: "36px", flexShrink: 0,
          border: `2px solid ${borderAccent}`,
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
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", color: textPrimary, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

      {/* ── MISSIONS (Daily / Weekly / Monthly) ─────────────── */}
      <MissionsPanel
        state={state}
        setState={setState}
        textPrimary={textPrimary}
        textDim={textDim}
        borderMid={borderMid}
        borderAccent={borderAccent}
      />

      {/* ── HABITS RING ─────────────────────────────────────── */}
      <div>
        <SectionLabel>TODAY&apos;S HABITS</SectionLabel>
        <HudPanel accent>
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
        <HudPanel>
          <SectionLabel>DAILY OBJECTIVE</SectionLabel>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", color: textPrimary, lineHeight: "1.6" }}>
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
