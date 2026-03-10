// ═══════════════════════════════════════════════════════════════
// AppContext
//
// Provides the full app context to all tabs and components so
// they don't need 15+ props drilled through every parent.
//
// Usage in any tab:
//   import { useAppContext } from "../context/AppContext";
//   const { state, awardXP, showBanner, ... } = useAppContext();
//
// Components that were receiving props like:
//   ProfileTab({ state, setState, profile, level, rank, ... })
// can now just call useAppContext() and destructure what they need.
// ═══════════════════════════════════════════════════════════════

import { createContext, useContext } from "react";

export const AppContext = createContext(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppContext.Provider");
  return ctx;
}
