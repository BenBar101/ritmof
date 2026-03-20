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
// Uses BroadcastChannel so detection is instant (no polling, no localStorage).
// Protocol:
//   1. New tab opens → broadcasts "hello". Waits HELLO_TIMEOUT_MS.
//   2. An existing primary tab receives "hello" → replies "alive".
//   3. If new tab gets "alive" it knows it's a duplicate → shows DuplicateScreen.
//   4. "RUN HERE INSTEAD" → new tab broadcasts "takeover". Primary closes its
//      channel immediately (stops replying to "hello"), then the new tab reloads
//      and boots as primary without getting an "alive" reply.
const TAB_CHANNEL_NAME = IS_DEV ? "ritmol_dev_tab" : "ritmol_tab";
const HELLO_TIMEOUT_MS = 600;

// Module-level ref so the primary channel can be closed from anywhere
// (including the takeover handler) without React closure issues.
let _primaryChannel = null;

function closePrimaryChannel() {
  if (_primaryChannel) {
    _primaryChannel.close();
    _primaryChannel = null;
  }
}

async function detectDuplicateTab() {
  if (typeof BroadcastChannel === "undefined") return false;
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

    ch.postMessage({ type: "hello" });
    setTimeout(() => done(false), HELLO_TIMEOUT_MS);
  });
}

// ── DuplicateScreen ───────────────────────────────────────────────────────────
function DuplicateScreen() {
  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const [takingOver, setTakingOver] = useState(false);

  function handleTakeOver() {
    setTakingOver(true);
    try {
      // Tell the primary tab to close its channel NOW so it stops replying
      // to "hello". We must do this before reloading — if the primary channel
      // is still open when this tab reloads and broadcasts "hello", it would
      // reply "alive" and we'd land on DuplicateScreen again.
      const ch = new BroadcastChannel(TAB_CHANNEL_NAME);
      ch.postMessage({ type: "takeover" });
      // Give the message time to be received, then reload.
      // The primary's onmessage closes _primaryChannel synchronously on receipt,
      // so 400ms is more than enough even on slow connections.
      setTimeout(() => {
        ch.close();
        window.location.reload();
      }, 400);
    } catch {
      // BroadcastChannel unavailable — just reload anyway
      setTimeout(() => window.location.reload(), 100);
    }
  }

  return (
    <>
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
            border: "1px solid #fff", clipPath: "inherit", pointerEvents: "none",
          }} />

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <span style={{ ...mono, fontSize: "11px", letterSpacing: "3px", opacity: 0.5 }}>RITMOL</span>
            <div style={{ flex: 1, height: "2px", background: "#fff", position: "relative" }}>
              <div style={{
                position: "absolute", right: -8, top: -3,
                width: 8, height: 8, background: "#fff", transform: "rotate(45deg)",
              }} />
            </div>
            <span style={{
              fontSize: "11px", letterSpacing: "2px",
              border: "1px solid #fff", padding: "2px 8px",
              animation: "blink 1.2s step-start infinite",
            }}>ALERT</span>
          </div>

          <div style={{ ...mono, fontSize: "22px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "8px" }}>
            DUPLICATE INSTANCE
          </div>
          <div style={{ ...mono, fontSize: "11px", letterSpacing: "3px", opacity: 0.5, marginBottom: "24px" }}>
            SYSTEM CONFLICT DETECTED
          </div>
          <div style={{ ...mono, fontSize: "14px", lineHeight: "1.8", color: "#ccc", marginBottom: "28px" }}>
            RITMOL is already running in another tab or window. Running two
            instances simultaneously risks data corruption and sync conflicts.
            <br /><br />
            Close the other tab, then return here — or take over below.
          </div>

          <div style={{ height: "1px", background: "#333", marginBottom: "24px" }} />

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

// ── Root ──────────────────────────────────────────────────────────────────────
function Root() {
  const [isDuplicate, setIsDuplicate] = useState(null);
  const [newTabDetected, setNewTabDetected] = useState(false);

  useEffect(() => {
    detectDuplicateTab().then((dup) => {
      setIsDuplicate(dup);

      if (!dup) {
        // We are the primary — open the channel and keep it alive.
        if (typeof BroadcastChannel === "undefined") return;
        _primaryChannel = new BroadcastChannel(TAB_CHANNEL_NAME);
        _primaryChannel.onmessage = (e) => {
          if (e.data?.type === "hello") {
            // Reply to any new tab that announces itself.
            _primaryChannel?.postMessage({ type: "alive" });
            setNewTabDetected(true);
          }
          if (e.data?.type === "takeover") {
            // The duplicate tab is claiming primary — close our channel
            // IMMEDIATELY so we stop replying to future "hello" messages.
            // This is the key fix: without this, after the duplicate reloads
            // and broadcasts "hello", we'd still be alive and reply, sending
            // it back to DuplicateScreen.
            closePrimaryChannel();
            setIsDuplicate(true);
          }
        };
      }
    });

    // Cleanup: close channel when Root unmounts (HMR, etc.)
    return () => closePrimaryChannel();
  }, []);

  if (isDuplicate === null) return null;
  if (isDuplicate) return <DuplicateScreen />;

  return (
    <>
      <GlobalStyles />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
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
    closePrimaryChannel();
    import("./sync/SyncManager").then(({ closeSyncChannel }) => closeSyncChannel());
    import("./api/dynamicCosts").then((m) => m.resetDcInFlight());
  });
}
