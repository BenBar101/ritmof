// ═══════════════════════════════════════════════════════════════
// useGameEngine
//
// Owns all RPG mechanics:
//  - awardXP           — validated XP award with level-up detection
//  - checkMissions     — progress check + completion rewards
//  - unlockAchievement — deduplicated achievement unlock
//  - executeCommands   — AI command allowlist executor
//  - trackTokens       — daily token budget tracker
//  - consumeAiXpBudget — daily AI XP cap (ref-based, race-condition safe)
//  - logHabit          — debounced habit logger
//
// KEY FIXES vs original App.jsx:
//  [A-1] All XP amounts validated before arithmetic
//  [A-2] loginXP capped at 5000
//  [A-3] pendingData pattern prevents double-toasts in Strict Mode
//  [Fix #5] aiXpTodayRef updated synchronously to prevent concurrent
//           executeCommands calls from each reading a stale total
// ═══════════════════════════════════════════════════════════════

import { useCallback, useRef, useEffect } from "react";
import { storageKey, todayUTC, localDateFromUTC, getMaxDateSeen } from "../utils/storage";
import { idbGet } from "../utils/db";
import { getLevel, getRank, getXpPerLevel } from "../utils/xp";
import { getGeminiApiKey } from "../utils/storage";
import { updateDynamicCosts } from "../api/dynamicCosts";
import { sanitizeForPrompt } from "../api/systemPrompt";
import { DAILY_TOKEN_LIMIT, DAILY_AI_XP_LIMIT } from "../constants";

const TOKEN_WARN_THRESHOLDS = [0.5, 0.8, 0.99];
const MAX_XP_PER_CMD        = 500;
const MAX_XP_PER_RESPONSE   = 1500;
const MAX_STR_LEN           = 300;
const MAX_TASKS_PER_RUN     = 10;
const MAX_TASKS_TOTAL       = 500;
const MAX_GOALS_TOTAL       = 200;
const MAX_HABITS_TOTAL      = 100;
const MAX_COMMANDS_PER_RUN  = 20;

const VALID_CMDS = new Set([
  "add_task", "add_goal", "complete_task", "clear_done_tasks", "award_xp",
  "announce", "set_daily_goal", "add_habit", "unlock_achievement", "add_timer", "suggest_sessions",
]);

