// ═══════════════════════════════════════════════════════════════
// CALENDAR OVERLAY
// Full-screen modal that pops on top of any tab.
// Accessible via the calendar icon in TopBar.
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef } from "react";
import { useAppContext } from "./context/AppContext";
import { fetchGCalEvents, fetchCalendarList, requestGcalAccessToken } from "./api/gcal";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { primaryBtn } from "./Onboarding";

// ── Calendar Picker ────────────────────────────────────────────
function CalendarPicker({ calendars, initialSelected, onConfirm, onCancel, theme }) {
  const fg = theme === "light" ? "#000" : "#fff";
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const mono = { fontFamily: "'Share Tech Mono', monospace" };

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ border: "2px solid #fff", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ ...mono, fontSize: "16px", fontWeight: "bold", letterSpacing: "2px", color: fg }}>
        [ SELECT CALENDARS ]
      </div>
      <div style={{ fontSize: "13px", color: "#aaa", ...mono }}>
        Choose which calendars to sync. All selected by default.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "200px", overflowY: "auto" }}>
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
              }}
            >
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
            ...mono, fontSize: "15px", letterSpacing: "1px",
            cursor: selected.size > 0 ? "pointer" : "default",
          }}
        >
          SYNC {selected.size} CALENDAR{selected.size !== 1 ? "S" : ""}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "12px 16px", border: "1px solid #555",
            background: "transparent", color: "#aaa",
            ...mono, fontSize: "15px", cursor: "pointer",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}

