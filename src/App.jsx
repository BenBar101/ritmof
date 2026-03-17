import React, { useState, useEffect, useRef, useCallback } from "react";

// Hooks
import { useAppState }   from "./hooks/useAppState";
import { useUI }         from "./hooks/useUI";
import { useSync }       from "./hooks/useSync";
import { useGameEngine } from "./hooks/useGameEngine";
import { useScheduler }  from "./hooks/useScheduler";
import { useDailyLogin } from "./hooks/useDailyLogin";

// Context
import { AppContext } from "./context/AppContext";

// Utils
import { LS, storageKey, IS_DEV, getGeminiApiKey, setGeminiApiKey, todayUTC, localDateFromUTC, APP_ICON_URL } from "./utils/db";
import { getLevel, getRank, getXpPerLevel, getGachaCost, getStreakShieldCost, calcSessionXP } from "./utils/xp";
import { THEME_KEY, SESSION_TYPES, DEFAULT_XP_PER_LEVEL, DEFAULT_GACHA_COST, DEFAULT_STREAK_SHIELD_COST, DAILY_TOKEN_LIMIT } from "./constants";
import { buildSystemPrompt } from "./api/systemPrompt";
import { fetchDailyQuote } from "./api/quotes";
import { callGemini } from "./api/gemini";
import { FSAPI_SUPPORTED } from "./sync/SyncManager";
import { verifyOAuthState } from "./api/dropbox";

const MISSION_DEFS = [
  { id: "m1", desc: "Complete 3 habits",  target: 3,  type: "habits",  xp: 100, done: false },
  { id: "m2", desc: "Complete 6 habits",  target: 6,  type: "habits",  xp: 200, done: false },
  { id: "m3", desc: "Complete 10 habits", target: 10, type: "habits",  xp: 500, done: false },
  { id: "m4", desc: "Log a study session",target: 1,  type: "session", xp: 75,  done: false },
  { id: "m5", desc: "Complete a task",    target: 1,  type: "task",    xp: 50,  done: false },
  { id: "m6", desc: "Open RITMOL chat",   target: 1,  type: "chat",    xp: 25,  done: false },
];

// ── ISO week key: "YYYY-Www" using local date ──────────────────
function localWeekKey() {
  const d = new Date();
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const week = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Month key: "YYYY-MM" using local date ──────────────────────
function localMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Ask Gemini to generate weekly or monthly missions ──────────
async function generateAiMissions(apiKey, profile, period, trackTokens) {
  const isWeekly = period === "weekly";
  const count    = isWeekly ? 5 : 3;
  const xpRange  = isWeekly ? "150-400" : "500-1500";
  const major     = (profile?.major     || "").replace(/[<>"'`]/g, "").slice(0, 60);
  const interests = (profile?.interests || "").replace(/[<>"'`]/g, "").slice(0, 80);
  const context   = [major, interests].filter(Boolean).join(", ") || "general studies";

  const prompt =
    `Student: ${context}. ` +
    `Write ${count} ${isWeekly ? "weekly" : "monthly"} RPG missions, XP ${xpRange}. ` +
    `JSON array only: [{"id":"1","desc":"text","type":"habits","target":5,"xp":200}]`;

  // Hard 20-second race so the promise always resolves
  const hardTimeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error("mission_timeout")), 20000)
  );

  try {
    const { text, tokensUsed } = await Promise.race([
      callGemini(
        apiKey,
        [{ role: "user", content: prompt }],
        "Output a JSON array only. No markdown fences, no explanation.",
        false, // jsonMode=false so response_mime_type is NOT set — arrays work fine
      ),
      hardTimeout,
    ]);
    if (trackTokens && tokensUsed) trackTokens(tokensUsed);

    const stripped = text.replace(/```[\w]*\n?/g, "").trim();
    const match = stripped.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || !parsed.length) return [];

    return parsed.slice(0, count).map((m, i) => ({
      id: `${period}_ai_${i}_${Date.now()}`,
      // eslint-disable-next-line no-control-regex
      desc: typeof m.desc === "string" ? m.desc.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[<>"'`&]/g, "").slice(0, 200) : "Complete the mission",
      type: ["habits","session","task","streak","custom"].includes(m.type) ? m.type : "custom",
      target: typeof m.target === "number" ? Math.min(Math.max(1, Math.round(m.target)), 100) : 1,
      xp: typeof m.xp === "number" ? Math.min(Math.max(50, Math.round(m.xp)), 2000) : 200,
      done: false,
      ai: true,
    }));
  } catch {
    return [];
  }
}

