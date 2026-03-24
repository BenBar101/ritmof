import { getLevelProgress } from "./utils/xp";

// ═══════════════════════════════════════════════════════════════
// TOP BAR
// ═══════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
export function TopBar({ xp, xpPerLevel, level, rank, profile, syncStatus, lastSynced, onPush, onPull, dropboxConnected, isReloading = false, onOpenSettings, theme = "dark" }) {
  const progress = getLevelProgress(xp, xpPerLevel);
  const pct = xpPerLevel > 0
    ? Math.min(100, Math.max(0, (progress / xpPerLevel) * 100))
    : 0;

  const fg = theme === "light" ? "#000" : "#fff";
  const syncTitle = lastSynced ? `Last synced: ${new Date(lastSynced).toLocaleTimeString()}` : "Not synced yet";
  const syncDisabled = syncStatus === "syncing" || (typeof navigator !== "undefined" && navigator.onLine === false) || isReloading;
  const syncBorder = syncDisabled ? `2px solid ${theme === "light" ? "#bbb" : "#444"}` : `2px solid ${fg}`;
  const syncColor = syncDisabled ? (theme === "light" ? "#bbb" : "#444") : fg;

  return (
    <div style={{
      flexShrink: 0,
      background: theme === "light" ? "#f0f0f0" : "#000",
      borderBottom: `4px double ${fg}`,
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingLeft: "10px", paddingRight: "10px", paddingBottom: "0px",
      height: "calc(56px + env(safe-area-inset-top, 0px))",
      display: "flex", alignItems: "flex-end", gap: "6px",
      zIndex: 200,
      boxSizing: "border-box",
    }}>
      {/* Gear icon — opens Settings */}
      <button
        type="button"
        onClick={onOpenSettings}
        title="Settings"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          background: "none", border: "none", cursor: "pointer",
          padding: "0 4px 8px 0",
          minHeight: "40px", minWidth: "40px",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* XP bar — fills remaining space */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", fontSize: "11px", color: fg, marginBottom: "2px", fontFamily: "'Share Tech Mono', monospace", fontWeight: 900, letterSpacing: "-0.02em", textTransform: "uppercase" }}>
          <span style={{ flexShrink: 0 }}>LV.{level}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{rank.title}</span>
          <span style={{ flexShrink: 0 }} data-testid="xp">{xp} XP</span>
          <span style={{ flexShrink: 0 }}>{Math.round(pct)}%</span>
        </div>
        <div style={{ height: "2px", background: theme === "light" ? "#bbb" : "#444", position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: fg }} />
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0, paddingBottom: "8px" }}>
        {dropboxConnected && (
          <>
            <button
              type="button"
              onClick={onPull}
              disabled={syncDisabled}
              data-testid="pull"
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
              data-testid="push"
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
export function BottomNav({ tab, setTab, theme = "dark" }) {
  const tabs = [
    { id: "home", icon: "⌂", label: "HOME" },
    { id: "habits", icon: "◉", label: "HABITS" },
    { id: "tasks", icon: "▣", label: "TASKS" },
    { id: "chat", icon: "◈", label: "AI" },
    { id: "profile", icon: "§", label: "PROFILE" },
  ];

  const bg     = theme === "light" ? "#f0f0f0" : "#000";
  const fg     = theme === "light" ? "#000"    : "#fff";
  const border = `2px solid ${fg}`;

  return (
    <div data-bottom-nav="" style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: bg, borderTop: border,
      display: "flex",
      height: "calc(60px + env(safe-area-inset-bottom, 0px))",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      zIndex: 300,
    }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          data-testid={`nav-${t.id}`}
          data-active={tab === t.id ? "true" : undefined}
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: "2px",
            background: tab === t.id ? fg : bg,
            border: "none",
            borderTop: border,
            color: tab === t.id ? bg : fg,
            fontFamily: "'Share Tech Mono', monospace",
            padding: "4px 0",
          }}
        >
          <span style={{ fontSize: "22px", lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: "10px", letterSpacing: "2px", fontWeight: 900, textTransform: "uppercase" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
export function Banner({ banner, onClose, theme = "dark" }) {
  const fg = theme === "light" ? "#000" : "#fff";
  const bg = theme === "light" ? "#f0f0f0" : "#000";
  const safeBannerText = (typeof banner.text === "string")
    // eslint-disable-next-line no-control-regex
    ? banner.text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "").slice(0, 300)
    : "";
  return (
    <div style={{
      position: "fixed", top: "calc(56px + env(safe-area-inset-top, 0px))", left: 0, right: 0, zIndex: 500,
      background: bg, borderBottom: `3px solid ${fg}`, borderTop: `3px solid ${fg}`,
      padding: "14px 16px", display: "flex", justifyContent: "space-between",
      alignItems: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", fontWeight: "bold",
    }}>
      <span style={{ color: fg, flex: 1 }}>{safeBannerText}</span>
      <button onClick={onClose} style={{ color: fg, fontSize: "24px", minHeight: "48px", minWidth: "48px", background: "none", border: "none" }}>×</button>
    </div>
  );
}
