import React from "react";
import ReactDOM from "react-dom/client";
import App, { GlobalStyles, ErrorBoundary } from "./App.jsx";

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
