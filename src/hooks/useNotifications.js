// ═══════════════════════════════════════════════════════════════
// System notifications (Capacitor native) + web fallback (useScheduler-style)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import { localDateFromUTC, localHour, localMin } from "../utils/db";
import { calcSessionXP } from "../utils/xp";

const NOTIF_AVAILABLE =
  typeof LocalNotifications?.schedule === "function" &&
  typeof window !== "undefined" &&
  window?.Capacitor?.isNativePlatform?.();

const NOTIF_IDS = {
  SLEEP_CHECKIN: 1001,
  SCREEN_AFTERNOON: 1002,
  SCREEN_EVENING: 1003,
  STREAK_PANIC: 1004,
  DAILY_LOGIN: 1005,
};

function collectIdsToCancel() {
  const ids = [
    NOTIF_IDS.SLEEP_CHECKIN,
    NOTIF_IDS.SCREEN_AFTERNOON,
    NOTIF_IDS.SCREEN_EVENING,
    NOTIF_IDS.STREAK_PANIC,
    NOTIF_IDS.DAILY_LOGIN,
  ];
  for (let i = 0; i < 50; i++) {
    ids.push(2000 + i, 3000 + i);
  }
  for (let i = 0; i < 150; i++) ids.push(4000 + i);
  return ids;
}

function atLocalToday(h, m) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function nextOccurrence(h, m) {
  const d = atLocalToday(h, m);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

async function cancelSystemNotifications() {
  if (!NOTIF_AVAILABLE) return;
  try {
    const notifications = collectIdsToCancel().map((id) => ({ id }));
    await LocalNotifications.cancel({ notifications });
  } catch { /* ignore */ }
}

let actionTypesRegistered = false;

async function ensureActionTypes() {
  if (!NOTIF_AVAILABLE || actionTypesRegistered) return;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        { id: "SLEEP_LOG", actions: [{ id: "log_sleep", title: "Log Sleep" }] },
        {
          id: "SCREEN_LOG",
          actions: [
            { id: "log_now", title: "Log Now" },
            { id: "skip", title: "Skip", destructive: true },
          ],
        },
        {
          id: "LECTURE_LOG",
          actions: [
            { id: "high", title: "High Focus" },
            { id: "medium", title: "Medium" },
            { id: "low", title: "Distracted", destructive: true },
          ],
        },
        { id: "LOG_ATTENDANCE", actions: [{ id: "open", title: "Open App" }] },
        { id: "OPEN_APP", actions: [{ id: "open", title: "Open" }] },
      ],
    });
    actionTypesRegistered = true;
  } catch { /* ignore */ }
}

