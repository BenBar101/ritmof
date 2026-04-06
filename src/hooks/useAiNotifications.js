// ═══════════════════════════════════════════════════════════════
// AI-generated notification batch (Gemini)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { z } from "zod";
import {
  NOTIF_WAKING_START_HOUR,
  NOTIF_WAKING_END_HOUR,
  NOTIF_AI_INTERVAL_HOURS,
  AI_DAILY_TOKEN_LIMIT,
  GEMINI_NOTIF_INPUT_TOKENS,
  GEMINI_NOTIF_OUTPUT_TOKENS,
  GEMINI_NOTIF_TOKEN_THRESHOLD,
} from "../config.js";
import { callGemini } from "../api/gemini";
import { localDateFromUTC, localHour } from "../utils/db";

const AiNotifSchema = z.object({
  title: z.string().max(80),
  body: z.string().max(150),
  scheduleAt: z.string().datetime(),
  type: z.enum(["ai_personal", "quest"]),
});

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function shouldRun(state, getAiKey) {
  if (!state?.profile) return false;
  const h = localHour();
  if (h < NOTIF_WAKING_START_HOUR || h >= NOTIF_WAKING_END_HOUR) return false;

  const last = state.lastAiNotificationBatch;
  if (last) {
    const elapsed = Date.now() - new Date(last).getTime();
    if (elapsed < NOTIF_AI_INTERVAL_HOURS * 3600000) return false;
  }

  const usage = state.tokenUsage;
  const cap = AI_DAILY_TOKEN_LIMIT * GEMINI_NOTIF_TOKEN_THRESHOLD;
  if (usage && usage.tokens >= cap) return false;

  const key = await getAiKey().catch(() => null);
  return !!key;
}

function buildStateSnapshot(state) {
  const today = localDateFromUTC();
  const y = yesterdayStr();
  const snap = {
    hour: localHour(),
    sleepYesterday: state?.sleepLog?.[y] ?? null,
    habitsToday: (state?.habitLog?.[today] ?? []).length,
    habitsTotal: state?.habits?.length ?? 0,
    sessionsToday: (state?.sessions ?? []).filter((s) => s.date === today).map((s) => ({ type: s.type, focus: s.focus })),
    streak: state?.streak ?? 0,
    xp: state?.xp ?? 0,
    nextEvent: (state?.calendarEvents ?? []).find((e) => e.start && new Date(e.start) > new Date()) ?? null,
    major: (state?.profile?.major ?? "").slice(0, 40),
    interests: (state?.profile?.interests ?? "").slice(0, 50),
    recentAiNotifs: (state?.aiNotificationLog?.[today] ?? []).slice(-3),
  };
  const raw = JSON.stringify(snap);
  const approxChars = GEMINI_NOTIF_INPUT_TOKENS * 4;
  return raw.length > approxChars ? raw.slice(0, approxChars) : raw;
}

async function generateAiNotifications(snapshot, apiKey) {
  const systemPrompt =
    "You are RITMOL, a harsh but fair RPG life companion for a university student. Generate 1-3 push notifications based on the student's current state. Respond ONLY with a JSON array. Each item: { title: string (max 60 chars, ALL CAPS style), body: string (max 120 chars), scheduleAt: ISO datetime string within the next 2 hours, type: 'ai_personal' | 'quest' }. For ai_personal: be direct, contextual, honest. For quest: use [ QUEST TYPE ] prefix and make it actionable.";
  const { text } = await callGemini(
    apiKey,
    [{ role: "user", content: snapshot }],
    systemPrompt,
    true,
    undefined,
    GEMINI_NOTIF_OUTPUT_TOKENS,
    true,
  );
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```[\w]*\n?/g, "").trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      const r = AiNotifSchema.safeParse(item);
      return r.success ? r.data : null;
    })
    .filter(Boolean);
}

export function useAiNotifications({ latestStateRef, getAiKey, setState, scheduleAiNotification }) {
  const inFlight = useRef(false);
  const getAiKeyRef = useRef(getAiKey);
  const scheduleRef = useRef(scheduleAiNotification);
  useEffect(() => { getAiKeyRef.current = getAiKey; }, [getAiKey]);
  useEffect(() => { scheduleRef.current = scheduleAiNotification; }, [scheduleAiNotification]);

  useEffect(() => {
    const ms = NOTIF_AI_INTERVAL_HOURS * 3600000;
    const tick = async () => {
      const state = latestStateRef.current;
      if (inFlight.current || !state?.profile) return;
      if (!(await shouldRun(state, () => getAiKeyRef.current()))) return;

      inFlight.current = true;
      try {
        const key = await getAiKeyRef.current().catch(() => null);
        if (!key) return;
        const snapshot = buildStateSnapshot(state);
        const notifications = await generateAiNotifications(snapshot, key).catch(() => []);
        if (!notifications.length) return;
        notifications.forEach((n) => scheduleRef.current(n));
        const today = localDateFromUTC();
        setState((s) => ({
          ...s,
          lastAiNotificationBatch: new Date().toISOString(),
          aiNotificationLog: {
            ...(s.aiNotificationLog || {}),
            [today]: [...(s.aiNotificationLog?.[today] ?? []), ...notifications.map((n) => n.title)].slice(-10),
          },
        }));
      } finally {
        inFlight.current = false;
      }
    };

    const id = setInterval(tick, ms);
    tick();

    const onBf = () => { tick(); };
    window.addEventListener("ritmol:ai-notif-tick", onBf);
    return () => {
      clearInterval(id);
      window.removeEventListener("ritmol:ai-notif-tick", onBf);
    };
  }, [latestStateRef, setState]);

  useEffect(() => {
    let h;
    (async () => {
      try {
        h = await CapApp.addListener("appStateChange", ({ isActive }) => {
          if (isActive) window.dispatchEvent(new Event("ritmol:ai-notif-tick"));
        });
      } catch { /* web / no Capacitor */ }
    })();
    return () => {
      try {
        h?.remove?.();
      } catch { /* ignore */ }
    };
  }, []);
}
