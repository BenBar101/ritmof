import React, { useState, useEffect, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { todayUTC, localDateFromUTC, getGeminiApiKey, setGeminiApiKey, getMaxDateSeen, IS_DEV } from "./utils/db";
import { ACHIEVEMENT_RARITIES, STYLE_CSS, DAILY_TOKEN_LIMIT, RANKS, sampleGachaRarity } from "./constants";
import { DATA_DISCLOSURE_SEEN_KEY, THEME_KEY } from "./constants";
import { getLevelProgress } from "./utils/xp";
import { callGemini, RateLimitedError, clearRateLimitWindow } from "./api/gemini";
import { fetchGCalEvents, fetchCalendarList, loadGoogleGIS } from "./api/gcal";
import { SyncManager, FSAPI_SUPPORTED } from "./sync/SyncManager";
import GeometricCorners from "./GeometricCorners";
import { primaryBtn } from "./Onboarding";
import { idbClearAll, idbSet } from "./utils/db";
import { updateDynamicCosts } from "./api/dynamicCosts";
import { sanitizeForPrompt } from "./api/systemPrompt";

// Keys belonging to this app but not starting with "jv_" — must be wiped on full reset.
const APP_CONSTANT_KEYS = new Set([DATA_DISCLOSURE_SEEN_KEY, THEME_KEY, "jv_last_synced"]);

// Strip control chars, BiDi overrides/zero-width chars from stored gacha fields at render time.
// Also used by GachaCard to defensively clean up legacy cards saved before stricter sanitizers.
// eslint-disable-next-line no-control-regex
const SAFE_GACHA_RENDER_REGEX = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export default function ProfileTab() {
  const { state, setState, latestStateRef, profile, level, rank, xpPerLevel, showBanner, showToast, executeCommands, apiKey, buildSystemPrompt, streakShieldCost, gachaCost, trackTokens } = useAppContext();
  const [section, setSection] = useState("overview");
  // showGacha state is reserved for future gacha modal implementation
  // eslint-disable-next-line no-unused-vars
  const [showGacha, setShowGacha] = useState(false);

  const sections = ["overview", "achievements", "calendar", "gacha"];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* XP card */}
      <div className="system-frame" style={{ padding: "24px", position: "relative" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", textAlign: "center" }}>
          <div className="system-header" style={{ fontSize: "13px", justifyContent: "center", marginBottom: "8px" }}>
            <div className="system-divider" />
            <span>[ HUNTER CARD ]</span>
            <div className="system-divider" />
          </div>
          <div style={{ fontSize: "clamp(20px, 6vw, 32px)", fontWeight: "bold", margin: "8px 0", wordBreak: "break-word" }}>{profile?.name || "Hunter"}</div>
          <div style={{ fontSize: "16px", color: "#fff" }}>{rank.decor} {rank.title}</div>
          <div style={{ fontSize: "16px", color: "#fff", marginTop: "4px" }}>{profile?.major ?? ""}</div>
          <div style={{ margin: "20px 0 8px", fontSize: "14px", color: "#fff", display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
            <span>LEVEL {level}</span><span>{getLevelProgress(state.xp, xpPerLevel)}/{xpPerLevel} XP</span>
          </div>
          <div style={{ height: "2px", background: "#444" }}>
            <div style={{ width: `${(getLevelProgress(state.xp, xpPerLevel) / xpPerLevel) * 100}%`, height: "100%", background: "#fff" }} />
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "8px" }}>{rank.badge}</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "8px", letterSpacing: "-0.05em" }}>{state.xp} XP</div>
        </div>
      </div>

      {/* Section nav */}
      <div style={{ display: "flex", gap: "4px", overflowX: "auto" }}>
        {sections.map((s) => (
          <button type="button" key={s} onClick={() => setSection(s)} style={{
            padding: "10px 18px", border: "2px solid #fff",
            background: section === s ? "#fff" : "transparent",
            color: section === s ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", letterSpacing: "1px", fontWeight: "bold",
            whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer", minHeight: "48px",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {section === "overview" && <ProfileOverview state={state} setState={setState} profile={profile} level={level} rank={rank} streakShieldCost={streakShieldCost} apiKey={apiKey} showBanner={showBanner} latestStateRef={latestStateRef} trackTokens={trackTokens} />}
      {section === "achievements" && <AchievementsSection state={state} />}
      {section === "calendar" && <CalendarSection state={state} setState={setState} profile={profile} apiKey={apiKey} buildSystemPrompt={buildSystemPrompt} showBanner={showBanner} executeCommands={executeCommands} />}
      {section === "gacha" && <GachaSection state={state} setState={setState} profile={profile} apiKey={apiKey} gachaCost={gachaCost} showBanner={showBanner} showToast={showToast} trackTokens={trackTokens} latestStateRef={latestStateRef} />}
    </div>
  );
}

function ProfileOverview({ state, setState, profile, level, streakShieldCost, apiKey, showBanner, trackTokens }) {
  const totalSessions = (state.sessions || []).length;
  const totalHabitsLogged = Object.values(state.habitLog || {}).reduce((acc, arr) => acc + arr.length, 0);
  const totalTasksDone = (state.tasks || []).filter((t) => t.done).length;
  const studyHours = (state.sessions || []).reduce((acc, s) => acc + (Number(s.duration) || 0), 0);
  const effectiveShieldCost = state.dynamicCosts?.streakShieldCost ?? streakShieldCost;
  const canBuyShield = state.xp >= effectiveShieldCost;
  const shieldSnapshotRef = useRef(null);
  const buyShieldInFlightRef = useRef(false);
  const buyShieldSkipReasonRef = useRef(null); // "already_purchased" | "insufficient_xp" | null
  const [buyShieldInFlight, setBuyShieldInFlight] = useState(false);

  function buyShield() {
    if (buyShieldInFlightRef.current) return;
    buyShieldInFlightRef.current = true;
    setBuyShieldInFlight(true);
    if (!apiKey) {
      buyShieldInFlightRef.current = false;
      setBuyShieldInFlight(false);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      buyShieldInFlightRef.current = false;
      setBuyShieldInFlight(false);
      showBanner("No network connection. Shield purchase requires connectivity for dynamic pricing.", "alert");
      return;
    }

    buyShieldSkipReasonRef.current = null;
    let appliedCost = 0;
    setState((s) => {
      // NOTE: lastShieldBuyDate is tracked in LOCAL calendar date (localDateFromUTC()),
      // consistent with other daily gates (missions, habit log). The date is read inside
      // the updater from live s to prevent DevTools closure inspection.
      const t = localDateFromUTC();
      if (s.lastShieldBuyDate === t) {
        // Mark as skipped — mutex will be released after setState commits
        buyShieldSkipReasonRef.current = "already_purchased";
        shieldSnapshotRef.current = null;
        return s;
      }
      const currentCost = s.dynamicCosts?.streakShieldCost ?? streakShieldCost;
      const MAX_SAFE_XP = 10_000_000;
      const safeXp = typeof s.xp === "number" && isFinite(s.xp) && s.xp >= 0
        ? Math.min(Math.floor(s.xp), MAX_SAFE_XP)
        : 0;
      if (safeXp < currentCost) {
        buyShieldSkipReasonRef.current = "insufficient_xp";
        shieldSnapshotRef.current = null;
        return s;
      }
      appliedCost = currentCost;
      const next = {
        ...s,
        xp: Math.max(0, safeXp - currentCost),
        streakShields: Math.min((s.streakShields || 0) + 1, 50),
        lastShieldBuyDate: t,
      };
      shieldSnapshotRef.current = next;
      return next;
    });

    queueMicrotask(() => {
      if (!shieldSnapshotRef.current) {
        buyShieldInFlightRef.current = false;
        setBuyShieldInFlight(false);
        if (buyShieldSkipReasonRef.current === "already_purchased") {
          showBanner("Streak shield already purchased today.", "info");
        }
        return;
      }
      buyShieldInFlightRef.current = false;
      setBuyShieldInFlight(false);
      const snapshotForApi = shieldSnapshotRef.current;
      shieldSnapshotRef.current = null;
      if (!snapshotForApi) return;
      const _displayCost = snapshotForApi?.xp !== undefined ? ((state.xp ?? 0) - (snapshotForApi.xp ?? 0)) : appliedCost;
      showBanner(`Streak shield purchased. Cost: ${_displayCost > 0 ? _displayCost : appliedCost} XP. Next cost may change.`, "success");
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        updateDynamicCosts(getGeminiApiKey(), snapshotForApi, "streak_shield_buy", trackTokens)
          .then((costs) => {
            if (costs && Object.keys(costs).length) {
              setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
            }
          })
          .catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("[ProfileTab] updateDynamicCosts failed:", err?.message || err);
            }
          });
      }
    });

  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {[
          { label: "TOTAL XP", value: state.xp },
          { label: "LEVEL", value: level },
          { label: "STREAK", value: `${state.streak}d` },
          { label: "SHIELDS", value: state.streakShields },
          { label: "HABITS LOGGED", value: totalHabitsLogged },
          { label: "TASKS DONE", value: totalTasksDone },
          { label: "SESSIONS", value: totalSessions },
          { label: "STUDY HRS", value: `${Math.round(studyHours / 60)}h` },
        ].map((s) => (
          <div key={s.label} style={{ border: "2px solid #fff", padding: "14px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", marginTop: "2px", fontWeight: "bold" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Buy streak shield — cost set by AI, one use per day when protecting streak */}
      <div style={{ border: "2px solid #fff", padding: "14px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", marginBottom: "8px", fontWeight: "bold" }}>[ STREAK SHIELD ]</div>
        <div style={{ fontSize: "16px", color: "#fff", marginBottom: "8px" }}>COST: {effectiveShieldCost} XP — MAX ONE PER DAY.</div>
        <button
          type="button"
          onClick={buyShield}
          disabled={!canBuyShield || !apiKey || buyShieldInFlight || (typeof navigator !== "undefined" && navigator.onLine === false)}
          style={{
            padding: "12px 16px", border: canBuyShield && apiKey ? "2px solid #fff" : "2px solid #444", background: canBuyShield && apiKey ? "#fff" : "#000",
            color: canBuyShield && apiKey ? "#000" : "#444", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "2px", cursor: canBuyShield && apiKey ? "pointer" : "default",
            minHeight: "48px",
          }}
        >
          BUY SHIELD — {effectiveShieldCost} XP
        </button>
      </div>

      {/* Rank ladder */}
      <div style={{ border: "2px solid #fff", padding: "14px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>[ RANK LADDER ]</div>
        {RANKS.map((r) => (
          <div key={r.title} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 0", borderBottom: "2px solid #fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
            color: "#fff",
          }}>
            <span>{level >= r.min ? "✓" : "○"} {r.title}</span>
            <span style={{ fontSize: "14px", color: "#fff" }}>{r.decor} LV.{r.min}</span>
          </div>
        ))}
      </div>

      {/* Semester goal */}
      {profile.semesterGoal && (
        <div style={{ border: "2px solid #fff", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", marginBottom: "6px", fontWeight: "bold" }}>[ SEMESTER OBJECTIVE ]</div>
          <div style={{ fontSize: "16px", fontStyle: "italic", color: "#fff", fontFamily: "'IM Fell English', serif" }}>
            {/* Fix [PR-1]: strip Unicode BiDi override characters (U+202A–U+202E, U+2066–U+2069)
                and zero-width chars before display. A crafted sync file can embed RIGHT-TO-LEFT
                OVERRIDE (U+202E) in semesterGoal to visually disguise text — e.g. making
                "goal" appear as "laog" — a visual spoofing/confusion attack. React auto-escapes
                HTML but does not filter Unicode overrides. */}
            &ldquo;{sanitizeForPrompt(
              (profile.semesterGoal || "")
                .replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/g, "")
            )}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}

function AchievementsSection({ state }) {
  const achievements = state.achievements || [];
  const rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };

  const sorted = [...achievements].sort((a, b) => (rarityOrder[a.rarity] ?? 3) - (rarityOrder[b.rarity] ?? 3));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", fontWeight: "bold" }}>
        {achievements.length} UNLOCKED
      </div>
      {achievements.length === 0 && (
        <div style={{ border: "2px solid #fff", padding: "24px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff" }}>
          No achievements yet. RITMOL is watching.
        </div>
      )}
      {sorted.map((ach) => {
        const r = ACHIEVEMENT_RARITIES[ach.rarity] || ACHIEVEMENT_RARITIES.common;
        return (
          <div key={ach.id} style={{
            border: "2px solid #fff", padding: "14px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#000",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "24px" }}>{sanitizeForPrompt(String(ach.icon ?? ''), 4)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "16px", fontWeight: "bold" }}>{sanitizeForPrompt(String(ach.title ?? ''), 300)}</span>
                  <span style={{ fontSize: "14px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "16px", color: "#fff", marginTop: "4px" }}>
                  {typeof ach.desc === "string"
                    ? sanitizeForPrompt(ach.desc, 300)
                    : ""}
                </div>
                {ach.flavorText && typeof ach.flavorText === "string" && (
                  <div style={{ fontSize: "14px", color: "#fff", marginTop: "4px", fontFamily: "'Share Tech Mono', monospace" }}>
                    &ldquo;{sanitizeForPrompt(ach.flavorText, 300)}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function CalendarSection({ state, setState, profile, apiKey, buildSystemPrompt, showBanner, executeCommands }) {
  const [form, setForm] = useState({ title: "", type: "exam", start: "", end: "" });
  const [gCalLoading, setGCalLoading] = useState(false);
  // Discovered calendars from the user's Google account (populated after OAuth).
  const [calendarList, setCalendarList] = useState([]);
  // Pending token held while the user is choosing calendars in the picker.
  const pendingTokenRef = React.useRef(null);

  const now = Date.now();
  const allEvents = [...(state.calendarEvents || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  const events     = allEvents.filter((e) => !e.start || new Date(e.start).getTime() >= now);
  const pastEvents = allEvents.filter((e) => e.start && new Date(e.start).getTime() < now);

  function clearPastEvents() {
    setState((s) => ({
      ...s,
      calendarEvents: (s.calendarEvents || []).filter((e) => !e.start || new Date(e.start).getTime() >= Date.now()),
    }));
    showBanner(`Cleared ${pastEvents.length} past event${pastEvents.length !== 1 ? "s" : ""}.`, "info");
  }

  function addEvent() {
    if (!form.title || !form.start) return;
    // Fix: sanitize user-supplied fields before persisting. These values end up in localStorage,
    // the sync file, and (via buildSystemPrompt) in the AI prompt — sanitize at write time so
    // prompt injection characters don't reach any of those sinks.
    const safeTitle = sanitizeForPrompt(form.title, 200);
    const safeType  = ["lecture","tirgul","exam","assignment","homework","other"].includes(form.type) ? form.type : "other";
    const safeStart = typeof form.start === "string" && /^\d{4}-\d{2}-\d{2}/.test(form.start) ? form.start : "";
    const safeEnd   = typeof form.end === "string" && /^\d{4}-\d{2}-\d{2}/.test(form.end) ? form.end : "";
    if (!safeTitle || !safeStart) return;
    const newEvent = { id: `manual_${crypto.randomUUID()}`, title: safeTitle, type: safeType, start: safeStart, end: safeEnd, source: "manual" }; // Fix: was Date.now()
    setState((s) => ({ ...s, calendarEvents: [...(s.calendarEvents || []), newEvent] }));
    showBanner(`Event added: ${safeTitle}`, "success");

    // Let RITMOL react
    if (apiKey && safeType === "exam") {
      const days = Math.ceil((new Date(safeStart) - Date.now()) / 86400000);
      showBanner(`Exam detected: ${safeTitle} in ${days} days. RITMOL adapting your plan.`, "alert");
    }
    setForm({ title: "", type: "exam", start: "", end: "" });
  }

  // After the user picks calendars, fetch events and persist the selection.
  async function applyCalendarSelection(chosenIds, accessToken) {
    const ids = chosenIds.length > 0 ? chosenIds : ["primary"];
    setGCalLoading(true);
    try {
      const events = await fetchGCalEvents(accessToken, ids);
      setState((s) => {
        const syncNow = Date.now();
        const manualEvents = (s.calendarEvents || []).filter((e) => e.source === "manual" && (!e.start || new Date(e.start).getTime() >= syncNow));
        return { ...s, calendarEvents: [...manualEvents, ...events], gCalConnected: true, gCalSelectedIds: ids };
      });
      showBanner(`Synced ${events.length} events from ${ids.length} calendar${ids.length !== 1 ? "s" : ""}.`, "success");
    } catch (e) {
      handleGCalError(e);
    } finally {
      pendingTokenRef.current = null;
      setGCalLoading(false);
    }
  }

  function handleGCalError(e) {
    if (e?.message === "GCAL_TOKEN_EXPIRED") {
      setState((s) => ({ ...s, gCalConnected: false }));
      showBanner("Google Calendar token expired. Re-sync to reconnect.", "alert"); return;
    }
    if (e?.message === "GCAL_PERMISSION_DENIED") {
      showBanner("Calendar sync failed: insufficient permissions or quota exceeded. Check your Google Cloud Console.", "alert"); return;
    }
    if (e?.message === "GCAL_RATE_LIMITED") {
      showBanner("Calendar sync failed: rate limit hit. Wait a moment and try again.", "alert"); return;
    }
    if (e?.message?.startsWith("GCAL_HTTP_")) {
      showBanner(`Calendar sync failed: server returned ${e.message.replace("GCAL_HTTP_", "HTTP ")}. Try again later.`, "alert"); return;
    }
    if (e?.message === "GCAL_NETWORK_ERROR") {
      showBanner("Calendar sync failed: network error. Check your connection and try again.", "alert"); return;
    }
    let msg = e?.error?.message ?? e?.result?.error?.message ?? e?.message ?? e?.reason;
    if (msg == null && e && typeof e === "object") {
      const err = e?.error ?? e?.result?.error;
      if (typeof err === "string") msg = err;
      else if (err && typeof err === "object") msg = err.message ?? err.error_description ?? JSON.stringify(err).slice(0, 100);
      else { const d = e?.details?.[0]; msg = d?.message ?? d?.description ?? (d ? JSON.stringify(d) : null); }
    }
    if (msg == null) msg = typeof e === "string" ? e : (e && typeof e === "object" ? JSON.stringify(e).slice(0, 80) : String(e));
    const short = msg.length > 60 ? msg.slice(0, 57) + "…" : msg;
    showBanner(`Calendar sync failed: ${short} Check Client ID and authorized origins in Google Cloud Console.`, "alert");
  }

  async function syncGoogleCalendar(forcePicker = false) {
    const clientId = profile?.googleClientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) { showBanner("No Google Client ID configured.", "alert"); return; }
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      showBanner("Invalid Google Client ID format. Check your ritmol-data.json.", "alert"); return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showBanner("No network connection. Google Calendar sync requires connectivity.", "alert"); return;
    }
    setGCalLoading(true);
    try {
      await loadGoogleGIS();
      const tokenResponse = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "https://www.googleapis.com/auth/calendar.readonly",
          callback: (resp) => { if (resp.error) reject(new Error(resp.error)); else resolve(resp); },
        });
        tokenClient.requestAccessToken({ prompt: state.gCalConnected ? "" : "consent" });
      });
      const accessToken = tokenResponse.access_token;
      if (!accessToken) throw new Error("No access token");

      // Fetch the full calendar list so the user can choose which to include.
      const cals = await fetchCalendarList(accessToken);
      setCalendarList(cals);

      const previousIds = state.gCalSelectedIds;
      if (!forcePicker && previousIds && previousIds.length > 0) {
        // User already has a saved selection — re-sync silently with it.
        await applyCalendarSelection(previousIds, accessToken);
      } else {
        // First time, or "Change Calendars" was clicked — show the picker.
        pendingTokenRef.current = accessToken;
        setGCalLoading(false);
      }
    } catch (e) {
      handleGCalError(e);
      setGCalLoading(false);
    }
  }

  function deleteEvent(id) {
    setState((s) => ({ ...s, calendarEvents: (s.calendarEvents || []).filter((e) => e.id !== id) }));
  }

  const showPicker = calendarList.length > 0 && pendingTokenRef.current !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <button
        type="button"
        onClick={syncGoogleCalendar}
        disabled={gCalLoading || showPicker || (typeof navigator !== "undefined" && navigator.onLine === false)}
        style={{
        padding: "12px", border: "2px solid #fff",
        background: "transparent",
        color: "#fff",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "1px",
        minHeight: "48px",
      }}>
        {gCalLoading ? "SYNCING..." : state.gCalConnected ? "✓ GOOGLE CALENDAR SYNCED" : "SYNC GOOGLE CALENDAR"}
      </button>

      {/* Change-calendars button (shown when already connected and picker is not open) */}
      {state.gCalConnected && !showPicker && (
        <button
          type="button"
          onClick={() => syncGoogleCalendar(true)}
          style={{
            padding: "10px", border: "1px solid #555", background: "transparent", color: "#aaa",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
          }}>
          CHANGE CALENDARS ({(state.gCalSelectedIds || []).length} selected)
        </button>
      )}

      {/* Calendar picker — shown after OAuth until the user confirms */}
      {showPicker && (
        <CalendarPicker
          calendars={calendarList}
          initialSelected={state.gCalSelectedIds || calendarList.map((c) => c.id)}
          onConfirm={(chosenIds) => {
            const token = pendingTokenRef.current;
            pendingTokenRef.current = null;
            setCalendarList([]);
            applyCalendarSelection(chosenIds, token);
          }}
          onCancel={() => {
            pendingTokenRef.current = null;
            setCalendarList([]);
          }}
        />
      )}

      {/* Add manual event */}
      <div style={{ border: "2px solid #fff", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>[ ADD EVENT ]</div>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Event title..."
          style={{ background: "#000", border: "2px solid #fff", color: "#fff", padding: "12px", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", outline: "none" }}
        />
        <div style={{ display: "flex", gap: "6px" }}>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            style={{ flex: 1, background: "#000", border: "2px solid #fff", color: "#fff", padding: "12px", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", outline: "none" }}
          >
            <option value="exam">EXAM</option>
            <option value="lecture">LECTURE</option>
            <option value="tirgul">TIRGUL</option>
            <option value="homework">HOMEWORK</option>
            <option value="other">OTHER</option>
          </select>
          <input
            type="datetime-local"
            value={form.start}
            onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
            style={{ flex: 2, background: "#000", border: "2px solid #fff", color: "#fff", padding: "12px", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", outline: "none" }}
          />
        </div>
        <button type="button" onClick={addEvent} style={primaryBtn}>ADD EVENT</button>
      </div>

      {pastEvents.length > 0 && (
        <button
          type="button"
          onClick={clearPastEvents}
          style={{
            padding: "10px", border: "1px solid #555", background: "transparent", color: "#aaa",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
          }}>
          CLEAR {pastEvents.length} PAST EVENT{pastEvents.length !== 1 ? "S" : ""}
        </button>
      )}

      {/* Events list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {events.length === 0 && (
          <div style={{ border: "2px solid #fff", padding: "16px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff" }}>
            No events. Sync calendar or add manually.
          </div>
        )}
        {events.map((ev) => {
          const startDate = ev.start ? new Date(ev.start) : null;
          const validStart = startDate && !isNaN(startDate.getTime());
          const startDisplay = validStart ? startDate.toLocaleDateString() : "TBD";
          const daysLeft = validStart ? Math.ceil((startDate - Date.now()) / 86400000) : null;
          return (
            <div key={ev.id} style={{
              border: "2px solid #fff", padding: "12px",
              fontFamily: "'Share Tech Mono', monospace",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "16px", fontWeight: "bold" }}>{ev.title}</div>
                <div style={{ fontSize: "14px", color: "#fff", marginTop: "4px" }}>
                  {ev.type?.toUpperCase()} · {startDisplay}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 14 && (
                    <span style={{ color: "#fff", fontWeight: daysLeft <= 3 ? "bold" : "normal" }}> · {daysLeft}d</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => deleteEvent(ev.id)} style={{ color: "#fff", background: "none", border: "none", fontSize: "18px", minHeight: "48px", minWidth: "48px" }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Displays the user's Google Calendar subscriptions and lets them toggle which ones to sync.
function CalendarPicker({ calendars, initialSelected, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(() => new Set(initialSelected));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const mono = { fontFamily: "'Share Tech Mono', monospace" };

  return (
    <div style={{ border: "2px solid #fff", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ ...mono, fontSize: "16px", fontWeight: "bold", letterSpacing: "2px", color: "#fff" }}>
        [ SELECT CALENDARS ]
      </div>
      <div style={{ fontSize: "13px", color: "#aaa", ...mono }}>
        Choose which calendars to sync. All selected by default.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
        {calendars.map((cal) => {
          const checked = selected.has(cal.id);
          return (
            <div
              key={cal.id}
              onClick={() => toggle(cal.id)}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px", border: `2px solid ${checked ? "#fff" : "#444"}`,
                cursor: "pointer", background: checked ? "rgba(255,255,255,0.05)" : "transparent",
              }}>
              {/* Colour dot from Google Calendar */}
              <span style={{
                width: "12px", height: "12px", borderRadius: "50%", flexShrink: 0,
                background: cal.color || "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
              }} />
              <span style={{ ...mono, fontSize: "14px", color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cal.title}
              </span>
              <span style={{ ...mono, fontSize: "18px", color: checked ? "#fff" : "#555", flexShrink: 0 }}>
                {checked ? "■" : "□"}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={() => onConfirm([...selected])}
          disabled={selected.size === 0}
          style={{
            flex: 1, padding: "12px", border: "2px solid #fff",
            background: selected.size > 0 ? "#fff" : "transparent",
            color: selected.size > 0 ? "#000" : "#555",
            ...mono, fontSize: "15px", letterSpacing: "1px", cursor: selected.size > 0 ? "pointer" : "default",
          }}>
          SYNC {selected.size} CALENDAR{selected.size !== 1 ? "S" : ""}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "12px 16px", border: "1px solid #555",
            background: "transparent", color: "#aaa",
            ...mono, fontSize: "15px", cursor: "pointer",
          }}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

function GachaSection({ state, setState, profile, apiKey, gachaCost, showBanner, showToast, trackTokens, latestStateRef }) {
  const [pulling, setPulling] = useState(false);
  const [lastPull, setLastPull] = useState(null);
  const [showCollection, setShowCollection] = useState(false);
  const [collectionPage, setCollectionPage] = useState(0);
  const rawCollection = state.gachaCollection || [];
  const collection = (rawCollection || []).map((card) => ({
    ...card,
    content: typeof card.content === "string"
      ? card.content.replace(SAFE_GACHA_RENDER_REGEX, "").slice(0, 1000)
      : "",
    asciiArt: card.asciiArt
      ? card.asciiArt.replace(SAFE_GACHA_RENDER_REGEX, "").slice(0, 500)
      : null,
  }));
  const canAfford = state.xp >= gachaCost;
  // Check if daily token budget is depleted
  const tokenUsage = state.tokenUsage;
  const tokensExhausted = !!(tokenUsage && tokenUsage.date === todayUTC() && tokenUsage.tokens >= DAILY_TOKEN_LIMIT);
  // Abort controller so unmounting mid-pull cancels the Gemini request and prevents
  // trackTokens / setState firing against an unmounted component.
  const gachaAbortRef = useRef(null);
  // Fix: ref-level guard prevents double-deduction if doPull is called twice
  // before the first setPulling(true) re-render has flushed (e.g. rapid taps).
  const pullingRef = useRef(false);
  const mountedRef = useRef(true);

  // Cancel any in-flight pull on unmount and mark unmounted.
  useEffect(() => () => {
    mountedRef.current = false;
    gachaAbortRef.current?.abort();
  }, []);

  async function doPull() {
    // Re-read xp from latestStateRef for the pre-check so a stale render snapshot
    // does not cause a false "Insufficient XP" banner when XP was just awarded.
    const liveXp = latestStateRef?.current?.xp ?? state.xp;
    const liveCost = latestStateRef?.current?.dynamicCosts?.gachaCost ?? gachaCost;
    const liveCanAfford = liveXp >= liveCost;
    if (pullingRef.current || !liveCanAfford || pulling || !apiKey) {
      if (!liveCanAfford) showBanner(`Insufficient XP. Need ${liveCost} XP to pull.`, "alert");
      if (!apiKey) showBanner("No API key. Configure in settings.", "alert");
      return;
    }
    const usage = latestStateRef?.current?.tokenUsage ?? state.tokenUsage;
    if (usage && usage.date === todayUTC() && usage.tokens >= DAILY_TOKEN_LIMIT) {
      showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showBanner("SYSTEM: No network connection. Gacha requires connectivity.", "alert");
      return;
    }

    // Set the ref-level guard immediately so rapid taps are blocked even before
    // setPulling re-renders. No XP deduction happens until the API call succeeds.
    pullingRef.current = true;
    setPulling(true);

    gachaAbortRef.current?.abort();
    const controller = new AbortController();
    // SAFETY: assign gachaAbortRef before any await so the useEffect cleanup
    // (which calls gachaAbortRef.current?.abort()) always sees the latest controller.
    gachaAbortRef.current = controller;

    try {
      const sp = (s, max) => sanitizeForPrompt(
        (s || "").replace(/[<>{}[\]`"'\\]/g, ""), max
      ).replace(/[`$]/g, "");

      // ── Compute behavioural patterns from real state data ──────────────
      const now = Date.now();

      // Habit consistency: count completions per habit over the last 30 days
      const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
      const habitLog = state.habitLog || {};
      const habitCounts = {}; // habitId → count
      for (const [date, ids] of Object.entries(habitLog)) {
        if (date < thirtyDaysAgo) continue;
        for (const id of (ids || [])) {
          habitCounts[id] = (habitCounts[id] || 0) + 1;
        }
      }
      const habits = state.habits || [];
      // Days with any log entry (= days the app was used) for denominator
      const activeDays = Object.keys(habitLog).filter(d => d >= thirtyDaysAgo).length || 1;
      const habitSummary = habits
        .map(h => ({ label: h.label, count: habitCounts[h.id] || 0, category: h.category }))
        .filter(h => h.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map(h => {
          const pct = Math.round((h.count / activeDays) * 100);
          return sp(`${h.label} (${pct}% consistency)`, 60);
        });

      // Task patterns: early, on-time, or overdue
      const tasks = state.tasks || [];
      const doneTasks = tasks.filter(t => t.done && t.doneDate && t.due);
      let earlyCount = 0, onTimeCount = 0, overdueCount = 0;
      for (const t of doneTasks) {
        if (t.doneDate < t.due) earlyCount++;
        else if (t.doneDate === t.due) onTimeCount++;
        else overdueCount++;
      }
      const taskStyle = earlyCount > onTimeCount + overdueCount ? "finishes early"
        : onTimeCount > overdueCount ? "deadline-precise"
        : overdueCount > 0 ? "battles deadlines"
        : "no task pattern yet";

      // Recent completed task labels for flavour
      const recentTaskLabels = tasks
        .filter(t => t.done && t.doneDate && t.doneDate >= thirtyDaysAgo)
        .slice(-5)
        .map(t => sp(t.text, 40));

      // Session stats
      const sessions = state.sessions || [];
      const recentSessions = sessions.filter(s => s.date && s.date >= thirtyDaysAgo);
      const sessionTypeCount = {};
      let totalFocus = 0, focusCount = 0;
      for (const s of recentSessions) {
        if (s.type) sessionTypeCount[s.type] = (sessionTypeCount[s.type] || 0) + 1;
        if (typeof s.focusLevel === "number") { totalFocus += s.focusLevel; focusCount++; }
      }
      const topSessionType = Object.entries(sessionTypeCount).sort((a,b) => b[1]-a[1])[0]?.[0] || null;
      const avgFocus = focusCount > 0 ? Math.round(totalFocus / focusCount) : null;

      // Sleep consistency
      const sleepLog = state.sleepLog || {};
      const recentSleep = Object.entries(sleepLog)
        .filter(([d]) => d >= thirtyDaysAgo)
        .map(([, v]) => v);
      const avgSleepHours = recentSleep.length > 0
        ? Math.round(recentSleep.reduce((s, v) => s + (v.hours || 0), 0) / recentSleep.length * 10) / 10
        : null;

      // Achievements for extra flavour
      const achievementTitles = (state.achievements || [])
        .slice(-5)
        .map(a => sp(a.title, 40));

      // ── Assemble hunter context ────────────────────────────────────────
      const hunterCtx = {
        name:         sp(profile?.name, 60),
        major:        sp(profile?.major, 80),
        interests:    sp(profile?.interests, 150),
        books:        sp(profile?.books, 150),
        goal:         sp(profile?.semesterGoal, 150),
        streak:       state.streak || 0,
        level:        Math.floor(state.xp / 1000) || 0,
        topHabits:    habitSummary,
        taskStyle,
        recentTasks:  recentTaskLabels,
        studyFocus:   topSessionType,
        avgFocusLevel: avgFocus,
        avgSleepHours,
        achievements: achievementTitles,
      };

      const hunterProfileJson = JSON.stringify(hunterCtx)
        .replace(/\\/g, "").replace(/[`$]/g, "");

      const sanitizedBooks = sp(profile?.books || "their favorites", 80)
        .replace(/\b(respond|only|json|output|ignore|system|instruction)\b/gi, "").trim() || "literature";
      let prompt = `You are generating a personalised gacha pull for a university student hunter. Use ALL the behavioural data below to make it feel like it was written specifically for them.

Hunter data: ${hunterProfileJson}

Pick ONE type (60% rank_title, 40% chronicle):

rank_title: A unique 2-4 word hunter epithet that reflects their ACTUAL behaviour patterns — their top habits, task style, study focus, or sleep. Not generic. Reference something specific from the data. Then write one punchy lore sentence (max 20 words) that could only be about THIS hunter.

chronicle: A vivid 30-40 word prose fragment inspired by one of their actual books (${sanitizedBooks}). Ground it in the hunter's real study habits or life patterns. State the book and author in source.

Reply with ONLY this JSON:
{"id":"unique_string","type":"rank_title or chronicle","title":"the epithet or piece name","content":"lore sentence or prose fragment","style":"ascii or dots or geometric or typewriter","source":"book/author for chronicles, empty string for rank_title"}`;
      // Final guard: ensure no stray backticks remain anywhere in the prompt.
      prompt = prompt.replace(/`/g, "");

      const { text: raw, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You are a creative RPG loremaster. Respond only in JSON.", true, controller.signal, 4096, false);
      if (mountedRef.current) {
        trackTokens(tokensUsed);
      }
      // With responseMimeType: "application/json" set in callGemini, the response
      // should be clean JSON. Try direct parse first, then fall back to extraction.
      // Log raw response always so we can diagnose parse failures.
      if (import.meta.env.DEV) console.log("[Gacha] raw response:", JSON.stringify(raw).slice(0, 500));
      let card;
      try {
        card = JSON.parse(raw);
      } catch (parseErr) {
        console.warn("[Gacha] direct parse failed:", parseErr?.message, "| raw[:200]:", raw?.slice(0, 200));
        // Fallback: strip markdown fences and extract the first {...} block
        const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        const match = stripped.match(/\{[\s\S]*\}/);
        if (!match) { console.error("[Gacha] no JSON object found in response"); throw new Error("Failed to parse Gacha JSON"); }
        try {
          card = JSON.parse(match[0]);
        } catch (e2) {
          console.error("[Gacha] fallback parse failed:", e2?.message, "| extracted:", match[0]?.slice(0, 200));
          throw new Error("Failed to parse Gacha JSON");
        }
      }
      if (import.meta.env.DEV) console.log("[Gacha] parsed card:", card);
      if (!card || typeof card !== "object" || Array.isArray(card)) {
        console.error("[Gacha] card is not a plain object:", typeof card);
        throw new Error("Failed to parse Gacha JSON");
      }
      // Prototype-pollution guard before any property access.
      const { isSafeSyncValue } = await import("./sync/SyncManager.js");
      if (!isSafeSyncValue(card)) {
        console.error("[Gacha] isSafeSyncValue rejected card:", Object.keys(card));
        throw new Error("Failed to parse Gacha JSON");
      }

      let contentHash = "";
      const contentToHash = String(card.content || "") + String(card.title || "");
      try {
        if (crypto?.subtle?.digest) {
          const data = new TextEncoder().encode(contentToHash);
          const hashBuf = await crypto.subtle.digest("SHA-1", data);
          contentHash = Array.from(new Uint8Array(hashBuf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 16);
        }
      } catch {
        contentHash = "";
      }

      // Fix #11 (security): construct the stored card explicitly — never spread the raw AI
      // object so unexpected keys cannot pollute the gachaCollection state/localStorage.
      // Fix: also strip control chars from all string fields before persisting — the AI
      // response is external input and could contain C0/C1 controls or zero-width chars
      // that would be silently stored then rendered or re-injected into prompts.
      const stripGachaStr = (s, max) => typeof s === "string" ? sanitizeForPrompt(s).replace(/[\u200B-\u200D\uFEFF]/g, "").slice(0, max) : null;
      const safeCard = {
        id:       contentHash ? `gacha_${contentHash}` : `gacha_${crypto.randomUUID()}`,
        type:     ["rank_title","chronicle"].includes(card.type) ? card.type : "rank_title",
        // rarity is sampled atomically inside the setState updater below
        title:    stripGachaStr(card.title, 120) ?? "Unknown",
        content:  stripGachaStr(card.content, 1000) ?? "",
        style:    ["ascii","dots","geometric","typewriter"].includes(card.style) ? card.style : "ascii",
        source:   stripGachaStr(card.source, 120),
        asciiArt: null,
      };

      // Pre-check affordability synchronously using latestStateRef before setState.
      // The committed-flag pattern (setting a flag inside a setState updater and reading
      // it immediately after) does NOT work in async React 18 — React schedules the
      // updater for the next render cycle, so the flag is always false when checked here.
      // Instead: validate against latestStateRef.current (always the committed live state),
      // then call setState unconditionally knowing the guards have already passed.
      const liveState = latestStateRef?.current ?? state;
      const liveCostNow = liveState.dynamicCosts?.gachaCost ?? gachaCost;
      const liveXpNow = typeof liveState.xp === "number" && isFinite(liveState.xp) && liveState.xp >= 0
        ? Math.min(Math.floor(liveState.xp), 10_000_000) : 0;

      if (liveXpNow < liveCostNow) {
        if (mountedRef.current) {
          showBanner(`Insufficient XP. Need ${liveCostNow} XP to pull.`, "info");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }
      if ((liveState.gachaCollection || []).length >= 2000) {
        if (mountedRef.current) {
          showBanner("Collection full (2000 cards max).", "info");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }
      if ((liveState.gachaCollection || []).find(c => c.id === safeCard.id)) {
        if (mountedRef.current) {
          showBanner("Duplicate card — no XP consumed.", "info");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }

      // All guards passed — deduct XP and store card.
      // Build the next state snapshot here (synchronously) so we have it for
      // updateDynamicCosts without relying on snapshotForCosts being set inside
      // the async updater (which runs in the next render cycle, not right now).
      let sampledRarity = "common";
      const costsSnapshot = {
        ...liveState,
        xp: Math.max(0, liveXpNow - liveCostNow),
        gachaCollection: [...(liveState.gachaCollection || []), { ...safeCard, rarity: "common", pulledAt: Date.now() }],
      };
      setState((s) => {
        const cost = s.dynamicCosts?.gachaCost ?? gachaCost;
        const safeXp = typeof s.xp === "number" && isFinite(s.xp) && s.xp >= 0
          ? Math.min(Math.floor(s.xp), 10_000_000) : 0;
        // Re-check inside updater as a safety net (handles race between two rapid taps).
        if (safeXp < cost) return s;
        if ((s.gachaCollection || []).length >= 2000) return s;
        if ((s.gachaCollection || []).find(c => c.id === safeCard.id)) return s;
        const rarity = (() => {
          const r = sampleGachaRarity();
          return ["common","rare","epic","legendary"].includes(r) ? r : "common";
        })();
        sampledRarity = rarity;
        return {
          ...s,
          xp: Math.max(0, safeXp - cost),
          gachaCollection: [...(s.gachaCollection || []), { ...safeCard, rarity, pulledAt: Date.now() }],
        };
      });
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        updateDynamicCosts(getGeminiApiKey(), costsSnapshot, "gacha_pull", trackTokens).then((costs) => {
          if (costs && Object.keys(costs).length && mountedRef.current) {
            setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
          }
        }).catch((err) => {
          if (import.meta.env.DEV) {
            console.warn("[ProfileTab] updateDynamicCosts failed:", err?.message || err);
          }
        });
      }

      setCollectionPage(0);
      if (mountedRef.current) {
        setLastPull(safeCard);
        showToast({ icon: safeCard.type === "chronicle" ? "≡" : "◈", title: safeCard.title, desc: sampledRarity.toUpperCase() + " PULL", rarity: sampledRarity, isAchievement: false });
        showBanner(`${sampledRarity.toUpperCase()} — ${safeCard.title}`, "success");
        setPulling(false);
      }
      pullingRef.current = false;
    } catch (err) {
      if (err?.name === "AbortError") {
        if (mountedRef.current) setPulling(false);
        pullingRef.current = false;
        return;
      }
      if (err instanceof RateLimitedError) {
        // Client cap hit — no XP consumed, tell user how long to wait
        const secsLeft = Math.ceil(err.retryAfterMs / 1000);
        if (mountedRef.current) {
          showBanner(`Rate cap reached. Wait ${secsLeft}s before pulling again.`, "alert");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }
      if (err?.isGemini429) {
        const secsLeft = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 60;
        const msg = err.message?.includes("RESOURCE_EXHAUSTED")
          ? "Daily Gemini quota used up — gacha unavailable until tomorrow."
          : `Gemini RPM limit hit. Wait ~${secsLeft}s and try again.`;
        if (mountedRef.current) {
          showBanner(msg, "alert");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }
      // No XP to refund — deduction only happened inside setState on success.
      console.error("[Gacha] doPull failed:", err?.message ?? err);
      if (mountedRef.current) {
        let msg = "Gacha pull failed. No XP consumed.";
        if (err?.message?.includes("MAX_TOKENS") || err?.message?.includes("truncated")) {
          msg = "Gacha response was cut off — try again in a moment.";
        }
        const devMsg = import.meta.env.DEV ? ` (${String(err?.message ?? err).slice(0, 80)})` : "";
        showBanner(msg + devMsg, "alert");
        setPulling(false);
      }
      pullingRef.current = false;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Gacha machine */}
      <div style={{
        border: "2px solid #fff", padding: "24px", textAlign: "center",
        background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
        fontFamily: "'Share Tech Mono', monospace", position: "relative",
      }}>
        <GeometricCorners style="geometric" />
        <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "3px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ CHRONICLE ENGINE ]</div>
        <div style={{ fontSize: "40px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "16px", color: "#fff", marginBottom: "16px", fontFamily: "'Share Tech Mono', monospace" }}>
          {tokensExhausted
            ? "NEURAL ENERGY DEPLETED"
            : canAfford ? `${gachaCost} XP per pull` : `Need ${gachaCost - state.xp} more XP`}
        </div>
        {tokensExhausted && (
          <div style={{
            border: "2px solid #fff", padding: "10px 14px", marginBottom: "12px",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff",
            letterSpacing: "1px", lineHeight: "1.5",
          }}>
            ⚡ DAILY TOKEN BUDGET EXHAUSTED<br />
            AI functions disabled until midnight reset.
          </div>
        )}
        <button
          type="button"
          onClick={doPull}
          disabled={!canAfford || pulling || tokensExhausted}
          style={{
            width: "100%", padding: "14px",
            background: canAfford && !pulling && !tokensExhausted ? "#fff" : "#1a1a1a",
            color: canAfford && !pulling && !tokensExhausted ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "2px",
            border: "none", cursor: canAfford && !pulling && !tokensExhausted ? "pointer" : "default",
            opacity: tokensExhausted ? 0.5 : 1,
          }}
        >
          {pulling ? "PULLING..." : tokensExhausted ? "NO NEURAL ENERGY" : `PULL — ${gachaCost} XP`}
        </button>
        <div style={{ fontSize: "16px", color: "#fff", marginTop: "8px", fontFamily: "'Share Tech Mono', monospace" }}>
          {collection.length} cards collected
        </div>
      </div>

      {/* Last pull display */}
      {lastPull && <GachaCard card={lastPull} />}

      {/* Collection toggle */}
        <button type="button" onClick={() => setShowCollection(!showCollection)} style={{
        padding: "12px", border: "2px solid #fff", background: "transparent",
        color: "#fff", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
      }}>
        {showCollection ? "HIDE COLLECTION" : `VIEW COLLECTION (${collection.length})`}
      </button>

      {showCollection && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {collection.length === 0 && (
            <div style={{ border: "2px solid #fff", padding: "20px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff" }}>
              No cards yet. Pull to collect.
            </div>
          )}
          {collection.length > 0 && (() => {
            const PAGE_SIZE = 20;
            const pageCount = Math.ceil(collection.length / PAGE_SIZE);
            const safePage = Math.min(Math.max(0, collectionPage), pageCount - 1);
            const pageItems = [...collection]
              .reverse()
              .slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
            return (
              <>
                {pageItems.map((card) => (
                  <GachaCard key={card.id} card={card} compact />
                ))}
                {pageCount > 1 && (
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center", alignItems: "center", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => setCollectionPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      style={{
                        padding: "8px 14px",
                        border: safePage === 0 ? "2px solid #444" : "2px solid #fff",
                        background: safePage === 0 ? "#000" : "transparent",
                        color: safePage === 0 ? "#444" : "#fff",
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: "16px",
                        cursor: safePage === 0 ? "default" : "pointer",
                        minHeight: "48px",
                      }}
                    >
                      ◀ PREV
                    </button>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff" }}>
                      {safePage + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCollectionPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage === pageCount - 1}
                      style={{
                        padding: "8px 14px",
                        border: safePage === pageCount - 1 ? "2px solid #444" : "2px solid #fff",
                        background: safePage === pageCount - 1 ? "#000" : "transparent",
                        color: safePage === pageCount - 1 ? "#444" : "#fff",
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: "16px",
                        cursor: safePage === pageCount - 1 ? "default" : "pointer",
                        minHeight: "48px",
                      }}
                    >
                      NEXT ▶
                    </button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function GachaCard({ card, compact }) {
  const [expanded, setExpanded] = useState(!compact);
  const styleMap = STYLE_CSS;
  const s = styleMap[card.style] || styleMap.ascii;
  const r = ACHIEVEMENT_RARITIES[card.rarity] || ACHIEVEMENT_RARITIES.common;

  // Defence-in-depth: sanitize card fields at render time to clean up entries stored before
  // the stricter stripGachaStr sanitizer was added. React auto-escapes HTML, but we still
  // strip control chars, BiDi overrides, zero-width chars, ANSI escape sequences, and
  // angle brackets so text cannot visually mimic tags or terminal control codes.
  const safeRenderStr = (v) => {
    if (typeof v !== "string") return v ?? "";
    return v
      .replace(SAFE_GACHA_RENDER_REGEX, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\[[0-9;]*[mGKHF]/g, "") // ANSI escape sequences
      .replace(/[<>]/g, "");
  };

  return (
    <div style={{
      border: "2px solid #fff", padding: "16px",
      background: s.background, fontFamily: s.fontFamily,
      cursor: compact ? "pointer" : "default",
    }} onClick={() => compact && setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", fontWeight: "bold" }}>{safeRenderStr(card.title)}</div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", color: "#fff", marginTop: "4px", fontWeight: "bold" }}>
            {card.type === "chronicle" ? `CHRONICLE · ${safeRenderStr(card.source)}` : "RANK TITLE"} · {r.label}
          </div>
        </div>
        {compact && <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff" }}>{expanded ? "[ ▲ ]" : "[ ▼ ]"}</span>}
      </div>

      {expanded && (
        <>
          {card.type === "rank_title" && (
            <div style={{
              borderTop: "2px solid #fff", borderBottom: "2px solid #fff",
              padding: "16px 0", margin: "12px 0", textAlign: "center",
            }}>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "4px", color: "#aaa", marginBottom: "8px" }}>— HUNTER EPITHET —</div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "22px", fontWeight: "bold", color: "#fff", letterSpacing: "2px" }}>
                {safeRenderStr(card.title)}
              </div>
            </div>
          )}
          <div style={{ fontSize: "16px", lineHeight: "1.7", color: "#fff", marginTop: "8px", whiteSpace: "pre-wrap" }}>
            {safeRenderStr(card.content)}
          </div>
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function SettingsSection({ profile, setState, showBanner, syncStatus, lastSynced, syncFileConnected, dropboxConnected, onPush, onPull, onPickSyncFile, onForgetSyncFile, confirmForgetSync, connectDropbox, disconnectDropbox, theme, setTheme, latestStateRef, rehydrate }) {
  const importRef = useRef(null);
  const [importLoading, setImportLoading] = useState(false);
  const currentGeminiKey = getGeminiApiKey();

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

  // Fix: replace window.confirm with a two-step in-app confirmation — window.confirm() is
  // blocked in PWA standalone mode and some embedded contexts (same reason forgetSyncFile was fixed).
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
      // Clear the client-side rate-limit window so the new key starts fresh.
      clearRateLimitWindow();
      // Force App to re-render so apiKey (read via getGeminiApiKey() on render)
      // reflects the new value immediately. Without this, the context value stays
      // stale until an unrelated re-render occurs.
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

    // 1. Preserve the anti-rollback watermark before wiping IDB so full reset
    // does not allow clock rollback exploits on AI XP / streak logic.
    const maxDateSeen = getMaxDateSeen();

    // 2. Wipe all IDB user data
    await idbClearAll();

    // 3. Restore the anti-cheat watermark if it existed.
    if (maxDateSeen) {
      idbSet("jv_max_date_seen", maxDateSeen);
      await new Promise((r) => setTimeout(r, 100));
    }

    // 4. Clear the residual localStorage keys that belong to this app
    //    (theme, disclosure flag, jv_last_synced, migration flag, quote cache)
    const lsKeysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (
        k.startsWith("jv_") ||
        k.startsWith("ritmol_dev_") ||
        APP_CONSTANT_KEYS.has(k)
      )) {
        lsKeysToDelete.push(k);
      }
    }
    lsKeysToDelete.forEach((k) => localStorage.removeItem(k));

    // 5. Forget sync file handle from IDB handles store
    await SyncManager.forget();

    // 6. Clear in-memory Gemini key
    setGeminiApiKey("");

    // 7. Reload — no setTimeout needed under write-through IDB persistence
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
          CORRUPT_FILE:          "Import failed: file is corrupt or not valid JSON.",
          SYNC_SCHEMA_OUTDATED:  "Import failed: file was written by an older version of RITMOL. Re-export it from an up-to-date device.",
          SYNC_FILE_TOO_LARGE:   "Import failed: file exceeds 10 MB.",
          SYNC_BUSY:             "Sync already in progress. Please wait.",
          IDB_NOT_READY:         "Import failed: app is still loading — try again in a moment.",
          // Dropbox error codes — not thrown by importFile today but may be in future
          // if the Dropbox transport is extended to support file-import flows.
          DROPBOX_AUTH_REQUIRED: "Import failed: Dropbox session required.",
          DROPBOX_TOKEN_EXPIRED: "Import failed: Dropbox session expired. Reconnect in Settings.",
          DROPBOX_OFFLINE:       "Import failed: no network connection.",
          DROPBOX_TIMEOUT:       "Import failed: request timed out. Check your connection.",
          DROPBOX_FILE_NOT_FOUND:"Import failed: no RITMOL file found in Dropbox.",
          DROPBOX_QUOTA_EXCEEDED:"Import failed: Dropbox storage is full.",
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

  const lastSyncedLabel = lastSynced
    ? new Date(lastSynced).toLocaleString()
    : "Never";

  const syncStatusLabel =
    syncStatus === "syncing" ? "SYNCING..." :
    syncStatus === "error"   ? "⚠ SYNC ERROR" :
    syncStatus === "synced"  ? `✓ ${lastSyncedLabel}` :
                               lastSynced ? lastSyncedLabel : "Not synced yet";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>[ APPEARANCE ]</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          style={{
            flex: 1, padding: "12px", border: "2px solid #fff",
            background: theme === "dark" ? "#fff" : "transparent",
            color: theme === "dark" ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px",
          }}
        >
          DARK
        </button>
        <button
          type="button"
          onClick={() => setTheme("light")}
          style={{
            flex: 1, padding: "10px", border: `2px solid ${theme === "light" ? "#000" : "#333"}`,
            background: theme === "light" ? "#fff" : "transparent",
            color: theme === "light" ? "#000" : "#fff",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "1px", cursor: "pointer", minHeight: "48px",
          }}
        >
          LIGHT
        </button>
      </div>

      <div style={{ height: "1px", background: "#333", margin: "8px 0" }} />

      {/* ── INSTALL APP ── */}
      {!isStandalone && (
        <>
          <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>[ INSTALL APP ]</div>
          {installDone ? (
            <div style={{ fontSize: "16px", color: "#fff", border: "2px solid #fff", padding: "12px" }}>
              ✓ APP INSTALLED SUCCESSFULLY
            </div>
          ) : installPrompt ? (
            /* Chrome / Android — native install prompt available */
            <>
              <div style={{ fontSize: "14px", color: "#fff", lineHeight: "1.7", opacity: 0.7 }}>
                Install RITMOL as an app for offline access and a full-screen experience.
              </div>
              <button
                type="button"
                onClick={doInstall}
                style={{
                  width: "100%", padding: "14px", background: "#fff", color: "#000",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
                  letterSpacing: "2px", border: "none", cursor: "pointer", minHeight: "56px",
                }}
              >
                ⬇ INSTALL APP
              </button>
            </>
          ) : isIOS ? (
            /* iOS Safari — no beforeinstallprompt, show manual steps */
            <>
              <div style={{ fontSize: "14px", color: "#fff", lineHeight: "1.7", opacity: 0.7 }}>
                Install RITMOL on your iPhone or iPad:
              </div>
              <div style={{ border: "2px solid #fff", padding: "14px", fontSize: "15px", color: "#fff", lineHeight: "2", fontFamily: "'Share Tech Mono', monospace" }}>
                1. Tap the <strong>Share</strong> button <span style={{ fontSize: "18px" }}>⎋</span> in Safari<br />
                2. Scroll down and tap <strong>&quot;Add to Home Screen&quot;</strong><br />
                3. Tap <strong>Add</strong>
              </div>
            </>
          ) : (
            /* Already installed or browser doesn't support install */
            <div style={{ fontSize: "14px", color: "#fff", lineHeight: "1.7", opacity: 0.6 }}>
              Open this page in Chrome or Edge on Android to install it as an app.
              On iPhone, use Safari → Share → Add to Home Screen.
            </div>
          )}
          <div style={{ height: "1px", background: "#333", margin: "8px 0" }} />
        </>
      )}

      {/* ── SYNC ── */}
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>[ SYNC ]</div>

      {dropboxConnected ? (
        /* Dropbox connected */
        <>
          <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
            SYNC — DROPBOX
          </div>
          <div style={{ fontSize: "16px", color: "#fff", marginBottom: "8px" }}>
            ● Connected
          </div>
          <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.8", fontFamily: "'Share Tech Mono', monospace" }}>
            LAST SYNCED: <span style={{ color: "#fff", fontWeight: "bold" }}>{syncStatusLabel}</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.onLine === false) {
                  showBanner("No network connection. Sync requires connectivity.", "alert");
                  return;
                }
                onPush();
              }}
              disabled={typeof navigator !== "undefined" && navigator.onLine === false}
              style={{
                flex: 1, padding: "12px", border: "2px solid #fff",
                background: "transparent", color: "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                minHeight: "48px",
              }}
            >
              PUSH ↑
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.onLine === false) {
                  showBanner("No network connection. Sync requires connectivity.", "alert");
                  return;
                }
                onPull();
              }}
              disabled={typeof navigator !== "undefined" && navigator.onLine === false}
              style={{
                flex: 1, padding: "12px", border: "2px solid #444",
                background: "transparent", color: "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                minHeight: "48px",
              }}
            >
              PULL ↓
            </button>
            <button
              type="button"
              onClick={disconnectDropbox}
              style={{
                padding: "12px", border: "2px solid #fff",
                background: "transparent", color: "#fff",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer",
                minHeight: "48px",
              }}
            >
              DISCONNECT
            </button>
          </div>
        </>
      ) : (
        /* Dropbox not connected */
        <>
          <button
            type="button"
            onClick={connectDropbox}
            style={{
              width: "100%", padding: "12px", border: "2px solid #fff", background: "#fff", color: "#000",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "2px", cursor: "pointer", minHeight: "48px",
            }}
          >
            CONNECT DROPBOX
          </button>
          <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.8", fontFamily: "'Share Tech Mono', monospace" }}>
            LAST SYNCED: <span style={{ color: "#fff", fontWeight: "bold" }}>{syncStatusLabel}</span>
          </div>
          <div style={{ height: "2px", background: "#fff", margin: "4px 0" }} />
          <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "1px", fontWeight: "bold" }}>
            {FSAPI_SUPPORTED ? "or use local file" : "or export / import manually"}
          </div>
          {FSAPI_SUPPORTED ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={onPickSyncFile} style={{
                  padding: "12px", border: "2px solid #fff", background: "transparent",
                  color: "#fff", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer",
                  minHeight: "48px",
                }}>
                  PICK FILE
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.onLine === false) {
                      showBanner("No network connection. Sync requires connectivity.", "alert");
                      return;
                    }
                    onPush();
                  }}
                  disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                  style={{
                    padding: "12px", border: "2px solid #fff", background: "transparent",
                    color: "#fff", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                    minHeight: "48px",
                  }}
                >
                  PUSH ↑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.onLine === false) {
                      showBanner("No network connection. Sync requires connectivity.", "alert");
                      return;
                    }
                    onPull();
                  }}
                  disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                  style={{
                    padding: "12px", border: "2px solid #444", background: "transparent",
                    color: "#fff", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                    minHeight: "48px",
                  }}
                >
                  PULL ↓
                </button>
                <button type="button" onClick={onForgetSyncFile} style={{
                  padding: "12px", border: "2px solid #fff",
                  background: "transparent",
                  color: "#fff",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer",
                  minHeight: "48px",
                }}>
                  {confirmForgetSync ? "CONFIRM?" : "FORGET"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "16px", color: "#fff", border: "2px solid #fff", padding: "12px", lineHeight: "1.7", fontFamily: "'Share Tech Mono', monospace" }}>
                ⚠ Your browser does not support direct file access.
              </div>
              <button type="button" onClick={() => SyncManager.download((msg) => showBanner(msg, "alert"))} style={{
                padding: "12px", border: "2px solid #fff", background: "transparent",
                color: "#fff", fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer",
                minHeight: "48px",
              }}>
                EXPORT ↓
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                disabled={importLoading || syncStatus === "syncing"}
                onChange={handleImportFile}
                style={{ display: "none" }}
              />
              <button
                type="button"
                disabled={importLoading || syncStatus === "syncing"}
                onClick={() => { if (!importLoading && syncStatus !== "syncing") importRef.current?.click(); }}
                style={{
                  padding: "12px", border: "2px solid #fff", background: "transparent",
                  color: "#fff",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "16px",
                  minHeight: "48px",
                  cursor: importLoading || syncStatus === "syncing" ? "default" : "pointer",
                }}
              >
                {importLoading ? "IMPORTING..." : "IMPORT ↑"}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── AI CONFIG ── */}
      <div style={{ height: "1px", background: "#333", margin: "8px 0" }} />
      <div style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", fontWeight: "bold" }}>[ AI CONFIG ]</div>
      <button
        type="button"
        onClick={handleChangeGeminiKey}
        style={{
          marginTop: "4px",
          padding: "12px",
          border: "2px solid #fff",
          background: "transparent",
          color: "#fff",
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: "16px",
          letterSpacing: "1px",
          cursor: "pointer",
          minHeight: "48px",
        }}
      >
        CHANGE GEMINI API KEY
      </button>
      {IS_DEV && (
        <div
          style={{
            marginTop: "8px",
            border: "2px dashed #555",
            padding: "10px 12px",
            fontSize: "12px",
            color: "#ccc",
            fontFamily: "'Share Tech Mono', monospace",
            lineHeight: "1.6",
            wordBreak: "break-all",
          }}
        >
          <div style={{ fontSize: "11px", letterSpacing: "2px", marginBottom: "4px", fontWeight: "bold" }}>
            DEV ONLY — CURRENT GEMINI KEY
          </div>
          <div>
            {currentGeminiKey || "(none set)"}
          </div>
        </div>
      )}

      <button type="button" onClick={resetAll} style={{
        marginTop: "8px", padding: "10px",
        border: "2px solid #fff",
        background: confirmReset ? "#3a1111" : "transparent",
        color: "#fff",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer",
        minHeight: "48px",
        transition: "none",
      }}>
        {confirmReset ? "CONFIRM RESET? (click again)" : "RESET ALL DATA"}
      </button>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════
