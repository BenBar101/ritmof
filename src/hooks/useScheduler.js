// ═══════════════════════════════════════════════════════════════
// useScheduler
//
// Owns all time-based side effects:
//  - Sleep check-in prompt (07:30)
//  - Screen time prompts (13:00, 20:00)
//  - Lecture/tirgul reminders (up to 120 min before)
//  - Streak panic warning (after 21:00 with 0 habits)
//
// Previously these lived as two large useEffect blocks in App.jsx
// and read state via closure, which caused stale reads when the
// scheduled callback fired after a state update. This version
// uses a scheduledStateRef that is updated on each relevant
// state change, so the interval callback always reads fresh data
// without being a dependency of the interval effect itself.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { todayUTC, nowHour, nowMin } from "../utils/storage";

export function useScheduler({ state, profile, showBanner, setModal }) {
  // Snapshot of the state slices the interval needs — updated every render
  // so the interval callback always sees fresh data without being in deps.
  const panicWarnedRef = useRef(null);
  const sleepModalShownRef = useRef(null);
  const screenModalShownRef = useRef({});
  const scheduledStateRef = useRef({
    sleepLog:       state?.sleepLog,
    screenTimeLog:  state?.screenTimeLog,
    calendarEvents: state?.calendarEvents,
    habitLog:       state?.habitLog,
    streak:         state?.streak,
  });
  useEffect(() => {
    if (!state) return;
    scheduledStateRef.current = {
      sleepLog:       state.sleepLog,
      screenTimeLog:  state.screenTimeLog,
      calendarEvents: state.calendarEvents,
      habitLog:       state.habitLog,
      streak:         state.streak,
    };
  }, [state, state?.sleepLog, state?.screenTimeLog, state?.calendarEvents, state?.habitLog, state?.streak]);

  // ── Timed modal / banner checks ──────────────────────────
  useEffect(() => {
    if (!profile) return;

    let mounted = true;

    const runChecks = () => {
      if (!mounted) return;
      if (document.visibilityState !== "visible") return;
      const h = nowHour();
      const m = nowMin();
      const t = todayUTC(); // use UTC so panic timing aligns with streak date boundary
      const { sleepLog, screenTimeLog, calendarEvents, habitLog, streak } = scheduledStateRef.current;

      // Sleep check-in at 07:30
      if (h === 7 && m >= 30 && m < 35 && !sleepLog?.[t]) {
        if (sleepModalShownRef.current === t) return;
        sleepModalShownRef.current = t;
        setModal({ type: "sleep_checkin" });
      }

      // Screen time at 13:00 and 20:00
      if (h === 13 && m >= 0 && m < 5 && !screenTimeLog?.[t]?.afternoon) {
        if (screenModalShownRef.current.afternoon === t) return;
        screenModalShownRef.current.afternoon = t;
        setModal({ type: "screen_time", period: "afternoon" });
      }
      if (h === 20 && m >= 0 && m < 5 && !screenTimeLog?.[t]?.evening) {
        if (screenModalShownRef.current.evening === t) return;
        screenModalShownRef.current.evening = t;
        setModal({ type: "screen_time", period: "evening" });
      }

      // Streak panic — evening only, no habits logged, warn once per day
      if (h >= 21) {
        const todayLog = habitLog?.[t] || [];
        if (todayLog.length === 0 && streak > 0 && panicWarnedRef.current !== t) {
          panicWarnedRef.current = t;
          showBanner("⚠ Hunter. Your streak expires at midnight. 0 habits logged.", "alert");
        }
      }

      // Lecture/tirgul reminders
      const upcoming = (calendarEvents || []).filter((e) => {
        if (e.type !== "lecture" && e.type !== "tirgul") return false;
        if (typeof e.start !== "string" || !e.start) return false;
        const diff = (new Date(e.start) - Date.now()) / 60000;
        return diff > 0 && diff <= 120 && !e.reminded;
      });

      if (upcoming.length > 0) {
        const safeTitle = String(upcoming[0].title || "Event")
          .replace(/[^\x20-\x7E]/g, "").slice(0, 100);
        const minsLeft = Math.round((new Date(upcoming[0].start) - Date.now()) / 60000);
        const count = upcoming.length;
        const summary =
          count === 1
            ? `${safeTitle} starts in ${minsLeft} minutes.`
            : `${safeTitle} starts in ${minsLeft} minutes, plus ${count - 1} more upcoming events.`;
        showBanner(summary, "warning");

        // Mark all as reminded — we set this via a custom event so the scheduler
        // doesn't need direct access to setState (keeps the hook dependency surface small).
        window.dispatchEvent(new CustomEvent("ritmol:mark-reminded", {
          detail: { ids: upcoming.map((u) => u.id) },
        }));
      }
    };

    const interval = setInterval(runChecks, 60_000);
    // Run once immediately on mount so we don't miss narrow trigger windows
    // when the app becomes visible mid-window.
    runChecks();

    const onVisible = () => {
      if (document.visibilityState === "visible") runChecks();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profile, showBanner, setModal]);
}