// ── Main Calendar Overlay ──────────────────────────────────────
export default function CalendarOverlay({ onClose, theme = "dark" }) {
  const { state, setState, profile, showBanner } = useAppContext();

  const fg = theme === "light" ? "#000" : "#fff";
  const bg = theme === "light" ? "#f0f0f0" : "#000";
  const mono = { fontFamily: "'Share Tech Mono', monospace" };

  const [form, setForm] = useState({ title: "", type: "exam", start: "", end: "" });
  const [gCalLoading, setGCalLoading] = useState(false);
  const [calendarList, setCalendarList] = useState([]);
  const pendingTokenRef = useRef(null);

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
    const safeTitle = sanitizeForPrompt(form.title, 200);
    const safeType  = ["lecture","tirgul","exam","assignment","homework","other"].includes(form.type) ? form.type : "other";
    const safeStart = typeof form.start === "string" && /^\d{4}-\d{2}-\d{2}/.test(form.start) ? form.start : "";
    const safeEnd   = typeof form.end === "string" && /^\d{4}-\d{2}-\d{2}/.test(form.end) ? form.end : "";
    if (!safeTitle || !safeStart) return;
    const newEvent = { id: `manual_${crypto.randomUUID()}`, title: safeTitle, type: safeType, start: safeStart, end: safeEnd, source: "manual" };
    setState((s) => ({ ...s, calendarEvents: [...(s.calendarEvents || []), newEvent] }));
    showBanner(`Event added: ${safeTitle}`, "success");
    if (safeType === "exam") {
      const days = Math.ceil((new Date(safeStart) - Date.now()) / 86400000);
      showBanner(`Exam added: ${safeTitle} in ${days} days.`, "info");
    }
    setForm({ title: "", type: "exam", start: "", end: "" });
  }

  async function applyCalendarSelection(chosenIds, accessToken) {
    const ids = chosenIds.length > 0 ? chosenIds : ["primary"];
    setGCalLoading(true);
    try {
      const evs = await fetchGCalEvents(accessToken, ids);
      setState((s) => {
        const syncNow = Date.now();
        const manualEvents = (s.calendarEvents || []).filter((e) => e.source === "manual" && (!e.start || new Date(e.start).getTime() >= syncNow));
        return { ...s, calendarEvents: [...manualEvents, ...evs], gCalConnected: true, gCalSelectedIds: ids };
      });
      showBanner(`Synced ${evs.length} events from ${ids.length} calendar${ids.length !== 1 ? "s" : ""}.`, "success");
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
      showBanner("Calendar sync failed: insufficient permissions. Check your Google Cloud Console.", "alert"); return;
    }
    if (e?.message === "GCAL_RATE_LIMITED") {
      showBanner("Calendar sync failed: rate limit hit. Wait a moment and try again.", "alert"); return;
    }
    if (e?.message?.startsWith("GCAL_HTTP_")) {
      showBanner(`Calendar sync failed: server returned ${e.message.replace("GCAL_HTTP_", "HTTP ")}. Try again later.`, "alert"); return;
    }
    if (e?.message === "GCAL_NETWORK_ERROR") {
      showBanner("Calendar sync failed: network error. Check your connection.", "alert"); return;
    }
    let msg = e?.error?.message ?? e?.message ?? String(e);
    const short = (msg || "").length > 60 ? msg.slice(0, 57) + "…" : msg;
    showBanner(`Calendar sync failed: ${short}`, "alert");
  }

  async function syncGoogleCalendar(forcePicker = false) {
    const clientId = profile?.googleClientId || (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (!clientId) { showBanner("No Google Client ID configured. Add one in Profile → Settings.", "alert"); return; }
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      showBanner("Invalid Google Client ID format.", "alert"); return;
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
      const cals = await fetchCalendarList(accessToken);
      setCalendarList(cals);
      const previousIds = state.gCalSelectedIds;
      if (!forcePicker && previousIds && previousIds.length > 0) {
        await applyCalendarSelection(previousIds, accessToken);
      } else {
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
    /* Backdrop */
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 6000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: "calc(56px + env(safe-area-inset-top, 0px))",
          left: 0, right: 0,
          bottom: "calc(60px + env(safe-area-inset-bottom, 0px))",
          background: bg,
          borderTop: `4px double ${fg}`,
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px 10px",
          borderBottom: `2px solid ${fg}`,
        }}>
          <div style={{ ...mono, fontSize: "13px", letterSpacing: "3px", fontWeight: 900, color: fg }}>
            [ CALENDAR ]
          </div>

          {/* GCal sync status pill */}
          <div style={{
            ...mono, fontSize: "11px", letterSpacing: "2px",
            color: state.gCalConnected ? fg : "#888",
            border: `1px solid ${state.gCalConnected ? fg : "#555"}`,
            padding: "3px 8px",
            display: "flex", alignItems: "center", gap: "6px",
          }}>
            {state.gCalConnected
              ? <><span style={{ fontSize: "10px" }}>●</span> GCAL SYNCED</>
              : <><span style={{ fontSize: "10px", color: "#fff" }}>○</span> NOT SYNCED</>
            }
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            title="Close calendar"
            style={{
              ...mono, fontSize: "22px", color: fg,
              background: "none", border: "none", cursor: "pointer",
              minHeight: "40px", minWidth: "40px",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>

          {/* Google Calendar sync banner — prominent when not connected */}
          {!state.gCalConnected && (
            <div style={{
              border: "2px dashed #fff", padding: "14px",
              display: "flex", flexDirection: "column", gap: "10px",
              background: "rgba(255,255,255,0.03)",
            }}>
              <div style={{ ...mono, fontSize: "11px", letterSpacing: "3px", color: "#aaa" }}>
                GOOGLE CALENDAR NOT CONNECTED
              </div>
              <div style={{ ...mono, fontSize: "13px", color: fg, lineHeight: "1.6" }}>
                Import lectures, exams, and deadlines automatically. Your events stay local — never sent to any server.
              </div>
              <button
                type="button"
                onClick={() => syncGoogleCalendar()}
                disabled={gCalLoading || showPicker}
                style={{
                  ...primaryBtn, marginTop: "0",
                  opacity: gCalLoading ? 0.6 : 1,
                  cursor: gCalLoading ? "not-allowed" : "pointer",
                  fontSize: "14px", letterSpacing: "2px",
                }}
              >
                {gCalLoading ? "CONNECTING…" : "▶ SYNC GOOGLE CALENDAR"}
              </button>
            </div>
          )}

          {/* Re-sync / change buttons when connected */}
          {state.gCalConnected && (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => syncGoogleCalendar()}
                disabled={gCalLoading || showPicker}
                style={{
                  flex: 1, padding: "10px", border: "2px solid #fff",
                  background: "transparent", color: fg,
                  ...mono, fontSize: "13px", letterSpacing: "1px",
                  cursor: gCalLoading ? "not-allowed" : "pointer",
                  minHeight: "44px",
                }}
              >
                {gCalLoading ? "SYNCING…" : "↺ RE-SYNC"}
              </button>
              <button
                type="button"
                onClick={() => syncGoogleCalendar(true)}
                disabled={gCalLoading || showPicker}
                style={{
                  flex: 1, padding: "10px", border: "1px solid #555",
                  background: "transparent", color: "#aaa",
                  ...mono, fontSize: "13px", letterSpacing: "1px",
                  cursor: gCalLoading ? "not-allowed" : "pointer",
                  minHeight: "44px",
                }}
              >
                CHANGE CALENDARS ({(state.gCalSelectedIds || []).length})
              </button>
            </div>
          )}

          {/* Calendar picker */}
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
            <div style={{ ...mono, fontSize: "14px", color: fg, letterSpacing: "2px", fontWeight: "bold" }}>[ ADD EVENT ]</div>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Event title..."
              style={{ background: bg, border: "2px solid #fff", color: fg, padding: "10px", ...mono, fontSize: "14px", outline: "none" }}
            />
            <div style={{ display: "flex", gap: "6px" }}>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                style={{ flex: 1, background: bg, border: "2px solid #fff", color: fg, padding: "10px", ...mono, fontSize: "13px", outline: "none" }}
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
                style={{ flex: 2, background: bg, border: "2px solid #fff", color: fg, padding: "10px", ...mono, fontSize: "13px", outline: "none" }}
              />
            </div>
            <button
              type="button"
              onClick={addEvent}
              disabled={!form.title || !form.start}
              style={{
                ...primaryBtn, marginTop: "0",
                opacity: (!form.title || !form.start) ? 0.4 : 1,
                cursor: (!form.title || !form.start) ? "not-allowed" : "pointer",
                fontSize: "14px", padding: "11px",
              }}
            >
              ADD EVENT
            </button>
          </div>

          {/* Clear past events */}
          {pastEvents.length > 0 && (
            <button
              type="button"
              onClick={clearPastEvents}
              style={{
                padding: "10px", border: "1px solid #555", background: "transparent", color: "#aaa",
                ...mono, fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
              }}
            >
              CLEAR {pastEvents.length} PAST EVENT{pastEvents.length !== 1 ? "S" : ""}
            </button>
          )}

          {/* Events list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {events.length === 0 && (
              <div style={{
                border: "2px solid #fff", padding: "20px", textAlign: "center",
                ...mono, fontSize: "14px", color: "#aaa",
              }}>
                {state.gCalConnected ? "No upcoming events." : "No events. Sync Google Calendar or add manually."}
              </div>
            )}
            {events.map((ev) => {
              const startDate = ev.start ? new Date(ev.start) : null;
              const validStart = startDate && !isNaN(startDate.getTime());
              const startDisplay = validStart ? startDate.toLocaleDateString() : "TBD";
              const daysLeft = validStart ? Math.ceil((startDate - Date.now()) / 86400000) : null;
              const isUrgent = daysLeft !== null && daysLeft <= 3;
              return (
                <div
                  key={ev.id}
                  style={{
                    border: `2px solid ${isUrgent ? fg : "#555"}`,
                    padding: "12px",
                    ...mono,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: isUrgent ? "rgba(255,255,255,0.04)" : "transparent",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "bold", color: fg }}>{ev.title}</div>
                    <div style={{ fontSize: "12px", color: "#aaa", marginTop: "3px" }}>
                      {ev.type?.toUpperCase()} · {startDisplay}
                      {daysLeft !== null && daysLeft >= 0 && daysLeft <= 14 && (
                        <span style={{ color: isUrgent ? fg : "#aaa", fontWeight: isUrgent ? "bold" : "normal" }}>
                          {" "}· {daysLeft}d
                        </span>
                      )}
                      {ev.source === "manual" && (
                        <span style={{ color: "#555" }}> · MANUAL</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteEvent(ev.id)}
                    style={{ color: fg, background: "none", border: "none", fontSize: "18px", minHeight: "44px", minWidth: "44px", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
