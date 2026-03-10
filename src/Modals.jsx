import { useState, useEffect, useRef } from "react";
import { ACHIEVEMENT_RARITIES, SESSION_TYPES, FOCUS_LEVELS, STYLE_CSS } from "./constants";
import { calcSessionXP } from "./utils/xp";
import GeometricCorners from "./GeometricCorners";
import { primaryBtn, inputStyle } from "./Onboarding";

export function Modal({ children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.92)", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "100%", maxWidth: "380px", background: "#0a0a0a", border: "1px solid #333" }}>
        {children}
      </div>
    </div>
  );
}

export function DailyLoginModal({ data, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "32px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "8px" }}>DAILY LOGIN</div>
        <div style={{ fontSize: "36px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "4px" }}>+{data.xp} XP</div>
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "16px" }}>
          {data.streak > 1 ? `Streak: ${data.streak} days. Pattern recognized.` : "System online. Begin."}
        </div>
        {data.streak >= 7 && (
          <div style={{ border: "1px solid #888", padding: "8px", marginBottom: "16px", fontSize: "11px", color: "#aaa" }}>
            7-DAY STREAK BONUS ACTIVE · +50% HABIT XP
          </div>
        )}
        <button onClick={onClose} style={primaryBtn}>PROCEED</button>
      </div>
    </Modal>
  );
}

export function SleepCheckinModal({ onClose, onSubmit }) {
  const [hours, setHours] = useState(7);
  const [quality, setQuality] = useState(3);
  const [rested, setRested] = useState(true);

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "16px" }}>SLEEP ANALYSIS</div>
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>HOURS SLEPT</div>
          <input type="range" min={3} max={12} value={hours} onChange={(e) => setHours(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "20px", marginTop: "4px" }}>{hours}h</div>
        </div>
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>QUALITY (1-5)</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[1,2,3,4,5].map((q) => (
              <button key={q} onClick={() => setQuality(q)} style={{
                flex: 1, padding: "8px", border: `1px solid ${quality >= q ? "#fff" : "#333"}`,
                background: quality >= q ? "#fff" : "transparent", color: quality >= q ? "#000" : "#555",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
              }}>{q}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px" }}>FELT RESTED?</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[true, false].map((v) => (
              <button key={String(v)} onClick={() => setRested(v)} style={{
                flex: 1, padding: "8px", border: `1px solid ${rested === v ? "#fff" : "#333"}`,
                background: rested === v ? "#fff" : "transparent", color: rested === v ? "#000" : "#555",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
              }}>{v ? "YES" : "NO"}</button>
            ))}
          </div>
        </div>
        <button onClick={() => onSubmit({ hours, quality, rested })} style={primaryBtn}>LOG SLEEP</button>
      </div>
    </Modal>
  );
}

export function ScreenTimeModal({ period, onClose, onSubmit }) {
  const [mins, setMins] = useState(90);
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "4px" }}>SCREEN TIME LOG</div>
        <div style={{ fontSize: "11px", color: "#666", marginBottom: "20px" }}>
          {period === "afternoon" ? "Morning session complete. Report usage." : "Evening check-in. How much time on your phone?"}
        </div>
        <input type="range" min={0} max={480} step={15} value={mins} onChange={(e) => setMins(+e.target.value)}
          style={{ width: "100%", accentColor: "#fff" }} />
        <div style={{ textAlign: "center", fontSize: "24px", margin: "12px 0", fontWeight: "bold" }}>
          {Math.floor(mins / 60)}h {mins % 60}m
        </div>
        <div style={{ textAlign: "center", fontSize: "10px", color: "#444", marginBottom: "20px" }}>
          {mins < 60 ? "Exemplary. Reward incoming." : mins < 120 ? "Acceptable." : mins < 240 ? "Above target. Noted." : "Hunter. This is a problem."}
        </div>
        <button onClick={() => onSubmit(mins)} style={primaryBtn}>REPORT HONESTLY</button>
      </div>
    </Modal>
  );
}

