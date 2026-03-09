import React from "react";
import { useEffect } from "react";

function GeometricCorners({ style, small }) {
  if (style === "geometric") {
    const s = small ? 6 : 8;
    const cornerStyle = { position: "absolute", width: s, height: s, borderColor: "#fff" };
    return (
      <>
        <div style={{ ...cornerStyle, top: 4, left: 4, borderTop: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, top: 4, right: 4, borderTop: "1px solid #fff", borderRight: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, left: 4, borderBottom: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, right: 4, borderBottom: "1px solid #fff", borderRight: "1px solid #fff" }} />
      </>
    );
  }
  if (style === "ascii") {
    return (
      <div style={{ position: "absolute", top: 4, left: 4, fontFamily: "'Share Tech Mono', monospace", fontSize: "8px", color: "#333" }}>
        {small ? ">" : ">>"}
      </div>
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CSS — E-INK SAFE
// Injected via a component + useEffect so it runs only in a live browser context,
// not at module parse time (which would throw in SSR or test environments).
// ═══════════════════════════════════════════════════════════════
const GLOBAL_CSS = `
  /* ── Animations ───────────────────────────────────────────── */
  @keyframes slideDown { from { transform: translateY(-20px); opacity:0; } to { transform: translateY(0); opacity:1; } }
  @keyframes slideUp   { from { transform: translateY(20px);  opacity:0; } to { transform: translateY(0); opacity:1; } }
  @keyframes fadeIn    { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pulse     { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  @keyframes spin      { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* ── E-ink / reduced-motion: kill all animation & transition ─ */
  @media (prefers-reduced-motion: reduce), (update: slow) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition: none !important;
    }
  }

  /* ── E-ink: strip gradients, shadows, opacity layers ─────── */
  @media (update: slow) {
    * {
      background-image: none !important;
      box-shadow: none !important;
      text-shadow: none !important;
      opacity: 1 !important;
    }
    /* Force solid borders so decorative chars survive ghosting */
    [data-eink-border] { border: 2px solid #000 !important; }
  }

  /* ── Base reset ──────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }

  html, body, #root {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;           /* root handles its own scroll */
    background: #0a0a0a;
    color: #e8e8e8;
  }

  /* ── Mobile: prevent text-size bump on rotation ─────────── */
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

  /* ── iOS PWA: respect notch/home-bar safe areas ─────────── */
  body {
    padding-top:    env(safe-area-inset-top,    0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left:   env(safe-area-inset-left,   0px);
    padding-right:  env(safe-area-inset-right,  0px);
  }

  /* ── Touch: no 300ms tap delay, no highlight flash ─────── */
  * {
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  /* ── Scrollbars: thin, dark ─────────────────────────────── */
  ::-webkit-scrollbar { width: 3px; height: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #333; border-radius: 0; }
  * { scrollbar-width: thin; scrollbar-color: #333 transparent; }

  /* ── Inputs ─────────────────────────────────────────────── */
  input, textarea, select {
    /* prevent iOS Safari zoom on focus (font-size must be ≥16px or use this) */
    font-size: max(16px, 1em);
    border-radius: 0;
  }
  input[type=range] { -webkit-appearance: none; height: 2px; background: #333; outline: none; width: 100%; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; background: #fff; cursor: pointer; border: 2px solid #000; }
  input[type=range]::-moz-range-thumb     { width: 24px; height: 24px; background: #fff; cursor: pointer; border: 2px solid #000; border-radius: 0; }
  input[type="date"]::-webkit-calendar-picker-indicator,
  input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(1); }
  select option { background: #111; }

  /* ── Buttons: large enough touch targets ────────────────── */
  button {
    min-height: 44px;           /* Apple HIG minimum */
    min-width:  44px;
    cursor: pointer;
    border-radius: 0;
  }

  /* ── Focus: visible ring for keyboard/e-ink nav ─────────── */
  :focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  :focus:not(:focus-visible) { outline: none; }

  /* ── Prevent content overflow on narrow screens ─────────── */
  img, video, canvas, svg { max-width: 100%; }
  pre { overflow-x: auto; }
`;

// Injects/updates <meta> tags that must be present for correct mobile/PWA behaviour.
// Called once at mount so it works even when index.html is minimal.
function ensureHeadMeta() {
  function setMeta(name, content, attr = "name") {
    let el = document.querySelector(`meta[${attr}="${name}"]`);
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }
  // Correct viewport: no user-scalable so the layout isn't broken, but allow pinch-zoom
  setMeta("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
  // PWA standalone display
  setMeta("mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  // Theme colour (dark default; updated dynamically when theme changes)
  setMeta("theme-color", "#0a0a0a");
}

export function GlobalStyles() {
  useEffect(() => {
    ensureHeadMeta();
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-ritmol", "global");
    styleEl.textContent = GLOBAL_CSS;
    document.head.appendChild(styleEl);
    return () => { styleEl.remove(); };
  }, []);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// ERROR BOUNDARY (prevents white screen on uncaught React errors)
// ═══════════════════════════════════════════════════════════════
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    // Fix #14 (code quality): log to console so the error is visible in DevTools even
    // after the boundary catches it. The generic UI message is shown to the user but
    // the full stack is preserved for self-hosted debugging.
    console.error("[RITMOL ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "#0a0a0a", color: "#e8e8e8", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "11px", color: "#666", letterSpacing: "2px", marginBottom: "16px" }}>RITMOL — ERROR</div>
          <div style={{ fontSize: "12px", color: "#aaa", maxWidth: "360px", lineHeight: "1.6", marginBottom: "24px" }}>
            Something went wrong. Reload the page to continue.
          </div>
          {/* Show error details only in dev builds — stack traces reveal internal structure in prod. */}
          {(typeof import.meta !== "undefined" && import.meta.env?.DEV) && (
          <details style={{ marginBottom: "16px", maxWidth: "400px", textAlign: "left" }}>
            <summary style={{ fontSize: "10px", color: "#555", cursor: "pointer", marginBottom: "6px" }}>▶ Error details</summary>
            <pre style={{
              fontSize: "9px", color: "#666", background: "#111", padding: "8px",
              overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
              border: "1px solid #222", lineHeight: "1.5",
            }}>
              {this.state.error?.message ?? String(this.state.error)}
              {"\n\n"}
              {this.state.error?.stack ?? ""}
            </pre>
          </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px", border: "1px solid #555", background: "transparent", color: "#ccc",
              fontFamily: "inherit", fontSize: "12px", letterSpacing: "1px", cursor: "pointer",
            }}
          >
            RELOAD
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Mount logic has been moved to main.jsx so importing App.jsx does not
// trigger ReactDOM.createRoot as a module-load side effect.
// See main.jsx for the entry point.
