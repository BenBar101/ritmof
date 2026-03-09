import { useState, useEffect, useRef } from "react";
import { today, LS, storageKey, getGeminiApiKey } from "../utils/storage";
import { ACHIEVEMENT_RARITIES, STYLE_CSS, DAILY_TOKEN_LIMIT } from "../constants";
import { getLevelProgress } from "../utils/xp";
import { callGemini } from "../api/gemini";
import { fetchGCalEvents, loadGoogleGIS } from "../api/gcal";
import { SyncManager, FSAPI_SUPPORTED } from "../sync/SyncManager";
import GeometricCorners from "../components/GeometricCorners";
import { primaryBtn, inputStyle } from "../components/Onboarding";
import { updateDynamicCosts } from "../api/dynamicCosts";

export default function ProfileTab({ state, setState, profile, level, rank, xpPerLevel, awardXP, showBanner, showToast, unlockAchievement, executeCommands, apiKey, buildSystemPrompt, syncStatus, lastSynced, syncFileConnected, onPush, onPull, onPickSyncFile, onForgetSyncFile, confirmForgetSync, theme, setTheme, streakShieldCost, gachaCost, trackTokens, latestStateRef }) {
  const [section, setSection] = useState("overview");
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
          <button key={s} onClick={() => setSection(s)} style={{
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

      {section === "overview" && <ProfileOverview state={state} setState={setState} profile={profile} level={level} rank={rank} streakShieldCost={streakShieldCost} apiKey={apiKey} showBanner={showBanner} latestStateRef={latestStateRef} />}
      {section === "achievements" && <AchievementsSection state={state} />}
      {section === "calendar" && <CalendarSection state={state} setState={setState} profile={profile} apiKey={apiKey} buildSystemPrompt={buildSystemPrompt} showBanner={showBanner} executeCommands={executeCommands} />}
      {section === "gacha" && <GachaSection state={state} setState={setState} profile={profile} apiKey={apiKey} gachaCost={gachaCost} showBanner={showBanner} showToast={showToast} trackTokens={trackTokens} latestStateRef={latestStateRef} />}
      {section === "settings" && <SettingsSection profile={profile} setState={setState} showBanner={showBanner} syncStatus={syncStatus} lastSynced={lastSynced} syncFileConnected={syncFileConnected} onPush={onPush} onPull={onPull} onPickSyncFile={onPickSyncFile} onForgetSyncFile={onForgetSyncFile} confirmForgetSync={confirmForgetSync} theme={theme} setTheme={setTheme} />}
    </div>
  );
}

function ProfileOverview({ state, setState, profile, level, rank, streakShieldCost, apiKey, showBanner, latestStateRef }) {
  const totalSessions = (state.sessions || []).length;
  const totalHabitsLogged = Object.values(state.habitLog || {}).reduce((acc, arr) => acc + arr.length, 0);
  const totalTasksDone = (state.tasks || []).filter((t) => t.done).length;
  const studyHours = (state.sessions || []).reduce((acc, s) => acc + (s.duration || 0), 0);
  const canBuyShield = state.xp >= streakShieldCost;

  function buyShield() {
    if (!canBuyShield || !apiKey) return;

    // Fix: use a functional updater so we always operate on the latest committed state,
    // avoiding stale-closure overwrites when React batches concurrent setState calls.
    // Capture a snapshot for the async updateDynamicCosts call after the update commits.
    let snapshotForApi = null;
    setState((s) => {
      if (s.xp < streakShieldCost) return s; // re-check inside updater in case XP changed
      const next = { ...s, xp: Math.max(0, s.xp - streakShieldCost), streakShields: (s.streakShields || 0) + 1 };
      snapshotForApi = next;
      return next;
    });

    // Fire async cost update after a tick so snapshotForApi is populated
    setTimeout(() => {
      if (!snapshotForApi) return;
      updateDynamicCosts(getGeminiApiKey(), snapshotForApi, "streak_shield_use", trackTokens).then((costs) => {
        if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
      }).catch(() => {});
    }, 0);

    showBanner(`Streak shield purchased. Cost: ${streakShieldCost} XP. Next cost may change.`, "success");
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
        <div style={{ fontSize: "11px", color: "#888", marginBottom: "8px" }}>Cost: {streakShieldCost} XP (AI may change after purchase). Max one shield use per calendar day.</div>
        <button
          onClick={buyShield}
          disabled={!canBuyShield || !apiKey}
          style={{
            padding: "8px 12px", border: "1px solid #444", background: canBuyShield && apiKey ? "#fff" : "#1a1a1a",
            color: canBuyShield && apiKey ? "#000" : "#333", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px", letterSpacing: "1px", cursor: canBuyShield && apiKey ? "pointer" : "default",
          }}
        >
          BUY SHIELD — {streakShieldCost} XP
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
            "{profile.semesterGoal}"
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
              <span style={{ fontSize: "24px" }}>{ach.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px" }}>{ach.title}</span>
                  <span style={{ fontSize: "8px", color: r.glow, letterSpacing: "1px" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{ach.desc}</div>
                {ach.flavorText && (
                  <div style={{ fontSize: "10px", color: "#444", marginTop: "4px", fontStyle: "italic", fontFamily: "'IM Fell English', serif" }}>
                    "{ach.flavorText}"
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
    const safeTitle = form.title.replace(/[<>{}[\]`"]/g, "").slice(0, 200).trim();
    const safeType  = ["exam","lecture","homework","tirgul","other"].includes(form.type) ? form.type : "other";
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
      const accessToken = tokenResponse.access_token;
      if (!accessToken) throw new Error("No access token");
      const events = await fetchGCalEvents(accessToken);
      setState((s) => {
        const manualEvents = (s.calendarEvents || []).filter((e) => e.source === "manual");
        return { ...s, calendarEvents: [...manualEvents, ...events], gCalConnected: true };
      });
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
      <button onClick={syncGoogleCalendar} disabled={gCalLoading} style={{
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
          const daysLeft = Math.ceil((new Date(ev.start) - Date.now()) / 86400000);
          return (
            <div key={ev.id} style={{
              border: `1px solid ${typeColors[ev.type] || "#333"}`, padding: "10px",
              fontFamily: "'Share Tech Mono', monospace",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: "12px" }}>{ev.title}</div>
                <div style={{ fontSize: "9px", color: "#555", marginTop: "2px" }}>
                  {ev.type?.toUpperCase()} · {new Date(ev.start).toLocaleDateString()}
                  {daysLeft >= 0 && daysLeft <= 14 && <span style={{ color: daysLeft <= 3 ? "#fff" : "#888" }}> · {daysLeft}d</span>}
                </div>
              </div>
              <button onClick={() => deleteEvent(ev.id)} style={{ color: "#333", background: "none", border: "none", fontSize: "14px" }}>×</button>
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
  const collection = state.gachaCollection || [];
  const canAfford = state.xp >= gachaCost;
  // Abort controller so unmounting mid-pull cancels the Gemini request and prevents
  // trackTokens / setState firing against an unmounted component.
  const gachaAbortRef = useRef(null);

  // Cancel any in-flight pull on unmount.
  useEffect(() => () => { gachaAbortRef.current?.abort(); }, []);

  async function doPull() {
    if (!canAfford || pulling || !apiKey) {
      if (!canAfford) showBanner(`Insufficient XP. Need ${gachaCost} XP to pull.`, "alert");
      if (!apiKey) showBanner("No API key. Configure in settings.", "alert");
      return;
    }
    const usage = state.tokenUsage;
    if (usage && usage.date === today() && usage.tokens >= DAILY_TOKEN_LIMIT) {
      showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert");
      return;
    }

    // Cancel any previous in-flight pull before starting a new one.
    gachaAbortRef.current?.abort();
    const controller = new AbortController();
    gachaAbortRef.current = controller;
    setPulling(true);

    try {
      const prompt = `Generate a gacha pull for a STEM university student.
Hunter profile: ${JSON.stringify({ name: profile?.name, books: profile?.books, interests: profile?.interests, major: profile?.major })}
Existing collection (don't duplicate): ${JSON.stringify(collection.slice(-50).map(c => c.id))}

Generate ONE of these (weighted random — 60% rank_cosmetic, 40% chronicle):

For rank_cosmetic: a black-and-white ASCII/geometric/typewriter/dot-matrix rank badge/crest design for this hunter. Make it unique and beautiful. Style must match their interests.

For chronicle: Write a vivid, atmospheric scene or passage from one of the hunter's favorite books (${profile?.books ?? "their favorites"}). Write it as a beautifully typeset literary fragment — original prose inspired by the style and world of that book. 50-100 words. Include the book/author it's inspired by.

Respond ONLY with JSON:
{
  "id": "unique_id_string",
  "type": "rank_cosmetic | chronicle",
  "rarity": "common | rare | epic | legendary",
  "title": "...",
  "content": "...",
  "style": "ascii | dots | geometric | typewriter",
  "source": "book or author name (for chronicles)",
  "asciiArt": "3-5 lines of ASCII/character art for cosmetics (null for chronicles)"
}`;

      const { text: raw, tokensUsed } = await callGemini(apiKey, [{ role: "user", content: prompt }], "You are a master of literary atmosphere and ASCII art. Respond only in JSON.", true, controller.signal);
      if (controller.signal.aborted) { setPulling(false); return; }
      trackTokens(tokensUsed);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Failed to parse Gacha JSON");
      const card = JSON.parse(match[0]);

      // Fix #11 (security): construct the stored card explicitly — never spread the raw AI
      // object so unexpected keys cannot pollute the gachaCollection state/localStorage.
      const safeCard = {
        id:       typeof card.id === "string" ? card.id.slice(0, 80).replace(/[^a-zA-Z0-9_-]/g, "_") : `gacha_${crypto.randomUUID()}`, // Fix: was Date.now()
        type:     ["rank_cosmetic","chronicle"].includes(card.type) ? card.type : "rank_cosmetic",
        rarity:   ["common","rare","epic","legendary"].includes(card.rarity) ? card.rarity : "common",
        title:    typeof card.title === "string" ? card.title.slice(0, 120) : "Unknown",
        content:  typeof card.content === "string" ? card.content.slice(0, 1000) : "",
        style:    ["ascii","dots","geometric","typewriter"].includes(card.style) ? card.style : "ascii",
        source:   typeof card.source === "string" ? card.source.slice(0, 120) : null,
        asciiArt: typeof card.asciiArt === "string" ? card.asciiArt.slice(0, 500) : null,
      };

      if (collection.find(c => c.id === safeCard.id)) {
        showBanner("Duplicate generated. No XP consumed.", "info");
        setPulling(false);
        return;
      }

      // Build the snapshot for updateDynamicCosts from the latest ref (best available XP value).
      const currentState = latestStateRef?.current ?? state;
      const snapshotForCosts = {
        ...currentState,
        xp: Math.max(0, currentState.xp - gachaCost),
        gachaCollection: [...(currentState.gachaCollection || []), { ...safeCard, pulledAt: Date.now() }],
      };

      // Use an updater function so this setState is safely batched with concurrent updates
      // instead of clobbering them by spreading a stale snapshot directly.
      setState((s) => ({
        ...s,
        xp: Math.max(0, s.xp - gachaCost),
        gachaCollection: [...(s.gachaCollection || []), { ...safeCard, pulledAt: Date.now() }],
      }));

      updateDynamicCosts(getGeminiApiKey(), snapshotForCosts, "gacha_pull", trackTokens).then((costs) => {
        if (costs && Object.keys(costs).length) setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
      }).catch(() => {});

      setLastPull(safeCard);
      showToast({ icon: safeCard.type === "chronicle" ? "≡" : "◈", title: safeCard.title, desc: safeCard.rarity.toUpperCase() + " PULL", rarity: safeCard.rarity, isAchievement: false });
    } catch (e) {
      showBanner("Pull failed. System error.", "alert");
    }
    setPulling(false);
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
      <button onClick={() => setShowCollection(!showCollection)} style={{
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
          {[...collection].reverse().map((card) => (
            <GachaCard key={card.id} card={card} compact />
          ))}
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

  return (
    <div style={{
      border: `1px solid ${r.glow}`, padding: "16px",
      background: s.background, fontFamily: s.fontFamily,
      cursor: compact ? "pointer" : "default",
    }} onClick={() => compact && setExpanded(!expanded)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "13px" }}>{card.title}</div>
          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", color: "#555", marginTop: "2px" }}>
            {card.type === "chronicle" ? `CHRONICLE · ${card.source}` : "RANK COSMETIC"} · {r.label}
          </div>
        </div>
        {compact && <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#444" }}>{expanded ? "▲" : "▼"}</span>}
      </div>

      {expanded && (
        <>
          {card.asciiArt && (
            <pre style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "12px", color: "#aaa", margin: "8px 0", lineHeight: "1.4", whiteSpace: "pre-wrap" }}>
              {card.asciiArt}
            </pre>
          )}
          <div style={{ fontSize: "13px", lineHeight: "1.7", color: "#ccc", marginTop: "8px", whiteSpace: "pre-wrap" }}>
            {card.content}
          </div>
        </>
      )}
    </div>
  );
}

function SettingsSection({ profile, setState, showBanner, syncStatus, lastSynced, syncFileConnected, onPush, onPull, onPickSyncFile, onForgetSyncFile, confirmForgetSync, theme, setTheme }) {
  const importRef = useRef(null);
  // Fix: replace window.confirm with a two-step in-app confirmation — window.confirm() is
  // blocked in PWA standalone mode and some embedded contexts (same reason forgetSyncFile was fixed).
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetTimerRef = useRef(null);

  function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      confirmResetTimerRef.current = setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    clearTimeout(confirmResetTimerRef.current);
    setConfirmReset(false);
    // Only delete keys that belong to this app to protect other apps on shared domains
    const keysToDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("jv_") || k.startsWith("ritmol_dev_") || APP_CONSTANT_KEYS.has(k))) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach(k => localStorage.removeItem(k));
    window.location.reload();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ts = await SyncManager.importFile(file);
      window.location.reload(); // reload so all state rehydrates from new localStorage
    } catch (err) {
      if (err.message === "SYNC_SCHEMA_OUTDATED") {
        showBanner("Import failed: file was written by an older version of RITMOL. Re-export it from an up-to-date device.", "alert");
      } else {
        showBanner("Import failed. File may be corrupt.", "alert");
      }
    }
    e.target.value = "";
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
      {/* ── SYNCTHING SYNC ── */}
      <div style={{ fontSize: "9px", color: "#444", letterSpacing: "2px" }}>SYNCTHING SYNC</div>
      <SyncthingSetupGuide />

      <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.8" }}>
        Last synced: <span style={{ color: syncStatus === "error" ? "#888" : "#aaa" }}>{syncStatusLabel}</span>
      </div>

      {!FSAPI_SUPPORTED ? (
        /* Fallback: browsers without File System Access API */
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "10px", color: "#555", border: "1px dashed #333", padding: "8px", lineHeight: "1.7" }}>
            ⚠ Your browser does not support direct file access. Use Download + Import below.<br />
            Place the downloaded file in your Syncthing folder manually.
          </div>
          <button onClick={() => SyncManager.download()} style={{
            padding: "10px", border: "1px solid #555", background: "transparent",
            color: "#aaa", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
          }}>
            DOWNLOAD DATA FILE ↓
          </button>
          <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} style={{ display: "none" }} />
          <button onClick={() => importRef.current?.click()} style={{
            padding: "10px", border: "1px solid #444", background: "transparent",
            color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
          }}>
            IMPORT DATA FILE ↑
          </button>
        </div>
      ) : !syncFileConnected ? (
        /* No file linked yet */
        <button onClick={onPickSyncFile} style={{
          padding: "12px", border: "2px solid #fff", background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
        }}>
          LINK SYNCTHING FILE →
        </button>
      ) : (
        /* File linked — push / pull controls */
        <div style={{ border: "1px solid #333", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#aaa" }}>✓ SYNC FILE LINKED</span>
            <button onClick={onForgetSyncFile} style={{
              background: confirmForgetSync ? "#3a1111" : "none",
              border: `1px solid ${confirmForgetSync ? "#c44" : "#333"}`,
              color: confirmForgetSync ? "#c44" : "#555",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", padding: "2px 8px", cursor: "pointer",
              transition: "none",
            }}>
              {/* Fix #12: two-step confirm replaces window.confirm() which is blocked in some PWA contexts */}
              {confirmForgetSync ? "CONFIRM?" : "UNLINK"}
            </button>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onPush} style={{
              flex: 1, padding: "10px", border: "1px solid #555",
              background: "transparent", color: "#ccc",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
            }}>
              PUSH ↑
            </button>
            <button onClick={onPull} style={{
              flex: 1, padding: "10px", border: "1px solid #444",
              background: "transparent", color: "#888",
              fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", cursor: "pointer",
            }}>
              PULL ↓
            </button>
          </div>
          <div style={{ fontSize: "10px", color: "#444", lineHeight: "1.6" }}>
            PUSH overwrites the Syncthing file with local data.<br />
            PULL loads the Syncthing file into local data.
          </div>
          <button onClick={onPickSyncFile} style={{
            padding: "6px", border: "1px solid #222", background: "transparent",
            color: "#444", fontFamily: "'Share Tech Mono', monospace", fontSize: "9px", cursor: "pointer",
          }}>
            CHANGE FILE
          </button>
        </div>
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
