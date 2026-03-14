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
import { LS, storageKey, getGeminiApiKey } from "../utils/storage";
import { SyncManager, getTransport, setTransport } from "../sync/SyncManager";
import {
  isAuthenticated,
  startOAuthFlow,
  handleOAuthCallback,
  ensureFreshToken,
  clearTokens,
} from "../api/dropbox";

export function useSync({ latestStateRef, rehydrate, showBanner }) {
  const [syncFileConnected, setSyncFileConnected] = useState(false);
  const [dropboxConnected, setDropboxConnected]   = useState(() => isAuthenticated());
  const [syncStatus, setSyncStatus]               = useState("idle");
  const [lastSynced, setLastSynced]               = useState(() =>
    LS.get(storageKey("jv_last_synced"), null)
  );
  // true during the 800ms window between pull completion and page reload;
  // used by App.jsx to render a non-interactive overlay that prevents state writes.
  const [isReloading, setIsReloading]             = useState(false);

  // Mutex: prevents auto-push from clobbering a concurrent manual Pull.
  // Fix [S-2]: keeping this ref inside the same hook as the auto-push
  // effect guarantees both sides always see the same object — no stale
  // closure from passing the ref down through props.
  const isPullingRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const pageHideInProgressRef = useRef(false);
  const blockUntilRef = useRef(0);

  // ── Check if a sync file is already linked on mount ──
  useEffect(() => {
    if (isAuthenticated()) {
      setDropboxConnected(true);
      setTransport("dropbox");
      setSyncFileConnected(true);
    } else {
      SyncManager.getHandle().then((h) => setSyncFileConnected(!!h)).catch(() => {});
    }
  }, []);

  // ── Auto-push on tab hide / page hide ──
  useEffect(() => {
    const schedulePush = () => {
      if (isPullingRef.current) return;
      if (debounceTimerRef.current) return;
      if (Date.now() < blockUntilRef.current) return;
      // 500ms debounce: ensures React's write-through setState has committed
      // to the TinyBase store before SyncManager.push() reads it.
      debounceTimerRef.current = setTimeout(async () => {
        try {
          if (Date.now() < blockUntilRef.current) return;
          if (isPullingRef.current) return; // skip during Pull [S-2]
          const transport = getTransport();
          const canPush = transport === "dropbox"
            ? isAuthenticated()
            : await SyncManager.getHandle().then((h) => !!h).catch(() => false);
          if (!canPush) return;
          if (!latestStateRef.current?.profile) return;
          const ts = await SyncManager.push();
          LS.set(storageKey("jv_last_synced"), String(ts));
          setSyncStatus("synced");
          setLastSynced(ts);
        } catch (e) {
          console.warn("[useSync] Auto-push failed:", e.message);
        } finally {
          debounceTimerRef.current = null;
        }
      }, 500);
    };

    const onBlockAutopush = (e) => {
      const ms = e?.detail?.ms ?? 3000;
      blockUntilRef.current = Date.now() + ms;
    };
    const onPageShow = (e) => {
      // e.persisted is true when the page is restored from bfcache.
      // isPullingRef may have been left true by a Pull that triggered the
      // reload that caused this bfcache entry — reset it so auto-push and
      // future Pulls are not permanently blocked.
      if (e.persisted) {
        isPullingRef.current = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") schedulePush(); };
    const onPageHide   = () => {
      if (pageHideInProgressRef.current) return;
      pageHideInProgressRef.current = true;
      // On browser/tab close, flush immediately without debounce so the final
      // state is best-effort pushed even if the 500ms timer would not fire.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      (async () => {
        const transport = getTransport();
        const canPush = transport === "dropbox"
          ? isAuthenticated()
          : await SyncManager.getHandle().then((h) => !!h).catch(() => false);
        if (!canPush || isPullingRef.current || !latestStateRef.current?.profile) return;
        return SyncManager.push();
      })()
        .catch((e) => {
          if (e?.message !== "IDB_NOT_READY") console.warn("[useSync] pagehide push failed:", e?.message);
        })
        .finally(() => {
          pageHideInProgressRef.current = false;
        });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("ritmol:block-autopush", onBlockAutopush);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("ritmol:block-autopush", onBlockAutopush);
    };
  }, [latestStateRef]); // latestStateRef is stable — safe dep

  // ── Push ──────────────────────────────────────────────────
  const syncPush = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSyncStatus("syncing");
    // Fast-fail for Dropbox when offline to avoid a 20s ensureFreshToken() timeout.
    if (getTransport() === "dropbox" && typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("error");
      showBanner("No network connection. Dropbox sync requires connectivity.", "alert");
      return;
    }
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
      if (e.message === "SYNC_SKIPPED") {
        setSyncStatus("idle");
        // Inform the user why the push was skipped so they don't think it failed silently.
        showBanner("Push skipped: sync file was just modified externally. Pull first or retry in a moment.", "info");
        return;
      }
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:           "No sync file selected. Pick one in Profile → Settings.",
        PERMISSION_DENIED:   "Write permission denied. Try again and allow access.",
        SYNC_BUSY:           "Sync already in progress. Please wait.",
        IDB_NOT_READY:       "Still loading, try again.",
        SYNC_FILE_NOT_FOUND: "Sync file not found — it may have been moved or deleted. Pick a new file in Profile → Settings.",
        DROPBOX_AUTH_REQUIRED: "Connect Dropbox in Profile → Settings to sync.",
        DROPBOX_TOKEN_EXPIRED: "Dropbox session expired. Reconnect in Profile → Settings.",
        DROPBOX_CONFLICT:      "Remote file changed since last pull. Pull first.",
        DROPBOX_FILE_NOT_FOUND: "No RITMOL save file found in Dropbox. Push to create one.",
        DROPBOX_QUOTA_EXCEEDED: "Dropbox storage full. Free up space and try again.",
        DROPBOX_OFFLINE:        "No network connection. Sync requires connectivity.",
        DROPBOX_TIMEOUT:       "Dropbox request timed out. Check your connection and try again.",
      };
      if (e.message === "SYNC_FILE_NOT_FOUND") {
        SyncManager.forget().catch(() => {});
        setSyncFileConnected(false);
        setSyncStatus("idle");
      }
      if (e.message === "DROPBOX_TOKEN_EXPIRED") {
        clearTokens();
        setDropboxConnected(false);
        setSyncFileConnected(false);
        setTransport("download");
        setSyncStatus("idle");
      }
      const safeMsg = (e.message || "")
        .replace(/AIza[A-Za-z0-9_-]{30,50}/g, "[key]")
        .replace(/eyJ[\w.-]+/g, "[token]")
        .slice(0, 80);
      showBanner(msgs[e.message] ?? `Push failed: ${safeMsg}`, "alert");
    }
  }, [latestStateRef, showBanner]);

  // ── Pull ──────────────────────────────────────────────────
  const syncPull = useCallback(async () => {
    setSyncStatus("syncing");
    // Fast-fail for Dropbox transport when offline — avoids a 20s timeout inside
    // ensureFreshToken(). FSAPI/download transports read local files and do not need
    // this guard (SyncManager.pull() will succeed offline for those paths).
    if (getTransport() === "dropbox" && typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("error");
      showBanner("No network connection. Dropbox sync requires connectivity.", "alert");
      return;
    }
    // Write-through setState (useAppState) persists synchronously to IDB; no flush needed before pull.
    isPullingRef.current = true; // [S-2] block auto-push during Pull
    let _willReload = false;
    try {
      const ts = await SyncManager.pull();
      // rehydrate calls initState() which reads from the TinyBase store
      // (already updated by applyPayload via idbSet) and resets React state
      // atomically — no initState race condition.
      await rehydrate();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      const _pullTransport = getTransport();
      const _pullBannerMsg = _pullTransport === "dropbox"
        ? "Pulled data from Dropbox."
        : "Pulled data from sync file.";
      showBanner(_pullBannerMsg, "success");
      // After a successful pull and rehydrate, a full reload ensures any components
      // with local UI state derived from the old global state are reset to match
      // the freshly loaded data.
      _willReload = true;
      setIsReloading(true);
      reloadTimerRef.current = setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          try {
            window.location.href = window.location.origin + window.location.pathname;
          } catch {
            // Reload blocked (e.g. Safari private mode).
            _willReload = false;
          }
        }
        // Reload may be blocked without throwing. Release mutex so auto-push can resume.
        // If reload worked we're gone anyway; if blocked, state is already rehydrated.
        if (!_willReload) isPullingRef.current = false;
      }, 800);
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:             "No sync file selected. Pick one in Profile → Settings.",
        CORRUPT_FILE:          "Sync file is corrupt or not valid JSON. Re-export from another device.",
        SYNC_SCHEMA_OUTDATED:  "Sync file was written by an older version of RITMOL. Re-export it from an up-to-date device.",
        SYNC_FILE_TOO_LARGE:   "Sync file exceeds 10 MB — this is unexpected. Check the file.",
        SYNC_BUSY:             "Sync already in progress. Please wait.",
        IDB_NOT_READY:         "Still loading, try again.",
        DROPBOX_AUTH_REQUIRED: "Connect Dropbox in Profile → Settings to sync.",
        DROPBOX_TOKEN_EXPIRED: "Dropbox session expired. Reconnect in Profile → Settings.",
        DROPBOX_CONFLICT:      "Remote file changed since last pull. Pull first.",
        DROPBOX_FILE_NOT_FOUND: "No RITMOL save file found in Dropbox. Push to create one.",
        DROPBOX_QUOTA_EXCEEDED: "Dropbox storage full. Free up space and try again.",
        DROPBOX_OFFLINE:        "No network connection. Sync requires connectivity.",
        DROPBOX_TIMEOUT:       "Dropbox request timed out. Check your connection and try again.",
      };
      if (e.message === "DROPBOX_TOKEN_EXPIRED") {
        clearTokens();
        setDropboxConnected(false);
        setSyncFileConnected(false);
        setTransport("download");
        setSyncStatus("idle");
      }
      const safeMsg = (e.message || "")
        .replace(/AIza[A-Za-z0-9_-]{30,50}/g, "[key]")
        .replace(/eyJ[\w.-]+/g, "[token]")
        .slice(0, 80);
      showBanner(msgs[e.message] ?? `Pull failed: ${safeMsg}`, "alert");
    } finally {
      if (!_willReload) isPullingRef.current = false;
    }
    // On success, isPullingRef stays true until reload clears the page.
  }, [rehydrate, showBanner]);

  // ── Pick file ─────────────────────────────────────────────
  const pickSyncFile = useCallback(async () => {
    try {
      await SyncManager.pickFile();
      setSyncFileConnected(true);
      let persisted = true;
      try {
        persisted = await SyncManager.isHandlePersisted();
      } catch {
        persisted = false;
      }
      if (!persisted) {
        showBanner("Sync file linked for this session only — browser storage restrictions prevent persisting the link.", "alert");
      } else {
        showBanner("Sync file linked. Push or Pull to sync.", "success");
      }
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

  const connectDropbox = useCallback(() => {
    try {
      startOAuthFlow();
    } catch (e) {
      if (e?.message === "DROPBOX_NOT_CONFIGURED") {
        showBanner("Dropbox App Key is not configured. See .env.example and rebuild.", "alert");
        return;
      }
      showBanner("Could not start Dropbox connection.", "alert");
    }
  }, [showBanner]);

  const dropboxErrorMsgs = {
    DROPBOX_AUTH_REQUIRED: "Connect Dropbox in Profile → Settings to sync.",
    DROPBOX_TOKEN_EXPIRED: "Dropbox session expired. Reconnect in Profile → Settings.",
    DROPBOX_CONFLICT: "Remote file changed since last pull. Pull first.",
    DROPBOX_FILE_NOT_FOUND: "No RITMOL save file found in Dropbox. Push to create one.",
    DROPBOX_QUOTA_EXCEEDED: "Dropbox storage full. Free up space and try again.",
    DROPBOX_OFFLINE: "No network connection. Sync requires connectivity.",
    DROPBOX_TIMEOUT: "Dropbox request timed out. Check your connection and try again.",
  };

  const handleDropboxCallback = useCallback(async (code, opts = {}) => {
    const { onNeedsGeminiKey } = opts;
    try {
      await handleOAuthCallback(code);
      setTransport("dropbox");
      setDropboxConnected(true);
      setSyncFileConnected(true);
      try {
        await ensureFreshToken();
        isPullingRef.current = true;
        const ts = await SyncManager.pull();
        await rehydrate();
        LS.set(storageKey("jv_last_synced"), String(ts));
        setLastSynced(ts);
        setSyncStatus("synced");
        if (!getGeminiApiKey()) {
          isPullingRef.current = false;
          onNeedsGeminiKey?.();
          return;
        }
        showBanner("Pulled data from Dropbox.", "success");
        setIsReloading(true);
        reloadTimerRef.current = setTimeout(() => {
          let navigated = false;
          try {
            window.location.reload();
            navigated = true;
          } catch {
            try {
              window.location.href = window.location.origin + window.location.pathname;
              navigated = true;
            } catch {
              /* navigation fully blocked */
            }
          }
          if (!navigated) {
            // Navigation was fully blocked — release mutex so future Pulls can run.
            isPullingRef.current = false;
          }
          // Safety release: if the page was not unloaded within 3 s (navigation blocked
          // silently without throwing), release the mutex. Only schedule this timer when
          // navigation was attempted — if navigation was blocked above we already released.
          if (navigated) {
            setTimeout(() => {
              isPullingRef.current = false;
            }, 3000);
          }
        }, 800);
      } catch (pullErr) {
        isPullingRef.current = false;
        if (pullErr?.message === "DROPBOX_FILE_NOT_FOUND") {
          onNeedsGeminiKey?.();
          showBanner(dropboxErrorMsgs.DROPBOX_FILE_NOT_FOUND, "alert");
          return;
        }
        throw pullErr;
      }
    } catch (e) {
      isPullingRef.current = false;
      showBanner(dropboxErrorMsgs[e?.message] ?? "Dropbox connection failed.", "alert");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dropboxErrorMsgs is stable
  }, [rehydrate, showBanner]);

  const disconnectDropbox = useCallback(() => {
    clearTokens();
    setTransport("download");
    setDropboxConnected(false);
    setSyncFileConnected(false);
    showBanner("Dropbox disconnected.", "info");
  }, [showBanner]);

  const forgetSyncFile = useCallback(async () => {
    if (!confirmForgetSync) {
      setConfirmForgetSync(true);
      confirmTimerRef.current = setTimeout(() => setConfirmForgetSync(false), 4000);
      return;
    }
    clearTimeout(confirmTimerRef.current);
    setConfirmForgetSync(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await SyncManager.forget();
    setSyncFileConnected(false);
    setSyncStatus("idle");
    showBanner("Sync file unlinked.", "success");
  }, [confirmForgetSync, showBanner]);

  return {
    syncFileConnected,
    dropboxConnected,
    syncStatus,
    lastSynced,
    confirmForgetSync,
    syncPush,
    syncPull,
    pickSyncFile,
    forgetSyncFile,
    connectDropbox,
    handleDropboxCallback,
    disconnectDropbox,
    isReloading,
    resetPullMutex: useCallback(() => { isPullingRef.current = false; }, []),
  };
}
