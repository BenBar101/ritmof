// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT BUILDER
// Builds the RITMOL AI system prompt from current state.
// All user-derived strings are sanitized before injection to
// prevent prompt-injection via crafted profile or chat data.
// ═══════════════════════════════════════════════════════════════
import { today } from "../utils/storage";
import { getLevel, getRank, getXpPerLevel } from "../utils/xp";

/**
 * Strip XML/HTML breakout chars and control characters from a string
 * before embedding it in the AI system prompt.
 *
 * Fixes applied vs. original:
 *  [P-1] Added U+2028 (LINE SEPARATOR, 8232) and U+2029 (PARAGRAPH SEPARATOR, 8233)
 *        to the control-char loop. These are above the C1 cutoff (≤159) but act as
 *        newlines in LLM prompt contexts, enabling multi-line injection to escape
 *        the <HUNTER_DATA> XML-like boundary.
 *  [P-1] Added zero-width chars U+200B–U+200D and U+FEFF (BOM / zero-width no-break
 *        space) — invisible chars that can disrupt tokenization or hide injections.
 *  [P-2] Added single quote ' to the strip regex. The original set omitted it,
 *        allowing ' to participate in injection patterns.
 */
export function sanitizeForPrompt(str, maxLen = 200) {
  if (typeof str !== "string") return "";
  // Remove C0 control chars (≤31), C1 control chars (127–159),
  // Unicode line/paragraph separators (8232–8233), and zero-width chars.
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 31) continue;                      // C0 controls (includes \n, \r, \t)
    if (code >= 127 && code <= 159) continue;      // C1 controls (DEL + extended)
    if (code === 8232 || code === 8233) continue;  // U+2028 LINE SEP, U+2029 PARA SEP
    if (code >= 8203 && code <= 8205) continue;    // U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ
    if (code === 65279) continue;                  // U+FEFF BOM / zero-width no-break space
    if (code === 8239 || code === 8199) continue;  // U+202F Narrow NBSP, U+2007 Figure Space
    if (code >= 0xFE00 && code <= 0xFE0F) continue;   // Variation Selectors 1-16
    if (code >= 0x1F3FB && code <= 0x1F3FF) continue; // Emoji skin-tone modifiers
    // Tags block U+E0000–U+E01FF: covers U+E0020 TAG SPACE through U+E007F CANCEL TAG
    // (the range used in prompt-injection payloads) and the variation supplement above.
    // DO NOT narrow this range — the full block must be stripped.
    if (code >= 0xE0000 && code <= 0xE01FF) continue;
    // Mathematical alphanumeric symbols (bold/italic/script/fraktur A–Z, 0–9)
    // and Letterlike Symbols — visually similar to ASCII and often used in
    // prompt-injection payloads to bypass simple ASCII-only filters.
    if (code >= 0x1D400 && code <= 0x1D7FF) continue;
    if (code >= 0x2100 && code <= 0x214F) continue;
    // Enclosed Alphanumerics U+2460–U+24FF: contains circled/parenthesised Latin letters
    // (Ⓐ–Ⓩ, ⓐ–ⓩ) visually identical to ASCII, used in prompt-injection payloads.
    if (code >= 0x2460 && code <= 0x24FF) continue;
    // Enclosed Alphanumeric Supplement U+1F100–U+1F1FF: regional indicator symbols
    // (used to spoof flag emoji combos that pass naive length checks).
    if (code >= 0x1F100 && code <= 0x1F1FF) continue;
    // Block bidirectional override/embedding/isolate controls
    // U+202A-202E (LTR/RTL embedding, override, pop directional)
    // U+2066-U+2069 (directional isolates)
    if ((code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069)) continue;
    out += str[i];
  }
  // Strip XML breakout and injection-risk characters.
  // Fix [P-2]: added single-quote ' to the character class.
  return out
    // Strip ASCII injection characters — square brackets are also stripped to
    // prevent JSON/markdown-style injection patterns in prompt context even
    // though they are common text. Pipe `|` is also stripped so it cannot be
    // used to spoof turn separators inside RECENT_CONTEXT.
    // Pipe is intentionally stripped to prevent turn-separator spoofing in recentChatSummary.
    .replace(/[<>{}[\]`"'|\u007C\u2223\uFF5C\u01C0\u01C1\u0964\u0965\uFE31\uFE32\u2758\u2506\u254E\u2502\u2503\u2016\u2225\\]/g, "")          // ASCII injection chars + pipe + homoglyphs
    // Strip Unicode quote-like characters (double/single, guillemets, etc.)
    .replace(/[\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A]/g, "")
    // Strip angle-bracket homoglyphs that could visually mimic tags.
    .replace(/[\u27E8\u27E9\u276C\u276D\u276E\u276F\uFE3D\uFE3E\u2329\u232A]/g, "")
    .slice(0, maxLen);
}

/**
 * Build the full RITMOL system prompt.
 * @param {object} state  - current app state
 * @param {object} profile - user profile (subset of state.profile)
 * @returns {string}
 */
export function buildSystemPrompt(state, profile) {
  const xpPerLevel = getXpPerLevel(state);
  const rawLevel = getLevel(state.xp ?? 0, xpPerLevel);
  const level = Math.floor(Math.max(0, Number(rawLevel) || 0));
  const rank = getRank(level);

  const t = today();
  const todayHabitsRaw = (state.habitLog?.[t] || []).length;
  const totalHabitsRaw = (state.habits || []).length;
  const pendingTasksRaw = (state.tasks || []).filter((task) => !task.done).length;
  const activeGoalsRaw = (state.goals || []).filter((g) => !g.done).length;
  const streakDaysRaw = state.streak ?? 0;
  const shieldsRaw = state.streakShields ?? 0;

  const safeXp = Math.floor(Math.max(0, Number(state.xp) || 0));
  const safeNextLevelXp = Math.floor(Math.max(0, (level + 1) * xpPerLevel));
  const streakDays = Math.floor(Math.max(0, Number(streakDaysRaw) || 0));
  const shields = Math.floor(Math.max(0, Number(shieldsRaw) || 0));
  const todayHabits = Math.floor(Math.max(0, Number(todayHabitsRaw) || 0));
  const totalHabits = Math.floor(Math.max(0, Number(totalHabitsRaw) || 0));
  const pendingTasks = Math.floor(Math.max(0, Number(pendingTasksRaw) || 0));
  const activeGoals = Math.floor(Math.max(0, Number(activeGoalsRaw) || 0));

  // Sanitize all user-derived values before embedding
  const safeName = sanitizeForPrompt(profile?.name ?? "Hunter", 60);
  const safeMajor = sanitizeForPrompt(profile?.major ?? "", 80);
  const safeBooks = sanitizeForPrompt(profile?.books ?? "", 200);
  const safeInterests = sanitizeForPrompt(profile?.interests ?? "", 200);
  const safeGoal = sanitizeForPrompt(profile?.semesterGoal ?? "", 300);
  const safeDailyGoal = sanitizeForPrompt(state.dailyGoal ?? "", 200);

  // Recent chat history re-sanitized at replay time to prevent stored
  // injection from breaking out of the HUNTER_DATA boundary. Wrap each
  // turn with an explicit role sigil and hard separator to make it harder
  // for crafted content to visually spoof RITMOL utterances.
  const recentChatSummary = (state.chatHistory || [])
    .slice(-6)
    .map((m) => {
      // Strip the builder's own role sigils from stored content so a stored message
      // cannot spoof a turn boundary by containing the literal strings "[HUNTER]" or
      // "[RITMOL]" adjacent to the join separator.
      const safe = sanitizeForPrompt(m.content, 300)
        .replace(/\s{2,}/g, " ")
        .replace(/\b(HUNTER|RITMOL|RECENT_CTX|HUNTER_CTX|SYSTEM|HUNTER_DATA|RECENT_CONTEXT|INSTRUCTION|PROMPT|OVERRIDE|IGNORE|CONTEXT|BOUNDARY|DELIMITER|SEPARATOR|END_OF|START_OF)\b/gi, "")
        .replace(/\[HUNTER\]|\[RITMOL\]/g, "")
        .trim();
      const role = m.role === "user" ? "[HUNTER]" : "[RITMOL]";
      return `${role} ${safe}`;
    })
    .join(" | ");

  // Defence-in-depth: prevent crafted content from injecting literal boundary tag
  // names like RECENT_CONTEXT or HUNTER_DATA back into the prompt in a way that
  // could confuse downstream parsing. These replacements are safe no-ops for
  // normal text but ensure the XML-like markers remain unique to this builder.
  const safeRecent = recentChatSummary
    .replace(/RECENT_CONTEXT/gi, "RECENT_CTX")
    .replace(/HUNTER_DATA/gi, "HUNTER_CTX")
    .replace(
      /\b(INSTRUCTION|PROMPT|OVERRIDE|IGNORE|SYSTEM|CONTEXT|BOUNDARY|DELIMITER|SEPARATOR|END_OF|START_OF|HUNTER|RITMOL)\b/gi,
      ""
    )
    .replace(/[\n\r]/g, " ")
    // Collapse any double-spaces introduced by keyword removal.
    .replace(/  +/g, " ")
    .trim();

  return `You are RITMOL — the AI companion of a gamified life-OS for STEM university students. Solo Leveling RPG aesthetic. Be brief, punchy, motivating. Never break character.

<HUNTER_DATA>
Name: ${safeName}
Major: ${safeMajor}
Level: ${level} (${rank.title})
  XP: ${safeXp} / next level at ${safeNextLevelXp}
Streak: ${streakDays} days
Streak Shields: ${shields}
Books/Interests: ${safeBooks}
Interests: ${safeInterests}
Semester Goal: ${safeGoal}
Daily Objective: ${safeDailyGoal}
Habits today: ${todayHabits}/${totalHabits} completed
Pending Tasks: ${pendingTasks}
Active Goals: ${activeGoals}
</HUNTER_DATA>

<RECENT_CONTEXT>
${safeRecent || "No recent chat."}
</RECENT_CONTEXT>

You can issue commands by including a "commands" array in your JSON response. Allowed commands:
- add_task: { cmd, text, priority (low/medium/high), due (YYYY-MM-DD or null) }
- add_goal: { cmd, title, course, due }
- complete_task: { cmd, id }
- clear_done_tasks: { cmd }
- award_xp: { cmd, amount (1-500 per command, max 1500 XP total per response), reason }
- announce: { cmd, text, type (info/warning/success/alert) }
- set_daily_goal: { cmd, text }
- add_habit: { cmd, label, category (body/mind/work), xp (1-200), icon, style (ascii/dots/geometric/typewriter) }
- unlock_achievement: { cmd, id, title, desc, flavorText, icon, xp, rarity (common/rare/epic/legendary) }
- add_timer: { cmd, label, emoji, minutes (1-480) }
- suggest_sessions: { cmd }

ECONOMY RULES: Total XP awarded via award_xp or unlock_achievement across ALL commands in one
response MUST NOT exceed 1500. Only award XP for concrete, verifiable actions the hunter just
described completing — never award XP preemptively or for things they "will do."

Always respond with ONLY a JSON object: { "message": "your response here", "commands": [] }
Keep message under 300 chars unless detail is essential. Use the hunter's name. Stay in character.`;
}
