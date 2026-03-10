// ═══════════════════════════════════════════════════════════════
// CORE CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Storage keys
export const DATA_DISCLOSURE_SEEN_KEY = "jv_data_disclosure_seen";
export const THEME_KEY = "jv_theme";

// AI / token limits
export const DAILY_TOKEN_LIMIT = 80000;

// XP / gacha defaults
export const DEFAULT_XP_PER_LEVEL = 1000;
export const DEFAULT_GACHA_COST = 100;
export const DEFAULT_STREAK_SHIELD_COST = 300;

// Client-enforced rarity probabilities for gacha pulls.
export const GACHA_RARITY_WEIGHTS = {
  common: 60,
  rare: 25,
  epic: 12,
  legendary: 3,
};

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
  ascii: { border: "1px solid #444", background: "#050505" },
  dots: { border: "1px dotted #444", background: "#050505" },
  geometric: { border: "1px solid #777", background: "#0b0b0b" },
  typewriter: { border: "1px solid #333", background: "#050505" },
};

// Achievement rarities — keyed by id so UI can do ACHIEVEMENT_RARITIES[ach.rarity].
export const ACHIEVEMENT_RARITIES = {
  common:    { label: "COMMON",    glow: "#888" },
  rare:      { label: "RARE",      glow: "#bbb" },
  epic:      { label: "EPIC",      glow: "#ddd" },
  legendary: { label: "LEGENDARY", glow: "#fff" },
};

