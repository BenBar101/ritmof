// ═══════════════════════════════════════════════════════════════
// useSync — Dropbox transport only
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { LS, storageKey, getGeminiApiKey } from "../utils/db";
import { SyncManager, getTransport, setTransport } from "../sync/SyncManager";
import {
  isAuthenticated,
  startOAuthFlow,
  handleOAuthCallback,
  ensureFreshToken,
  clearTokens,
} from "../api/dropbox";

export function useSync({ latestStateRef, rehydrate, showBanner }) {
  const [dropboxConnected, setDropboxConnected] = useState(() => isAuthenticated());
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSynced, setLastSynced] = useState(() =>
    LS.get(storageKey("jv_last_synced"), null)
  );
  const [isReloading, setIsReloading] = useState(false);

  const isPullingRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const pageHideInProgressRef = useRef(false);
  const blockUntilRef = useRef(0);

  useEffect(() => {
    if (isAuthenticated()) {
      setDropboxConnected(true);
      setTransport("dropbox");
    }
  }, []);

  const autoPullAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoPullAttemptedRef.current) return;
    if (!isAuthenticated()) return;
    if (getGeminiApiKey()) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    autoPullAttemptedRef.current = true;
    setSyncStatus("syncing");
    let cancelled = false;
    isPullingRef.current = true;
    (async () => {
      try {
        await SyncManager.pull();
        if (cancelled) { isPullingRef.current = false; return; }
        await rehydrate();
        LS.set(storageKey("jv_last_synced"), String(Date.now()));
        setLastSynced(Date.now());
        setSyncStatus("synced");
        setIsReloading(true);
        reloadTimerRef.current = setTimeout(() => {
          try { window.location.reload(); } catch { isPullingRef.current = false; }
        }, 400);
      } catch (e) {
        if (cancelled) { isPullingRef.current = false; return; }
        if (e.message === "DROPBOX_TOKEN_EXPIRED") {
          clearTokens();
          setDropboxConnected(false);
        }
        setSyncStatus("idle");
        isPullingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
      if (isPullingRef.current) isPullingRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only effect
  }, []);

  useEffect(() => {
    const schedulePush = () => {
      if (isPullingRef.current) return;
      if (debounceTimerRef.current) return;
      if (Date.now() < blockUntilRef.current) return;
      debounceTimerRef.current = setTimeout(async () => {
        try {
          if (Date.now() < blockUntilRef.current) return;
          if (isPullingRef.current) return;
          if (!isAuthenticated()) return;
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
      if (e.persisted) {
        isPullingRef.current = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") schedulePush(); };
    const onPageHide = () => {
      if (pageHideInProgressRef.current) return;
      pageHideInProgressRef.current = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      (async () => {
        if (!isAuthenticated() || isPullingRef.current || !latestStateRef.current?.profile) return;
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
  }, [latestStateRef]);

  const syncPush = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setSyncStatus("syncing");
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
      showBanner("Pushed to Dropbox.", "success");
    } catch (e) {
      if (e.message === "SYNC_SKIPPED") {
        setSyncStatus("idle");
        showBanner("Push skipped: sync file was just modified externally. Pull first or retry in a moment.", "info");
        return;
      }
      console.error("[useSync] Push failed:", e);
      setSyncStatus("error");
      const msgs = {
        PERMISSION_DENIED:   "Write permission denied. Try again and allow access.",
        SYNC_BUSY:           "Sync already in progress. Please wait.",
        IDB_NOT_READY:       "Still loading, try again.",
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
        setSyncStatus("idle");
      }
      const safeMsg = (e.message || "")
        .replace(/AIza[A-Za-z0-9_-]{30,50}/g, "[key]")
        .replace(/eyJ[\w.-]+/g, "[token]")
        .slice(0, 80);
      showBanner(msgs[e.message] ?? `Push failed: ${safeMsg}`, "alert");
    }
  }, [latestStateRef, showBanner]);

  const syncPull = useCallback(async () => {
    setSyncStatus("syncing");
    if (getTransport() === "dropbox" && typeof navigator !== "undefined" && navigator.onLine === false) {
      setSyncStatus("error");
      showBanner("No network connection. Dropbox sync requires connectivity.", "alert");
      return;
    }
    isPullingRef.current = true;
    let _willReload = false;
    try {
      const ts = await SyncManager.pull();
      await rehydrate();
      LS.set(storageKey("jv_last_synced"), String(ts));
      setLastSynced(ts);
      setSyncStatus("synced");
      showBanner("Pulled data from Dropbox.", "success");
      _willReload = true;
      setIsReloading(true);
      reloadTimerRef.current = setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          try {
            window.location.href = window.location.origin + window.location.pathname;
          } catch {
            _willReload = false;
          }
        }
        if (!_willReload) isPullingRef.current = false;
      }, 800);
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
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
  }, [rehydrate, showBanner]);

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
            isPullingRef.current = false;
          }
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
    setDropboxConnected(false);
    showBanner("Dropbox disconnected.", "info");
  }, [showBanner]);

  return {
    dropboxConnected,
    syncStatus,
    lastSynced,
    syncPush,
    syncPull,
    connectDropbox,
    handleDropboxCallback,
    disconnectDropbox,
    isReloading,
    resetPullMutex: useCallback(() => { isPullingRef.current = false; }, []),
  };
}
