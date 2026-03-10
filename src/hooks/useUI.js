// ═══════════════════════════════════════════════════════════════
// useUI
//
// Owns ephemeral UI state: banner, toast, modal, levelUpData.
// Extracted from App.jsx to give each piece of state a clear owner.
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useCallback } from "react";

export function useUI() {
  const [modal,       setModal]       = useState(null); // { type, ...data }
  const [toast,       setToast]       = useState(null);
  const [banner,      setBanner]      = useState(null);
  const [levelUpData, setLevelUpData] = useState(null);

  const toastTimerRef  = useRef(null);
  const bannerTimerRef = useRef(null);

  const showToast = useCallback((data) => {
    clearTimeout(toastTimerRef.current);
    setToast({ ...data, _id: data._id || crypto.randomUUID() });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const showBanner = useCallback((text, type = "info") => {
    clearTimeout(bannerTimerRef.current);
    setBanner({ text, type });
    bannerTimerRef.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  return {
    modal, setModal,
    toast, setToast,
    banner, setBanner,
    levelUpData, setLevelUpData,
    showToast, showBanner,
  };
}