function buildSystemSchedule(state) {
  const list = [];
  const t = localDateFromUTC();
  const now = Date.now();

  // Sleep 07:30
  if (!state.sleepLog?.[t]) {
    const at = nextOccurrence(7, 30);
    list.push({
      id: NOTIF_IDS.SLEEP_CHECKIN,
      title: "[ RITMOL ] Morning Protocol",
      body: "Log your sleep quality to calibrate your day.",
      schedule: { at },
      actionTypeId: "SLEEP_LOG",
    });
  }

  // Screen afternoon 13:00
  if (!state.screenTimeLog?.[t]?.afternoon) {
    list.push({
      id: NOTIF_IDS.SCREEN_AFTERNOON,
      title: "[ RITMOL ] Screen Time",
      body: "Log your afternoon screen usage.",
      schedule: { at: nextOccurrence(13, 0) },
      actionTypeId: "SCREEN_LOG",
      extra: { period: "afternoon" },
    });
  }

  // Screen evening 20:00
  if (!state.screenTimeLog?.[t]?.evening) {
    list.push({
      id: NOTIF_IDS.SCREEN_EVENING,
      title: "[ RITMOL ] Screen Time",
      body: "Log your evening screen usage.",
      schedule: { at: nextOccurrence(20, 0) },
      actionTypeId: "SCREEN_LOG",
      extra: { period: "evening" },
    });
  }

  // Streak panic 21:00
  const todayLog = state.habitLog?.[t] || [];
  if ((state.streak ?? 0) > 0 && todayLog.length === 0) {
    const at = atLocalToday(21, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    list.push({
      id: NOTIF_IDS.STREAK_PANIC,
      title: "[ WARNING ] Streak Expiring",
      body: "Hunter. 0 habits logged. Midnight approaches.",
      schedule: { at },
      actionTypeId: "OPEN_APP",
    });
  }

  // Daily login 09:00
  if (state.lastLoginDate !== t) {
    let at = atLocalToday(9, 0);
    if (at.getTime() <= now) at = new Date(now + 120_000);
    list.push({
      id: NOTIF_IDS.DAILY_LOGIN,
      title: "[ DAILY ] Login Bonus Available",
      body: "Your Hunter rewards are waiting.",
      schedule: { at },
      actionTypeId: "OPEN_APP",
    });
  }

  const events = state.calendarEvents || [];
  let lecIdx = 0;
  for (const e of events) {
    if (lecIdx >= 50) break;
    if (e.type !== "lecture" && e.type !== "tirgul") continue;
    if (typeof e.start !== "string" || !e.start) continue;
    const startMs = new Date(e.start).getTime();
    const diffMin = (startMs - now) / 60000;
    if (diffMin > 30) {
      const remindAt = new Date(startMs - 30 * 60000);
      if (remindAt.getTime() > now) {
        const safeTitle = String(e.title || "Event").replace(/[^\x20-\x7E]/g, "").slice(0, 80);
        list.push({
          id: 2000 + lecIdx,
          title: `[ LECTURE ] ${safeTitle}`,
          body: "Starting in 30 minutes.",
          schedule: { at: remindAt },
          actionTypeId: "LOG_ATTENDANCE",
          extra: { eventId: e.id },
        });
      }
    }

    const endStr = e.end || e.start;
    const endMs = new Date(endStr).getTime();
    if (endMs > now && endMs < now + 86400000 * 1) {
      const postAt = new Date(endMs + 10 * 60000);
      if (postAt.getTime() > now) {
        const dur = Math.max(1, Math.round((endMs - startMs) / 60000) || 60);
        const safeTitle = String(e.title || "Lecture").replace(/[^\x20-\x7E]/g, "").slice(0, 80);
        list.push({
          id: 3000 + lecIdx,
          title: `[ LOG ] ${safeTitle}`,
          body: "How was your focus? Log your session.",
          schedule: { at: postAt },
          actionTypeId: "LECTURE_LOG",
          extra: {
            eventTitle: safeTitle,
            durationMinutes: dur,
            eventId: e.id,
          },
        });
      }
    }
    lecIdx += 1;
  }

  let exIdx = 0;
  for (const e of events) {
    if (exIdx >= 50) break;
    if (e.type !== "exam") continue;
    if (typeof e.start !== "string" || !e.start) continue;
    const startMs = new Date(e.start).getTime();
    if (startMs <= now) continue;
    const warnings = [
      { h: 72, ms: 72 * 3600000 },
      { h: 24, ms: 24 * 3600000 },
      { h: 1, ms: 3600000 },
    ];
    warnings.forEach((w, wi) => {
      const at = new Date(startMs - w.ms);
      if (at.getTime() > now) {
        const safeTitle = String(e.title || "Exam").replace(/[^\x20-\x7E]/g, "").slice(0, 80);
        list.push({
          id: 4000 + exIdx * 3 + wi,
          title: `[ EXAM ] ${safeTitle}`,
          body: `Starts in ${w.h} hour${w.h === 1 ? "" : "s"}.`,
          schedule: { at },
          actionTypeId: "OPEN_APP",
        });
      }
    });
    exIdx += 1;
  }

  return list;
}

async function scheduleSystemNotifications(state) {
  if (!NOTIF_AVAILABLE) return;
  await ensureActionTypes();
  await cancelSystemNotifications();
  const notifications = buildSystemSchedule(state).map((n) => ({
    ...n,
    sound: undefined,
    channelId: "ritmol_default",
  }));
  if (!notifications.length) return;
  try {
    await LocalNotifications.schedule({ notifications });
  } catch { /* ignore */ }
}

async function runRequestNotificationPermission(setState, currentState) {
  if (!NOTIF_AVAILABLE) return;
  try {
    const req = await LocalNotifications.requestPermissions();
    const granted = req.display === "granted";
    setState((s) => ({ ...s, notificationsEnabled: granted }));
    if (granted && currentState) await scheduleSystemNotifications(currentState);
  } catch {
    setState((s) => ({ ...s, notificationsEnabled: false }));
  }
}

function scheduleAiNotificationImpl({ title, body, scheduleAt, type }, showBanner) {
  if (NOTIF_AVAILABLE) {
    LocalNotifications.schedule({
      notifications: [{
        id: 6000 + Math.floor(Math.random() * 999),
        title,
        body,
        schedule: { at: new Date(scheduleAt) },
        extra: { type },
      }],
    }).catch(() => {});
  } else {
    const msUntil = new Date(scheduleAt).getTime() - Date.now();
    if (msUntil >= 0) {
      setTimeout(() => showBanner(`${title}: ${body}`, "info"), msUntil);
    }
  }
}

export function useNotifications({
  state, profile, showBanner, setModal, setState,
}) {
  const panicWarnedRef = useRef(null);
  const sleepModalShownRef = useRef(null);
  const screenModalShownRef = useRef({});
  const scheduledStateRef = useRef({
    sleepLog: null,
    screenTimeLog: null,
    calendarEvents: null,
    habitLog: null,
    streak: 0,
    lastLoginDate: null,
  });

  const scheduleAiNotification = useCallback(
    (n) => scheduleAiNotificationImpl(n, showBanner),
    [showBanner],
  );

  useEffect(() => {
    if (!state) return;
    scheduledStateRef.current = {
      sleepLog: state.sleepLog,
      screenTimeLog: state.screenTimeLog,
      calendarEvents: state.calendarEvents,
      habitLog: state.habitLog,
      streak: state.streak,
      lastLoginDate: state.lastLoginDate,
    };
  }, [state, profile]);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Native: reschedule when state / permission changes
  useEffect(() => {
    if (!NOTIF_AVAILABLE || !profile) return;
    if (!state?.notificationsEnabled) return;
    scheduleSystemNotifications(state);
  }, [
    profile,
    state,
  ]);

  // Native: action handler
  useEffect(() => {
    if (!NOTIF_AVAILABLE) return;
    let h;
    (async () => {
      await ensureActionTypes();
      h = await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
        const { notification, actionId } = event;
        const actionTypeId = notification.actionTypeId;
        if (actionTypeId === "LECTURE_LOG") {
          const focusMap = { high: "high", medium: "medium", low: "low" };
          const focusLevel = focusMap[actionId];
          if (!focusLevel) return;
          const { eventTitle, durationMinutes, eventId } = notification.extra ?? {};
          const streakDays = stateRef.current?.streak ?? 0;
          const xpResult = calcSessionXP("lecture", durationMinutes ?? 60, focusLevel, streakDays);
          setState((s) => {
            const newSession = {
              id: `session_${Date.now()}`,
              type: "lecture",
              title: eventTitle ?? "Lecture",
              focus: focusLevel,
              duration: durationMinutes ?? 60,
              xp: xpResult,
              date: localDateFromUTC(),
              ts: Date.now(),
            };
            const newPending = { ...(s.lectureQuickLogPending || {}) };
            if (eventId) delete newPending[eventId];
            return {
              ...s,
              sessions: [...(s.sessions ?? []), newSession],
              xp: (s.xp ?? 0) + xpResult,
              lectureQuickLogPending: newPending,
            };
          });
          LocalNotifications.schedule({
            notifications: [{
              id: 9000 + Math.floor(Math.random() * 1000),
              title: "[ LOGGED ]",
              body: `${eventTitle ?? "Lecture"} logged. +${xpResult} XP.`,
              schedule: { at: new Date(Date.now() + 3000) },
            }],
          }).catch(() => {});
          return;
        }
        if (actionTypeId === "SLEEP_LOG") {
          setModal({ type: "sleep_checkin" });
          return;
        }
        if (actionTypeId === "SCREEN_LOG" && actionId === "log_now") {
          setModal({ type: "screen_time", period: notification.extra?.period ?? "afternoon" });
        }
      });
    })();
    return () => { try { h?.remove?.(); } catch { /* ignore */ } };
  }, [setModal, setState]);

  // Web fallback: same interval as useScheduler
  useEffect(() => {
    if (NOTIF_AVAILABLE) return;
    if (!profile) return;

    let mounted = true;
    const runChecks = () => {
      if (!mounted) return;
      if (document.visibilityState !== "visible") return;
      const h = localHour();
      const m = localMin();
      const today = localDateFromUTC();
      const { sleepLog, screenTimeLog, calendarEvents, habitLog, streak } = scheduledStateRef.current;

      if (h === 7 && m >= 30 && m < 35 && !sleepLog?.[today]) {
        if (sleepModalShownRef.current === today) return;
        sleepModalShownRef.current = today;
        setModal({ type: "sleep_checkin" });
      }

      if (h === 13 && m >= 0 && m < 5 && !screenTimeLog?.[today]?.afternoon) {
        if (screenModalShownRef.current.afternoon === today) return;
        screenModalShownRef.current.afternoon = today;
        setModal({ type: "screen_time", period: "afternoon" });
      }
      if (h === 20 && m >= 0 && m < 5 && !screenTimeLog?.[today]?.evening) {
        if (screenModalShownRef.current.evening === today) return;
        screenModalShownRef.current.evening = today;
        setModal({ type: "screen_time", period: "evening" });
      }

      if (h >= 21) {
        const todayLog = habitLog?.[today] || [];
        if (todayLog.length === 0 && streak > 0 && panicWarnedRef.current !== today) {
          panicWarnedRef.current = today;
          showBanner("⚠ Hunter. Your streak expires at midnight. 0 habits logged.", "alert");
        }
      }

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

        window.dispatchEvent(new CustomEvent("ritmol:mark-reminded", {
          detail: { ids: upcoming.map((u) => u.id) },
        }));
      }
    };

    const interval = setInterval(runChecks, 60_000);
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

  const requestNotificationPermission = useCallback(() => {
    return runRequestNotificationPermission(setState, stateRef.current);
  }, [setState]);

  return { scheduleAiNotification, requestNotificationPermission };
}
