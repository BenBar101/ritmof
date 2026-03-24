import React, { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { useAppContext } from "./context/AppContext";
import { getGeminiApiKey, setGeminiApiKey, getMaxDateSeen, IS_DEV } from "./utils/db";
import { DATA_DISCLOSURE_SEEN_KEY, THEME_KEY } from "./constants";
import { clearRateLimitWindow } from "./api/gemini";
import { SyncManager } from "./sync/SyncManager";
import { LocalNotifications } from "@capacitor/local-notifications";
import { startGoogleOAuthFlow, revokeGoogleAuth } from "./api/googleAuth";
import { idbClearAll, idbSet } from "./utils/db";
import { RitmolHealth } from "./plugins/RitmolHealth.js";

// Keys belonging to this app but not starting with "jv_" — must be wiped on full reset.
const APP_CONSTANT_KEYS = new Set([DATA_DISCLOSURE_SEEN_KEY, THEME_KEY, "jv_last_synced"]);

const NOTIF_NATIVE =
  typeof LocalNotifications?.requestPermissions === "function" &&
  typeof window !== "undefined" &&
  window?.Capacitor?.isNativePlatform?.();

const HEALTHKIT_SETTINGS =
  typeof window !== "undefined" &&
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === "ios";

export default function SettingsTab() {
  const {
    rehydrate,
    showBanner,
    state, setState,
    syncStatus, lastSynced, dropboxConnected,
    syncPush: onPush, syncPull: onPull,
    connectDropbox, disconnectDropbox,
    theme, setTheme,
    requestNotificationPermission,
  } = useAppContext();

  const importRef = useRef(null);
  const [importLoading, setImportLoading] = useState(false);
  const currentGeminiKey = getGeminiApiKey();
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

  // ── PWA install prompt ────────────────────────────────────────
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installDone, setInstallDone] = useState(false);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function doInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") { setInstallDone(true); setInstallPrompt(null); }
  }

  const isIOS =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetTimerRef = useRef(null);

  useEffect(() => () => {
    if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
  }, []);

  async function handleChangeGeminiKey() {
    try {
      const next = window.prompt(
        "Enter new Gemini API key (stored only in this browser tab):",
        currentGeminiKey || "",
      );
      if (next == null) return;
      const trimmed = next.trim();
      if (!trimmed) {
        showBanner("Gemini API key not changed.", "info");
        return;
      }
      setGeminiApiKey(trimmed);
      clearRateLimitWindow();
      await rehydrate?.();
      showBanner("Gemini API key updated for this session.", "success");
    } catch {
      showBanner("Could not update Gemini API key.", "alert");
    }
  }

  async function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      confirmResetTimerRef.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    clearTimeout(confirmResetTimerRef.current);
    setConfirmReset(false);

    const maxDateSeen = getMaxDateSeen();
    await idbClearAll();
    if (maxDateSeen) {
      idbSet("jv_max_date_seen", maxDateSeen);
      await new Promise((r) => setTimeout(r, 100));
    }
    const lsKeysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("jv_") || k.startsWith("ritmol_dev_") || APP_CONSTANT_KEYS.has(k))) {
        lsKeysToDelete.push(k);
      }
    }
    lsKeysToDelete.forEach((k) => localStorage.removeItem(k));
    await SyncManager.forget();
    setGeminiApiKey("");
    window.location.reload();
  }

  async function handleImportFile(e) {
    if (importLoading || syncStatus === "syncing") {
      showBanner("Sync already in progress. Please wait.", "alert");
      try { e.target.value = ""; } catch { /* ignore */ }
      return;
    }
    setImportLoading(true);
    try {
      const file = e.target.files?.[0];
      if (!file) { setImportLoading(false); return; }
      try {
        await SyncManager.importFile(file);
        window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
        window.location.reload();
      } catch (err) {
        const msgs = {
          CORRUPT_FILE:           "Import failed: file is corrupt or not valid JSON.",
          SYNC_SCHEMA_OUTDATED:   "Import failed: file was written by an older version of RITMOL.",
          SYNC_FILE_TOO_LARGE:    "Import failed: file exceeds 10 MB.",
          SYNC_BUSY:              "Sync already in progress. Please wait.",
          IDB_NOT_READY:          "Import failed: app is still loading — try again in a moment.",
          DROPBOX_AUTH_REQUIRED:  "Import failed: Dropbox session required.",
          DROPBOX_TOKEN_EXPIRED:  "Import failed: Dropbox session expired. Reconnect in Settings.",
          DROPBOX_OFFLINE:        "Import failed: no network connection.",
          DROPBOX_TIMEOUT:        "Import failed: request timed out. Check your connection.",
          DROPBOX_FILE_NOT_FOUND: "Import failed: no RITMOL file found in Dropbox.",
          DROPBOX_QUOTA_EXCEEDED: "Import failed: Dropbox storage is full.",
        };
        const safeErrMsg = (err?.message || "")
          .replace(/AIza[A-Za-z0-9_-]{20,60}/g, "[key]")
          .replace(/eyJ[\w.-]+/g, "[token]")
          .replace(/ya29\.[A-Za-z0-9_-]{20,}/g, "[oauth]")
          .slice(0, 80);
        showBanner(msgs[err?.message] ?? `Import failed: ${safeErrMsg || "check the file"}`, "alert");
      } finally {
        setImportLoading(false);
        e.target.value = "";
      }
    } catch {
      showBanner("Import failed unexpectedly.", "alert");
      setImportLoading(false);
      try { if (importRef.current) importRef.current.value = ""; } catch { /* ignore */ }
    }
  }

  const lastSyncedLabel = lastSynced ? new Date(lastSynced).toLocaleString() : "Never";
  const syncStatusLabel =
    syncStatus === "syncing" ? "SYNCING..." :
    syncStatus === "error"   ? "⚠ SYNC ERROR" :
    syncStatus === "synced"  ? `✓ ${lastSyncedLabel}` :
                               lastSynced ? lastSyncedLabel : "Not synced yet";

  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const fg = theme === "light" ? "#000" : "#fff";
  const bg = theme === "light" ? "#f0f0f0" : "#000";
  const border = `2px solid ${fg}`;
  const dimBorder = `2px solid ${theme === "light" ? "#999" : "#444"}`;
  const dimColor = theme === "light" ? "#555" : "#aaa";

  const sectionHeader = (label) => (
    <div style={{ fontSize: "16px", color: fg, letterSpacing: "2px", fontWeight: "bold", ...mono }}>
      {label}
    </div>
  );

  const divider = <div style={{ height: "1px", background: theme === "light" ? "#ccc" : "#333", margin: "8px 0" }} />;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "20px", background: bg, minHeight: "100%" }}>

      {/* Page title */}
      <div style={{ borderBottom: `3px solid ${fg}`, paddingBottom: "16px", ...mono }}>
        <div style={{ fontSize: "16px", color: fg, letterSpacing: "3px", fontWeight: "bold" }}>[ SYSTEM CONFIG ]</div>
        <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "4px", color: fg }}>SETTINGS</div>
      </div>

      {/* ── APPEARANCE ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {sectionHeader("[ APPEARANCE ]")}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            style={{
              flex: 1, padding: "12px", border,
              background: theme === "dark" ? fg : "transparent",
              color: theme === "dark" ? bg : fg,
              ...mono, fontSize: "16px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px",
            }}
          >
            DARK
          </button>
          <button
            type="button"
            onClick={() => setTheme("light")}
            style={{
              flex: 1, padding: "12px",
              border: theme === "light" ? border : dimBorder,
              background: theme === "light" ? fg : "transparent",
              color: theme === "light" ? bg : fg,
              ...mono, fontSize: "16px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px",
            }}
          >
            LIGHT
          </button>
        </div>
        <div style={{ fontSize: "13px", color: dimColor, ...mono, lineHeight: "1.6" }}>
          More cosmetic options coming soon — rank themes, card borders, HUD styles.
        </div>
      </div>

      {divider}

      {/* ── INSTALL APP ── */}
      {!isStandalone && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {sectionHeader("[ INSTALL APP ]")}
            {installDone ? (
              <div style={{ fontSize: "16px", color: fg, border, padding: "12px", ...mono }}>
                ✓ APP INSTALLED SUCCESSFULLY
              </div>
            ) : installPrompt ? (
              <>
                <div style={{ fontSize: "14px", color: fg, lineHeight: "1.7", opacity: 0.7, ...mono }}>
                  Install RITMOL as an app for offline access and a full-screen experience.
                </div>
                <button
                  type="button"
                  onClick={doInstall}
                  style={{
                    width: "100%", padding: "14px", background: fg, color: bg,
                    ...mono, fontSize: "16px", letterSpacing: "2px", border: "none",
                    cursor: "pointer", minHeight: "56px",
                  }}
                >
                  ⬇ INSTALL APP
                </button>
              </>
            ) : isIOS ? (
              <>
                <div style={{ fontSize: "14px", color: fg, lineHeight: "1.7", opacity: 0.7, ...mono }}>
                  Install RITMOL on your iPhone or iPad:
                </div>
                <div style={{ border, padding: "14px", fontSize: "15px", color: fg, lineHeight: "2", ...mono }}>
                  1. Tap the <strong>Share</strong> button <span style={{ fontSize: "18px" }}>⎋</span> in Safari<br />
                  2. Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong><br />
                  3. Tap <strong>Add</strong>
                </div>
              </>
            ) : (
              <div style={{ fontSize: "14px", color: fg, lineHeight: "1.7", opacity: 0.6, ...mono }}>
                Open this page in Chrome or Edge on Android to install it as an app.
                On iPhone, use Safari → Share → Add to Home Screen.
              </div>
            )}
          </div>
          {divider}
        </>
      )}

      {/* ── SYNC ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {sectionHeader("[ SYNC ]")}

        {dropboxConnected ? (
          <>
            <div style={{ fontSize: "10px", color: dimColor, lineHeight: "1.8", ...mono }}>SYNC — DROPBOX</div>
            <div style={{ fontSize: "16px", color: fg, ...mono }}>● Connected</div>
            <div style={{ fontSize: "16px", color: fg, lineHeight: "1.8", ...mono }}>
              LAST SYNCED: <span style={{ fontWeight: "bold" }}>{syncStatusLabel}</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" onClick={() => {
                if (typeof navigator !== "undefined" && navigator.onLine === false) { showBanner("No network connection.", "alert"); return; }
                onPush();
              }} disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                style={{ flex: 1, padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>
                PUSH ↑
              </button>
              <button type="button" onClick={() => {
                if (typeof navigator !== "undefined" && navigator.onLine === false) { showBanner("No network connection.", "alert"); return; }
                onPull();
              }} disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                style={{ flex: 1, padding: "12px", border: dimBorder, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>
                PULL ↓
              </button>
              <button type="button" onClick={disconnectDropbox}
                style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>
                DISCONNECT
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={connectDropbox}
              style={{ width: "100%", padding: "12px", border, background: fg, color: bg, ...mono, fontSize: "16px", letterSpacing: "2px", cursor: "pointer", minHeight: "48px" }}>
              CONNECT DROPBOX
            </button>
            <div style={{ fontSize: "16px", color: fg, lineHeight: "1.8", ...mono }}>
              LAST SYNCED: <span style={{ fontWeight: "bold" }}>{syncStatusLabel}</span>
            </div>
            <div style={{ height: "2px", background: fg, margin: "4px 0" }} />
            <div style={{ fontSize: "16px", color: fg, letterSpacing: "1px", fontWeight: "bold", ...mono }}>
              Export / import backup
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button type="button" onClick={() => SyncManager.download((msg) => showBanner(msg, "alert"))}
                style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>EXPORT ↓</button>
              <input ref={importRef} type="file" accept=".json" disabled={importLoading || syncStatus === "syncing"} onChange={handleImportFile} style={{ display: "none" }} />
              <button type="button" disabled={importLoading || syncStatus === "syncing"}
                onClick={() => { if (!importLoading && syncStatus !== "syncing") importRef.current?.click(); }}
                style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", minHeight: "48px", cursor: importLoading || syncStatus === "syncing" ? "default" : "pointer" }}>
                {importLoading ? "IMPORTING..." : "IMPORT ↑"}
              </button>
            </div>
          </>
        )}
      </div>

      {divider}

      {/* ── AI CONFIG ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {sectionHeader("[ AI CONFIG ]")}
        {googleClientId ? (
          <>
            <div style={{ fontSize: "14px", color: dimColor, ...mono, lineHeight: "1.6" }}>
              {state?.googleAuthConnected ? "Google account connected for Gemini." : "Connect Google for Gemini (OAuth)."}
            </div>
            {state?.googleAuthConnected ? (
              <button type="button" onClick={() => { revokeGoogleAuth(); showBanner("Google disconnected.", "info"); }}
                style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>
                DISCONNECT GOOGLE
              </button>
            ) : (
              <button type="button" onClick={() => { try { startGoogleOAuthFlow(googleClientId); } catch { showBanner("Could not start Google sign-in.", "alert"); } }}
                style={{ padding: "12px", border, background: fg, color: bg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}>
                CONNECT GOOGLE
              </button>
            )}
          </>
        ) : (
          <button type="button" onClick={handleChangeGeminiKey}
            style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px" }}>
            CHANGE GEMINI API KEY
          </button>
        )}
        {IS_DEV && (
          <div style={{ border: "2px dashed #555", padding: "10px 12px", fontSize: "12px", color: "#ccc", ...mono, lineHeight: "1.6", wordBreak: "break-all" }}>
            <div style={{ fontSize: "11px", letterSpacing: "2px", marginBottom: "4px", fontWeight: "bold" }}>DEV ONLY — CURRENT GEMINI KEY</div>
            <div>{currentGeminiKey || "(none set)"}</div>
          </div>
        )}
      </div>

      {divider}

      {/* ── HEALTH (iOS native) ── */}
      {HEALTHKIT_SETTINGS && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {sectionHeader("[ HEALTH ]")}
            <div style={{ fontSize: "14px", color: dimColor, ...mono, lineHeight: "1.6" }}>
              {state?.healthKitEnabled ? "HealthKit access was granted (sleep read)." : "HealthKit not connected — sleep check-in modal still works."}
            </div>
            <button
              type="button"
              onClick={() => {
                void RitmolHealth.requestPermission()
                  .then(({ granted }) => {
                    setState((s) => ({ ...s, healthKitEnabled: !!granted }));
                    showBanner(granted ? "Health permission updated." : "Health access not granted.", "info");
                  })
                  .catch(() => showBanner("Could not request Health access.", "alert"));
              }}
              style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px" }}
            >
              RE-REQUEST HEALTH PERMISSION
            </button>
          </div>
          {divider}
        </>
      )}

      {/* ── NOTIFICATIONS ── */}
      {NOTIF_NATIVE && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {sectionHeader("[ NOTIFICATIONS ]")}
            {state?.notificationsEnabled ? (
              <>
                <div style={{ fontSize: "14px", color: fg, ...mono }}>Notifications enabled ✓</div>
                <button type="button" onClick={() => {
                  LocalNotifications.cancelAll?.().catch(() => {});
                  LocalNotifications.getPending?.().then((p) => {
                    const n = p?.notifications ?? [];
                    if (n.length) LocalNotifications.cancel({ notifications: n }).catch(() => {});
                  }).catch(() => {});
                  setState((s) => ({ ...s, notificationsEnabled: false }));
                  showBanner("Notifications disabled.", "info");
                }}
                  style={{ padding: "12px", border, background: "transparent", color: fg, ...mono, fontSize: "16px", cursor: "pointer" }}>
                  DISABLE
                </button>
              </>
            ) : (
              <button type="button" onClick={() => requestNotificationPermission?.()}
                style={{ padding: "12px", border, background: fg, color: bg, ...mono, fontSize: "16px", cursor: "pointer" }}>
                ENABLE NOTIFICATIONS
              </button>
            )}
          </div>
          {divider}
        </>
      )}

      {/* ── DANGER ZONE ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {sectionHeader("[ DANGER ZONE ]")}
        <button type="button" onClick={resetAll}
          style={{
            padding: "12px", border,
            background: confirmReset ? "#3a1111" : "transparent",
            color: confirmReset ? "#fff" : fg,
            ...mono, fontSize: "16px", cursor: "pointer", minHeight: "48px",
          }}>
          {confirmReset ? "CONFIRM RESET? (click again)" : "RESET ALL DATA"}
        </button>
      </div>

    </div>
  );
}
