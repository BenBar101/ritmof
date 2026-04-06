import React, { useState, useEffect, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { todayUTC, localDateFromUTC } from "./utils/db";
import { ACHIEVEMENT_RARITIES, STYLE_CSS, RANKS, sampleGachaRarity } from "./constants";
import { getLevelProgress } from "./utils/xp";
import { fetchGCalEvents, fetchCalendarList, requestGcalAccessToken } from "./api/gcal";
import GeometricCorners from "./GeometricCorners";
import { primaryBtn } from "./Onboarding";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { GACHA_POOL, gachaPickIndex } from "./data/gachaPool.js";

// Strip control chars, BiDi overrides/zero-width chars from stored gacha fields at render time.
// Also used by GachaCard to defensively clean up legacy cards saved before stricter sanitizers.
// eslint-disable-next-line no-control-regex
const SAFE_GACHA_RENDER_REGEX = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export default function ProfileTab() {
  const { state, setState, latestStateRef, profile, level, rank, xpPerLevel, showBanner, showToast, streakShieldCost, gachaCost, theme } = useAppContext();
  const fg  = theme === "light" ? "#000" : "#fff";
  const [section, setSection] = useState("overview");
  // showGacha state is reserved for future gacha modal implementation
  // eslint-disable-next-line no-unused-vars
  const [showGacha, setShowGacha] = useState(false);

  const sections = ["overview", "calendar", "gacha"];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* XP card */}
      <div className="system-frame" style={{ padding: "24px", position: "relative" }}>
        <div style={{ textAlign: "center" }}>
          <div className="system-header" style={{ fontSize: "13px", justifyContent: "center", marginBottom: "8px" }}>
            <div className="system-divider" />
            <span>HUNTER CARD</span>
            <div className="system-divider" />
          </div>
          <div style={{ fontSize: "clamp(20px, 6vw, 32px)", fontWeight: "bold", margin: "8px 0", wordBreak: "break-word" }}>{profile?.name || "Hunter"}</div>
          <div style={{ fontSize: "16px", color: fg }}>{rank.decor} {rank.title}</div>
          <div style={{ fontSize: "16px", color: fg, marginTop: "4px" }}>{profile?.major ?? ""}</div>
          <div className="type-system" style={{ margin: "20px 0 8px", fontSize: "14px", color: fg, display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
            <span>LEVEL {level}</span><span>{getLevelProgress(state.xp, xpPerLevel)}/{xpPerLevel} XP</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${(getLevelProgress(state.xp, xpPerLevel) / xpPerLevel) * 100}%` }} />
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", marginTop: "8px" }}>{rank.badge}</div>
          <div className="type-system" style={{ fontSize: "28px", fontWeight: "bold", marginTop: "8px", letterSpacing: "-0.03em" }}>{state.xp} XP</div>
        </div>
      </div>

      {/* Section nav */}
      <div style={{ display: "flex", gap: "4px", overflowX: "auto" }}>
        {sections.map((s) => (
          <button type="button" key={s} onClick={() => setSection(s)} style={{
            padding: "10px 18px", border: "2px solid #fff",
            background: section === s ? "#fff" : "transparent",
            color: section === s ? "#000" : fg,
            fontSize: "14px", letterSpacing: "0.08em", fontWeight: "700",
            whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer", minHeight: "48px",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {section === "overview" && <ProfileOverview theme={theme} state={state} setState={setState} profile={profile} level={level} rank={rank} streakShieldCost={streakShieldCost} showBanner={showBanner} />}
      {section === "calendar" && <CalendarSection state={state} theme={theme} setState={setState} profile={profile} showBanner={showBanner} />}
      {section === "gacha" && <GachaSection theme={theme} state={state} setState={setState} profile={profile} gachaCost={gachaCost} showBanner={showBanner} showToast={showToast} latestStateRef={latestStateRef} />}
    </div>
  );
}

function ProfileOverview({ state, setState, profile, level, streakShieldCost, showBanner, theme }) {
  const fg  = theme === "light" ? "#000" : "#fff";
  const bg  = theme === "light" ? "#f0f0f0" : "#000";

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
      void (async () => {
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
        showBanner(`Streak shield purchased. Cost: ${_displayCost > 0 ? _displayCost : appliedCost} XP.`, "success");
      })();
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
          <div key={s.label} style={{ border: "2px solid #fff", padding: "14px", fontFamily: "var(--font-system), ui-monospace, monospace" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "16px", color: fg, letterSpacing: "2px", marginTop: "2px", fontWeight: "bold" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Buy streak shield — one use per day when protecting streak */}
      <div style={{ border: "2px solid #fff", padding: "14px", fontFamily: "var(--font-system), ui-monospace, monospace" }}>
        <div style={{ fontSize: "16px", color: fg, letterSpacing: "2px", marginBottom: "8px", fontWeight: "bold" }}>[ STREAK SHIELD ]</div>
        <div style={{ fontSize: "16px", color: fg, marginBottom: "8px" }}>COST: {effectiveShieldCost} XP — MAX ONE PER DAY.</div>
        <button
          type="button"
          onClick={buyShield}
          disabled={!canBuyShield || buyShieldInFlight}
          style={{
            padding: "12px 16px", border: canBuyShield ? "2px solid #fff" : "2px solid #444", background: canBuyShield ? "#fff" : bg,
            color: canBuyShield ? "#000" : "#444", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", letterSpacing: "2px", cursor: canBuyShield ? "pointer" : "default",
            minHeight: "48px",
          }}
        >
          BUY SHIELD — {effectiveShieldCost} XP
        </button>
      </div>

      {/* Rank ladder */}
      <div style={{ border: "2px solid #fff", padding: "14px" }}>
        <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", color: fg, letterSpacing: "2px", marginBottom: "10px", fontWeight: "bold" }}>[ RANK LADDER ]</div>
        {RANKS.map((r) => (
          <div key={r.title} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 0", borderBottom: "2px solid #fff",
            fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px",
            color: fg,
          }}>
            <span>{level >= r.min ? "✓" : "○"} {r.title}</span>
            <span style={{ fontSize: "14px", color: fg }}>{r.decor} LV.{r.min}</span>
          </div>
        ))}
      </div>

      {/* Semester goal */}
      {profile.semesterGoal && (
        <div style={{ border: "2px solid #fff", padding: "12px", fontFamily: "var(--font-system), ui-monospace, monospace" }}>
          <div style={{ fontSize: "16px", color: fg, letterSpacing: "2px", marginBottom: "6px", fontWeight: "bold" }}>[ SEMESTER OBJECTIVE ]</div>
          <div style={{ fontSize: "16px", fontStyle: "italic", color: fg, fontFamily: "'IM Fell English', serif" }}>
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

function CalendarSection({ state, setState, profile, showBanner, theme }) {
  const fg  = theme === "light" ? "#000" : "#fff";
  const bg  = theme === "light" ? "#f0f0f0" : "#000";

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
    if (safeType === "exam") {
      const days = Math.ceil((new Date(safeStart) - Date.now()) / 86400000);
      showBanner(`Exam added: ${safeTitle} in ${days} days.`, "info");
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
      const tokenResponse = await requestGcalAccessToken(clientId, {
        promptConsent: !state.gCalConnected,
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
        color: fg,
        fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", letterSpacing: "1px",
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
            fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
          }}>
          CHANGE CALENDARS ({(state.gCalSelectedIds || []).length} selected)
        </button>
      )}

      {/* Calendar picker — shown after OAuth until the user confirms */}
      {showPicker && (
        <CalendarPicker
          theme={theme}
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
        <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", color: fg, letterSpacing: "2px", fontWeight: "bold" }}>[ ADD EVENT ]</div>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Event title..."
          style={{ background: bg, border: "2px solid #fff", color: fg, padding: "12px", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", outline: "none" }}
        />
        <div style={{ display: "flex", gap: "6px" }}>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            style={{ flex: 1, background: bg, border: "2px solid #fff", color: fg, padding: "12px", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", outline: "none" }}
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
            style={{ flex: 2, background: bg, border: "2px solid #fff", color: fg, padding: "12px", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", outline: "none" }}
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
            fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
          }}>
          CLEAR {pastEvents.length} PAST EVENT{pastEvents.length !== 1 ? "S" : ""}
        </button>
      )}

      {/* Events list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {events.length === 0 && (
          <div style={{ border: "2px solid #fff", padding: "16px", textAlign: "center", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", color: fg }}>
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
              fontFamily: "var(--font-system), ui-monospace, monospace",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "16px", fontWeight: "bold" }}>{ev.title}</div>
                <div style={{ fontSize: "14px", color: fg, marginTop: "4px" }}>
                  {ev.type?.toUpperCase()} · {startDisplay}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 14 && (
                    <span style={{ color: fg, fontWeight: daysLeft <= 3 ? "bold" : "normal" }}> · {daysLeft}d</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => deleteEvent(ev.id)} style={{ color: fg, background: "none", border: "none", fontSize: "18px", minHeight: "48px", minWidth: "48px" }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Displays the user's Google Calendar subscriptions and lets them toggle which ones to sync.
function CalendarPicker({ calendars, initialSelected, onConfirm, onCancel, theme }) {
  const fg  = theme === "light" ? "#000" : "#fff";

  const [selected, setSelected] = useState(() => new Set(initialSelected));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const mono = { fontFamily: "var(--font-system), ui-monospace, monospace" };

  return (
    <div style={{ border: "2px solid #fff", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ ...mono, fontSize: "16px", fontWeight: "bold", letterSpacing: "2px", color: fg }}>
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
              
              <span style={{ ...mono, fontSize: "14px", color: fg, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

function GachaSection({ state, setState, profile, gachaCost, showBanner, showToast, latestStateRef, theme }) {
  const fg  = theme === "light" ? "#000" : "#fff";
  const bg  = theme === "light" ? "#f0f0f0" : "#000";

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
  const pullingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const stripGachaStr = (s, max) => typeof s === "string" ? sanitizeForPrompt(s).replace(/[\u200B-\u200D\uFEFF]/g, "").slice(0, max) : null;

  async function doPull() {
    const liveXp = latestStateRef?.current?.xp ?? state.xp;
    const liveCost = latestStateRef?.current?.dynamicCosts?.gachaCost ?? gachaCost;
    const liveCanAfford = liveXp >= liveCost;
    if (pullingRef.current || !liveCanAfford || pulling) {
      if (!liveCanAfford) showBanner(`Insufficient XP. Need ${liveCost} XP to pull.`, "alert");
      return;
    }

    pullingRef.current = true;
    setPulling(true);

    try {
      const seedKey = `${profile?.id || "anon"}_${todayUTC()}_${Date.now()}_${(state.gachaCollection || []).length}`;
      const tpl = GACHA_POOL[gachaPickIndex(seedKey, GACHA_POOL.length)];
      const contentToHash = String(tpl.content || "") + String(tpl.title || "");
      let contentHash = "";
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

      const safeCard = {
        id:       contentHash ? `gacha_${contentHash}` : `gacha_${crypto.randomUUID()}`,
        type:     ["rank_title", "chronicle"].includes(tpl.type) ? tpl.type : "rank_title",
        title:    stripGachaStr(tpl.title, 120) ?? "Unknown",
        content:  stripGachaStr(tpl.content, 1000) ?? "",
        style:    ["ascii", "dots", "geometric", "typewriter"].includes(tpl.style) ? tpl.style : "ascii",
        source:   stripGachaStr(tpl.source || "", 120),
        asciiArt: null,
      };

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
      if ((liveState.gachaCollection || []).find((c) => c.id === safeCard.id)) {
        if (mountedRef.current) {
          showBanner("Duplicate card — no XP consumed.", "info");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }

      let sampledRarity = "common";
      setState((s) => {
        const cost = s.dynamicCosts?.gachaCost ?? gachaCost;
        const safeXp = typeof s.xp === "number" && isFinite(s.xp) && s.xp >= 0
          ? Math.min(Math.floor(s.xp), 10_000_000) : 0;
        if (safeXp < cost) return s;
        if ((s.gachaCollection || []).length >= 2000) return s;
        if ((s.gachaCollection || []).find((c) => c.id === safeCard.id)) return s;
        const rarity = (() => {
          const r = sampleGachaRarity();
          return ["common", "rare", "epic", "legendary"].includes(r) ? r : "common";
        })();
        sampledRarity = rarity;
        return {
          ...s,
          xp: Math.max(0, safeXp - cost),
          gachaCollection: [...(s.gachaCollection || []), { ...safeCard, rarity, pulledAt: Date.now() }],
        };
      });

      setCollectionPage(0);
      if (mountedRef.current) {
        setLastPull(safeCard);
        showToast({ icon: safeCard.type === "chronicle" ? "≡" : "◈", title: safeCard.title, desc: sampledRarity.toUpperCase() + " PULL", rarity: sampledRarity, isAchievement: false });
        showBanner(`${sampledRarity.toUpperCase()} — ${safeCard.title}`, "success");
        setPulling(false);
      }
      pullingRef.current = false;
    } catch (err) {
      console.error("[Gacha] doPull failed:", err?.message ?? err);
      if (mountedRef.current) {
        showBanner("Pull failed. No XP consumed.", "alert");
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
        fontFamily: "var(--font-system), ui-monospace, monospace", position: "relative",
      }}>
        <GeometricCorners style="geometric" />
        <div style={{ fontSize: "16px", color: fg, letterSpacing: "3px", fontFamily: "var(--font-system), ui-monospace, monospace", fontWeight: "bold" }}>[ CHRONICLE ENGINE ]</div>
        <div style={{ fontSize: "40px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "16px", color: fg, marginBottom: "16px", fontFamily: "var(--font-system), ui-monospace, monospace" }}>
          {canAfford ? `${gachaCost} XP per pull` : `Need ${gachaCost - state.xp} more XP`}
        </div>
        <button
          type="button"
          onClick={doPull}
          disabled={!canAfford || pulling}
          style={{
            width: "100%", padding: "14px",
            background: canAfford && !pulling ? "#fff" : bg,
            color: canAfford && !pulling ? "#000" : fg,
            fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", letterSpacing: "2px",
            border: "none", cursor: canAfford && !pulling ? "pointer" : "default",
          }}
        >
          {pulling ? "PULLING..." : `PULL — ${gachaCost} XP`}
        </button>
        <div style={{ fontSize: "16px", color: fg, marginTop: "8px", fontFamily: "var(--font-system), ui-monospace, monospace" }}>
          {collection.length} cards collected
        </div>
      </div>

      {/* Last pull display */}
      {lastPull && <GachaCard card={lastPull} />}

      {/* Collection toggle */}
        <button type="button" onClick={() => setShowCollection(!showCollection)} style={{
        padding: "12px", border: "2px solid #fff", background: "transparent",
        color: fg, fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px",
      }}>
        {showCollection ? "HIDE COLLECTION" : `VIEW COLLECTION (${collection.length})`}
      </button>

      {showCollection && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {collection.length === 0 && (
            <div style={{ border: "2px solid #fff", padding: "20px", textAlign: "center", fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", color: fg }}>
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
                  <GachaCard key={card.id} card={card} theme={theme} compact />
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
                        color: safePage === 0 ? "#444" : fg,
                        fontFamily: "var(--font-system), ui-monospace, monospace",
                        fontSize: "16px",
                        cursor: safePage === 0 ? "default" : "pointer",
                        minHeight: "48px",
                      }}
                    >
                      ◀ PREV
                    </button>
                    <span style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "14px", color: fg }}>
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
                        color: safePage === pageCount - 1 ? "#444" : fg,
                        fontFamily: "var(--font-system), ui-monospace, monospace",
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

function GachaCard({ card, compact, theme }) {
  const fg  = theme === "light" ? "#000" : "#fff";

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
          <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", fontWeight: "bold" }}>{safeRenderStr(card.title)}</div>
          <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "14px", color: fg, marginTop: "4px", fontWeight: "bold" }}>
            {card.type === "chronicle" ? `CHRONICLE · ${safeRenderStr(card.source)}` : "RANK TITLE"} · {r.label}
          </div>
        </div>
        {compact && <span style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "16px", color: fg }}>{expanded ? "[ ▲ ]" : "[ ▼ ]"}</span>}
      </div>

      {expanded && (
        <>
          {card.type === "rank_title" && (
            <div style={{
              borderTop: "2px solid #fff", borderBottom: "2px solid #fff",
              padding: "16px 0", margin: "12px 0", textAlign: "center",
            }}>
              <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "11px", letterSpacing: "4px", color: "#aaa", marginBottom: "8px" }}>— HUNTER EPITHET —</div>
              <div style={{ fontFamily: "var(--font-system), ui-monospace, monospace", fontSize: "22px", fontWeight: "bold", color: fg, letterSpacing: "2px" }}>
                {safeRenderStr(card.title)}
              </div>
            </div>
          )}
          <div style={{ fontSize: "16px", lineHeight: "1.7", color: fg, marginTop: "8px", whiteSpace: "pre-wrap" }}>
            {safeRenderStr(card.content)}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODALS
// ═══════════════════════════════════════════════════════════════