// Components
import Onboarding, { GeminiKeySetupScreen } from "./Onboarding";
import { TopBar, BottomNav, Banner } from "./Layout";
import { GlobalStyles, ErrorBoundary } from "./GlobalStyles";
import {
  DailyLoginModal, SleepCheckinModal, ScreenTimeModal,
  SessionLogModal, LevelUpModal, AchievementToast,
} from "./Modals";

// Tabs
import HomeTab    from "./HomeTab";
import HabitsTab  from "./HabitsTab";
import TasksTab   from "./TasksTab";
import ChatTab    from "./ChatTab";
import ProfileTab from "./ProfileTab";

// ─────────────────────────────────────────────────────────────
// KEYS CONFIG GATE
// ─────────────────────────────────────────────────────────────
// KeysConfigGate is intentionally removed.
// Missing-key handling is done inline in the main App render (after hooks run)
// so it has access to connectDropbox, syncPull, pickSyncFile, setShowGeminiKeySetup, etc.

// ─────────────────────────────────────────────────────────────
// MISSING KEY GATE
// Shown when there is no Gemini API key in sessionStorage.
// Rendered inside the main App (after hooks run) so it has access
// to connectDropbox, syncPull, pickSyncFile, etc.
// ─────────────────────────────────────────────────────────────
function MissingKeyGate({ connectDropbox, dropboxConnected, pickSyncFile, syncPull, resetPullMutex, onGeminiKeySaved }) {
  const [mode, setMode]           = useState("choose"); // "choose" | "gemini" | "syncthing"
  const [syncFileLinked, setSyncFileLinked] = useState(false);
  const [syncStatus, setSyncStatus]         = useState("idle"); // "idle" | "syncing" | "synced" | "error"
  const [syncError, setSyncError]           = useState("");
  const [dropboxError, setDropboxError]     = useState("");

  const mono = { fontFamily: "'Share Tech Mono', monospace" };
  const btnPrimary = {
    width: "100%", padding: "16px", border: "2px solid #fff", background: "#fff", color: "#000",
    ...mono, fontSize: "16px", letterSpacing: "2px", cursor: "pointer", marginBottom: "10px",
    minHeight: "56px",
  };
  const btnSecondary = {
    width: "100%", padding: "13px", border: "2px solid #fff", background: "transparent", color: "#fff",
    ...mono, fontSize: "14px", letterSpacing: "1px", cursor: "pointer", marginBottom: "10px",
  };

  function handleConnectDropbox() {
    setDropboxError("");
    try {
      connectDropbox();
    } catch (e) {
      if (e?.message === "DROPBOX_NOT_CONFIGURED") {
        setDropboxError("Dropbox is not configured in this build. Enter your Gemini key manually instead.");
      } else {
        setDropboxError("Could not start Dropbox connection. Try again.");
      }
    }
  }

  async function handleSyncthingLink() {
    setSyncError("");
    try {
      await pickSyncFile();
      setSyncFileLinked(true);
    } catch (e) {
      if (e?.name !== "AbortError") setSyncError("Could not link file. Try again.");
    }
  }

  async function handleSyncthingPull() {
    setSyncError(""); setSyncStatus("syncing");
    window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
    try {
      await syncPull();
      setSyncStatus("synced");
      setTimeout(() => {
        try { window.location.reload(); } catch {
          try { window.location.href = window.location.origin + window.location.pathname; }
          catch { resetPullMutex?.(); }
        }
        setTimeout(() => resetPullMutex?.(), 3000);
      }, 250);
    } catch (e) {
      setSyncStatus("error");
      const msgs = {
        NO_HANDLE:            "No sync file linked yet.",
        CORRUPT_FILE:         "Sync file is corrupt or not valid JSON.",
        SYNC_SCHEMA_OUTDATED: "Sync file was written by an older version of RITMOL.",
        SYNC_FILE_TOO_LARGE:  "Sync file exceeds 10 MB.",
        SYNC_BUSY:            "Sync already in progress. Please wait.",
        IDB_NOT_READY:        "Still loading, try again in a moment.",
      };
      setSyncError(msgs[e?.message] ?? "Pull failed. Check your sync file and try again.");
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "32px 24px", background: "#000",
      color: "#fff", ...mono,
    }}>
      <img src={APP_ICON_URL} alt="" style={{ width: 44, height: 44, marginBottom: "20px", marginTop: "24px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "6px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ RITMOL ]</div>
      <div style={{ fontSize: "20px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "6px" }}>
        {mode === "gemini" ? "GEMINI API KEY" : mode === "syncthing" ? "LOAD FROM FILE" : "SETUP REQUIRED"}
      </div>
      <div style={{ fontSize: "16px", color: "#fff", marginBottom: "28px", fontFamily: "'Share Tech Mono', monospace" }}>
        {mode === "gemini"   ? "Enter your key to enable AI features." :
         mode === "syncthing" ? "Pull your data file to restore your config." :
         "A Gemini API key is needed to continue."}
      </div>

      <div style={{ width: "100%", maxWidth: "360px" }}>

        {/* ── Choose mode ── */}
        {mode === "choose" && (
          <>
            {!dropboxConnected && (
              <>
                <div style={{ fontSize: "13px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>
                  RETURNING USER? PULL FROM SYNC
                </div>
                <button type="button" onClick={handleConnectDropbox} style={btnPrimary}>
                  CONNECT DROPBOX ↗
                </button>
                {dropboxError && <div style={{ color: "#fff", fontSize: "16px", marginBottom: "10px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {dropboxError}</div>}
                {FSAPI_SUPPORTED && (
                  <button type="button" onClick={() => setMode("syncthing")} style={{ ...btnSecondary, marginBottom: "24px" }}>
                    LOAD FROM SYNCTHING FILE
                  </button>
                )}
                <div style={{ height: "1px", background: "#222", marginBottom: "24px" }} />
              </>
            )}
            <div style={{ fontSize: "13px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>
              NEW USER? ENTER KEY MANUALLY
            </div>
            <button type="button" onClick={() => setMode("gemini")} style={btnPrimary}>
              ENTER GEMINI API KEY
            </button>
          </>
        )}

        {/* ── Gemini key entry ── */}
        {mode === "gemini" && (
          <>
            <GeminiKeySetupScreen onSave={onGeminiKeySaved} />
            <button type="button" onClick={() => setMode("choose")} style={{ ...btnSecondary, marginTop: "12px" }}>
              ← BACK
            </button>
          </>
        )}

        {/* ── Syncthing pull ── */}
        {mode === "syncthing" && (
          <>
            <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.8", marginBottom: "16px", fontFamily: "'Share Tech Mono', monospace" }}>
              Link your <code>ritmol-data.json</code> from your Syncthing folder, then pull to load your Gemini key and data.
            </div>
            <button type="button" onClick={handleSyncthingLink} style={btnPrimary}>
              {syncFileLinked ? "✓ FILE LINKED" : "LINK SYNC FILE →"}
            </button>
            <button
              type="button"
              onClick={handleSyncthingPull}
              disabled={!syncFileLinked || syncStatus === "syncing"}
              style={{
                ...btnSecondary,
                color: (!syncFileLinked || syncStatus === "syncing") ? "#555" : "#fff",
                border: (!syncFileLinked || syncStatus === "syncing") ? "2px solid #555" : "2px solid #fff",
                cursor: (!syncFileLinked || syncStatus === "syncing") ? "not-allowed" : "pointer",
                marginBottom: "12px",
              }}
            >
              {syncStatus === "syncing" ? "LOADING..." : syncStatus === "synced" ? "✓ LOADED — RELOADING…" : "PULL FROM FILE ↓"}
            </button>
            {syncError && <div style={{ color: "#fff", fontSize: "16px", marginBottom: "8px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {syncError}</div>}
            <button type="button" onClick={() => { setMode("choose"); setSyncError(""); setSyncStatus("idle"); }} style={btnSecondary}>
              ← BACK
            </button>
          </>
        )}

      </div>

      <div style={{ fontSize: "16px", color: "#fff", marginTop: "32px", letterSpacing: "2px", fontFamily: "'Share Tech Mono', monospace" }}>
        RITMOL v1.0 // ZERO TELEMETRY
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SYNCING SCREEN — E-ink safe static loading
// ─────────────────────────────────────────────────────────────
function SyncingScreen({ theme = "dark" }) {
  const isLight = theme === "light";
  const bg     = isLight ? "#f0f0f0" : "#000";
  const text   = isLight ? "#000"    : "#fff";
  const border = isLight ? "rgba(0,0,0,0.35)"   : "rgba(255,255,255,0.35)";
  const track  = isLight ? "rgba(0,0,0,0.12)"   : "rgba(255,255,255,0.12)";
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: bg, fontFamily: "'Share Tech Mono', monospace",
    }}>
      <div style={{ fontSize: "11px", color: text, letterSpacing: "4px", marginBottom: "32px", opacity: 0.5 }}>
        RITMOL
      </div>
      <div style={{
        fontSize: "13px", fontWeight: "bold", color: text,
        letterSpacing: "3px", marginBottom: "24px",
        border: `1.5px solid ${border}`,
        padding: "20px 36px",
        clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)",
      }}>
        LOADING...
      </div>
      <div style={{
        width: "120px", height: "2px", background: track,
      }} />
      <div style={{ fontSize: "10px", color: text, letterSpacing: "3px", marginTop: "20px", opacity: 0.45 }}>
        INITIALISING SYSTEM
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────
export default function App() {
  const { state, setState, latestStateRef, rehydrate, idbReady, rehydrateCount } = useAppState();
  const [tab, setTab]               = useState("home");
  const [theme, setThemeState]      = useState(() => LS.get(storageKey(THEME_KEY), "dark"));
  const [dailyQuote, setDailyQuote] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showGeminiKeySetup, setShowGeminiKeySetup] = useState(false);
  const setTheme = useCallback((t) => { LS.set(storageKey(THEME_KEY), t); setThemeState(t); }, []);

  const { modal, setModal, toast, setToast, banner, setBanner, levelUpData, setLevelUpData, showToast, showBanner } = useUI();

  const profile          = state?.profile;
  // apiKey is read from sessionStorage on every render. After a sync Pull that
  // writes a new key into sessionStorage, rehydrate() triggers a re-render and
  // this call observes the updated value — there is at most a single render
  // where the old key remains in scope.
  const apiKey           = getGeminiApiKey();
  const xpPerLevel       = state ? getXpPerLevel(state) : DEFAULT_XP_PER_LEVEL;
  const level            = state ? getLevel(state.xp, xpPerLevel) : 0;
  const rank             = getRank(level);
  const gachaCost        = state ? getGachaCost(state) : DEFAULT_GACHA_COST;
  const streakShieldCost = state ? getStreakShieldCost(state) : DEFAULT_STREAK_SHIELD_COST;

  const { awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef, lastLevelUpXpRef } =
    useGameEngine({ setState, latestStateRef, showBanner, showToast, setLevelUpData });

  const { syncFileConnected, dropboxConnected, syncStatus, lastSynced, confirmForgetSync, syncPush, syncPull, pickSyncFile, forgetSyncFile, connectDropbox, handleDropboxCallback, disconnectDropbox, isReloading, resetPullMutex } =
    useSync({ latestStateRef, rehydrate, showBanner });

  // OAuth callback: when returning from Dropbox, exchange code and pull.
  // Two landing scenarios:
  //   1. Direct: the host serves all routes (Vercel, local dev). Dropbox lands on
  //      /dropbox-callback?code=X&state=Y → code/state are in window.location.search.
  //   2. GitHub Pages 404 redirect: 404.html encodes the original URL as
  //      /?q=%2Fritmol%2Fdropbox-callback%3Fcode%3DX%26state%3DY
  //      The q= value is a full path+query string, so we must extract its search
  //      part before parsing it as URLSearchParams.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let code = params.get("code");
    let stateParam = params.get("state");

    // Scenario 2: GitHub Pages 404 → q= redirect.
    // Only attempt extraction when the current path doesn't already look like the
    // callback route (avoids double-processing on direct landings).
    if ((!code || !stateParam) && params.get("q")) {
      try {
        const decoded = decodeURIComponent(params.get("q"));
        // decoded may be a full path like "/ritmol/dropbox-callback?code=X&state=Y"
        // or a bare query string like "code=X&state=Y". Handle both.
        let search = decoded;
        if (decoded.includes("?")) {
          // It's a path+query — check it's actually the callback path, then extract search.
          const [pathPart, queryPart] = decoded.split("?");
          if (pathPart.includes("dropbox-callback")) {
            search = queryPart;
          } else {
            search = ""; // not a dropbox callback redirect — ignore
          }
        }
        if (search) {
          const qParams = new URLSearchParams(search);
          code = code || qParams.get("code");
          stateParam = stateParam || qParams.get("state");
        }
      } catch { /* ignore malformed q */ }
    }

    // For direct landings (scenario 1), also guard on the current path so we
    // don't accidentally consume code/state params on non-callback pages.
    const isCallbackPath = window.location.pathname.includes("dropbox-callback");
    const hasDirectParams = isCallbackPath && params.get("code") && params.get("state");
    const hasQParams = !!code && !!stateParam && !hasDirectParams;

    if ((hasDirectParams || hasQParams) && code && stateParam) {
      window.history.replaceState({}, "", window.location.pathname.replace(/\/dropbox-callback\/?$/, "") || "/");
      if (!verifyOAuthState(stateParam)) {
        showBanner("OAuth state mismatch. Please try connecting Dropbox again.", "alert");
        return;
      }
      handleDropboxCallback(code, {
        // If onboarding is active, let its own Gemini step handle key entry
        // rather than showing the standalone key setup screen on top of it.
        onNeedsGeminiKey: () => { if (!showOnboarding) setShowGeminiKeySetup(true); },
      });
    }
  }, [handleDropboxCallback, showBanner, showOnboarding]);

  useDailyLogin({ profile, setState, setModal, setLevelUpData, showBanner, trackTokens, lastLevelUpXpRef });
  useScheduler({ state, profile, showBanner, setModal });

  // Handle "mark reminded" event dispatched by useScheduler
  useEffect(() => {
    const handler = (e) => {
      const ids = new Set(e.detail?.ids || []);
      setState((s) => ({ ...s, calendarEvents: (s.calendarEvents || []).map((ev) => ids.has(ev.id) ? { ...ev, reminded: true } : ev) }));
    };
    window.addEventListener("ritmol:mark-reminded", handler);
    return () => window.removeEventListener("ritmol:mark-reminded", handler);
  }, [setState]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "theme-color"); document.head.appendChild(meta); }
    meta.setAttribute("content", theme === "light" ? "#f0f0f0" : "#000");
  }, [theme]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      document.title = "RITMOL-DEV";
    }
  }, []);

  useEffect(() => {
    if (!profile?.geminiKey) return;
    setState((s) => {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _g, ...rest } = s.profile || {};
      return { ...s, profile: rest };
    });
  }, [profile?.geminiKey, setState]);

  useEffect(() => {
    if (!profile) return;
    const resetMissions = () => setState((s) => {
      const t = localDateFromUTC();
      if (s.lastMissionDate === t) return s;
      return { ...s, dailyMissions: [...MISSION_DEFS], lastMissionDate: t };
    });
    resetMissions();
    const id = setInterval(resetMissions, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, setState]);

  // ── Weekly & Monthly AI missions ───────────────────────────
  // Session-level guard: tracks which periods have been attempted this app load.
  // Using a ref (not state) means it never causes re-renders, and persists across
  // effect re-runs so a 429 failure never triggers a retry loop.
  const missionAttemptedRef = useRef({ weekly: false, monthly: false });
  const missionGenRef = useRef({ weekly: false, monthly: false });

  useEffect(() => {
    if (!profile || !apiKey) return;

    const wk = localWeekKey();
    const mo = localMonthKey();

    function tryGenerate(period) {
      const key     = period === "weekly" ? "weeklyMissions"         : "monthlyMissions";
      const dateKey = period === "weekly" ? "lastWeeklyMissionDate"  : "lastMonthlyMissionDate";
      const currentPeriodKey = period === "weekly" ? wk : mo;

      // Already in-flight or already attempted this session — never retry on 429
      if (missionGenRef.current[period] || missionAttemptedRef.current[period]) return;

      // Read current values directly from state (closure is fresh on each effect run)
      const currentMissions = period === "weekly" ? state?.weeklyMissions : state?.monthlyMissions;
      const currentDateKey  = period === "weekly" ? state?.lastWeeklyMissionDate : state?.lastMonthlyMissionDate;

      // Already have valid missions for this period — skip
      if (currentDateKey === currentPeriodKey && Array.isArray(currentMissions) && currentMissions.length > 0) return;

      // Skip if token budget exhausted
      const usage = state?.tokenUsage;
      if (usage && usage.date === todayUTC() && usage.tokens >= DAILY_TOKEN_LIMIT) return;

      // Mark attempted immediately — before the async call — so no re-render can sneak in a second call
      missionAttemptedRef.current[period] = true;
      missionGenRef.current[period] = true;

      generateAiMissions(apiKey, profile, period, trackTokens)
        .then((missions) => {
          setState((s) => ({
            ...s,
            [key]: Array.isArray(missions) && missions.length ? missions : [],
            [dateKey]: currentPeriodKey,
          }));
        })
        .catch(() => {
          // Write [] so the UI shows "no missions" instead of spinning forever.
          // Do NOT change the date key on failure — next app load can retry.
          setState((s) => ({ ...s, [key]: [] }));
        })
        .finally(() => { missionGenRef.current[period] = false; });
    }

    tryGenerate("weekly");
    // Stagger monthly by 3 s so both calls don't hit the API simultaneously
    const monthlyTimer = setTimeout(() => tryGenerate("monthly"), 3000);
    return () => clearTimeout(monthlyTimer);
  // Only re-run when profile or apiKey first becomes available — never on state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, !!apiKey, profile?.name ?? ""]);

  const quoteFetchedRef = useRef(false);
  const quoteInputRef = useRef("");
  const quoteInput = `${profile?.books ?? ""}|${profile?.interests ?? ""}|${profile?.major ?? ""}`;
  useEffect(() => {
    if (!profile) return;
    if (quoteInputRef.current !== quoteInput) {
      quoteFetchedRef.current = false;
      quoteInputRef.current = quoteInput;
    }
    if (quoteFetchedRef.current) return;
    quoteFetchedRef.current = true;
    fetchDailyQuote(apiKey || null, profile, trackTokens || null)
      .then((result) => {
        if (result === null) {
          quoteFetchedRef.current = false;
          return;
        }
        setDailyQuote(result);
      })
      .catch(() => {
        quoteFetchedRef.current = false;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!profile, !!apiKey, quoteInput]);

  useEffect(() => {
    const handler = () => showBanner("SYSTEM ALERT: Storage full! (~5MB). Clear old chat history or sessions.", "alert");
    window.addEventListener("ls-quota-exceeded", handler);
    return () => window.removeEventListener("ls-quota-exceeded", handler);
  }, [showBanner]);

  // Initialize onboarding flag once — only fires when IDB is first ready.
  // Using a ref guard prevents a subsequent setState() call (e.g. after a sync
  // pull) from re-triggering onboarding if profile is momentarily absent.
  const onboardingInitedRef = useRef(false);
  useEffect(() => {
    if (!idbReady || !state || onboardingInitedRef.current) return;
    onboardingInitedRef.current = true;
    setShowOnboarding(!state.profile);
  }, [idbReady, state]);

  // ── Render guards ────────────────────────────────────────
  if (!idbReady || state === null) {
    return (
      <ErrorBoundary>
        <SyncingScreen theme={theme} />
      </ErrorBoundary>
    );
  }


  // Onboarding must be checked BEFORE the !apiKey gate.
  // New users hit onboarding first (which has its own Dropbox → Gemini → profile
  // flow). The !apiKey gate is only for returning users whose sessionStorage
  // was cleared (e.g. new browser tab) without a sync file to pull from.
  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <Onboarding
          onComplete={async (profile) => {
            setState((s) => ({ ...s, profile }));
            setShowOnboarding(false);
            // Push immediately so the Gemini key (in sessionStorage) and the
            // new profile are written to Dropbox in one shot. Without this,
            // a fresh tab after onboarding shows MissingKeyGate because the
            // key never made it into the sync file.
            try { await syncPush(); } catch { /* non-fatal — user can push manually */ }
          }}
          onGeminiKeySaved={async (key, profile) => {
            setGeminiApiKey(key);
            if (profile) setState((s) => ({ ...s, profile }));
            await syncPush();
          }}
          connectDropbox={connectDropbox}
        />
      </ErrorBoundary>
    );
  }

  if (showGeminiKeySetup) {
    return (
      <ErrorBoundary>
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "flex-start", padding: "24px", background: "#000",
        }}>
          <div style={{
            width: "100%", maxWidth: "380px", padding: "24px",
            background: "#000", border: "2px solid #fff",
            fontFamily: "'Share Tech Mono', monospace",
          }}>
            <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", marginBottom: "8px", fontWeight: "bold" }}>
              CONFIGURE AI
            </div>
            <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "18px", letterSpacing: "1px" }}>
              GEMINI API KEY
            </div>
            <GeminiKeySetupScreen
              onSave={async (key) => {
                setGeminiApiKey(key);
                await syncPush();
                setShowGeminiKeySetup(false);
              }}
            />
          </div>
        </div>
      </ErrorBoundary>
    );
  }
  if (!apiKey) {
    // While the auto-pull on mount is in flight (Dropbox connected, pulling key),
    // show a loading screen instead of MissingKeyGate so the user never sees a
    // jarring "setup required" flash on a normal returning-user open.
    if (syncStatus === "syncing" || isReloading) {
      return (
        <ErrorBoundary>
          <SyncingScreen theme={theme} />
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
        <MissingKeyGate
          connectDropbox={connectDropbox}
          dropboxConnected={dropboxConnected}
          pickSyncFile={pickSyncFile}
          syncPull={syncPull}
          resetPullMutex={resetPullMutex}
          onGeminiKeySaved={async (key) => {
            setGeminiApiKey(key);
            await syncPush();
          }}
        />
      </ErrorBoundary>
    );
  }
  if (!profile && !showOnboarding) {
    return (
      <ErrorBoundary>
        <SyncingScreen theme={theme} />
      </ErrorBoundary>
    );
  }

  // ── Context value ────────────────────────────────────────
  const ctx = {
    state, setState, latestStateRef, profile, apiKey, theme, setTheme,
    level, rank, xpPerLevel, gachaCost, streakShieldCost,
    awardXP, checkMissions, unlockAchievement, executeCommands, trackTokens, logHabit, actionLocksRef,
    showBanner, showToast, setModal,
    syncStatus, lastSynced, syncFileConnected, dropboxConnected, confirmForgetSync,
    syncPush, syncPull, pickSyncFile, forgetSyncFile,
    connectDropbox, handleDropboxCallback, disconnectDropbox,
    dailyQuote, buildSystemPrompt, setTab,
    rehydrateCount,
  };

  return (
    <AppContext.Provider value={ctx}>
      <GlobalStyles />
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#000", color: "#fff", overflow: "hidden" }}>
        {isReloading && (
          <div
            aria-label="Syncing — please wait"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              background: theme === "light" ? "rgba(255,255,255,0.96)" : "rgba(0,0,0,0.96)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Share Tech Mono', monospace",
              pointerEvents: "all",
            }}
          >
            <div style={{ fontSize: "11px", color: theme === "light" ? "#000" : "#fff", letterSpacing: "3px", fontWeight: "bold", opacity: 0.7 }}>SYNC COMPLETE</div>
            <div style={{ fontSize: "16px", color: theme === "light" ? "#000" : "#fff", marginTop: "10px", fontWeight: "bold", letterSpacing: "3px" }}>[ RELOADING... ]</div>
            <div style={{
              width: "80px", height: "2px", marginTop: "16px",
              background: theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)",
              position: "relative", overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", left: "-40%", width: "40%", height: "100%",
                background: theme === "light" ? "#000" : "#fff",
                animation: "scan 1.2s linear infinite",
              }} />
            </div>
          </div>
        )}
        {banner && <Banner banner={banner} onClose={() => setBanner(null)} />}
        {IS_DEV && (
          <div style={{ background: "#000", color: "#fff", fontSize: "16px", letterSpacing: "2px", padding: "8px 12px", textAlign: "center", borderBottom: "2px solid #fff", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>
            DEV MODE — separate localStorage (ritmol_dev_*)
          </div>
        )}
        <TopBar xp={state.xp} xpPerLevel={xpPerLevel} level={level} rank={rank} profile={profile} syncStatus={syncStatus} lastSynced={lastSynced} onPush={syncPush} onPull={syncPull} syncFileConnected={syncFileConnected} isReloading={isReloading} />
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "calc(64px + env(safe-area-inset-bottom, 0px))", paddingTop: "calc(56px + env(safe-area-inset-top, 0px))" }}>
          {tab === "home"    && <ErrorBoundary key="home"><HomeTab /></ErrorBoundary>}
          {tab === "habits"  && <ErrorBoundary key="habits"><HabitsTab /></ErrorBoundary>}
          {tab === "tasks"   && <ErrorBoundary key="tasks"><TasksTab /></ErrorBoundary>}
          {tab === "chat"    && <ErrorBoundary key="chat"><ChatTab /></ErrorBoundary>}
          {tab === "profile" && <ErrorBoundary key="profile"><ProfileTab /></ErrorBoundary>}
        </div>
        <BottomNav tab={tab} setTab={setTab} />

        {modal?.type === "daily_login"  && (
          <ErrorBoundary>
            <DailyLoginModal data={modal} onClose={() => setModal(null)} />
          </ErrorBoundary>
        )}
        {modal?.type === "sleep_checkin" && (
          <ErrorBoundary>
            <SleepCheckinModal onClose={() => setModal(null)} onSubmit={(data) => {
              const safeHours   = Math.min(Math.max(0, Number(data.hours)   || 0), 24);
              const safeQuality = Math.min(Math.max(1, Number(data.quality) || 1), 5);
              const safeRested  = typeof data.rested === "boolean" ? data.rested : false;
              setState((s) => {
                const t = localDateFromUTC(); // match scheduler's localDateFromUTC() check
                return ({ ...s, sleepLog: { ...s.sleepLog, [t]: { hours: safeHours, quality: safeQuality, rested: safeRested } } });
              });
              awardXP(20, null, true); showBanner("Sleep data logged. +20 XP", "success"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {modal?.type === "screen_time" && (
          <ErrorBoundary>
            <ScreenTimeModal period={modal.period} onClose={() => setModal(null)} onSubmit={(mins) => {
              const safeMins = Math.min(Math.max(0, Number(mins) || 0), 480);
              setState((s) => {
                const key = localDateFromUTC(); // match scheduler's localDateFromUTC() check
                // Allowlist modal.period so arbitrary strings cannot become IDB sub-keys.
                const safePeriod = modal.period === "afternoon" || modal.period === "evening"
                  ? modal.period
                  : "afternoon";
                return {
                  ...s,
                  screenTimeLog: {
                    ...s.screenTimeLog,
                    [key]: { ...(s.screenTimeLog?.[key] || {}), [safePeriod]: safeMins },
                  },
                };
              });
              const xp = safeMins < 60 ? 40 : safeMins < 120 ? 25 : safeMins < 180 ? 15 : 10;
              awardXP(xp, null, true); showBanner(`Screen time logged. ${safeMins < 60 ? "Impressive discipline." : "Noted."} +${xp} XP`, safeMins < 60 ? "success" : "info"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {modal?.type === "session_log" && (
          <ErrorBoundary>
            <SessionLogModal onClose={() => setModal(null)} state={state} onSubmit={(session) => {
              const xp = calcSessionXP(session.type, session.duration, session.focus, state.streak);
              // eslint-disable-next-line no-control-regex
              const san = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/[<>"'`&]/g, "").slice(0, max) : "";
              const newSession = {
                id: `session_${crypto.randomUUID()}`,
                date: todayUTC(),
                xp,
                type: SESSION_TYPES.find((s) => s.id === session.type) ? session.type : SESSION_TYPES[0].id,
                course: san(session.course, 100),
                duration: Math.min(Math.max(0, Number(session.duration) || 0), 600),
                focus: ["low", "medium", "high"].includes(session.focus) ? session.focus : "medium",
                notes: san(session.notes, 300),
              };
              setState((s) => {
                if ((s.sessions || []).length >= 10000) return s;
                return { ...s, sessions: [...(s.sessions || []), newSession] };
              });
              awardXP(xp, null, true);
              showBanner(`${SESSION_TYPES.find((s) => s.id === session.type)?.label} logged. +${xp} XP`, "success");
              checkMissions("session"); setModal(null);
            }} />
          </ErrorBoundary>
        )}
        {levelUpData && (
          <ErrorBoundary>
            <LevelUpModal data={levelUpData} onClose={() => setLevelUpData(null)} />
          </ErrorBoundary>
        )}
        {toast && (
          <ErrorBoundary>
            <AchievementToast key={toast._id} toast={toast} onClose={() => setToast(null)} />
          </ErrorBoundary>
        )}
      </div>
    </AppContext.Provider>
  );
}

export { GlobalStyles, ErrorBoundary };
