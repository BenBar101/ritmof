import { useState, useEffect, useRef, flushSync } from "react";
import { useAppContext } from "./context/AppContext";
import { todayUTC, getGeminiApiKey, setGeminiApiKey, getMaxDateSeen, storageKey } from "./utils/storage";
import { ACHIEVEMENT_RARITIES, STYLE_CSS, DAILY_TOKEN_LIMIT, RANKS, sampleGachaRarity } from "./constants";
import { DATA_DISCLOSURE_SEEN_KEY, THEME_KEY } from "./constants";
import { getLevelProgress } from "./utils/xp";
import { callGemini } from "./api/gemini";
import { fetchGCalEvents, loadGoogleGIS } from "./api/gcal";
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
const SAFE_GACHA_RENDER_REGEX = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export default function ProfileTab() {
  const { state, setState, latestStateRef, profile, level, rank, xpPerLevel, showBanner, showToast, executeCommands, apiKey, buildSystemPrompt, syncStatus, lastSynced, syncFileConnected, dropboxConnected, confirmForgetSync, syncPush: onPush, syncPull: onPull, pickSyncFile: onPickSyncFile, forgetSyncFile: onForgetSyncFile, connectDropbox, disconnectDropbox, theme, setTheme, streakShieldCost, gachaCost, trackTokens } = useAppContext();
  const [section, setSection] = useState("overview");
  // showGacha state is reserved for future gacha modal implementation
  // eslint-disable-next-line no-unused-vars
  const [showGacha, setShowGacha] = useState(false);

  const sections = ["overview", "achievements", "calendar", "gacha", "settings"];

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* XP card */}
      <div style={{
        border: "2px solid #fff", padding: "20px",
        background: "linear-gradient(45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(-45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px, linear-gradient(-45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px",
        position: "relative",
      }}>
        <GeometricCorners style="geometric" />
        <div style={{ fontFamily: "'Share Tech Mono', monospace", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#666", letterSpacing: "3px" }}>HUNTER CARD</div>
          <div style={{ fontSize: "28px", fontWeight: "bold", margin: "6px 0" }}>{profile?.name || "Hunter"}</div>
          <div style={{ fontSize: "13px", color: "#aaa" }}>{rank.decor} {rank.title}</div>
          <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{profile?.major ?? ""}</div>
          <div style={{ margin: "16px 0 4px", fontSize: "11px", color: "#555", display: "flex", justifyContent: "space-between" }}>
            <span>LEVEL {level}</span><span>{getLevelProgress(state.xp, xpPerLevel)}/{xpPerLevel} XP</span>
          </div>
          <div style={{ height: "4px", background: "#111" }}>
            <div style={{ width: `${(getLevelProgress(state.xp, xpPerLevel) / xpPerLevel) * 100}%`, height: "100%", background: "#fff", transition: "width 0.5s" }} />
          </div>
          <div style={{ fontSize: "28px", marginTop: "8px" }}>{rank.badge}</div>
          <div style={{ fontSize: "24px", fontWeight: "bold", marginTop: "4px" }}>{state.xp} XP</div>
        </div>
      </div>

      {/* Section nav */}
      <div style={{ display: "flex", gap: "4px", overflowX: "auto" }}>
        {sections.map((s) => (
          <button type="button" key={s} onClick={() => setSection(s)} style={{
            padding: "6px 12px", border: `1px solid ${section === s ? "#fff" : "#333"}`,
            background: section === s ? "#fff" : "transparent",
            color: section === s ? "#000" : "#666",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", letterSpacing: "1px",
            whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer",
          }}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {section === "overview" && <ProfileOverview state={state} setState={setState} profile={profile} level={level} rank={rank} streakShieldCost={streakShieldCost} apiKey={apiKey} showBanner={showBanner} latestStateRef={latestStateRef} trackTokens={trackTokens} />}
      {section === "achievements" && <AchievementsSection state={state} />}
      {section === "calendar" && <CalendarSection state={state} setState={setState} profile={profile} apiKey={apiKey} buildSystemPrompt={buildSystemPrompt} showBanner={showBanner} executeCommands={executeCommands} />}
      {section === "gacha" && <GachaSection state={state} setState={setState} profile={profile} apiKey={apiKey} gachaCost={gachaCost} showBanner={showBanner} showToast={showToast} trackTokens={trackTokens} latestStateRef={latestStateRef} />}
      {section === "settings" && <SettingsSection profile={profile} setState={setState} showBanner={showBanner} syncStatus={syncStatus} lastSynced={lastSynced} syncFileConnected={syncFileConnected} dropboxConnected={dropboxConnected} onPush={onPush} onPull={onPull} onPickSyncFile={onPickSyncFile} onForgetSyncFile={onForgetSyncFile} confirmForgetSync={confirmForgetSync} connectDropbox={connectDropbox} disconnectDropbox={disconnectDropbox} theme={theme} setTheme={setTheme} latestStateRef={latestStateRef} />}
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

  function buyShield() {
    if (buyShieldInFlightRef.current) return;
    buyShieldInFlightRef.current = true;
    if (!apiKey) {
      buyShieldInFlightRef.current = false;
      return;
    }

    buyShieldSkipReasonRef.current = null;
    let appliedCost = 0;
    setState((s) => {
      // NOTE: lastShieldBuyDate is tracked in UTC rather than local time. This means
      // hunters near the UTC date boundary (UTC+12–UTC+14) may appear to get two
      // purchases within a single local calendar day when buying just before and
      // just after UTC midnight, but the economic impact is limited and keeps
      // streak logic consistent with other UTC-based checks.
      const t = todayUTC();
      if (s.lastShieldBuyDate === t) {
        // Mark as skipped — mutex will be released after setState commits
        buyShieldSkipReasonRef.current = "already_purchased";
        shieldSnapshotRef.current = null;
        return s;
      }
      const currentCost = s.dynamicCosts?.streakShieldCost ?? streakShieldCost;
      if (s.xp < currentCost) {
        buyShieldSkipReasonRef.current = "insufficient_xp";
        return s;
      }
      appliedCost = currentCost;
      const next = {
        ...s,
        xp: Math.max(0, s.xp - currentCost),
        streakShields: (s.streakShields || 0) + 1,
        lastShieldBuyDate: t,
      };
      shieldSnapshotRef.current = next;
      return next;
    });

    queueMicrotask(() => {
      if (!shieldSnapshotRef.current) {
        buyShieldInFlightRef.current = false;
        if (buyShieldSkipReasonRef.current === "already_purchased") {
          showBanner("Streak shield already purchased today.", "info");
        }
        return;
      }
      buyShieldInFlightRef.current = false;
      const snapshotForApi = shieldSnapshotRef.current;
      shieldSnapshotRef.current = null;
      if (!snapshotForApi) return;
      const _displayCost = snapshotForApi?.xp !== undefined ? ((state.xp ?? 0) - (snapshotForApi.xp ?? 0)) : appliedCost;
      showBanner(`Streak shield purchased. Cost: ${_displayCost > 0 ? _displayCost : appliedCost} XP. Next cost may change.`, "success");
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
          <div key={s.label} style={{ border: "1px solid #1a1a1a", padding: "10px", fontFamily: "'Share Tech Mono', monospace" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold" }}>{s.value}</div>
            <div style={{ fontSize: "8px", color: "#444", letterSpacing: "1px", marginTop: "2px" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Buy streak shield — cost set by AI, one use per day when protecting streak */}
      <div style={{ border: "1px solid #333", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
        <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px", marginBottom: "8px" }}>STREAK SHIELD</div>
        <div style={{ fontSize: "11px", color: "#888", marginBottom: "8px" }}>Cost: {effectiveShieldCost} XP (AI may change after purchase). Max one shield use per calendar day.</div>
        <button
          type="button"
          onClick={buyShield}
          disabled={!canBuyShield || !apiKey}
          style={{
            padding: "8px 12px", border: "1px solid #444", background: canBuyShield && apiKey ? "#fff" : "#1a1a1a",
            color: canBuyShield && apiKey ? "#000" : "#333", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", letterSpacing: "1px", cursor: canBuyShield && apiKey ? "pointer" : "default",
          }}
        >
          BUY SHIELD — {effectiveShieldCost} XP
        </button>
      </div>

      {/* Rank ladder */}
      <div style={{ border: "1px solid #1a1a1a", padding: "12px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "10px" }}>RANK LADDER</div>
        {RANKS.map((r) => (
          <div key={r.title} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "5px 0", borderBottom: "1px solid #0f0f0f",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
            color: level >= r.min ? "#fff" : "#333",
          }}>
            <span>{level >= r.min ? "✓" : "○"} {r.title}</span>
            <span style={{ fontSize: "10px", color: "#444" }}>{r.decor} LV.{r.min}</span>
          </div>
        ))}
      </div>

      {/* Semester goal */}
      {profile.semesterGoal && (
        <div style={{ border: "1px solid #222", padding: "12px", fontFamily: "'Share Tech Mono', monospace" }}>
          <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "6px" }}>SEMESTER OBJECTIVE</div>
          <div style={{ fontSize: "13px", fontStyle: "italic", color: "#aaa", fontFamily: "'IM Fell English', serif" }}>
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
      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", color: "#444" }}>
        {achievements.length} UNLOCKED
      </div>
      {achievements.length === 0 && (
        <div style={{ border: "1px dashed #222", padding: "24px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
          No achievements yet. RITMOL is watching.
        </div>
      )}
      {sorted.map((ach) => {
        const r = ACHIEVEMENT_RARITIES[ach.rarity] || ACHIEVEMENT_RARITIES.common;
        return (
          <div key={ach.id} style={{
            border: `1px solid ${r.glow}`, padding: "12px",
            fontFamily: "'Share Tech Mono', monospace",
            background: "#0a0a0a",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "24px" }}>{sanitizeForPrompt(String(ach.icon ?? ''), 4)}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px" }}>{sanitizeForPrompt(String(ach.title ?? ''), 300)}</span>
                  <span style={{ fontSize: "8px", color: r.glow, letterSpacing: "1px" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>
                  {typeof ach.desc === "string"
                    ? sanitizeForPrompt(ach.desc, 300)
                    : ""}
                </div>
                {ach.flavorText && typeof ach.flavorText === "string" && (
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "4px", fontStyle: "italic", fontFamily: "'IM Fell English', serif" }}>
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

  const events = [...(state.calendarEvents || [])].sort((a, b) => new Date(a.start) - new Date(b.start));
  const typeColors = { exam: "#fff", lecture: "#aaa", homework: "#888", tirgul: "#777", other: "#555" };

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

  async function syncGoogleCalendar() {
    const clientId = profile?.googleClientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) { showBanner("No Google Client ID configured.", "alert"); return; }
    // Fix: validate clientId format before passing to Google OAuth — a crafted value from
    // the profile object (e.g. via an old sync file) could trigger unexpected behaviour.
    // Google OAuth client IDs always match *.apps.googleusercontent.com
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      showBanner("Invalid Google Client ID format. Check your ritmol-data.json.", "alert");
      return;
    }
    setGCalLoading(true);
    try {
      await loadGoogleGIS();
      const tokenResponse = await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "https://www.googleapis.com/auth/calendar.readonly",
          callback: (resp) => {
            if (resp.error) reject(new Error(resp.error));
            else resolve(resp);
          },
        });
        tokenClient.requestAccessToken({ prompt: "" });
      });
      let accessToken = tokenResponse.access_token;
      if (!accessToken) throw new Error("No access token");
      const events = await fetchGCalEvents(accessToken);
      accessToken = null; // clear reference promptly
      try {
        setState((s) => {
          const manualEvents = (s.calendarEvents || []).filter((e) => e.source === "manual");
          return { ...s, calendarEvents: [...manualEvents, ...events], gCalConnected: true };
        });
      } catch {
        // If state update fails, ensure we don't leave gCalConnected stuck true
        setState((s) => ({ ...s, gCalConnected: false }));
        throw new Error("GCAL_STATE_UPDATE_FAILED");
      }
      showBanner(`Synced ${events.length} events from Google Calendar.`, "success");
    } catch (e) {
      if (e?.message === "GCAL_TOKEN_EXPIRED") {
        setState((s) => ({ ...s, gCalConnected: false }));
        showBanner("Google Calendar token expired. Re-sync to reconnect.", "alert");
        setGCalLoading(false);
        return;
      }
      // Fix #9: surface specific GCal HTTP errors with actionable messages
      if (e?.message === "GCAL_PERMISSION_DENIED") {
        showBanner("Calendar sync failed: insufficient permissions or quota exceeded. Check your Google Cloud Console.", "alert");
        setGCalLoading(false);
        return;
      }
      if (e?.message === "GCAL_RATE_LIMITED") {
        showBanner("Calendar sync failed: rate limit hit. Wait a moment and try again.", "alert");
        setGCalLoading(false);
        return;
      }
      if (e?.message?.startsWith("GCAL_HTTP_")) {
        showBanner(`Calendar sync failed: server returned ${e.message.replace("GCAL_HTTP_", "HTTP ")}. Try again later.`, "alert");
        setGCalLoading(false);
        return;
      }
      if (e?.message === "GCAL_NETWORK_ERROR") {
        showBanner("Calendar sync failed: network error. Check your connection and try again.", "alert");
        setGCalLoading(false);
        return;
      }
      let msg = e?.error?.message ?? e?.result?.error?.message ?? e?.message ?? e?.reason;
      if (msg == null && e && typeof e === "object") {
        const err = e?.error ?? e?.result?.error;
        if (typeof err === "string") msg = err;
        else if (err && typeof err === "object") msg = err.message ?? err.error_description ?? JSON.stringify(err).slice(0, 100);
        else {
          const d = e?.details?.[0];
          msg = d?.message ?? d?.description ?? (d ? JSON.stringify(d) : null);
        }
      }
      if (msg == null) msg = typeof e === "string" ? e : (e && typeof e === "object" ? JSON.stringify(e).slice(0, 80) : String(e));
      const short = msg.length > 60 ? msg.slice(0, 57) + "…" : msg;
      showBanner(`Calendar sync failed: ${short} Check Client ID and authorized origins in Google Cloud Console.`, "alert");
    }
    setGCalLoading(false);
  }

  function deleteEvent(id) {
    setState((s) => ({ ...s, calendarEvents: (s.calendarEvents || []).filter((e) => e.id !== id) }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <button type="button" onClick={syncGoogleCalendar} disabled={gCalLoading} style={{
        padding: "10px", border: "1px solid #555",
        background: state.gCalConnected ? "#1a1a1a" : "transparent",
        color: state.gCalConnected ? "#aaa" : "#888",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px",
      }}>
        {gCalLoading ? "SYNCING..." : state.gCalConnected ? "✓ GOOGLE CALENDAR SYNCED" : "SYNC GOOGLE CALENDAR"}
      </button>

      {/* Add manual event */}
      <div style={{ border: "1px solid #222", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#444", letterSpacing: "2px" }}>ADD EVENT</div>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Event title..."
          style={{ background: "#111", border: "1px solid #222", color: "#e8e8e8", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", outline: "none" }}
        />
        <div style={{ display: "flex", gap: "6px" }}>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            style={{ flex: 1, background: "#111", border: "1px solid #222", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
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
            style={{ flex: 2, background: "#111", border: "1px solid #222", color: "#aaa", padding: "8px", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", outline: "none" }}
          />
        </div>
        <button onClick={addEvent} style={primaryBtn}>ADD EVENT</button>
      </div>

      {/* Events list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {events.length === 0 && (
          <div style={{ border: "1px dashed #222", padding: "16px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
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
              border: `1px solid ${typeColors[ev.type] || "#333"}`, padding: "10px",
              fontFamily: "'Share Tech Mono', monospace",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "12px" }}>{ev.title}</div>
                <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>
                  {ev.type?.toUpperCase()} · {startDisplay}
                  {daysLeft !== null && daysLeft >= 0 && daysLeft <= 14 && (
                    <span style={{ color: daysLeft <= 3 ? "#fff" : "#888" }}> · {daysLeft}d</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => deleteEvent(ev.id)} style={{ color: "#333", background: "none", border: "none", fontSize: "14px" }}>×</button>
            </div>
          );
        })}
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
    if (pullingRef.current || !canAfford || pulling || !apiKey) {
      if (!canAfford) showBanner(`Insufficient XP. Need ${gachaCost} XP to pull.`, "alert");
      if (!apiKey) showBanner("No API key. Configure in settings.", "alert");
      return;
    }

    // Guard 1: token budget — check BEFORE any XP deduction
    const usage = state.tokenUsage;
    if (usage && usage.date === todayUTC() && usage.tokens >= DAILY_TOKEN_LIMIT) {
      showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert");
      return;
    }

    // Guard 2: online — check BEFORE any XP deduction
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showBanner("SYSTEM: No network connection. Gacha requires connectivity.", "alert");
      return;
    }

    // Optimistic XP deduction (only reached when guards pass)
    pullingRef.current = true;
    let optimisticDeducted = false;
    let deductedCost = 0;
    flushSync(() => {
      setState((s) => {
        const cost = s.dynamicCosts?.gachaCost ?? gachaCost;
        if (s.xp < cost) return s;
        optimisticDeducted = true;
        deductedCost = cost;
        return { ...s, xp: Math.max(0, s.xp - cost) };
      });
    });
    if (!optimisticDeducted) {
      pullingRef.current = false;
      showBanner(`Insufficient XP. Need ${gachaCost} XP to pull`, "alert");
      return;
    }

    // Cancel any previous in-flight pull before starting a new one.
    gachaAbortRef.current?.abort();
    const controller = new AbortController();
    gachaAbortRef.current = controller;
    setPulling(true);

    try {
      // Fix [PR-2]: extract sanitized books once and reuse it in BOTH the JSON block
      // AND the chronicle sub-prompt. The original code sanitized books in the JSON
      // block but interpolated raw profile?.books in the prose instruction line, creating
      // a prompt-injection bypass for that second interpolation point.
      const sanitizedBooks = sanitizeForPrompt(
        (profile?.books || "their favorites").replace(/[<>{}[\]`"'\\]/g, "")
      , 200)
        .replace(/\b(respond|only|json|output|ignore|system|instruction)\b/gi, "").trim() || "literature";
      const sanitizedBooksProse = sanitizedBooks
        .replace(/[()]/g, "")
        .replace(
          /\b(ignore|instruction|system|output|respond|override|prompt|forget|disregard|previous|above|below|execute|run|call|return|do|perform|write|say|tell|pretend|act|play|switch|change|replace|rewrite|now|instead|new|task|role|rule|assistant|user|human|ai|model|llm|gpt|gemini|claude)\b/gi,
          ""
        )
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 80) || "literature";

      const hunterProfileJson = JSON.stringify({
        // Fix: apply full sanitization (control chars + injection chars) not just angle-bracket strip.
        name:      sanitizeForPrompt((profile?.name      || "").replace(/[<>{}[\]`"\\]/g, "")).slice(0, 60),
        books:     sanitizedBooks,
        interests: sanitizeForPrompt((profile?.interests || "").replace(/[<>{}[\]`"\\]/g, "")).slice(0, 200),
        major:     sanitizeForPrompt((profile?.major     || "").replace(/[<>{}[\]`"\\]/g, "")).slice(0, 80),
      })
        // Defence-in-depth: strip backslashes and template delimiters so the JSON
        // block cannot break out of the surrounding template literal.
        .replace(/\\/g, "")
        .replace(/[`$]/g, "");

      let prompt = `Generate a gacha pull for a STEM university student.
Hunter profile: ${hunterProfileJson}
Existing collection (don't duplicate): ${JSON.stringify(collection.slice(-50).map(c => c.id))}

Generate ONE of these (weighted random — 60% rank_cosmetic, 40% chronicle):

For rank_cosmetic: a black-and-white ASCII/geometric/typewriter/dot-matrix rank badge/crest design for this hunter. Make it unique and beautiful. Style must match their interests.

For chronicle: Write a vivid, atmospheric scene or passage from one of the hunter's favorite books (${sanitizedBooksProse}). Write it as a beautifully typeset literary fragment — original prose inspired by the style and world of that book. 50-100 words. Include the book/author it's inspired by.

Respond ONLY with JSON:
{
  "id": "unique_id_string",
  "type": "rank_cosmetic | chronicle",
  "title": "...",
  "content": "...",
  "style": "ascii | dots | geometric | typewriter",
  "source": "book or author name (for chronicles)",
  "asciiArt": "3-5 lines of ASCII/character art for cosmetics (null for chronicles)"
}`;
      // Final guard: ensure no stray backticks remain anywhere in the prompt.
      prompt = prompt.replace(/`/g, "");

      const { text: raw, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You are a master of literary atmosphere and ASCII art. Respond only in JSON.", true, controller.signal);
      if (mountedRef.current) {
        trackTokens(tokensUsed);
      }
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Failed to parse Gacha JSON");
      const card = JSON.parse(match[0]);

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
        type:     ["rank_cosmetic","chronicle"].includes(card.type) ? card.type : "rank_cosmetic",
        // Client enforces rarity probabilities; ignore AI-suggested rarity.
        rarity:   (() => { const r = sampleGachaRarity(); return ["common","rare","epic","legendary"].includes(r) ? r : "common"; })(),
        title:    stripGachaStr(card.title, 120) ?? "Unknown",
        content:  stripGachaStr(card.content, 1000) ?? "",
        style:    ["ascii","dots","geometric","typewriter"].includes(card.style) ? card.style : "ascii",
        source:   stripGachaStr(card.source, 120),
        asciiArt: stripGachaStr(card.asciiArt, 500),
      };

      // Build the snapshot for updateDynamicCosts from the latest ref (best available XP value).
      const currentState = latestStateRef?.current ?? state;

      // Duplicate check and XP deduction both happen inside the updater so they read
      // authoritative (latest-committed) state. A stale-closure check here would allow
      // a rapid double-tap to pass both checks and store two identical cards.
      let isDuplicate = false;
      let snapshotForCosts = null;
      setState((s) => {
        // Fix: cap gachaCollection to match sync validator bound.
        if ((s.gachaCollection || []).length >= 2000) { isDuplicate = true; return s; }
        // Authoritative duplicate check using committed state.
        if ((s.gachaCollection || []).find(c => c.id === safeCard.id)) { isDuplicate = true; return s; }
        // XP already deducted optimistically before API call.
        const next = {
          ...s,
          gachaCollection: [...(s.gachaCollection || []), { ...safeCard, pulledAt: Date.now() }],
        };
        snapshotForCosts = next;
        return next;
      });

      if (isDuplicate) {
        setState((s) => ({ ...s, xp: s.xp + deductedCost }));
        if (mountedRef.current) {
          showBanner("Duplicate generated or insufficient XP. No XP consumed.", "info");
          setPulling(false);
        }
        pullingRef.current = false;
        return;
      }

      const costsSnapshot = snapshotForCosts ?? {
        ...currentState,
        xp: Math.max(0, currentState.xp - (currentState.dynamicCosts?.gachaCost ?? gachaCost)),
        gachaCollection: [...(currentState.gachaCollection || []), { ...safeCard, pulledAt: Date.now() }],
      };

      updateDynamicCosts(getGeminiApiKey(), costsSnapshot, "gacha_pull", trackTokens).then((costs) => {
        if (costs && Object.keys(costs).length && mountedRef.current) {
          setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
        }
      }).catch((err) => {
        if (import.meta.env.DEV) {
          console.warn("[ProfileTab] updateDynamicCosts failed:", err?.message || err);
        }
      });

      setCollectionPage(0);
      if (mountedRef.current) {
        setLastPull(safeCard);
        showToast({ icon: safeCard.type === "chronicle" ? "≡" : "◈", title: safeCard.title, desc: safeCard.rarity.toUpperCase() + " PULL", rarity: safeCard.rarity, isAchievement: false });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        // Request was cancelled (unmount or new pull started). Refund XP silently.
        setState((s) => ({ ...s, xp: s.xp + deductedCost }));
      } else {
        setState((s) => ({ ...s, xp: s.xp + deductedCost }));
        if (mountedRef.current) showBanner("Pull failed. System error.", "alert");
      }
    } finally {
      pullingRef.current = false;
      if (mountedRef.current) setPulling(false);
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
        <div style={{ fontSize: "11px", color: "#555", letterSpacing: "3px" }}>CHRONICLE ENGINE</div>
        <div style={{ fontSize: "40px", margin: "16px 0" }}>◈</div>
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
          {canAfford ? `${gachaCost} XP per pull` : `Need ${gachaCost - state.xp} more XP`}
        </div>
        <button
          onClick={doPull}
          disabled={!canAfford || pulling}
          style={{
            width: "100%", padding: "14px",
            background: canAfford && !pulling ? "#fff" : "#1a1a1a",
            color: canAfford && !pulling ? "#000" : "#444",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "13px", letterSpacing: "2px",
            border: "none", cursor: canAfford && !pulling ? "pointer" : "default",
          }}
        >
          {pulling ? "PULLING..." : `PULL — ${gachaCost} XP`}
        </button>
        <div style={{ fontSize: "10px", color: "#333", marginTop: "8px" }}>
          {collection.length} cards collected
        </div>
      </div>

      {/* Last pull display */}
      {lastPull && <GachaCard card={lastPull} />}

      {/* Collection toggle */}
        <button type="button" onClick={() => setShowCollection(!showCollection)} style={{
        padding: "10px", border: "1px solid #333", background: "transparent",
        color: "#666", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px",
      }}>
        {showCollection ? "HIDE COLLECTION" : `VIEW COLLECTION (${collection.length})`}
      </button>

      {showCollection && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {collection.length === 0 && (
            <div style={{ border: "1px dashed #222", padding: "20px", textAlign: "center", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#333" }}>
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
                        padding: "4px 10px",
                        border: "1px solid #333",
                        background: safePage === 0 ? "#0a0a0a" : "transparent",
                        color: safePage === 0 ? "#333" : "#888",
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: "9px",
                        cursor: safePage === 0 ? "default" : "pointer",
                      }}
                    >
                      ◀ PREV
                    </button>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555" }}>
                      {safePage + 1} / {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCollectionPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage === pageCount - 1}
                      style={{
                        padding: "4px 10px",
                        border: "1px solid #333",
                        background: safePage === pageCount - 1 ? "#0a0a0a" : "transparent",
                        color: safePage === pageCount - 1 ? "#333" : "#888",
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: "9px",
                        cursor: safePage === pageCount - 1 ? "default" : "pointer",
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
      border: `1px solid ${r.glow}`, padding: "16px",
      background: s.background, fontFamily: s.fontFamily,
      cursor: compact ? "pointer" : "default",
    }} onClick={() => compact && setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px" }}>{safeRenderStr(card.title)}</div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555", marginTop: "2px" }}>
            {card.type === "chronicle" ? `CHRONICLE · ${safeRenderStr(card.source)}` : "RANK COSMETIC"} · {r.label}
          </div>
        </div>
        {compact && <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#444" }}>{expanded ? "▲" : "▼"}</span>}
      </div>

      {expanded && (
        <>
          {card.asciiArt && (
            <pre style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#aaa", margin: "8px 0", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>
              {(() => {
                const safeAscii = safeRenderStr(card.asciiArt)
                  .replace(/\n{3,}/g, "\n\n")
                  .split("\n")
                  .map((line) => line.slice(0, 80))
                  .join("\n");
                return safeAscii;
              })()}
            </pre>
          )}
          <div style={{ fontSize: "13px", lineHeight: "1.7", color: "#ccc", marginTop: "8px", whiteSpace: "pre-wrap" }}>
            {safeRenderStr(card.content)}
          </div>
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function SettingsSection({ profile, setState, showBanner, syncStatus, lastSynced, syncFileConnected, dropboxConnected, onPush, onPull, onPickSyncFile, onForgetSyncFile, confirmForgetSync, connectDropbox, disconnectDropbox, theme, setTheme, latestStateRef }) {
  const importRef = useRef(null);
  const [clientIdInput, setClientIdInput] = useState(profile?.googleClientId || "");

  useEffect(() => {
    setClientIdInput(profile?.googleClientId || "");
  }, [profile?.googleClientId]);

  function saveClientId() {
    const trimmed = clientIdInput.trim();
    if (trimmed && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(trimmed)) {
      showBanner("Invalid Client ID format. Must end in .apps.googleusercontent.com", "alert");
      return;
    }
    setState((s) => ({
      ...s,
      profile: { ...(s.profile || {}), googleClientId: trimmed || undefined },
    }));
    showBanner(trimmed ? "Google Client ID saved." : "Google Client ID cleared.", "success");
  }

  // Fix: replace window.confirm with a two-step in-app confirmation — window.confirm() is
  // blocked in PWA standalone mode and some embedded contexts (same reason forgetSyncFile was fixed).
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetTimerRef = useRef(null);

  useEffect(() => () => {
    if (confirmResetTimerRef.current) clearTimeout(confirmResetTimerRef.current);
  }, []);

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
      idbSet(storageKey("jv_max_date_seen"), maxDateSeen);
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
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await SyncManager.importFile(file);
        window.dispatchEvent(new CustomEvent("ritmol:block-autopush", { detail: { ms: 3000 } }));
        window.location.reload();
      } catch (err) {
        const msgs = {
          CORRUPT_FILE: "Import failed: file is corrupt or not valid JSON.",
          SYNC_SCHEMA_OUTDATED: "Import failed: file was written by an older version of RITMOL. Re-export it from an up-to-date device.",
          SYNC_FILE_TOO_LARGE: "Import failed: file exceeds 10 MB.",
          APPLY_QUOTA_RISK: "Import failed: local storage is almost full. Clear data first.",
        };
        showBanner(msgs[err?.message] ?? "Import failed. Check the file.", "alert");
      } finally {
        e.target.value = "";
      }
    } catch {
      showBanner("Import failed unexpectedly.", "alert");
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
      <div style={{ fontSize: "9px", color: "#555", letterSpacing: "2px" }}>APPEARANCE</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          style={{
            flex: 1, padding: "10px", border: `2px solid ${theme === "dark" ? "#fff" : "#333"}`,
            background: theme === "dark" ? "#fff" : "transparent",
            color: theme === "dark" ? "#000" : "#888",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
          }}
        >
          DARK
        </button>
        <button
          type="button"
          onClick={() => setTheme("light")}
          style={{
            flex: 1, padding: "10px", border: `2px solid ${theme === "light" ? "#000" : "#333"}`,
            background: theme === "light" ? "#000" : "transparent",
            color: theme === "light" ? "#fff" : "#888",
            fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
          }}
        >
          LIGHT
        </button>
      </div>

      <div style={{ height: "1px", background: "#333", margin: "8px 0" }} />
      {/* ── SYNC ── */}
      <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px" }}>SYNC</div>

      {dropboxConnected ? (
        /* Dropbox connected */
        <>
          <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
            SYNC — DROPBOX
          </div>
          <div style={{ fontSize: "10px", color: "#aaa", marginBottom: "8px" }}>
            ● Connected
          </div>
          <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
            Last synced: <span style={{ color: syncStatus === "error" ? "#888" : "#aaa" }}>{syncStatusLabel}</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onPush}
              disabled={typeof navigator !== "undefined" && navigator.onLine === false}
              style={{
                flex: 1, padding: "10px", border: "1px solid #555",
                background: "transparent", color: "#ccc",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
              }}
            >
              PUSH ↑
            </button>
            <button
              type="button"
              onClick={onPull}
              disabled={typeof navigator !== "undefined" && navigator.onLine === false}
              style={{
                flex: 1, padding: "10px", border: "1px solid #444",
                background: "transparent", color: "#888",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
              }}
            >
              PULL ↓
            </button>
            <button
              type="button"
              onClick={disconnectDropbox}
              style={{
                padding: "10px", border: "1px solid #333",
                background: "transparent", color: "#555",
                fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
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
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
            }}
          >
            CONNECT DROPBOX
          </button>
          <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
            Last synced: <span style={{ color: syncStatus === "error" ? "#888" : "#aaa" }}>{syncStatusLabel}</span>
          </div>
          <div style={{ height: "1px", background: "#333", margin: "4px 0" }} />
          <div style={{ fontSize: "9px", color: "#444", letterSpacing: "1px" }}>
            {FSAPI_SUPPORTED ? "or use local file" : "or export / import manually"}
          </div>
          {FSAPI_SUPPORTED ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={onPickSyncFile} style={{
                  padding: "10px", border: "1px solid #555", background: "transparent",
                  color: "#aaa", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
                }}>
                  PICK FILE
                </button>
                <button
                  type="button"
                  onClick={onPush}
                  disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                  style={{
                    padding: "10px", border: "1px solid #555", background: "transparent",
                    color: "#ccc", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                  }}
                >
                  PUSH ↑
                </button>
                <button
                  type="button"
                  onClick={onPull}
                  disabled={typeof navigator !== "undefined" && navigator.onLine === false}
                  style={{
                    padding: "10px", border: "1px solid #444", background: "transparent",
                    color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: (typeof navigator !== "undefined" && navigator.onLine === false) ? "default" : "pointer",
                  }}
                >
                  PULL ↓
                </button>
                <button onClick={onForgetSyncFile} style={{
                  padding: "10px", border: "1px solid #333",
                  background: confirmForgetSync ? "#3a1111" : "transparent",
                  color: confirmForgetSync ? "#c44" : "#555",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
                }}>
                  {confirmForgetSync ? "CONFIRM?" : "FORGET"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "10px", color: "#555", border: "1px dashed #333", padding: "8px", lineHeight: "1.7" }}>
                ⚠ Your browser does not support direct file access.
              </div>
              <button type="button" onClick={() => SyncManager.download((msg) => showBanner(msg, "alert"))} style={{
                padding: "10px", border: "1px solid #555", background: "transparent",
                color: "#aaa", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
              }}>
                EXPORT ↓
              </button>
              <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} style={{ display: "none" }} />
              <button onClick={() => importRef.current?.click()} style={{
                padding: "10px", border: "1px solid #444", background: "transparent",
                color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
              }}>
                IMPORT ↑
              </button>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: "12px", padding: "12px", border: "1px dashed #222" }}>
        <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px", marginBottom: "8px" }}>DEPLOY GUIDE</div>
        <div style={{ fontSize: "11px", color: "#555", lineHeight: "1.8" }}>
          1. Push this repo to GitHub<br />
          2. Enable GitHub Pages (Settings → Pages → Source: GitHub Actions)<br />
          3. Deploy — done. No server needed.<br />
          4. On each device: link your Syncthing folder file above.
        </div>
      </div>

      <div style={{ height: "1px", background: "#333", margin: "8px 0" }} />
      <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px" }}>GOOGLE CALENDAR</div>
      <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
        Paste your Google OAuth Client ID to enable Calendar sync.<br />
        Get one free at <span style={{ color: "#888" }}>console.cloud.google.com</span> → APIs & Services → Credentials.
      </div>
      <input
        type="text"
        value={clientIdInput}
        onChange={(e) => setClientIdInput(e.target.value)}
        placeholder="xxxxx.apps.googleusercontent.com"
        style={{
          width: "100%", padding: "8px", background: "#0a0a0a",
          border: "1px solid #333", color: "#ccc", boxSizing: "border-box",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
        }}
      />
      <button
        type="button"
        onClick={saveClientId}
        style={{
          padding: "8px", border: "1px solid #444", background: "transparent",
          color: "#888", fontFamily: "'Share Tech Mono', monospace",
          fontSize: "10px", letterSpacing: "1px", cursor: "pointer",
        }}
      >
        SAVE CLIENT ID
      </button>

      <button onClick={resetAll} style={{
        marginTop: "8px", padding: "10px",
        border: `1px solid ${confirmReset ? "#c44" : "#333"}`,
        background: confirmReset ? "#3a1111" : "transparent",
        color: confirmReset ? "#c44" : "#444",
        fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
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
