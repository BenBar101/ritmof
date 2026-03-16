import { useState, useEffect, useRef } from "react";
import { ACHIEVEMENT_RARITIES, SESSION_TYPES, FOCUS_LEVELS, STYLE_CSS } from "./constants";
import { calcSessionXP } from "./utils/xp";
import GeometricCorners from "./GeometricCorners";
import { primaryBtn, inputStyle } from "./Onboarding";
import { sanitizeForDisplay } from "./utils/db";

export function Modal({ children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "#000", display: "flex",
      alignItems: "center", justifyContent: "center", padding: "24px",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "100%", maxWidth: "400px", background: "#000", border: "3px solid #fff" }}>
        {children}
      </div>
    </div>
  );
}

export function DailyLoginModal({ data, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "32px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "12px", fontWeight: "bold" }}>[ DAILY LOGIN ]</div>
        <div style={{ fontSize: "48px", margin: "20px 0" }}>◈</div>
        <div style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "8px" }}>+{data.xp} XP</div>
        <div style={{ fontSize: "16px", color: "#fff", marginBottom: "20px", lineHeight: "1.5" }}>
          {data.streak > 1 ? `Streak: ${data.streak} days. Pattern recognized.` : "System online. Begin."}
        </div>
        {data.streak >= 7 && (
          <div style={{ border: "3px solid #fff", padding: "14px", marginBottom: "20px", fontSize: "15px", color: "#fff", fontWeight: "bold" }}>
            7-DAY STREAK BONUS ACTIVE · +50% HABIT XP
          </div>
        )}
        <button type="button" onClick={onClose} style={primaryBtn}>PROCEED</button>
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
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "20px", fontWeight: "bold" }}>[ SLEEP ANALYSIS ]</div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "15px", color: "#fff", marginBottom: "10px", fontWeight: "bold" }}>HOURS SLEPT</div>
          <input type="range" min={3} max={12} value={hours} onChange={(e) => setHours(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "28px", marginTop: "8px", fontWeight: "bold" }}>{hours}h</div>
        </div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "15px", color: "#fff", marginBottom: "10px", fontWeight: "bold" }}>QUALITY (1-5)</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[1,2,3,4,5].map((q) => (
              <button
                type="button"
                key={q}
                onClick={() => setQuality(q)}
                style={{
                flex: 1, padding: "12px 8px", border: "2px solid #fff",
                background: quality >= q ? "#fff" : "transparent", color: quality >= q ? "#000" : "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", fontWeight: "bold",
                minHeight: "48px",
              }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "15px", color: "#fff", marginBottom: "10px", fontWeight: "bold" }}>FELT RESTED?</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {[true, false].map((v) => (
              <button
                type="button"
                key={String(v)}
                onClick={() => setRested(v)}
                style={{
                flex: 1, padding: "14px 8px", border: "2px solid #fff",
                background: rested === v ? "#fff" : "transparent", color: rested === v ? "#000" : "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", fontWeight: "bold",
                minHeight: "48px",
              }}
              >
                {v ? "YES" : "NO"}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => onSubmit({ hours, quality, rested })} style={primaryBtn}>LOG SLEEP</button>
      </div>
    </Modal>
  );
}

export function ScreenTimeModal({ period, onClose, onSubmit }) {
  const [mins, setMins] = useState(90);
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "8px", fontWeight: "bold" }}>[ SCREEN TIME LOG ]</div>
        <div style={{ fontSize: "15px", color: "#fff", marginBottom: "24px", lineHeight: "1.5" }}>
          {period === "afternoon" ? "Morning session complete. Report usage." : "Evening check-in. How much time on your phone?"}
        </div>
        <input type="range" min={0} max={480} step={15} value={mins} onChange={(e) => setMins(+e.target.value)}
          style={{ width: "100%", accentColor: "#fff" }} />
        <div style={{ textAlign: "center", fontSize: "32px", margin: "16px 0", fontWeight: "bold" }}>
          {Math.floor(mins / 60)}h {mins % 60}m
        </div>
        <div style={{ textAlign: "center", fontSize: "15px", color: "#fff", marginBottom: "24px", lineHeight: "1.5" }}>
          {mins < 60 ? "Exemplary. Reward incoming." : mins < 120 ? "Acceptable." : mins < 240 ? "Above target. Noted." : "Hunter. This is a problem."}
        </div>
        <button type="button" onClick={() => onSubmit(mins)} style={primaryBtn}>REPORT HONESTLY</button>
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
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "20px", fontWeight: "bold" }}>[ LOG STUDY SESSION ]</div>

        {/* Session type */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px", marginBottom: "16px" }}>
          {SESSION_TYPES.map((st) => (
            <button type="button" key={st.id} onClick={() => setType(st.id)} style={{
              padding: "12px 4px", border: "2px solid #fff",
              background: type === st.id ? "#fff" : "transparent",
              color: type === st.id ? "#000" : "#fff",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "1px",
              fontWeight: "bold", minHeight: "48px",
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
          <div style={{ fontSize: "14px", color: "#fff", marginBottom: "8px", fontWeight: "bold" }}>DURATION</div>
          <input type="range" min={15} max={300} step={15} value={duration} onChange={(e) => setDuration(+e.target.value)}
            style={{ width: "100%", accentColor: "#fff" }} />
          <div style={{ textAlign: "center", fontSize: "16px", marginTop: "4px" }}>
            {Math.floor(duration / 60)}h {duration % 60}m
          </div>
        </div>

        {/* Focus */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", color: "#fff", marginBottom: "10px", fontWeight: "bold" }}>FOCUS LEVEL</div>
          <div style={{ display: "flex", gap: "4px" }}>
            {FOCUS_LEVELS.map((f) => (
              <button type="button" key={f.id} onClick={() => setFocus(f.id)} style={{
                flex: 1, padding: "12px 8px",
                border: "2px solid #fff",
                background: focus === f.id ? "#fff" : "transparent",
                color: focus === f.id ? "#000" : "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "14px",
              }}>
                {f.label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)..."
          rows={2} maxLength={300} style={{ ...inputStyle(sStyle), marginBottom: "12px" }} />

        <div style={{ textAlign: "center", fontSize: "28px", fontWeight: "bold", marginBottom: "12px", fontFamily: "'Share Tech Mono', monospace", letterSpacing: "2px" }}>
          +{xpPreview} XP
        </div>

        <button type="button" onClick={() => onSubmit({ type, course, duration, focus, notes })} style={primaryBtn}>
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
    }}>
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "4px", marginBottom: "20px", fontWeight: "bold" }}>[ SYSTEM ALERT ]</div>
      <div style={{ fontSize: "32px", color: "#fff", letterSpacing: "3px", marginBottom: "12px", fontWeight: "bold" }}>[ LEVEL UP ]</div>
      <div style={{ fontSize: "clamp(40px, 15vw, 64px)", fontWeight: "bold", margin: "16px 0" }}>{data.level}</div>
      <div style={{ fontSize: "24px", color: "#fff", marginBottom: "8px" }}>{data.rank.decor}</div>
      <div style={{ fontSize: "18px", letterSpacing: "4px", marginBottom: "32px" }}>{data.rank.title.toUpperCase()}</div>
      <div style={{ fontSize: "clamp(28px, 10vw, 40px)", letterSpacing: "8px", marginBottom: "36px", color: "#fff" }}>
        {data.rank.badge}
      </div>
      <button type="button" onClick={onClose} style={{ ...primaryBtn, width: "200px" }}>CONTINUE</button>
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
      position: "fixed", bottom: "80px", right: "16px", zIndex: 900,
      width: "300px", background: "#000", border: "3px solid #fff",
      padding: "12px", fontFamily: "'Share Tech Mono', monospace",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "24px" }}>{sanitizeForDisplay(String(toast.icon ?? ''), 4)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", color: "#fff", letterSpacing: "2px", fontWeight: "bold", fontFamily: "'Share Tech Mono', monospace" }}>
            {toast.isAchievement ? "ACHIEVEMENT UNLOCKED" : "REWARD"} · {r.label}
          </div>
          <div style={{ fontSize: "18px", marginTop: "4px", fontWeight: "bold", fontFamily: "'Share Tech Mono', monospace" }}>{sanitizeForDisplay(String(toast.title ?? ''), 300)}</div>
          <div style={{ fontSize: "16px", color: "#fff", marginTop: "4px", lineHeight: "1.6", fontFamily: "'Share Tech Mono', monospace" }}>{sanitizeForDisplay(String(toast.desc ?? ''), 300)}</div>
          {toast.xp && <div style={{ fontSize: "16px", color: "#fff", marginTop: "4px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>+{toast.xp} XP</div>}
        </div>
        <button type="button" onClick={onClose} style={{ color: "#fff", fontSize: "22px", background: "none", border: "none", minHeight: "48px", minWidth: "48px" }}>×</button>
      </div>
      <div style={{ marginTop: "8px", height: "6px", background: "#555" }}>
        <div style={{ width: `${width}%`, height: "100%", background: "#fff" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DECORATIVE HELPERS
// ═══════════════════════════════════════════════════════════════