// eslint-disable-next-line no-control-regex
const CTRL_RE   = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const BIDI_RE   = /[\u202A-\u202E\u2066-\u2069]/g;
// Include square brackets in the injection character set so prompt-injection
// patterns that rely on [SYSTEM]/[INSTRUCTION] style markers are stripped
// consistently with sanitizeForPrompt in systemPrompt.js.
const INJECT_RE = /[<>"`&'[\]|\u007C\u2223\uFF5C\u01C0\u01C1\u0964\u0965\uFE31\uFE32\u2758\u2506\u254E\u2502\u2503\u2016\u2225\\]/g;

function sanitizeStr(s, max = MAX_STR_LEN) {
  if (typeof s !== "string") return "";
  return s.replace(CTRL_RE, "").replace(BIDI_RE, "").replace(INJECT_RE, "").slice(0, max);
}

// ─────────────────────────────────────────────────────────────
export function useGameEngine({ setState, latestStateRef, showBanner, showToast, setLevelUpData }) {
  // ── Refs that must survive render cycles ─────────────────
  // aiXpTodayRef: updated synchronously so concurrent executeCommands
  // calls in the same event loop all see the accumulated total [Fix #5]
  const aiXpTodayRef     = useRef(null);
  // Prevents double level-up detection on rapid awardXP calls
  const lastLevelUpXpRef = useRef(-1);
  // Action debounce map (habitId → locked)
  const actionLocksRef   = useRef(new Set());
  const _engineMountedRef = useRef(true);
  useEffect(() => { _engineMountedRef.current = true; return () => { _engineMountedRef.current = false; }; }, []);

  // ── Token tracker ─────────────────────────────────────────
  const trackTokens = useCallback((amount) => {
    const safeAmount = typeof amount === "number" && isFinite(amount) && amount > 0
      ? Math.min(Math.round(amount), 1_000_000)
      : 0;
    if (safeAmount === 0) return;

    const t = todayUTC();
    setState((s) => {
      const usage = s.tokenUsage || { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 };
      const fresh = usage.date !== t
        ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 }
        : { ...usage, aiXpToday: typeof usage.aiXpToday === "number" ? usage.aiXpToday : 0 };

      const prevTokens = fresh.tokens;
      const newTokens  = prevTokens + safeAmount;
      const updated    = { ...fresh, tokens: newTokens };
      const newWarned  = [...(fresh.warnedAt || [])];

      TOKEN_WARN_THRESHOLDS.forEach((threshold) => {
        const pct = Math.round(threshold * 100);
        if (!newWarned.includes(pct) && prevTokens < DAILY_TOKEN_LIMIT * threshold && newTokens >= DAILY_TOKEN_LIMIT * threshold) {
          newWarned.push(pct);
          if (threshold >= 0.99) {
            setTimeout(() => showBanner("SYSTEM: Neural energy depleted. AI functions offline until tomorrow.", "alert"), 0);
          } else {
            setTimeout(() => showBanner(`SYSTEM: Neural energy at ${pct}%. ${threshold >= 0.8 ? "Conserve wisely." : ""}`, "warning"), 0);
          }
        }
      });
      updated.warnedAt = newWarned;
      return { ...s, tokenUsage: updated };
    });
  }, [setState, showBanner]);

  const trackTokensRef = useRef(trackTokens);
  // trackTokensRef is intentionally updated via the ref so it always holds the latest version without being a dep of other callbacks
  useEffect(() => { trackTokensRef.current = trackTokens; }, [trackTokens]);

  // ── AI XP budget (ref-based to avoid race conditions) ────
  const consumeAiXpBudget = useCallback((requested) => {
    if (!latestStateRef?.current) return 0;
    const t = todayUTC();
    // Harden against clock rollback: if the current date is earlier than the
    // anti-rollback watermark, treat the daily AI XP budget as already spent.
    // getMaxDateSeen() reads from the TinyBase store singleton — it is a module-level
    // function, not a React dep. Do NOT add it to the useCallback deps array.
    const maxSeen = getMaxDateSeen();
    if (maxSeen && t < maxSeen) {
      return 0;
    }
    if (aiXpTodayRef.current === null || aiXpTodayRef.current.date !== t) {
      const persisted = idbGet(storageKey("jv_token_usage"), null);
      const live = latestStateRef?.current?.tokenUsage;
      const persistedXp = persisted?.date === t ? (typeof persisted.aiXpToday === "number" && isFinite(persisted.aiXpToday) ? Math.max(0, Math.floor(persisted.aiXpToday)) : 0) : 0;
      const liveXp = live?.date === t ? (typeof live.aiXpToday === "number" && isFinite(live.aiXpToday) ? Math.max(0, Math.floor(live.aiXpToday)) : 0) : 0;
      const refXp = aiXpTodayRef.current?.date === t ? aiXpTodayRef.current.value : 0;
      const baseXp = Math.max(persistedXp, liveXp, refXp);
      aiXpTodayRef.current = { date: t, value: baseXp };
    }
    const alreadyAwarded = aiXpTodayRef.current.value;
    const remaining      = Math.max(0, DAILY_AI_XP_LIMIT - alreadyAwarded);
    const allowed        = Math.min(requested, remaining);
    if (allowed > 0) {
      aiXpTodayRef.current = { date: t, value: alreadyAwarded + allowed };
      setState((s) => {
        const usage   = s.tokenUsage || { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 };
        const fresh   = usage.date !== t
          ? { date: t, tokens: 0, warnedAt: [], aiXpToday: 0 }
          : { ...usage, aiXpToday: typeof usage.aiXpToday === "number" ? usage.aiXpToday : 0, warnedAt: Array.isArray(usage.warnedAt) ? usage.warnedAt : [] };
        return { ...s, tokenUsage: { ...fresh, aiXpToday: aiXpTodayRef.current.value } };
      });
    }
    return allowed;
  }, [setState, latestStateRef]);

  // ── Core XP award ─────────────────────────────────────────
  const awardXP = useCallback((amount, _event, silent = false) => {
    // [A-1] Validate before any arithmetic
    const safeAmount = typeof amount === "number" && isFinite(amount) && amount > 0
      ? Math.min(Math.round(amount), 100_000)
      : 0;
    if (safeAmount === 0) return;

    setState((s) => {
      const newXP  = Math.min((s.xp || 0) + safeAmount, 10_000_000);
      const xpPl   = getXpPerLevel(s);
      const baseXp = Math.max(
        typeof s.xp === "number" && isFinite(s.xp) ? s.xp : 0,
        lastLevelUpXpRef.current === -1 ? 0 : lastLevelUpXpRef.current,
      );
      const oldLevel  = getLevel(baseXp, xpPl);
      const newLevel  = getLevel(newXP,  xpPl);
      const didLevelUp = newLevel > oldLevel && !silent;

      if (didLevelUp) {
        lastLevelUpXpRef.current = newXP;
        const snapshot = { ...s, xp: newXP };
        setTimeout(() => {
          if (!_engineMountedRef.current) return;
          setLevelUpData((prev) => {
            if (prev && prev.level >= newLevel) return prev;
            return { level: newLevel, rank: getRank(newLevel) };
          });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokensRef.current)
            .then((costs) => {
              if (costs && Object.keys(costs).length && _engineMountedRef.current) {
                setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
              }
            })
            .catch((err) => {
              if (import.meta.env.DEV) {
                console.warn("[useGameEngine] updateDynamicCosts (level_up) failed:", err?.message || err);
              }
            });
        }, 300);
      }
      return { ...s, xp: newXP };
    });
  }, [setState, setLevelUpData]);

  // ── Mission checker ───────────────────────────────────────
  // [A-3] pendingData object prevents double-toasts in React Strict Mode
  const checkMissions = useCallback((hintType = null) => {
    const pendingData = { toasts: [], levelUp: null };

    setState((s) => {
      const t = localDateFromUTC();
      if (!s.dailyMissions) return s;
      const todayLog = s.habitLog[t] || [];
      let bonusXP = 0;
      const toastsThisRun = [];

      const updated = s.dailyMissions.map((m) => {
        if (m.done) return m;
        if (hintType && m.type !== hintType) return m;

        let progress = 0;
        if (m.type === "habits")  progress = todayLog.length;
        if (m.type === "session") progress = (s.sessions || []).filter((ss) => ss.date === t).length;
        if (m.type === "task")    progress = (s.tasks || []).filter((tk) => tk.doneDate === t).length;
        if (m.type === "chat") {
          progress = (s.chatHistory || []).some(
            (msg) => msg.role === "user" && typeof msg.date === "string" &&
                     /^\d{4}-\d{2}-\d{2}$/.test(msg.date) && msg.date === t
          ) ? 1 : 0;
        }

        if (progress >= m.target) {
          const missionXp = typeof m.xp === "number" && isFinite(m.xp) && m.xp > 0
            ? Math.min(m.xp, 2000) : 0;
          bonusXP += missionXp;
          toastsThisRun.push({ icon: "◈", title: "Mission Complete", desc: m.desc, xp: missionXp, rarity: "common" });
          return { ...m, done: true };
        }
        return m;
      });

      const safeBonus = Math.min(bonusXP > 0 && isFinite(bonusXP) ? bonusXP : 0, 10_000);
      const newXP     = Math.min(s.xp + safeBonus, 10_000_000);

      if (safeBonus > 0) {
        const xpPl    = getXpPerLevel(s);
        const effectiveOldXp = lastLevelUpXpRef.current > 0 ? Math.max(s.xp, lastLevelUpXpRef.current) : s.xp;
        const oldLevel = getLevel(effectiveOldXp, xpPl);
        const newLevel = getLevel(newXP, xpPl);
        if (newLevel > oldLevel) {
          pendingData.levelUp = { level: newLevel, rank: getRank(newLevel), snapshot: { ...s, xp: newXP, dailyMissions: updated } };
        }
      }
      pendingData.toasts = toastsThisRun;
      return { ...s, dailyMissions: updated, xp: newXP };
    });

    queueMicrotask(() => {
      if (!_engineMountedRef.current) return;
      pendingData.toasts.forEach((t, i) => setTimeout(() => showToast(t), 200 + i * 5500));
      if (pendingData.levelUp) {
        const { level, rank, snapshot } = pendingData.levelUp;
        const newXP = snapshot.xp;
        lastLevelUpXpRef.current = newXP;
        setTimeout(() => {
          if (!_engineMountedRef.current) return;
          setLevelUpData((prev) => {
            if (prev && prev.level >= level) return prev;
            return { level, rank };
          });
          updateDynamicCosts(getGeminiApiKey(), snapshot, "level_up", trackTokensRef.current)
            .then((costs) => {
              if (costs && Object.keys(costs).length && _engineMountedRef.current) {
                setState((prev) => ({ ...prev, dynamicCosts: { ...prev.dynamicCosts, ...costs } }));
              }
            })
            .catch((err) => {
              if (import.meta.env.DEV) {
                console.warn("[useGameEngine] updateDynamicCosts (mission level_up) failed:", err?.message || err);
              }
            });
        }, 300);
      }
    });
  }, [setState, showToast, setLevelUpData]);

  // ── Achievement unlock ────────────────────────────────────
  const unlockAchievement = useCallback((data, skipXP = false) => {
    setState((s) => {
      if ((s.achievements || []).find((a) => a.id === data.id)) return s;
      if ((s.achievements || []).length >= 2000) return s;
      const ach = { ...data, unlockedAt: Date.now() };
      setTimeout(() => showToast({ ...ach, isAchievement: true }), 300);
      return { ...s, achievements: [...(s.achievements || []), ach] };
    });
    if (!skipXP && data.xp > 0) queueMicrotask(() => awardXP(data.xp, null, false));
  }, [setState, showToast, awardXP]);

  // ── Habit logger ──────────────────────────────────────────
  const logHabit = useCallback((habitId) => {
    if (typeof habitId !== "string" || !habitId) return;
    if (actionLocksRef.current.has(habitId)) return;
    actionLocksRef.current.add(habitId);
    setTimeout(() => actionLocksRef.current.delete(habitId), 500);

    const t = localDateFromUTC();
    // pendingRef is a plain object (not useRef) intentionally — it is local to each
    // logHabit invocation. In React Strict Mode the updater runs twice:
    //   - 1st run: log does NOT include habitId → sets didLog=true, xp=h.xp
    //   - 2nd run: log NOW includes habitId → hits early return, does NOT mutate pendingRef
    // So didLog=true after both runs, and queueMicrotask awards XP exactly once.
    const pendingRef = { didLog: false, xp: 0 };

    setState((s) => {
      const log = s.habitLog[t] || [];
      if (log.includes(habitId)) return s;
      const h = s.habits.find((h) => h.id === habitId);
      if (!h) return s;
      pendingRef.xp = typeof h.xp === "number" && h.xp > 0 ? h.xp : 25;
      pendingRef.didLog = true;
      return { ...s, habitLog: { ...s.habitLog, [t]: [...log, habitId] } };
    });

    queueMicrotask(() => {
      if (pendingRef.didLog) {
        awardXP(pendingRef.xp, null);
        checkMissions("habits");
      }
    });
  }, [setState, awardXP, checkMissions]);

  // ── AI command executor ───────────────────────────────────
  const executeCommands = useCallback((commands) => {
    if (!Array.isArray(commands) || commands.length === 0) return;

    let tasksAdded       = 0;
    // NOTE: totalXPThisRun caps XP within ONE executeCommands call.
    // Concurrent calls each have their own cap; the daily budget in
    // consumeAiXpBudget is the global safety net.
    let totalXPThisRun   = 0;
    const pendingBanners = [];

    commands.slice(0, MAX_COMMANDS_PER_RUN).forEach((cmd) => {
      if (!cmd || typeof cmd !== "object" || Array.isArray(cmd)) return;
      if (!VALID_CMDS.has(cmd.cmd)) return;

      switch (cmd.cmd) {
        case "add_task": {
          if (tasksAdded >= MAX_TASKS_PER_RUN) break;
          const safeText = sanitizeStr(cmd.text, 500);
          if (!safeText.trim()) break;
          tasksAdded++;
          setState((s) => {
            if ((s.tasks || []).length >= MAX_TASKS_TOTAL) return s;
            return {
              ...s,
              tasks: [...(s.tasks || []), {
                id:       `t_${crypto.randomUUID()}`,
                text:     safeText,
                priority: ["low","medium","high"].includes(cmd.priority) ? cmd.priority : "medium",
                due:      typeof cmd.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cmd.due) ? cmd.due : null,
                done:     false,
                addedBy:  "ritmol",
              }],
            };
          });
          pendingBanners.push([`Task added: ${sanitizeStr(cmd.text, 60)}`, "info"]);
          break;
        }

        case "add_goal":
          setState((s) => {
            if ((s.goals || []).length >= MAX_GOALS_TOTAL) return s;
            return {
              ...s,
              goals: [...(s.goals || []), {
                id:       `g_${crypto.randomUUID()}`,
                title:    sanitizeStr(cmd.title),
                course:   sanitizeStr(cmd.course),
                due:      typeof cmd.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cmd.due) ? cmd.due : null,
                done:     false,
                addedBy:  "ritmol",
                tasks:    [],
              }],
            };
          });
          pendingBanners.push([`Goal logged: ${sanitizeStr(cmd.title, 60)}`, "success"]);
          break;

        case "complete_task": {
          const doneDate = localDateFromUTC();
          setState((s) => {
            const tasks    = [...(s.tasks || [])];
            const isValidId = typeof cmd.id === "string" && cmd.id.length <= 40 && /^[a-zA-Z0-9_]+$/.test(cmd.id);
            const idx = isValidId ? tasks.findIndex((t) => t.id === cmd.id) : -1;
            if (idx >= 0) tasks[idx] = { ...tasks[idx], done: true, doneDate };
            return { ...s, tasks };
          });
          queueMicrotask(() => { checkMissions("task"); });
          break;
        }

        case "clear_done_tasks":
          setState((s) => ({ ...s, tasks: (s.tasks || []).filter((t) => !t.done) }));
          break;

        case "award_xp": {
          const rawAmount      = Number(cmd.amount);
          const amount         = isFinite(rawAmount) && rawAmount > 0 ? Math.min(Math.floor(rawAmount), MAX_XP_PER_CMD) : 0;
          const cappedByResp   = Math.min(amount, Math.max(0, MAX_XP_PER_RESPONSE - totalXPThisRun));
          const allowed        = consumeAiXpBudget(cappedByResp);
          if (allowed <= 0) break;
          totalXPThisRun += allowed;
          awardXP(allowed, null, true);
          pendingBanners.push([`${sanitizeStr(cmd.reason, 80) || "XP awarded"} +${allowed} XP`, "success"]);
          break;
        }

        case "announce":
          pendingBanners.push([sanitizeStr(cmd.text, 200), ["info","warning","success","alert"].includes(cmd.type) ? cmd.type : "info"]);
          break;

        case "set_daily_goal": {
          // Sanitize once at storage time; display uses sanitizeForDisplay and
          // prompt-context uses sanitizeForPrompt when building the system prompt.
          const safeGoal = sanitizeForPrompt(cmd.text ?? "", 500);
          setState((s) => ({ ...s, dailyGoal: safeGoal }));
          break;
        }

        case "add_habit": {
          const incomingLabel = sanitizeStr(cmd.label);
          setState((s) => {
            if (s.habits.find((h) => (h.label||"").toLowerCase().trim() === (incomingLabel||"").toLowerCase().trim())) return s;
            if (s.habits.length >= MAX_HABITS_TOTAL) return s;
            return {
              ...s,
              habits: [...s.habits, {
                id:       `habit_${crypto.randomUUID()}`,
                label:    incomingLabel,
                category: ["body","mind","work"].includes(cmd.category) ? cmd.category : "mind",
                xp:       Math.min(Math.max(1, Number(cmd.xp) || 25), 200),
                icon:     typeof cmd.icon === "string"
                  ? [...cmd.icon].slice(0, 2).join("")
                  : "◈",
                style:    ["ascii","dots","geometric","typewriter"].includes(cmd.style) ? cmd.style : "ascii",
                addedBy:  "ritmol",
              }],
            };
          });
          pendingBanners.push([`New habit protocol: ${sanitizeStr(incomingLabel, 60)}`, "success"]);
          break;
        }

        case "unlock_achievement": {
          const safeId    = sanitizeStr(cmd.id, 100);
          if (!/^[\w\-.:@]+$/.test(safeId)) break;
          const achXP         = Math.min(Math.max(0, Number(cmd.xp) || 50), MAX_XP_PER_CMD);
          const cappedAchXP   = Math.min(achXP, Math.max(0, MAX_XP_PER_RESPONSE - totalXPThisRun));
          const allowedAchXP  = consumeAiXpBudget(cappedAchXP);
          totalXPThisRun += allowedAchXP;
          unlockAchievement({
            id:         safeId,
            title:      sanitizeStr(cmd.title),
            desc:       sanitizeStr(cmd.desc),
            flavorText: sanitizeStr(cmd.flavorText),
            icon:       typeof cmd.icon === "string" ? cmd.icon.slice(0, 2) : "◈",
            xp:         allowedAchXP,
            rarity:     ["common","rare","epic","legendary"].includes(cmd.rarity) ? cmd.rarity : "common",
          }, allowedAchXP === 0);
          break;
        }

        case "add_timer":
          setState((s) => {
            const rawMins = typeof cmd.minutes === "number" && isFinite(cmd.minutes)
              ? cmd.minutes
              : (typeof cmd.minutes === "string" ? parseFloat(cmd.minutes) : NaN);
            const safeMins = isFinite(rawMins)
              ? Math.min(Math.max(1, Math.floor(rawMins)), 480)
              : 90;
            return {
              ...s,
              activeTimers: [...(s.activeTimers || []), {
                id:     `timer_${crypto.randomUUID()}`,
                label:  sanitizeStr(cmd.label),
                emoji: (() => {
                  if (typeof cmd.emoji !== "string") return "◈";
                  const sanitized = cmd.emoji
                    // eslint-disable-next-line no-control-regex -- intentional: strip control and other unsafe chars
                    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
                    .replace(/[<>&"'`]/g, "");
                  if (!sanitized) return "◈";
                  return [...sanitized].slice(0, 2).join("") || "◈";
                })(),
                endsAt: Date.now() + safeMins * 60000,
              }],
            };
          });
          break;

        case "suggest_sessions":
          pendingBanners.push(["Session protocol suggested. Check Tasks.", "info"]);
          break;

        default: break;
      }
    });

    pendingBanners.slice(0, 3).forEach(([text, type], i) => {
      setTimeout(() => showBanner(text, type), i * 4200);
    });
  }, [setState, awardXP, unlockAchievement, consumeAiXpBudget, showBanner, checkMissions]);

  return {
    awardXP,
    checkMissions,
    unlockAchievement,
    executeCommands,
    trackTokens,
    consumeAiXpBudget,
    logHabit,
    actionLocksRef,
    lastLevelUpXpRef,
    aiXpTodayRef,
  };
}
