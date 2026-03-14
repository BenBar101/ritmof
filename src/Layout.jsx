import { APP_ICON_URL } from "./utils/storage";
import { getLevelProgress } from "./utils/xp";

// ═══════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
export function TopBar({ xp, xpPerLevel, level, rank, streak, profile, syncStatus, lastSynced, onPush, onPull, syncFileConnected }) {
  const progress = getLevelProgress(xp, xpPerLevel);
  const pct = xpPerLevel > 0
    ? Math.min(100, Math.max(0, (progress / xpPerLevel) * 100))
    : 0;

  const syncColor = syncStatus === "error" ? "#888" : syncStatus === "synced" ? "#aaa" : "#555";
  const syncTitle = lastSynced ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}` : "Not synced yet";

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200,
      background: "#0a0a0a", borderBottom: "1px solid #222",
      padding: "8px 16px", height: "56px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <img src={APP_ICON_URL} alt="" style={{ width: 28, height: 28, display: "block" }} />
        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "3px", color: "#fff" }}>
          RITMOL
        </span>
        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555" }}>
          {rank.decor}
        </span>
      </div>

      <div style={{ flex: 1, margin: "0 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#666", marginBottom: "2px", fontFamily: "'Share Tech Mono', monospace" }}>
          <span>LV.{level} {rank.title}</span>
          <span>{getLevelProgress(xp, xpPerLevel)}/{xpPerLevel}</span>
        </div>
        <div style={{ height: "3px", background: "#1a1a1a", position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "#fff", transition: "width 0.5s" }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {syncFileConnected && (
          <>
            <button
              type="button"
              onClick={onPull}
              disabled={syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false)}
              title={`Pull from Syncthing file · ${syncTitle}`}
              style={{
                fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
                color: syncColor, background: "none", border: "none", padding: "2px 4px",
                cursor: syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                opacity: syncStatus === "syncing" ? 0.4 : 1,
              }}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={onPush}
              disabled={syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false)}
              title={`Push to Syncthing file · ${syncTitle}`}
              style={{
                fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
                color: syncStatus === "syncing" ? "#aaa" : syncColor, background: "none", border: "none", padding: "2px 4px",
                animation: syncStatus === "syncing" ? "spin 1s linear infinite" : "none",
                cursor: syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
              }}
            >
              {syncStatus === "syncing" ? "↻" : "↑"}
            </button>
          </>
        )}
        <div style={{
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
          border: "1px solid #333", padding: "2px 8px", color: "#ccc",
        }}>
          🔥{streak}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BOTTOM NAV
// ═══════════════════════════════════════════════════════════════
export function BottomNav({ tab, setTab }) {
  const tabs = [
    { id: "home", icon: "⌂", label: "HOME" },
    { id: "habits", icon: "◉", label: "HABITS" },
    { id: "tasks", icon: "▣", label: "TASKS" },
    { id: "chat", icon: "◈", label: "RITMOL" },
    { id: "profile", icon: "§", label: "PROFILE" },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200,
      background: "#0a0a0a", borderTop: "1px solid #222",
      display: "flex", height: "60px",
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "2px",
            background: "none", border: "none",
            borderTop: tab === t.id ? "2px solid #fff" : "2px solid transparent",
            color: tab === t.id ? "#fff" : "#555",
            fontFamily: "'Share Tech Mono', monospace",
            transition: "color 0.15s",
          }}
        >
          <span style={{ fontSize: "16px" }}>{t.icon}</span>
          <span style={{ fontSize: "8px", letterSpacing: "1px" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
export function Banner({ banner, onClose }) {
  const colors = { info: "#555", warning: "#888", success: "#aaa", alert: "#fff" };
  const safeBannerText = (typeof banner.text === "string")
    // eslint-disable-next-line no-control-regex
    ? banner.text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").slice(0, 300)
    : "";
  return (
    <div style={{
      position: "fixed", top: "56px", left: 0, right: 0, zIndex: 500,
      background: "#111", borderBottom: `2px solid ${colors[banner.type] || "#555"}`,
      padding: "10px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px",
      animation: "slideDown 0.2s ease",
    }}>
      <span style={{ color: colors[banner.type] || "#ccc" }}>{safeBannerText}</span>
      <button onClick={onClose} style={{ color: "#555", fontSize: "14px" }}>×</button>
    </div>
  );
}
