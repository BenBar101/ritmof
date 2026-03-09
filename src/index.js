// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Default costs; actual values come from state.dynamicCosts (AI can change them on level-up, gacha pull, shield use).
export const DEFAULT_XP_PER_LEVEL = 500;
export const DEFAULT_GACHA_COST = 150;
export const DEFAULT_STREAK_SHIELD_COST = 300;

export const RANKS = [
  { min: 0,  title: "Rookie",      decor: "[ _ ]",    badge: "░░░░░", font: "mono" },
  { min: 2,  title: "Scholar",     decor: "[ § ]",    badge: "▒░░░░", font: "fell" },
  { min: 4,  title: "Focused",     decor: "[ ◈ ]",    badge: "▒▒░░░", font: "mono" },
  { min: 6,  title: "Operator",    decor: "[ ▣ ]",    badge: "▒▒▒░░", font: "mono" },
  { min: 8,  title: "Elite",       decor: "[ ◉ ]",    badge: "▒▒▒▒░", font: "mono" },
  { min: 10, title: "Apex",        decor: "[ ✦ ]",    badge: "█████", font: "fell" },
  { min: 12, title: "Sovereign",   decor: "[ ❖ ]",    badge: "░▒▓██", font: "fell" },
  { min: 15, title: "Transcendent",decor: "[ ∞ ]",    badge: "█▓▒░█", font: "fell" },
];

export const DEFAULT_HABITS = [
  { id: "water",    label: "Drink 2L Water",      category: "body", xp: 20, icon: "◉", style: "dots" },
  { id: "sleep11",  label: "Sleep Before 11PM",   category: "body", xp: 30, icon: "◑", style: "dots" },
  { id: "wake7",    label: "Wake Before 7AM",      category: "body", xp: 30, icon: "◐", style: "dots" },
  { id: "sunlight", label: "Morning Sunlight",     category: "body", xp: 20, icon: "☀", style: "dots" },
  { id: "read",     label: "Read 20 Pages",        category: "mind", xp: 35, icon: "≡", style: "dots" },
  { id: "deepwork", label: "2hr Deep Work",        category: "work", xp: 50, icon: "◈", style: "ascii" },
  { id: "journal",  label: "Journal Entry",        category: "mind", xp: 20, icon: "✎", style: "typewriter" },
];

export const SESSION_TYPES = [
  { id: "lecture",  label: "Lecture",   style: "geometric", baseXP: 15, icon: "◈", desc: "Attended class" },
  { id: "tirgul",   label: "Tirgul",    style: "ascii",     baseXP: 20, icon: ">>", desc: "Tutorial / problem session" },
  { id: "homework", label: "Homework",  style: "typewriter",baseXP: 25, icon: "✎", desc: "Assignment work" },
  { id: "prep",     label: "Prep",      style: "dots",      baseXP: 20, icon: "∷", desc: "Reading / preparation" },
];

export const FOCUS_LEVELS = [
  { id: "low",    label: "Low",    mult: 0.7, symbol: "▁▁▁" },
  { id: "medium", label: "Medium", mult: 1.0, symbol: "▃▃▃" },
  { id: "high",   label: "High",   mult: 1.5, symbol: "█▃▁" },
];

export const ACHIEVEMENT_RARITIES = {
  common:    { label: "COMMON",    glow: "#888" },
  rare:      { label: "RARE",      glow: "#bbb" },
  epic:      { label: "EPIC",      glow: "#ddd" },
  legendary: { label: "LEGENDARY", glow: "#fff" },
};

// Daily token budget. Gemini 2.5 Flash free tier is ~1 000 000 tokens/day per key.
// Set conservatively so a runaway loop doesn't silently drain the quota.
export const DAILY_TOKEN_LIMIT = 50_000;
export const DATA_DISCLOSURE_SEEN_KEY = "ritmol_data_disclosure_seen";
export const THEME_KEY = "jv_theme";

// Styles by context
export const STYLE_CSS = {
  ascii: {
    border: "1px solid #888",
    fontFamily: "'Share Tech Mono', monospace",
    background: "repeating-linear-gradient(0deg, transparent, transparent 19px, #111 19px, #111 20px)",
    decoration: "top-left",
  },
  dots: {
    border: "1px solid #666",
    fontFamily: "'IM Fell English', serif",
    background: "radial-gradient(circle, #1a1a1a 1px, transparent 1px) 0 0 / 12px 12px",
    decoration: "ornate",
  },
  geometric: {
    border: "2px solid #aaa",
    fontFamily: "'Share Tech Mono', monospace",
    background: "linear-gradient(45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(-45deg, #0d0d0d 25%, transparent 25%) -10px 0/ 20px 20px, linear-gradient(45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px, linear-gradient(-45deg, transparent 75%, #0d0d0d 75%) 0 0/ 20px 20px",
    decoration: "corners",
  },
  typewriter: {
    border: "1px solid #777",
    fontFamily: "'Special Elite', cursive",
    background: "#0f0f0f",
    decoration: "underline",
  },
};
