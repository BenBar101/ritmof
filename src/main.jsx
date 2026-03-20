import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App, { GlobalStyles, ErrorBoundary } from "./App";
import { bootDb, store, IS_DEV } from "./utils/db";

// Dev-only test hooks for E2E: inject sync payload, inspect store state.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__RITMOL_TEST__ = {
    injectSync: null,
    getState: () => (store ? store.getValues() : {}),
  };
}

// ── Duplicate-tab detection ───────────────────────────────────────────────────
// Uses BroadcastChannel so detection is instant (no polling, no localStorage
// race). Protocol:
//   1. New tab opens → broadcasts "hello". Waits HELLO_TIMEOUT ms.
//   2. An existing active tab receives "hello" → replies "alive".
//   3. If the new tab gets "alive" before the timeout it knows it is a duplicate
//      and renders the DuplicateScreen instead of the app.
//   4. Each active tab also listens for "hello" from future duplicates and sets a
//      flag so IT can show a warning if the user tries to keep using the stale tab.
//
// The channel name is namespaced per dev/prod so dev builds don't interfere with
// prod builds running in another tab.
const TAB_CHANNEL_NAME = IS_DEV ? "ritmol_dev_tab" : "ritmol_tab";
// How long the new tab waits for an "alive" reply before deciding it is the primary.
const HELLO_TIMEOUT_MS = 600;

async function detectDuplicateTab() {
  if (typeof BroadcastChannel === "undefined") return false; // SSR / old browser → skip
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(TAB_CHANNEL_NAME);
    let resolved = false;

    function done(isDuplicate) {
      if (resolved) return;
      resolved = true;
      ch.close();
      resolve(isDuplicate);
    }

    ch.onmessage = (e) => {
      if (e.data?.type === "alive") done(true);
    };

    // Announce ourselves. Existing active tabs will reply "alive".
    ch.postMessage({ type: "hello" });

    // If no reply within HELLO_TIMEOUT_MS, we are the primary tab.
    setTimeout(() => done(false), HELLO_TIMEOUT_MS);
  });
}

