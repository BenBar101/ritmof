import { localDateFromUTC } from "./db";

/** Same week key as App.jsx / sync (local calendar). */
export function localWeekKey() {
  const d = new Date();
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const week = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function localMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Monday (local) as YYYY-MM-DD */
export function localWeekStartDateStr() {
  const d = new Date();
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  const y = m.getFullYear();
  const mo = String(m.getMonth() + 1).padStart(2, "0");
  const da = String(m.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** First day of month (local) YYYY-MM-DD */
export function localMonthStartDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${mo}-01`;
}

function inRange(dateStr, startStr, endStr) {
  return typeof dateStr === "string" && dateStr >= startStr && dateStr <= endStr;
}

export function countHabitsInRange(habitLog, startStr, endStr) {
  let n = 0;
  for (const [date, ids] of Object.entries(habitLog || {})) {
    if (!inRange(date, startStr, endStr)) continue;
    n += (ids || []).length;
  }
  return n;
}

export function countSessionsInRange(sessions, startStr, endStr) {
  return (sessions || []).filter((s) => s.date && inRange(s.date, startStr, endStr)).length;
}

export function countTasksDoneInRange(tasks, startStr, endStr) {
  return (tasks || []).filter((t) => t.done && t.doneDate && inRange(t.doneDate, startStr, endStr)).length;
}

/**
 * Progress for a mission row within [startStr, endStr] (local calendar dates).
 */
export function missionProgressInRange(m, s, startStr, endStr) {
  const today = localDateFromUTC();
  const end = today < endStr ? today : endStr;
  if (m.type === "habits") {
    return countHabitsInRange(s.habitLog, startStr, end);
  }
  if (m.type === "session") {
    return countSessionsInRange(s.sessions, startStr, end);
  }
  if (m.type === "task") {
    return countTasksDoneInRange(s.tasks, startStr, end);
  }
  return 0;
}
