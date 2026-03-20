import React from "react";
import { useEffect } from "react";

const GLOBAL_CSS = `
  @keyframes slideDown { from { opacity:1; } to { opacity:1; } }
  @keyframes slideUp   { from { opacity:1; } to { opacity:1; } }
  @keyframes fadeIn    { from { opacity:1; } to { opacity:1; } }
  @keyframes pulse     { 0%, 100% { opacity:1; } 50% { opacity:1; } }
  @keyframes spin      { from { transform: rotate(0deg); } to { transform: rotate(0deg); } }
  @keyframes scan      { from { left: -40%; } to { left: 140%; } }

  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition: none !important;
    background-image: none !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }

  [data-eink-border] { border: 3px solid #000 !important; }
  *, *::before, *::after { box-sizing: border-box; }

  /* ── Viewport height fix for iOS Safari browser mode ────────
     Safari in browser mode (not PWA) has TWO viewport height bugs:
     1. 100vh = the height INCLUDING the hidden-behind-chrome area,
        so fixed elements at bottom:0 are obscured by the toolbar.
     2. overflow:hidden on body does NOT prevent the page from
        rubber-band scrolling, revealing blank space below the nav.

     The solution:
     - Set --vh via JS to window.innerHeight (the true visible height).
     - Use calc(var(--vh) * 100) everywhere instead of 100vh/100dvh.
     - Block overscroll with overscroll-behavior:none on html+body.
     - Use touch-action:none on #root to kill iOS momentum scroll at
       the container level, while allowing scroll inside [data-scroll].
  ── */

  html {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    /* Do NOT set overflow:hidden on html — iOS PWA clips fixed elements incorrectly */
    overscroll-behavior: none;
    background: #000;
  }

  body {
    width: 100%;
    /* lvh = largest viewport height. In iOS PWA standalone this equals the full
       screen height. dvh shrinks when the keyboard appears which we don't want.
       Falls back to 100% for browsers that don't support lvh. */
    height: 100%;
    height: 100lvh;
    margin: 0;
    padding: 0;
    overflow: hidden;
    overscroll-behavior: none;
    background: #000;
    color: #fff;
    font-size: 16px;
    font-family: 'Share Tech Mono', monospace;
  }

  #root {
    width: 100%;
    height: 100%;
    height: 100lvh;
    overflow: hidden;
    overscroll-behavior: none;
    background: #000;
  }

  /* Only allow scrolling in explicitly marked containers */
  [data-scroll] {
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
  }

  body { font-size: clamp(14px, 4vw, 18px); }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }

  body {
    padding-top:    0px;
    padding-bottom: 0px;
    padding-left:   env(safe-area-inset-left,   0px);
    padding-right:  env(safe-area-inset-right,  0px);
  }

  * {
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  /* Allow normal vertical scrolling inside scroll containers */
  [data-scroll] { touch-action: pan-y; }

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
  html[data-theme="light"] button {
    background-color: #f0f0f0 !important;
    color: #000 !important;
    border-color: #000 !important;
  }
  html[data-theme="light"] button[data-active="true"] {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #000 !important;
  }
  html[data-theme="light"] button[data-active="true"] *,
  html[data-theme="light"] button[data-active="true"] span,
  html[data-theme="light"] button[data-active="true"] div {
    background-color: transparent !important;
    color: #fff !important;
  }
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
  html[data-theme="light"] button:not([data-active])[style*="background: rgb(255, 255, 255)"],
  html[data-theme="light"] button:not([data-active])[style*="background: #fff"],
  html[data-theme="light"] button:not([data-active])[style*="background: white"],
  html[data-theme="light"] button:not([data-active])[style*="background:#fff"] {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #000 !important;
  }
  /* Home “Log study session” — true inversion under light theme (globals force gray buttons/divs). */
  html[data-theme="light"] button.inverted-cta {
    background-color: #000 !important;
    color: #fff !important;
    border-color: #fff !important;
  }
  html[data-theme="light"] button.inverted-cta > div {
    background-color: transparent !important;
    border-color: #fff !important;
    color: inherit !important;
  }
  html[data-theme="light"] button.inverted-cta > div:first-child {
    background-color: #fff !important;
    border-color: #fff !important;
  }
  html[data-theme="light"] button.inverted-cta > div:first-child span {
    background-color: transparent !important;
    color: #000 !important;
  }
  /* Nested divs still matched by html[data-theme="light"] div { background #f0f0f0 } — strip it so text sits on the black CTA. */
  html[data-theme="light"] button.inverted-cta > div:last-child div {
    background-color: transparent !important;
  }
  html[data-theme="light"] button.inverted-cta > div:last-child > div:first-child {
    color: #fff !important;
  }
  html[data-theme="light"] button.inverted-cta > div:last-child > div:last-child {
    color: #c9c9c9 !important;
  }
  html[data-theme="light"] button.inverted-cta:focus-visible {
    outline-color: #fff !important;
  }
  html[data-theme="light"] [style*="color: rgb(170"],
  html[data-theme="light"] [style*="color: #aaa"],
  html[data-theme="light"] [style*="color: #888"],
  html[data-theme="light"] [style*="color: #666"],
  html[data-theme="light"] [style*="color: #555"],
  html[data-theme="light"] [style*="color: #444"],
  html[data-theme="light"] [style*="color: #ccc"] { color: #444 !important; }
  html[data-theme="light"] [style*="background: #333"],
  html[data-theme="light"] [style*="background:#333"],
  html[data-theme="light"] [style*="background: rgb(51"] { background-color: #bbb !important; }
  html[data-theme="light"] [style*="background: #111"],
  html[data-theme="light"] [style*="background:#111"],
  html[data-theme="light"] [style*="background: rgb(17"] { background-color: #ddd !important; }
  html[data-theme="light"] [style*="background: #222"],
  html[data-theme="light"] [style*="background:#222"] { background-color: #ccc !important; }
  html[data-theme="light"] input,
  html[data-theme="light"] textarea,
  html[data-theme="light"] select {
    background: #fff !important;
    color: #000 !important;
    border-color: #000 !important;
  }
  html[data-theme="light"] select option { background: #fff !important; color: #000 !important; }
  html[data-theme="light"] input[type=range] { background: #bbb !important; }
  html[data-theme="light"] input[type=range]::-webkit-slider-thumb { background: #000 !important; border-color: #fff !important; }
  html[data-theme="light"] input[type=range]::-moz-range-thumb { background: #000 !important; border-color: #fff !important; }
  html[data-theme="light"] input[type="date"]::-webkit-calendar-picker-indicator,
  html[data-theme="light"] input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: none !important; }
  html[data-theme="light"] * { scrollbar-color: #000 #f0f0f0 !important; }
  html[data-theme="light"] ::-webkit-scrollbar-track { background: #f0f0f0 !important; }
  html[data-theme="light"] ::-webkit-scrollbar-thumb { background: #000 !important; }
  html[data-theme="light"] :focus-visible { outline-color: #000 !important; }

  input, textarea, select {
    font-size: max(16px, 1em);
    border-radius: 0;
  }
  input[type=range] { -webkit-appearance: none; height: 2px; background: #333; outline: none; width: 100%; }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; background: #fff; cursor: pointer; border: 2px solid #000; }
  input[type=range]::-moz-range-thumb     { width: 24px; height: 24px; background: #fff; cursor: pointer; border: 2px solid #000; border-radius: 0; }
  input[type="date"]::-webkit-calendar-picker-indicator,
  input[type="datetime-local"]::-webkit-calendar-picker-indicator { filter: invert(1); }
  select option { background: #111; }

  button {
    min-height: 48px;
    min-width:  48px;
    cursor: pointer;
    border-radius: 0;
  }

  :focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  :focus:not(:focus-visible) { outline: none; }

  img, video, canvas, svg { max-width: 100%; }
  pre { overflow-x: auto; }

  /* ── RPG System Frame ─────────────────────────────────────────
     Apply class="system-frame" to any primary card/section.
     The ::after ring gives the inner double-border effect from design.md.
     clip-path is set on the element itself via inline style because
     React components need to vary notch depth; ::after inherits it.
  ── */
  .system-frame {
    position: relative;
    border: 2px solid #fff;
    background-color: #000;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    clip-path: polygon(
      0% 10px, 10px 0%,
      calc(100% - 10px) 0%, 100% 10px,
      100% calc(100% - 10px), calc(100% - 10px) 100%,
      10px 100%, 0% calc(100% - 10px)
    );
  }
  html[data-theme="light"] .system-frame {
    border-color: #000;
    background-color: #fff;
  }
  .system-frame::after {
    content: "";
    position: absolute;
    top: 4px; left: 4px; right: 4px; bottom: 4px;
    border: 1px solid #fff;
    pointer-events: none;
    clip-path: inherit;
  }
  html[data-theme="light"] .system-frame::after {
    border-color: #000;
  }

  /* ── RPG System Header ──────────────────────────────────────── */
  .system-header {
    font-family: 'Share Tech Mono', monospace;
    text-transform: uppercase;
    font-weight: 900;
    letter-spacing: -0.05em;
    display: flex;
    align-items: center;
    gap: 1rem;
    color: #fff;
    margin-bottom: 0.75rem;
  }
  html[data-theme="light"] .system-header {
    color: #000;
  }

  /* ── RPG System Divider ─────────────────────────────────────── */
  .system-divider {
    height: 2px;
    background-color: #fff;
    flex-grow: 1;
    position: relative;
  }
  html[data-theme="light"] .system-divider {
    background-color: #000;
  }
  .system-divider::after {
    content: "";
    position: absolute;
    right: -8px;
    top: -3px;
    width: 8px;
    height: 8px;
    background-color: #fff;
    transform: rotate(45deg);
  }
  html[data-theme="light"] .system-divider::after {
    background-color: #000;
  }

  /* ── RPG Status Badge ───────────────────────────────────────── */
  .status-badge {
    font-size: 0.7rem;
    padding: 2px 8px;
    border: 1px solid #fff;
    font-weight: bold;
    font-family: 'Share Tech Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #fff;
    background: transparent;
  }
  /* Inverted pill: dark theme = white fill / black frame / black text; light = opposite. */
  .status-badge[data-urgent="true"] {
    background: #fff !important;
    color: #000 !important;
    border: 2px solid #000 !important;
  }
  html[data-theme="light"] .status-badge {
    border-color: #000;
    color: #000;
  }
  html[data-theme="light"] .status-badge[data-urgent="true"] {
    background-color: #000 !important;
    color: #fff !important;
    border: 2px solid #fff !important;
  }

  /* ── RPG Task Row ───────────────────────────────────────────── */
  .task-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #fff;
    padding: 1rem 0.5rem;
    font-family: 'Share Tech Mono', monospace;
    color: #fff;
  }
  html[data-theme="light"] .task-row {
    border-bottom-color: #000;
    color: #000;
  }
  .task-row:last-child {
    border-bottom: none;
  }

  /* ── Light theme — hardcoded inline border colour fixes ──────
     Many components use inline style={{ border: "Xpx solid #fff" }} or
     borderBottom/borderTop with #fff. The selectors below override those
     so all lines invert correctly in light mode.
     We target the attribute-value substrings Vite/React renders verbatim. ── */

  /* Section header double-rule (4px double #fff) */
  html[data-theme="light"] [style*="4px double #fff"],
  html[data-theme="light"] [style*="4px double rgb(255, 255, 255)"] {
    border-color: #000 !important;
  }

  /* Generic solid white borders (2px, 1px, 3px) */
  html[data-theme="light"] [style*="border: 2px solid #fff"],
  html[data-theme="light"] [style*="border: 1px solid #fff"],
  html[data-theme="light"] [style*="border: 3px solid #fff"],
  html[data-theme="light"] [style*="border:2px solid #fff"],
  html[data-theme="light"] [style*="border:1px solid #fff"],
  html[data-theme="light"] [style*="border:3px solid #fff"] {
    border-color: #000 !important;
  }

  /* borderBottom / borderTop inline */
  html[data-theme="light"] [style*="borderBottom: 2px solid #fff"],
  html[data-theme="light"] [style*="border-bottom: 2px solid #fff"],
  html[data-theme="light"] [style*="borderBottom: 1px solid #fff"],
  html[data-theme="light"] [style*="border-bottom: 1px solid #fff"],
  html[data-theme="light"] [style*="borderTop: 2px solid #fff"],
  html[data-theme="light"] [style*="border-top: 2px solid #fff"] {
    border-color: #000 !important;
  }

  /* Habit category heading underline and habit card border */
  html[data-theme="light"] [style*="borderBottom: 2px solid rgb(255"],
  html[data-theme="light"] [style*="border: 2px solid rgb(255, 255, 255)"],
  html[data-theme="light"] [style*="border: 3px solid rgb(255, 255, 255)"] {
    border-color: #000 !important;
  }

  /* Completed task list separator */
  html[data-theme="light"] [style*="borderBottom: 2px solid #fff"] {
    border-color: #000 !important;
  }

  /* Goals section card backgrounds */
  html[data-theme="light"] [style*="background: #000"][style*="border: 2px solid #fff"],
  html[data-theme="light"] [style*="background:#000"][style*="border: 2px solid #fff"] {
    background: #fff !important;
    border-color: #000 !important;
  }
    * { letter-spacing: 0 !important; }
    [data-card] { padding: 10px !important; }
  }

  @media (max-height: 500px) and (orientation: landscape) {
    [data-modal-inner] { padding: 12px !important; }
  }
`;

function isPWAMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function setVhVariable() {
  // ── PWA vs Browser height strategy ───────────────────────────
  //
  // iOS PWA mode (standalone):
  //   • window.innerHeight = full screen height including the home indicator
  //     notch area (~34 px on iPhone with Face ID). Using this directly causes
  //     the layout container to be taller than the visible area, leaving a dead
  //     strip above the bottom nav.
  //   • The system already reserves the home indicator via env(safe-area-inset-bottom).
  //   • Best approach: set --vh from innerHeight BUT subtract the actual
  //     safe-area-inset-bottom so the layout height = truly usable pixels.
  //     We read the inset via a hidden sentinel div with padding-bottom set to
  //     env(safe-area-inset-bottom) — the only reliable cross-browser way to
  //     read env() values from JS.
  //
  // Safari browser mode:
  //   • innerHeight already excludes the browser chrome. Use it directly.
  //   • safe-area-inset-bottom is 0 in browser mode so no subtraction needed.

  // Read env(safe-area-inset-bottom) into JS via a sentinel element.
  let safeAreaBottom = 0;
  try {
    let sentinel = document.getElementById("__vh-sentinel");
    if (!sentinel) {
      sentinel = document.createElement("div");
      sentinel.id = "__vh-sentinel";
      sentinel.style.cssText =
        "position:fixed;bottom:0;left:0;width:1px;height:1px;" +
        "padding-bottom:env(safe-area-inset-bottom,0px);" +
        "pointer-events:none;opacity:0;z-index:-1;";
      document.documentElement.appendChild(sentinel);
    }
    const computed = getComputedStyle(sentinel);
    safeAreaBottom = parseFloat(computed.paddingBottom) || 0;
  } catch { /* ignore */ }

  const pwa = isPWAMode();
  // In PWA mode, subtract the home indicator height so --vh * 100 = usable height.
  // In browser mode, safeAreaBottom is 0 so this is a no-op.
  const usableHeight = pwa
    ? window.innerHeight - safeAreaBottom
    : window.innerHeight;

  const vh = usableHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);

  // --sab: in PWA mode the nav/scroll padding for the home indicator is already
  // subtracted from --vh, so set --sab=0 to avoid double-counting.
  // In browser mode remove --sab so CSS falls back to env(safe-area-inset-bottom).
  if (pwa) {
    document.documentElement.style.setProperty("--sab", "0px");
  } else {
    document.documentElement.style.removeProperty("--sab");
  }
}

