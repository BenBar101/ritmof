import React from "react";
import { useEffect } from "react";

// ═══════════════════════════════════════════════════════════════
// CSS — E-INK SAFE
// Injected via a component + useEffect so it runs only in a live browser context,
// not at module parse time (which would throw in SSR or test environments).
// ═══════════════════════════════════════════════════════════════
const GLOBAL_CSS = `
  /* ── Animations: unconditionally disabled for E-ink ───────── */
  /* All keyframe names kept as no-ops so references don't break */
  @keyframes slideDown { from { opacity:1; } to { opacity:1; } }
  @keyframes slideUp   { from { opacity:1; } to { opacity:1; } }
  @keyframes fadeIn    { from { opacity:1; } to { opacity:1; } }
  @keyframes pulse     { 0%, 100% { opacity:1; } 50% { opacity:1; } }
  @keyframes spin      { from { transform: rotate(0deg); } to { transform: rotate(0deg); } }
  @keyframes scan      { from { left: -40%; } to { left: 140%; } }

  /* Kill every animation and transition globally — E-ink cannot render motion */
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition: none !important;
    background-image: none !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }

  /* ── E-ink: solid border data attribute ──────────────────── */
  [data-eink-border] { border: 3px solid #000 !important; }

  /* ── Base reset ──────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; }

  html, body, #root {
    width: 100%;
    /* Use dvh (dynamic viewport height) so the layout tracks the actual
       visible area on mobile browsers with a collapsible address bar.
       This keeps the fixed BottomNav pinned to the real bottom edge
       instead of slipping behind the browser chrome.
       Falls back to 100% for browsers that don't support dvh. */
    height: 100%;
    height: 100dvh;
    margin: 0;
    padding: 0;
    overflow: hidden;           /* root handles its own scroll */
    background: #000;
    color: #fff;
    font-size: 16px;
    font-family: 'Share Tech Mono', monospace;
  }

  /* ── Clamp font sizes to avoid overflow on small screens ─── */
  body { font-size: clamp(14px, 4vw, 18px); }

  /* ── Mobile: prevent text-size bump on rotation ─────────── */
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

  /* ── iOS PWA: safe-area side insets only ─────────────────── */
  /* Do NOT add padding-top/bottom here — the fixed TopBar and BottomNav   */
  /* each handle their own safe-area insets so adding them on body too      */
  /* would shift the entire fixed layout on iPhone notch / Dynamic Island.  */
  body {
    padding-top:    0px;
    padding-bottom: 0px;
    padding-left:   env(safe-area-inset-left,   0px);
    padding-right:  env(safe-area-inset-right,  0px);
  }

  /* ── Touch: no 300ms tap delay, no highlight flash ─────── */
  * {
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  /* ── Scrollbars: high-contrast for E-ink ────────────────── */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: #000; }
  ::-webkit-scrollbar-thumb { background: #fff; border-radius: 0; }
  * { scrollbar-width: thin; scrollbar-color: #fff #000; }

  /* ── Light theme ─────────────────────────────────────────── */
  html[data-theme="light"],
  html[data-theme="light"] body,
  html[data-theme="light"] #root {
    background: #f0f0f0 !important;
    color: #000 !important;
  }
  /* Flip all backgrounds and text colors */
  html[data-theme="light"] div,
  html[data-theme="light"] span,
  html[data-theme="light"] section,
  html[data-theme="light"] article,
  html[data-theme="light"] header,
  html[data-theme="light"] footer,
  html[data-theme="light"] nav,
  html[data-theme="light"] aside,
  html[data-theme="light"] main,
  html[data-theme="light"] p,
  html[data-theme="light"] h1,
  html[data-theme="light"] h2,
  html[data-theme="light"] h3,
  html[data-theme="light"] h4,
  html[data-theme="light"] label,
  html[data-theme="light"] li,
  html[data-theme="light"] ul,
  html[data-theme="light"] details,
  html[data-theme="light"] summary,
  html[data-theme="light"] pre {
    background-color: #f0f0f0 !important;
    color: #000 !important;
    border-color: #000 !important;
  }
  /* Buttons: default ghost style */
  html[data-theme="light"] button {
    background-color: #f0f0f0 !important;
    color: #000 !important;
    border-color: #000 !important;
  }
  /* Active bottom nav tab — uses data-active attribute for reliable targeting */
  html[data-theme="light"] button[data-active="true"] {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #000 !important;
  }
  /* All descendants of inverted buttons must inherit black bg, not be overridden to #f0f0f0 */
  html[data-theme="light"] button[data-active="true"] *,
  html[data-theme="light"] button[data-active="true"] span,
  html[data-theme="light"] button[data-active="true"] div {
    background-color: transparent !important;
    color: #fff !important;
  }
  /* Completed protocol button — uses data-done attribute for reliable targeting */
  html[data-theme="light"] button[data-done="true"] {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #000 !important;
  }
  html[data-theme="light"] button[data-done="true"] *,
  html[data-theme="light"] button[data-done="true"] span,
  html[data-theme="light"] button[data-done="true"] div {
    background-color: transparent !important;
    color: #fff !important;
  }
  /* Primary/filled buttons: invert (was white bg + black text).
     Exclude nav buttons (handled above) to avoid double-invert. */
  html[data-theme="light"] button:not([data-active])[style*="background: rgb(255, 255, 255)"],
  html[data-theme="light"] button:not([data-active])[style*="background: #fff"],
  html[data-theme="light"] button:not([data-active])[style*="background: white"],
  html[data-theme="light"] button:not([data-active])[style*="background:#fff"] {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #000 !important;
  }
  /* Dim/mid text elements */
  html[data-theme="light"] [style*="color: rgb(170"],
  html[data-theme="light"] [style*="color: #aaa"],
  html[data-theme="light"] [style*="color: #888"],
  html[data-theme="light"] [style*="color: #666"],
  html[data-theme="light"] [style*="color: #555"],
  html[data-theme="light"] [style*="color: #444"],
  html[data-theme="light"] [style*="color: #ccc"] { color: #444 !important; }
  /* Dark track backgrounds */
  html[data-theme="light"] [style*="background: #333"],
  html[data-theme="light"] [style*="background:#333"],
  html[data-theme="light"] [style*="background: rgb(51"] { background-color: #bbb !important; }
  html[data-theme="light"] [style*="background: #111"],
  html[data-theme="light"] [style*="background:#111"],
  html[data-theme="light"] [style*="background: rgb(17"] { background-color: #ddd !important; }
  html[data-theme="light"] [style*="background: #222"],
  html[data-theme="light"] [style*="background:#222"] { background-color: #ccc !important; }
  /* Inputs */
  html[data-theme="light"] input,
  html[data-theme="light"] textarea,
  html[data-theme="light"] select {
    background: #fff !important;
    color: #000 !important;
    border-color: #000 !important;
  }
  html[data-theme="light"] select option { background: #fff !important; color: #000 !important; }
  /* Range input */
  html[data-theme="light"] input[type=range] { background: #bbb !important; }
  html[data-theme="light"] input[type=range]::-webkit-slider-thumb { background: #000 !important; border-color: #fff !important; }
  html[data-theme="light"] input[type=range]::-moz-range-thumb { background: #000 !important; border-color: #fff !important; }
  /* Calendar picker: undo the dark-mode invert */
  html[data-theme="light"] input[type="date"]::-webkit-calendar-picker-indicator,
  html[data-theme="light"] input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: none !important; }
  /* Scrollbars */
  html[data-theme="light"] * { scrollbar-color: #000 #f0f0f0 !important; }
  html[data-theme="light"] ::-webkit-scrollbar-track { background: #f0f0f0 !important; }
  html[data-theme="light"] ::-webkit-scrollbar-thumb { background: #000 !important; }
  /* Focus ring */
  html[data-theme="light"] :focus-visible { outline-color: #000 !important; }

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
    min-height: 48px;           /* E-ink safe touch target */
    min-width:  48px;
    cursor: pointer;
    border-radius: 0;
  }

  /* ── Focus: visible ring for keyboard/e-ink nav ─────────── */
  :focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  :focus:not(:focus-visible) { outline: none; }

  /* ── Prevent content overflow on narrow screens ─────────── */
  img, video, canvas, svg { max-width: 100%; }
  pre { overflow-x: auto; }

  /* ── Mobile-specific: tighter padding on very small screens ─ */
  @media (max-width: 380px) {
    /* Reduce letter-spacing so labels don't overflow */
    * { letter-spacing: 0 !important; }
    /* Tighter padding for cards */
    [data-card] { padding: 10px !important; }
  }

  /* ── Landscape mobile: reduce vertical whitespace ──────── */
  @media (max-height: 500px) and (orientation: landscape) {
    [data-modal-inner] { padding: 12px !important; }
  }
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
  setMeta("theme-color", "#000");
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
      const redact = (s) => (typeof s === "string"
        ? s
            .replace(/AIza[A-Za-z0-9_-]{35}/g, "[key]")
            .replace(/eyJ[\w.-]+/g, "[token]")
            .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]")
        : String(s ?? ""));
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "#000", color: "#fff", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "15px", color: "#ccc", letterSpacing: "2px", marginBottom: "20px", fontWeight: "bold" }}>RITMOL — ERROR</div>
          <div style={{ fontSize: "16px", color: "#fff", maxWidth: "380px", lineHeight: "1.6", marginBottom: "28px" }}>
            Something went wrong. Reload the page to continue.
          </div>
          {/* Show redacted error details only in dev builds — stack traces reveal internal structure in prod. */}
          {(typeof import.meta !== "undefined" && import.meta.env?.DEV) && (
          <details style={{ marginBottom: "20px", maxWidth: "420px", textAlign: "left" }}>
            <summary style={{ fontSize: "14px", color: "#ccc", cursor: "pointer", marginBottom: "10px" }}>▶ Error details</summary>
            <pre style={{
              fontSize: "13px", color: "#fff", background: "#000", padding: "14px",
              overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
              border: "2px solid #fff", lineHeight: "1.6",
            }}>
              {redact(this.state.error?.message ?? String(this.state.error))}
              {"\n\n"}
              {redact(this.state.error?.stack ?? "").replace(/AIza[A-Za-z0-9_-]{30,}/g, "[key]").replace(/eyJ[\w.-]+/g, "[token]")}
            </pre>
          </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "16px 32px", border: "3px solid #fff", background: "#fff", color: "#000",
              fontFamily: "inherit", fontSize: "16px", letterSpacing: "2px", cursor: "pointer",
              fontWeight: "bold", minHeight: "56px",
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