export function SessionLogModal({ onClose, onSubmit, state }) {
  const [type, setType] = useState("lecture");
  const [course, setCourse] = useState("");
  const [duration, setDuration] = useState(60);
  const [focus, setFocus] = useState("medium");
  const [notes, setNotes] = useState("");

  const sessionType = SESSION_TYPES.find((s) => s.id === type) || SESSION_TYPES[0];
  const xpPreview = calcSessionXP(type, duration, focus, state.streak || 0);
  const sStyle = STYLE_CSS[sessionType.style] || STYLE_CSS.ascii;

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace", background: sStyle.background }}>
        <GeometricCorners style={sessionType.style} />
        <div style={{ fontSize: "10px", color: "#555", letterSpacing: "3px", marginBottom: "16px" }}>LOG STUDY SESSION</div>

        {/* Session type */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px", marginBottom: "16px" }}>
          {SESSION_TYPES.map((st) => (
            <button key={st.id} onClick={() => setType(st.id)} style={{
              padding: "8px 4px", border: `1px solid ${type === st.id ? "#fff" : "#333"}`,
              background: type === st.id ? "#fff" : "transparent",
              color: type === st.id ? "#000" : "#666",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", letterSpacing: "1px",
            }}>
              <div style={{ fontSize: "14px" }}>{st.icon}</div>
              <div style={{ marginTop: "2px" }}>{st.label.toUpperCase()}</div>
            </button>
          ))}
        </div>

        <input
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          placeholder="Course / subject..."
          maxLength={100}
          style={{ ...inputStyle(sStyle), marginBottom: "12px" }}
        />

        {/* Duration */}
        <div style={{ marginBottom: "12px" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px" }}>DURATION</div>
          <input type="range" min={15} max={300} step={15} value={duration} onChange={(e) => setDuration(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "16px", marginTop: "4px" }}>
            {Math.floor(duration / 60)}h {duration % 60}m
          </div>
        </div>

        {/* Focus */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10px", color: "#555", marginBottom: "6px" }}>FOCUS LEVEL</div>
          <div style={{ display: "flex", gap: "4px" }}>
            {FOCUS_LEVELS.map((f) => (
              <button key={f.id} onClick={() => setFocus(f.id)} style={{
                flex: 1, padding: "8px",
                border: `1px solid ${focus === f.id ? "#fff" : "#333"}`,
                background: focus === f.id ? "#fff" : "transparent",
                color: focus === f.id ? "#000" : "#666",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
              }}>
                {f.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)..."
          rows={2} maxLength={300} style={{ ...inputStyle(sStyle), marginBottom: "12px" }} />

        <div style={{ textAlign: "center", fontSize: "20px", fontWeight: "bold", marginBottom: "12px" }}>
          +{xpPreview} XP
        </div>

        <button onClick={() => onSubmit({ type, course, duration, focus, notes })} style={primaryBtn}>
          LOG SESSION
        </button>
      </div>
    </Modal>
  );
}

export function LevelUpModal({ data, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "#000", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Share Tech Mono', monospace",
      animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ fontSize: "11px", color: "#444", letterSpacing: "4px", marginBottom: "16px" }}>SYSTEM ALERT</div>
      <div style={{ fontSize: "16px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>LEVEL UP</div>
      <div style={{ fontSize: "64px", fontWeight: "bold", margin: "16px 0" }}>{data.level}</div>
      <div style={{ fontSize: "24px", color: "#aaa", marginBottom: "8px" }}>{data.rank.decor}</div>
      <div style={{ fontSize: "18px", letterSpacing: "4px", marginBottom: "32px" }}>{data.rank.title.toUpperCase()}</div>
      <div style={{ fontSize: "32px", letterSpacing: "8px", marginBottom: "32px", color: "#555" }}>
        {data.rank.badge}
      </div>
      <button onClick={onClose} style={{ ...primaryBtn, width: "200px" }}>CONTINUE</button>
    </div>
  );
}

export function AchievementToast({ toast, onClose }) {
  const [width, setWidth] = useState(100);
  const r = ACHIEVEMENT_RARITIES[toast.rarity] || ACHIEVEMENT_RARITIES.common;
  // Keep onClose in a ref so the effect never re-runs just because the parent
  // passed a new inline function reference — that would reset the countdown timer.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => {
      const pct = Math.max(0, 100 - ((Date.now() - start) / 5000) * 100);
      setWidth(pct);
      if (pct === 0) { clearInterval(iv); onCloseRef.current(); }
    }, 50);
    return () => clearInterval(iv);
  }, []); // intentionally empty — runs once per mount

  return (
    <div style={{
      position: "fixed", bottom: "70px", left: "12px", right: "12px", zIndex: 900,
      border: `2px solid ${r.glow}`, background: "#0a0a0a",
      padding: "12px", fontFamily: "'Share Tech Mono', monospace",
      animation: "slideUp 0.3s ease",
      boxShadow: `0 0 20px ${r.glow}22`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "24px" }}>{toast.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "9px", color: r.glow, letterSpacing: "2px" }}>
            {toast.isAchievement ? "ACHIEVEMENT UNLOCKED" : "REWARD"} · {r.label}
          </div>
          <div style={{ fontSize: "13px", marginTop: "2px" }}>{toast.title}</div>
          <div style={{ fontSize: "11px", color: "#666", marginTop: "1px" }}>{toast.desc}</div>
          {toast.xp && <div style={{ fontSize: "11px", color: "#aaa", marginTop: "2px" }}>+{toast.xp} XP</div>}
        </div>
        <button onClick={onClose} style={{ color: "#444", fontSize: "16px", background: "none", border: "none" }}>×</button>
      </div>
      <div style={{ marginTop: "8px", height: "2px", background: "#1a1a1a" }}>
        <div style={{ width: `${width}%`, height: "100%", background: r.glow, transition: "width 0.1s linear" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DECORATIVE HELPERS
// ═══════════════════════════════════════════════════════════════