function ensureHeadMeta() {
  function setMeta(name, content, attr = "name") {
    let el = document.querySelector(`meta[${attr}="${name}"]`);
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }
  setMeta("viewport", "width=device-width, initial-scale=1, viewport-fit=cover");
  setMeta("mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-capable", "yes");
  setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  setMeta("theme-color", "#000");
}

export function GlobalStyles() {
  useEffect(() => {
    ensureHeadMeta();

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-ritmol", "global");
    styleEl.textContent = GLOBAL_CSS;
    document.head.appendChild(styleEl);

    // Set --vh immediately (first pass: safeAreaBottom may be 0 before the
    // sentinel's style is computed, which is fine — we correct it one frame later).
    setVhVariable();
    // Second pass after layout: sentinel paddingBottom is now computed correctly.
    requestAnimationFrame(() => setVhVariable());
    window.addEventListener("resize", setVhVariable);
    window.addEventListener("orientationchange", setVhVariable);

    return () => {
      styleEl.remove();
      window.removeEventListener("resize", setVhVariable);
      window.removeEventListener("orientationchange", setVhVariable);
      const sentinel = document.getElementById("__vh-sentinel");
      if (sentinel) sentinel.remove();
    };
  }, []);
  return null;
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
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
          minHeight: "calc(var(--vh, 1vh) * 100)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "#000", color: "#fff", fontFamily: "'Share Tech Mono', monospace", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "15px", color: "#ccc", letterSpacing: "2px", marginBottom: "20px", fontWeight: "bold" }}>RITMOL — ERROR</div>
          <div style={{ fontSize: "16px", color: "#fff", maxWidth: "380px", lineHeight: "1.6", marginBottom: "28px" }}>
            Something went wrong. Reload the page to continue.
          </div>
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
