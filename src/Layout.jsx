import { APP_ICON_URL } from "./utils/db";
import { getLevelProgress } from "./utils/xp";

// ═══════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
export function TopBar({ xp, xpPerLevel, level, rank, profile, syncStatus, lastSynced, onPush, onPull, syncFileConnected, isReloading = false }) {
  const progress = getLevelProgress(xp, xpPerLevel);
  const pct = xpPerLevel > 0
    ? Math.min(100, Math.max(0, (progress / xpPerLevel) * 100))
    : 0;

  const syncTitle = lastSynced ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}` : "Not synced yet";
  const syncDisabled = syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false) || isReloading;
  const syncBorder = syncDisabled ? "2px solid #444" : "2px solid #fff";
  const syncColor = syncDisabled ? "#444" : "#fff";

  return (
    <div style={{
      background: "#000", borderBottom: "3px solid #fff",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingLeft: "10px", paddingRight: "10px", paddingBottom: "0px",
      height: "calc(56px + env(safe-area-inset-top, 0px))",
      display: "flex", alignItems: "flex-end", gap: "6px",
      zIndex: 200,
    }}>
      {/* Logo — shrinks on very small screens */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, paddingBottom: "8px" }}>
        <img src={APP_ICON_URL} alt="" style={{ width: 24, height: 24, display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", letterSpacing: "2px", color: "#fff", whiteSpace: "nowrap" }}>
          RITMOL
        </span>
      </div>

      {/* XP bar — fills remaining space */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#fff", marginBottom: "2px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold", letterSpacing: "0.5px" }}>
          <span>LV.{level}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "50%" }}>{rank.title}</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div style={{ height: "4px", background: "#333", position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "#fff" }} />
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0, paddingBottom: "8px" }}>
        {syncFileConnected && (
          <>
            <button
              type="button"
              onClick={onPull}
              disabled={syncDisabled}
              title={`Pull ↓ · ${syncTitle}`}
              style={{
                fontFamily: "'Share Tech Mono', monospace", fontSize: "15px",
                color: syncColor,
                background: "none", border: syncBorder,
                cursor: syncDisabled ? "default" : "pointer",
                minHeight: "40px", minWidth: "40px",
                padding: "0",
              }}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={onPush}
              disabled={syncDisabled}
              title={`Push ↑ · ${syncTitle}`}
              style={{
                fontFamily: "'Share Tech Mono', monospace", fontSize: "15px",
                color: syncColor,
                background: "none", border: syncBorder,
                cursor: syncDisabled ? "default" : "pointer",
                minHeight: "40px", minWidth: "40px",
                padding: "0",
              }}
            >
              {syncStatus === "syncing" ? "…" : "↑"}
            </button>
          </>
        )}
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
    { id: "chat", icon: "◈", label: "AI" },
    { id: "profile", icon: "§", label: "PROFILE" },
  ];

  return (
    <div data-bottom-nav="" style={{
      background: "#000", borderTop: "3px solid #fff",
      display: "flex",
      height: "calc(60px + env(safe-area-inset-bottom, 0px))",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      zIndex: 300,
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          data-active={tab === t.id ? "true" : undefined}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "2px",
            background: tab === t.id ? "#fff" : "#000", border: "none",
            borderTop: "3px solid #fff",
            color: tab === t.id ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace",
            padding: "4px 0",
          }}
        >
          <span style={{ fontSize: "22px", lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: "10px", letterSpacing: "1px", fontWeight: "bold" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
export function Banner({ banner, onClose }) {
  const bgColors = { info: "#000", warning: "#000", success: "#000", alert: "#000" };
  const safeBannerText = (typeof banner.text === "string")
    // eslint-disable-next-line no-control-regex
    ? banner.text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").slice(0, 300)
    : "";
  return (
    <div style={{
      position: "fixed", top: "calc(56px + env(safe-area-inset-top, 0px))", left: 0, right: 0, zIndex: 500,
      background: bgColors[banner.type] || "#000", borderBottom: "3px solid #fff", borderTop: "3px solid #fff",
      padding: "14px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", fontWeight: "bold",
    }}>
      <span style={{ color: "#fff", flex: 1 }}>{safeBannerText}</span>
      <button onClick={onClose} style={{ color: "#fff", fontSize: "24px", minHeight: "48px", minWidth: "48px", background: "none", border: "none" }}>×</button>
    </div>
  );
}