// ── DuplicateScreen ───────────────────────────────────────────────────────────
// Rendered instead of the full app when a second instance is detected.
// Matches the RITMOL monochrome, mono-font, RPG-frame aesthetic exactly.
function DuplicateScreen() {
  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const [takingOver, setTakingOver] = useState(false);

  // Let the user forcibly claim this tab as the primary.
  // We broadcast a "takeover" message so the old tab can show a notice,
  // then reload this tab so it boots fresh as the new primary.
  function handleTakeOver() {
    setTakingOver(true);
    try {
      const ch = new BroadcastChannel(TAB_CHANNEL_NAME);
      ch.postMessage({ type: "takeover" });
      ch.close();
    } catch { /* ignore */ }
    // Small delay so the message can be dispatched before reload
    setTimeout(() => window.location.reload(), 300);
  }

  return (
    <>
      {/* Inject minimal global styles — GlobalStyles hasn't mounted yet */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root {
          width: 100%; height: 100%;
          background: #000; color: #fff;
          font-family: 'Share Tech Mono', monospace;
          overflow: hidden;
        }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>

      <div style={{
        position: "fixed", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "#000", padding: "24px",
      }}>

        {/* Outer frame */}
        <div style={{
          width: "100%", maxWidth: "380px",
          border: "2px solid #fff",
          clipPath: "polygon(0% 12px, 12px 0%, calc(100% - 12px) 0%, 100% 12px, 100% calc(100% - 12px), calc(100% - 12px) 100%, 12px 100%, 0% calc(100% - 12px))",
          padding: "28px 24px",
          position: "relative",
        }}>
          {/* Inner frame ring */}
          <div style={{
            position: "absolute", top: 4, left: 4, right: 4, bottom: 4,
            border: "1px solid #fff",
            clipPath: "inherit",
            pointerEvents: "none",
          }} />

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <span style={{ ...mono, fontSize: "11px", letterSpacing: "3px", opacity: 0.5 }}>
              RITMOL
            </span>
            <div style={{ flex: 1, height: "2px", background: "#fff", position: "relative" }}>
              <div style={{
                position: "absolute", right: -8, top: -3,
                width: 8, height: 8, background: "#fff",
                transform: "rotate(45deg)",
              }} />
            </div>
            {/* Blinking alert indicator */}
            <span style={{
              fontSize: "11px", letterSpacing: "2px",
              border: "1px solid #fff", padding: "2px 8px",
              animation: "blink 1.2s step-start infinite",
            }}>
              ALERT
            </span>
          </div>

          {/* Title */}
          <div style={{ ...mono, fontSize: "22px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "8px" }}>
            DUPLICATE INSTANCE
          </div>
          <div style={{ ...mono, fontSize: "11px", letterSpacing: "3px", opacity: 0.5, marginBottom: "24px" }}>
            SYSTEM CONFLICT DETECTED
          </div>

          {/* Body */}
          <div style={{ ...mono, fontSize: "14px", lineHeight: "1.8", color: "#ccc", marginBottom: "28px" }}>
            RITMOL is already running in another tab or window. Running two instances
            simultaneously risks data corruption and sync conflicts.
            <br /><br />
            Close the other tab, then return here to continue.
          </div>

          {/* Divider */}
          <div style={{ height: "1px", background: "#333", marginBottom: "24px" }} />

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <button
              type="button"
              onClick={handleTakeOver}
              disabled={takingOver}
              style={{
                width: "100%", padding: "14px",
                background: takingOver ? "#555" : "#fff",
                color: takingOver ? "#ccc" : "#000",
                border: "none", ...mono,
                fontSize: "14px", letterSpacing: "2px",
                cursor: takingOver ? "not-allowed" : "pointer",
                fontWeight: "bold", minHeight: "48px",
              }}
            >
              {takingOver ? "RELOADING…" : "RUN HERE INSTEAD →"}
            </button>

            <button
              type="button"
              onClick={() => window.close()}
              style={{
                width: "100%", padding: "13px",
                background: "transparent", color: "#fff",
                border: "2px solid #fff", ...mono,
                fontSize: "13px", letterSpacing: "2px",
                cursor: "pointer", minHeight: "48px",
              }}
            >
              CLOSE THIS TAB
            </button>
          </div>
        </div>

        <div style={{ ...mono, fontSize: "10px", letterSpacing: "3px", opacity: 0.3, marginTop: "24px" }}>
          ZERO TELEMETRY // LOCAL FIRST
        </div>
      </div>
    </>
  );
}

// ── Root component — decides what to render ───────────────────────────────────
function Root() {
  // null = still checking, true = duplicate, false = primary
  const [isDuplicate, setIsDuplicate] = useState(null);
  // true = a new tab opened while we are the primary (warn the user)
  const [newTabDetected, setNewTabDetected] = useState(false);

  useEffect(() => {
    let ch = null;

    detectDuplicateTab().then((dup) => {
      setIsDuplicate(dup);

      if (!dup) {
        // We are the primary tab — open a channel to reply to future duplicates
        // and to receive takeover notices.
        if (typeof BroadcastChannel === "undefined") return;
        ch = new BroadcastChannel(TAB_CHANNEL_NAME);
        ch.onmessage = (e) => {
          if (e.data?.type === "hello") {
            // A new duplicate tab announced itself — reply alive.
            ch.postMessage({ type: "alive" });
            // Surface a non-blocking warning in the primary tab so the user
            // knows something odd is happening.
            setNewTabDetected(true);
          }
          if (e.data?.type === "takeover") {
            // The other tab is claiming primary — this tab is now stale.
            setIsDuplicate(true);
          }
        };
      }
    });

    return () => {
      if (ch) ch.close();
    };
  }, []);

  // Still running the duplicate check — render nothing (avoids flash)
  if (isDuplicate === null) return null;

  // Confirmed duplicate
  if (isDuplicate) return <DuplicateScreen />;

  // Primary tab — render the real app
  return (
    <>
      <GlobalStyles />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      {/* Non-blocking banner when a duplicate opened while we are primary */}
      {newTabDetected && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 99999,
          background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: "13px", letterSpacing: "1px",
          padding: "12px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "12px",
        }}>
          <span>⚠ Another RITMOL tab opened. Close it to avoid sync conflicts.</span>
          <button
            type="button"
            onClick={() => setNewTabDetected(false)}
            style={{
              background: "#000", color: "#fff", border: "none",
              fontFamily: "inherit", fontSize: "13px", letterSpacing: "1px",
              padding: "6px 12px", cursor: "pointer", flexShrink: 0,
              minHeight: "32px",
            }}
          >
            DISMISS
          </button>
        </div>
      )}
    </>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await bootDb();
  } catch (e) {
    console.error("[RITMOL] bootDb failed — rendering with empty state:", e);
  }

  const root = document.getElementById("root");
  if (!root) { console.error("RITMOL: #root element not found. Cannot mount."); return; }
  ReactDOM.createRoot(root).render(<Root />);
}

// ── Service-worker update handler ─────────────────────────────────────────────
// When a new SW activates it sends SW_UPDATED to all open clients.
// We reload so the page fetches the new HTML + JS rather than mixing
// stale cached chunks with the freshly deployed assets.
if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "SW_UPDATED") {
      window.location.reload();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    import("./sync/SyncManager").then(({ closeSyncChannel }) => closeSyncChannel());
    import("./api/dynamicCosts").then((m) => m.resetDcInFlight());
  });
}
