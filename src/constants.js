// ═══════════════════════════════════════════════════════════════
// CORE CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Storage keys
export const DATA_DISCLOSURE_SEEN_KEY = "jv_data_disclosure_seen";
export const THEME_KEY = "jv_theme";

// XP / gacha defaults
export const DEFAULT_XP_PER_LEVEL = 1000;
export const DEFAULT_GACHA_COST = 100;
export const DEFAULT_STREAK_SHIELD_COST = 300;

/** Offline mechanics metadata (synced as `jv_game_meta`). */
export const DEFAULT_GAME_META = Object.freeze({
  staticContentVersion: 1,
  lastEvaluatedAchievementIds: [],
  lastEvaluatedAt: null,
});

/** Sealed function: weights captured in closure, not patchable via DevTools.
 * Uses crypto.getRandomValues so the roll value is generated atomically — no observable
 * intermediate state for a debugger breakpoint to replay until legendary. */
export function sampleGachaRarity() {
  const W = Object.freeze({ common: 60, rare: 25, epic: 12, legendary: 3 });
  const total = Object.values(W).reduce((a, b) => a + b, 0); // 100
  const buf = new Uint8Array(1);
  let attempts = 0;
  while (attempts < 8) {
    crypto.getRandomValues(buf);
    // Rejection sampling: discard values >= 200 to keep distribution uniform over 0-99.
    if (buf[0] >= 200) { attempts++; continue; }
    break;
  }
  let roll = buf[0] % total;
  for (const [rarity, weight] of Object.entries(W)) {
    roll -= weight;
    if (roll < 0) return rarity;
  }
  return "common";
}

// Session types & focus levels used by XP calc and UI.
export const SESSION_TYPES = [
  { id: "lecture", label: "Lecture", baseXP: 40, style: "ascii" },
  { id: "self_study", label: "Self-Study", baseXP: 35, style: "dots" },
  { id: "project", label: "Project Work", baseXP: 45, style: "geometric" },
  { id: "exam_prep", label: "Exam Prep", baseXP: 50, style: "typewriter" },
];

export const FOCUS_LEVELS = [
  { id: "low", label: "Distracted", mult: 0.7 },
  { id: "medium", label: "Focused", mult: 1.0 },
  { id: "high", label: "Hyperfocus", mult: 1.3 },
];

// Ranks by level thresholds — includes decor/badge/font used by TopBar and ProfileTab.
export const RANKS = [
  { id: "novice",     label: "Novice",      min: 0,  title: "Novice",      decor: "[ _ ]", badge: "░░░░░", font: "mono" },
  { id: "apprentice", label: "Apprentice",  min: 5,  title: "Apprentice",  decor: "[ § ]", badge: "▒░░░░", font: "fell" },
  { id: "adept",      label: "Adept",       min: 15, title: "Adept",       decor: "[ ◈ ]", badge: "▒▒░░░", font: "mono" },
  { id: "elite",      label: "Elite",       min: 30, title: "Elite",       decor: "[ ◉ ]", badge: "▒▒▒▒░", font: "mono" },
  { id: "ascendant",  label: "Ascendant",   min: 50, title: "Ascendant",   decor: "[ ✦ ]", badge: "█████", font: "fell" },
];

// Habit starter pack.
export const DEFAULT_HABITS = [
  { id: "habit_water", label: "Drink water", category: "body", xp: 20, icon: "W", style: "ascii", addedBy: "system" },
  { id: "habit_review", label: "Review notes", category: "mind", xp: 30, icon: "R", style: "dots", addedBy: "system" },
  { id: "habit_focus", label: "Deep work sprint", category: "work", xp: 40, icon: "F", style: "geometric", addedBy: "system" },
];

// CSS style presets for ASCII / geometric aesthetics.
export const STYLE_CSS = {
  ascii: { border: "2px solid #fff", background: "#000" },
  dots: { border: "2px dotted #fff", background: "#000" },
  geometric: { border: "2px solid #fff", background: "#000" },
  typewriter: { border: "2px solid #fff", background: "#000" },
};

// Achievement rarities — keyed by id so UI can do ACHIEVEMENT_RARITIES[ach.rarity].
export const ACHIEVEMENT_RARITIES = {
  common:    { label: "[ COMMON ]",    glow: "#fff" },
  rare:      { label: "[ RARE ]",      glow: "#fff" },
  epic:      { label: "[ EPIC ]",      glow: "#fff" },
  legendary: { label: "[ LEGENDARY ]", glow: "#fff" },
};

