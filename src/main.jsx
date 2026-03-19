import React from "react";
import ReactDOM from "react-dom/client";
import App, { GlobalStyles, ErrorBoundary } from "./App";
import { bootDb, store } from "./utils/db";

// Dev-only test hooks for E2E: inject sync payload, inspect store state.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.__RITMOL_TEST__ = {
    injectSync: null,
    getState: () => (store ? store.getValues() : {}),
  };
}

// Single entry point for mounting. Keeping this separate from App.jsx means
// importing App in tests (or alternative entry points) does not trigger
// ReactDOM.createRoot as a module-load side effect.
function mount() {
  const root = document.getElementById("root");
  if (!root) { console.error("RITMOL: #root element not found. Cannot mount."); return; }
  ReactDOM.createRoot(root).render(
    <><GlobalStyles /><ErrorBoundary><App /></ErrorBoundary></>
  );
}

async function start() {
  try {
    await bootDb();
  } catch (e) {
    console.error("[RITMOL] bootDb failed — rendering with empty state:", e);
  }
  mount();
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
