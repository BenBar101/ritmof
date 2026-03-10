// ═══════════════════════════════════════════════════════════════
// useSync
//
// Owns all Syncthing file sync logic that was previously scattered
// through App.jsx (~200 lines). Exposes a clean API:
//
//   syncPush()      — write current state to sync file
//   syncPull()      — read sync file, rehydrate state
//   pickSyncFile()  — open file picker
//   forgetSyncFile()— unlink (double-confirm)
//   syncFileConnected — bool
//   syncStatus      — "idle" | "syncing" | "synced" | "error"
//   lastSynced      — timestamp or null
//
// The key fix over the original:
//  isPullingRef lived in App and was passed into the visibility
//  handler via closure — but the auto-push effect captured a
//  stale closure and sometimes missed the flag. Here the mutex
//  and the auto-push effect both live in the same module so
//  they always share the same ref object.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { LS, storageKey } from "../utils/storage";
import { SyncManager } from "../sync/SyncManager";

export function useSync({ latestStateRef, rehydrate, showBanner }) {
  const [syncFileConnected, setSyncFileConnected] = useState(false);
  const [syncStatus, setSyncStatus]               = useState("idle");
  const [lastSynced, setLastSynced]               = useState(() =>
    LS.get(storageKey("jv_last_synced"), null)
  );

  // Mutex: prevents auto-push from clobbering a concurrent manual Pull.
  // Fix [S-2]: keeping this ref inside the same hook as the auto-push
  // effect guarantees both sides always see the same object — no stale
  // closure from passing the ref down through props.
  const isPullingRef = useRef(false);

  // ── Check if a sync file is already linked on mount ──
  useEffect(() => {
    SyncManager.getHandle().then((h) => setSyncFileConnected(!!h)).catch(() => {});
  }, []);

  // ── Auto-push on tab hide / page hide ──
  useEffect(() => {
    let debounceTimer = null;

    const schedulePush = () => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(async () => {
        try {
          if (isPullingRef.current) return; // skip during Pull [S-2]
          const handle = await SyncManager.getHandle().catch(() => null);
          if (!handle) return;
          if (!latestStateRef.current?.profile) return;
          const ts = await SyncManager.push();
          LS.set(storageKey("jv_last_synced"), String(ts));
          setSyncStatus("synced");
          setLastSynced(ts);
        } catch (e) {
          console.warn("[useSync] Auto-push failed:", e.message);
        } finally {
          debounceTimer = null;
        }
      }, 250);
    };

    const onVisibility = () => { if (document.visibilityState === "hidden") schedulePush(); };
    const onPageHide   = () => schedulePush();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [latestStateRef]); // latestStateRef is stable — safe dep

  // ── Push ──────────────────────────────────────────────────
  const syncPush = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      if (!latestStateRef.current?.profile) {
        setSyncStatus("idle");
        showBanner("Nothing to push yet. Complete onboarding first.", "info");
        return;
      }
      const ts = await SyncManager.push();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pushed to Syncthing file.", "success");
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:        "No sync file selected. Pick one in Profile → Settings.",
        PERMISSION_DENIED:"Write permission denied. Try again and allow access.",
        SYNC_BUSY:        "Sync already in progress. Please wait.",
      };
      showBanner(msgs[e.message] ?? `Push failed: ${(e.message || "").slice(0, 80)}`, "alert");
    }
  }, [latestStateRef, showBanner]);

  // ── Pull ──────────────────────────────────────────────────
  const syncPull = useCallback(async () => {
    setSyncStatus("syncing");
    isPullingRef.current = true; // [S-2] block auto-push during Pull
    try {
      const ts = await SyncManager.pull();
      // rehydrate reads from localStorage (which Pull just wrote) and
      // resets React state atomically — no initState race condition.
      rehydrate();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pulled data from Syncthing file.", "success");
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:             "No sync file selected. Pick one in Profile → Settings.",
        CORRUPT_FILE:          "Sync file is corrupt or not valid JSON. Re-export from another device.",
        SYNC_SCHEMA_OUTDATED:  "Sync file was written by an older version of RITMOL. Re-export it from an up-to-date device.",
        SYNC_FILE_TOO_LARGE:   "Sync file exceeds 10 MB — this is unexpected. Check the file.",
        APPLY_QUOTA_RISK:      "Pull failed: local storage is almost full (~5MB). Clear old chat history or sessions first.",
        SYNC_BUSY:             "Sync already in progress. Please wait.",
      };
      showBanner(msgs[e.message] ?? `Pull failed: ${(e.message || "").slice(0, 80)}`, "alert");
    } finally {
      isPullingRef.current = false; // always release mutex
    }
  }, [rehydrate, showBanner]);

  // ── Pick file ─────────────────────────────────────────────
  const pickSyncFile = useCallback(async () => {
    try {
      await SyncManager.pickFile();
      setSyncFileConnected(true);
      showBanner("Sync file linked. Push or Pull to sync.", "success");
    } catch (e) {
      if (e.name !== "AbortError") showBanner("Could not pick file.", "alert");
    }
  }, [showBanner]);

  // ── Forget file (double-confirm) ──────────────────────────
  const [confirmForgetSync, setConfirmForgetSync] = useState(false);
  const confirmTimerRef = useRef(null);

  // Cleanup confirm timer on unmount
  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  const forgetSyncFile = useCallback(async () => {
    if (!confirmForgetSync) {
      setConfirmForgetSync(true);
      confirmTimerRef.current = setTimeout(() => setConfirmForgetSync(false), 4000);
      return;
    }
    clearTimeout(confirmTimerRef.current);
    setConfirmForgetSync(false);
    await SyncManager.forget();
    setSyncFileConnected(false);
    setSyncStatus("idle");
    showBanner("Sync file unlinked.", "success");
  }, [confirmForgetSync, showBanner]);

  return {
    syncFileConnected,
    syncStatus,
    lastSynced,
    confirmForgetSync,
    syncPush,
    syncPull,
    pickSyncFile,
    forgetSyncFile,
  };
}
