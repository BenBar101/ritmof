// ═══════════════════════════════════════════════════════════════
// SYNC MANAGER  (File System Access API + fallback download/import)
// ═══════════════════════════════════════════════════════════════
// Security model:
//   - Key allowlist: only SYNC_KEYS are written from an incoming payload.
//   - Schema version check: files from older schema versions are rejected.
//   - Per-key validators (SYNC_VALIDATORS): range, length, shape checks.
//   - Prototype pollution guard: __proto__ / constructor / prototype rejected.
//   - Payload size cap: >10 MB rejected before any write.
//   - geminiKey and googleClientId are read from the file into sessionStorage
//     but NEVER written back out on Push.
// ═══════════════════════════════════════════════════════════════

import { LS, storageKey, setGeminiApiKey, IS_DEV, DEV_PREFIX, today, todayUTC } from "../utils/storage";

// ── Schema version ──────────────────────────────────────────────
export const SYNC_SCHEMA_VERSION = 1;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Storage key for the persisted file handle ────────────────────
const HANDLE_LS_KEY = IS_DEV ? `${DEV_PREFIX}sync_handle` : "sync_handle";

// ── Feature detection ────────────────────────────────────────────
export const FSAPI_SUPPORTED =
  typeof window !== "undefined" &&
  typeof window.showOpenFilePicker === "function" &&
  typeof window.showSaveFilePicker === "function";

// ── Keys written to / read from sync file ────────────────────────
export const SYNC_KEYS = [
  "jv_profile", "jv_xp", "jv_streak", "jv_shields", "jv_last_login",
  "jv_habits", "jv_habit_log", "jv_tasks", "jv_goals", "jv_sessions",
  "jv_achievements", "jv_gacha", "jv_cal_events", "jv_chat",
  "jv_daily_goal", "jv_timers", "jv_sleep_log", "jv_screen_log",
  "jv_missions", "jv_mission_date", "jv_habit_suggestions",
  "jv_chronicles", "jv_gcal_connected", "jv_token_usage",
  "jv_habits_init", "jv_dynamic_costs", "jv_last_shield_use_date",
  "jv_max_date_seen", "jv_last_shield_buy_date",
];

// ── Simple per-key validators ─────────────────────────────────────
const isString = (v) => typeof v === "string";
const isNumber = (v) => typeof v === "number" && isFinite(v);
const isBool   = (v) => typeof v === "boolean";
const isArray  = (v) => Array.isArray(v);
const isObj    = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDateStr = (v) => isString(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isNullOrDateStr = (v) => v === null || isDateStr(v);
const MAX_LOG_ENTRIES = 800; // ~2 years of daily entries
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOG_VALUE_SIZE = 4096; // per-entry byte cap to prevent log value bloat
const MAX_LOG_OBJECT_BYTES = MAX_LOG_VALUE_SIZE * MAX_LOG_ENTRIES;

function isLogObj(v) {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > MAX_LOG_ENTRIES) return false;
  let totalBytes = 0;
  for (const k of keys) {
    if (!DATE_KEY_RE.test(k)) return false;
    const val = v[k];
    // Allow: null, bool, number — do not contribute to byte budget.
    if (val === null || typeof val === "boolean" || typeof val === "number") continue;

    let size = 0;
    if (typeof val === "string") {
      if (val.length > MAX_LOG_VALUE_SIZE) return false;
      size = val.length;
    } else if (Array.isArray(val)) {
      if (val.length > 200) return false;
      // Each array item must be a non-empty string of reasonable length so that
      // habit IDs or similar keys cannot be replaced with arbitrary objects that
      // bypass includes() checks in the app logic.
      if (!val.every((item) => typeof item === "string" && item.length > 0 && item.length <= 64)) return false;
      const serialized = JSON.stringify(val);
      if (serialized.length > MAX_LOG_VALUE_SIZE) return false;
      size = serialized.length;
    } else if (isObj(val)) {
      const serialized = JSON.stringify(val);
      if (serialized.length > MAX_LOG_VALUE_SIZE) return false;
      size = serialized.length;
    } else {
      return false;
    }

    totalBytes += size;
    if (totalBytes > MAX_LOG_OBJECT_BYTES) return false;
  }
  return true;
}

export const SYNC_VALIDATORS = {
  jv_profile:             (v) => {
    if (v === null) return true;
    if (!isObj(v)) return false;
    if (Object.prototype.hasOwnProperty.call(v, "geminiKey")) return false;
    if (Object.prototype.hasOwnProperty.call(v, "googleClientId")) return false;
    if (v.name !== undefined && !(typeof v.name === "string" && v.name.length <= 60)) return false;
    if (v.major !== undefined && !(typeof v.major === "string" && v.major.length <= 80)) return false;
    if (v.interests !== undefined && !(typeof v.interests === "string" && v.interests.length <= 200)) return false;
    if (v.books !== undefined && !(typeof v.books === "string" && v.books.length <= 200)) return false;
    if (v.semesterGoal !== undefined && !(typeof v.semesterGoal === "string" && v.semesterGoal.length <= 300)) return false;
    return true;
  },
  // Fix: add upper bounds — a crafted sync file with jv_xp: 1e18 would
  // otherwise instantly grant max level or an implausible streak/shield count.
  jv_xp:                  (v) => isNumber(v) && v >= 0 && v <= 100_000_000,
  jv_streak:              (v) => isNumber(v) && v >= 0 && v <= 36500,
  jv_shields:             (v) => isNumber(v) && v >= 0 && v <= 10000,
  // NOTE: todayUTC() is called lazily inside the lambda (at validation time).
  // Do NOT hoist it to a module-level const — it would capture the date at startup.
  // Using UTC here keeps last-login anti-cheat checks consistent across devices.
  jv_last_login:          (v) => v === null || (isDateStr(v) && v <= todayUTC()),
  jv_habits:              (v) => isArray(v) && v.length <= 500 && v.every((h) =>
    isObj(h) &&
    typeof h.id === "string" && h.id.length <= 64 && /^[\w-]+$/.test(h.id) &&
    typeof h.label === "string" && h.label.length <= 200 &&
    typeof h.xp === "number" && isFinite(h.xp) && h.xp >= 1 && h.xp <= 200 &&
    ["body","mind","work"].includes(h.category) &&
    (h.icon === undefined || (typeof h.icon === "string" && h.icon.length <= 2))
  ),
  jv_habit_log:           (v) => isLogObj(v),
  jv_tasks:               (v) => isArray(v) && v.length <= 5000 && v.every((t) =>
    isObj(t) &&
    typeof t.id === "string" && t.id.length <= 64 && /^[\w-]+$/.test(t.id) &&
    typeof t.text === "string" && t.text.length <= 500 &&
    typeof t.done === "boolean" &&
    (t.priority === undefined || ["low","medium","high"].includes(t.priority)) &&
    (t.due === null || t.due === undefined || (typeof t.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due)))
  ),
  jv_goals:               (v) => isArray(v) && v.length <= 1000 && v.every((g) =>
    isObj(g) &&
    typeof g.id === "string" && g.id.length <= 64 && /^[\w-]+$/.test(g.id) &&
    typeof g.title === "string" && g.title.length <= 200 &&
    typeof g.done === "boolean" &&
    (g.course === undefined || (typeof g.course === "string" && g.course.length <= 100)) &&
    (g.due === null || g.due === undefined || (typeof g.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.due))) &&
    (g.addedBy === undefined || ["user","ritmol","system"].includes(g.addedBy))
  ),
  jv_sessions:            (v) => isArray(v) && v.length <= 10000 && v.every((s) =>
    isObj(s) &&
    typeof s.id === "string" && s.id.length <= 64 && /^[\w-]+$/.test(s.id) &&
    (s.date === undefined || (typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date))) &&
    (s.course === undefined || (typeof s.course === "string" && s.course.length <= 100)) &&
    (s.notes === undefined || (typeof s.notes === "string" && s.notes.length <= 300)) &&
    (s.duration === undefined || (typeof s.duration === "number" && isFinite(s.duration) && s.duration >= 0 && s.duration <= 600)) &&
    (s.type === undefined || ["lecture","self_study","project","exam_prep"].includes(s.type))
  ),
  jv_achievements:        (v) => isArray(v) && v.length <= 2000 && v.every((a) =>
    isObj(a) &&
    typeof a.id === "string" && a.id.length <= 100 && /^[\w-.:@]+$/.test(a.id) &&
    typeof a.title === "string" && a.title.length <= 300 &&
    (a.desc        === undefined || (typeof a.desc        === "string" && a.desc.length        <= 300)) &&
    (a.flavorText  === undefined || (typeof a.flavorText  === "string" && a.flavorText.length  <= 300)) &&
    (a.icon        === undefined || (typeof a.icon        === "string" && a.icon.length        <= 2)) &&
    (a.xp === undefined || (typeof a.xp === "number" && isFinite(a.xp) && a.xp >= 0 && a.xp <= 500)) &&
    (a.rarity === undefined || ["common","rare","epic","legendary"].includes(a.rarity))
  ),
  jv_gacha:               (v) => isArray(v) && v.length <= 2000 && v.every((c) =>
    isObj(c) &&
    typeof c.id === "string" && c.id.length <= 80 && /^[\w-]+$/.test(c.id) &&
    ["rank_cosmetic","chronicle"].includes(c.type) &&
    ["common","rare","epic","legendary"].includes(c.rarity) &&
    (typeof c.content === "string" && c.content.length <= 1000) &&
    (c.asciiArt === null || c.asciiArt === undefined || (typeof c.asciiArt === "string" && c.asciiArt.length <= 500))
  ),
  jv_cal_events:          (v) => isArray(v) && v.length <= 2000 && v.every((e) =>
    isObj(e) &&
    typeof e.id === "string" && e.id.length <= 150 &&
    typeof e.title === "string" && e.title.length <= 200 &&
    (e.start === null || (typeof e.start === "string" && !isNaN(new Date(e.start).getTime()))) &&
    (e.type === undefined || ["lecture","tirgul","exam","assignment","other"].includes(e.type))
  ),
  jv_chat:                (v) => {
    if (!isArray(v)) return false;
    if (v.length > 5000) return false;
    return v.every(item => {
      if (!isObj(item)) return false;
      if (!['user', 'assistant'].includes(item.role)) return false;
      if (typeof item.content !== 'string') return false;
      if (item.content.length > 4000) return false; // ~1k token cap per message
      // Reject stored chat messages that contain control characters, BiDi overrides,
      // or zero-width characters. These should never be persisted; callers must
      // re-enter clean content instead of silently sanitizing dangerous payloads.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/.test(item.content)) return false;
      if (item.ts !== undefined && !(typeof item.ts === 'number' && isFinite(item.ts) && item.ts > 0)) return false;
      if (item.date !== undefined && !(typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date))) return false;
      return true;
    });
  },
  // Fix: accept null for unset state in addition to non-empty strings.
  jv_daily_goal:          (v) => v === null || (isString(v) && v.length <= 500),
  jv_timers:              (v) => isArray(v) && v.length <= 50 && v.every((t) =>
    isObj(t) &&
    typeof t.id === "string" && t.id.length <= 64 &&
    typeof t.label === "string" && t.label.length <= 300 &&
    typeof t.endsAt === "number" && isFinite(t.endsAt) && t.endsAt > 0 && t.endsAt <= Date.now() + 172_800_000 &&
    (t.emoji === undefined || (typeof t.emoji === "string" && t.emoji.length <= 2))
  ),
  jv_sleep_log:           (v) => isLogObj(v),
  jv_screen_log:          (v) => isLogObj(v),
  jv_missions:            (v) => {
    if (v === null) return true;
    if (!isArray(v) || v.length > 20) return false;
    return v.every((m) =>
      isObj(m) &&
      typeof m.id === "string" && m.id.length <= 40 &&
      typeof m.desc === "string" && m.desc.length <= 200 &&
      typeof m.xp === "number" && isFinite(m.xp) && m.xp >= 0 && m.xp <= 2000 &&
      typeof m.done === "boolean" &&
      ["habits", "session", "task", "chat"].includes(m.type) &&
      typeof m.target === "number" && isFinite(m.target) && m.target >= 0 && m.target <= 100
    );
  },
  jv_mission_date:        (v) => v === null || (isDateStr(v) && v <= today()),
  jv_habit_suggestions:   (v) => isArray(v) && v.length <= 200 && v.every((s) =>
    typeof s === "string" && s.length <= 200
  ),
  jv_chronicles:          (v) => isArray(v) && v.length <= 500 && v.every((c) =>
    isObj(c) &&
    typeof c.id === "string" && c.id.length <= 80 &&
    (c.content === undefined || (typeof c.content === "string" && c.content.length <= 2000)) &&
    (c.date === undefined || (typeof c.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date))) &&
    (c.title  === undefined || (typeof c.title  === "string" && c.title.length  <= 120)) &&
    (c.source === undefined || (typeof c.source === "string" && c.source.length <= 120))
  ),
  jv_gcal_connected:      (v) => isBool(v),
  // NOTE: today() is called lazily inside the lambda (at validation time).
  // Do NOT hoist it to a module-level const — it would capture the date at startup.
  jv_token_usage:         (v) => {
    if (!isObj(v)) return false;
    // date is REQUIRED — a token_usage object without a date would bypass
    // daily budget checks when compared against todayUTC().
    if (!isDateStr(v.date)) return false;
    // Reject future dates using a UTC comparison so timezone changes cannot
    // be abused to bypass the daily budget.
    if (v.date > todayUTC()) return false;
    // Fix [S-1]: add upper bounds on tokens and aiXpToday. Without them, a crafted
    // sync file can set tokens to 9 999 999, permanently disabling all AI features,
    // or set aiXpToday to 9 999 999, permanently blocking AI XP awards.
    if (v.tokens !== undefined && !(isNumber(v.tokens) && v.tokens >= 0 && v.tokens <= 10_000_000)) return false;
    if (v.aiXpToday !== undefined && !(isNumber(v.aiXpToday) && v.aiXpToday >= 0 && v.aiXpToday <= 1_000_000)) return false;
    // warnedAt must be an array of safe numeric percentage values (50, 80, 99, etc.)
    if (v.warnedAt !== undefined && !(isArray(v.warnedAt) && v.warnedAt.length <= 20 && v.warnedAt.every(x => typeof x === "number" && isFinite(x) && x >= 0 && x <= 99))) return false;
    return true;
  },
  jv_habits_init:         (v) => isBool(v),
  // Fix: validate dynamic cost fields and enforce the same numeric bounds as
  // dynamicCosts.js so a crafted sync file cannot smuggle out-of-range economy
  // values past this validator.
  jv_dynamic_costs:       (v) => {
    if (v === null) return true;
    if (!isObj(v)) return false;
    if (v.xpPerLevel !== undefined && !(isNumber(v.xpPerLevel) && v.xpPerLevel >= 200 && v.xpPerLevel <= 10000)) return false;
    if (v.gachaCost !== undefined && !(isNumber(v.gachaCost) && v.gachaCost >= 50 && v.gachaCost <= 5000)) return false;
    if (v.streakShieldCost !== undefined && !(isNumber(v.streakShieldCost) && v.streakShieldCost >= 100 && v.streakShieldCost <= 5000)) return false;
    return true;
  },
  jv_last_shield_use_date:(v) => isNullOrDateStr(v),
  jv_max_date_seen:       (v) => v === null || (isDateStr(v) && v <= todayUTC()),
  jv_last_shield_buy_date:(v) => v === null || (isDateStr(v) && v <= todayUTC()),
};

// ── Prototype pollution guard ─────────────────────────────────────
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafeSyncValue(v, depth = 0) {
  if (depth >= 6) return false;
  if (isObj(v)) {
    for (const k of Object.getOwnPropertyNames(v)) {
      if (DANGEROUS_KEYS.has(k)) return false;
      if (!isSafeSyncValue(v[k], depth + 1)) return false;
    }
  } else if (isArray(v)) {
    for (const item of v) {
      // Arrays do not add a depth level — only object nesting does.
      if (!isSafeSyncValue(item, depth)) return false;
    }
  }
  return true;
}

// ── Payload size guard ────────────────────────────────────────────
export function assertPayloadSize(text) {
  // TextEncoder measures UTF-8 bytes — correct for file-size comparison since
  // FileSystemWritableFileStream.write() encodes strings to UTF-8.
  if (typeof text === "string" && new TextEncoder().encode(text).length > MAX_PAYLOAD_BYTES) {
    throw new Error("SYNC_FILE_TOO_LARGE");
  }
}

// ── Persist / restore file handle via IndexedDB ───────────────────
// File handles can't be stored in localStorage, use IndexedDB.
let _cachedHandle = null;
let _opInProgress = false;
let _broadcastChannel = null;
let _lastPushTime = 0;

function getSyncChannel() {
  if (!_broadcastChannel && typeof BroadcastChannel !== "undefined") {
    _broadcastChannel = new BroadcastChannel("ritmol_sync");
    _broadcastChannel.addEventListener("message", (e) => {
      if (e.data?.type === "sync_start" && !_opInProgress) {
        _opInProgress = true;
        setTimeout(() => { _opInProgress = false; }, 5000);
      }
    });
  }
  return _broadcastChannel;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ritmol_sync_v1", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandleToDB(handle) {
  try {
    const db = await openDB();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(handle, HANDLE_LS_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch { /* silently ignore — handle won't persist across sessions */ }
}

async function loadHandleFromDB() {
  try {
    const db = await openDB();
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(HANDLE_LS_KEY);
    return await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => rej(req.error);
    });
  } catch { return null; }
}

async function clearHandleFromDB() {
  try {
    const db = await openDB();
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").delete(HANDLE_LS_KEY);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch { /* ignore */ }
}

// ── Build sync payload from localStorage ─────────────────────────
function buildPayload() {
  const payload = { _schemaVersion: SYNC_SCHEMA_VERSION };
  for (const key of SYNC_KEYS) {
    let stored = LS.get(storageKey(key));
    if (stored === null && IS_DEV) {
      const unprefixed = LS.get(key);
      if (unprefixed !== null) {
        console.warn(`[SyncManager] Key "${key}" found at unprefixed location. Consider clearing storage.`);
        stored = unprefixed;
      }
    }
    if (stored !== null && stored !== undefined) {
      if (key === "jv_profile" && stored && typeof stored === "object") {
        // eslint-disable-next-line no-unused-vars
        const { geminiKey: _gk, googleClientId: _gc, ...safeProfile } = stored;
        stored = safeProfile;
      }
      payload[key] = stored;
    }
  }
  return payload;
}

// ── Apply validated payload to localStorage ───────────────────────
function applyPayload(payload) {
  // Estimate quota risk using UTF-16 storage approximation: browsers store
  // localStorage as UTF-16 (2 bytes per code unit), so we use (length * 2)
  // instead of UTF-8 TextEncoder bytes here. This keeps the 4.5 MB guard
  // meaningfully below typical 10 MB limits on ASCII-heavy data.
  const payloadSize = JSON.stringify(payload).length * 2;
  let lsUsed = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      const v = localStorage.getItem(k) ?? "";
      lsUsed += (k.length + v.length) * 2;
    }
  } catch {
    // ignore estimation failures
  }
  if (lsUsed + payloadSize > 4.5 * 1024 * 1024) {
    throw new Error("APPLY_QUOTA_RISK");
  }

  for (const key of SYNC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    let val = payload[key];
    if (key === "jv_profile" && val && typeof val === "object") {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _gk, googleClientId: _gc, ...safeProfile } = val;
      val = safeProfile;
    }
    const validator = SYNC_VALIDATORS[key];
    if (validator && !validator(val)) continue;
    if (!isSafeSyncValue(val)) continue;
    LS.set(storageKey(key), val);
  }
}

// ── Parse and validate incoming JSON text ─────────────────────────
function parseAndValidate(text) {
  assertPayloadSize(text);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("CORRUPT_FILE");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("CORRUPT_FILE");
  }
  // Fix: the previous check `DANGEROUS_KEYS.has("__proto__")` was always true
  // (a dead condition). The actual guard is isSafeSyncValue which traverses the
  // entire payload tree looking for dangerous keys.
  if (!isSafeSyncValue(payload)) {
    throw new Error("CORRUPT_FILE");
  }
  const schemaVersion = payload._schemaVersion;
  // Fix: also reject schemaVersion < 1 (zero, negative, or NaN) — only positive
  // integer values up to SYNC_SCHEMA_VERSION are valid.
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) ||
      schemaVersion < 1 || schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error("SYNC_SCHEMA_OUTDATED");
  }
  return payload;
}

// ── Read geminiKey / googleClientId into sessionStorage ───────────
function extractSecretsFromPayload(payload) {
    if (typeof payload.geminiKey === "string") {
      const trimmed = payload.geminiKey.trim();
      // Accept a range of plausible key lengths so future format changes don't
      // silently break the config gate. We never log the key value itself.
      if (/^AIza[A-Za-z0-9_-]{30,50}$/.test(trimmed)) {
        setGeminiApiKey(trimmed);
      } else {
        // Key was present but failed the format check — surface a console warning
        // so developers can debug why the config gate is still shown.
        console.warn("[SyncManager] geminiKey present in sync file but did not match expected format. App will show config gate.");
      }
    }
  // googleClientId is intentionally not stored here — it would be
  // placed in a dedicated session key if implemented.
}

// ── SyncManager public API ────────────────────────────────────────
export const SyncManager = {
  /** Returns the current FileSystemFileHandle, or null if none linked. */
  async getHandle() {
    if (_cachedHandle) return _cachedHandle;
    _cachedHandle = await loadHandleFromDB();
    return _cachedHandle;
  },

  /** Open a file picker and persist the chosen handle. */
  async pickFile() {
    if (!FSAPI_SUPPORTED) throw new Error("FSAPI_NOT_SUPPORTED");
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "RITMOL data", accept: { "application/json": [".json"] } }],
      multiple: false,
    });
    _cachedHandle = handle;
    await saveHandleToDB(handle);
    return handle;
  },

  /** Write current localStorage state to the linked sync file. */
  async push() {
    const handle = await SyncManager.getHandle();
    if (!handle) throw new Error("NO_HANDLE");
    if (_opInProgress) throw new Error("SYNC_BUSY");
    const ch = getSyncChannel();
    ch?.postMessage({ type: "sync_start" });
    _opInProgress = true; // acquire BEFORE any await
    try {
      let perm;
      try {
        perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
          perm = await handle.requestPermission({ mode: "readwrite" });
        }
      } catch {
        throw new Error("PERMISSION_DENIED");
      }
      if (perm !== "granted") throw new Error("PERMISSION_DENIED");

      // Last-writer conflict guard: if the backing file was modified very
      // recently by another tab (within ~800ms), skip this push to avoid
      // clobbering fresh data with a stale snapshot.
      try {
        const currentFile = await handle.getFile();
        const lastMod = currentFile.lastModified;
        if (Date.now() - lastMod < 2000 && lastMod > _lastPushTime) {
          // 2 s window: some filesystems (e.g. FAT32) have 2-second lastModified
          // resolution; 800 ms was too tight and caused false-positive skips.
          console.warn("[SyncManager] Skipping push — file was recently modified by another tab.");
          const ts = Date.now();
          return ts;
        }
      } catch {
        // If we can't read lastModified, fall through and attempt the push.
      }

      const payload = buildPayload();
      const text = JSON.stringify(payload, null, 2);
      assertPayloadSize(text);

      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();

      const ts = Date.now();
      _lastPushTime = ts;
      LS.set(IS_DEV ? `${DEV_PREFIX}jv_last_synced` : "jv_last_synced", String(ts));
      return ts;
    } finally {
      _opInProgress = false;
    }
  },

  /** Read the linked sync file and apply it to localStorage. */
  async pull() {
    const handle = await SyncManager.getHandle();
    if (!handle) throw new Error("NO_HANDLE");
    if (_opInProgress) throw new Error("SYNC_BUSY");

    _opInProgress = true;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const payload = parseAndValidate(text);
      extractSecretsFromPayload(payload);
      applyPayload(payload);

      const ts = Date.now();
      return ts;
    } finally {
      _opInProgress = false;
    }
  },

  /** Import from a file picker (fallback for browsers without FSAPI write). */
  async importFile(file) {
    if (_opInProgress) throw new Error("SYNC_BUSY");
    _opInProgress = true;
    try {
      const text = await file.text();
      const payload = parseAndValidate(text);
      extractSecretsFromPayload(payload);
      applyPayload(payload);
      return Date.now();
    } finally {
      _opInProgress = false;
    }
  },

  /** Download current state as a JSON file (fallback for browsers without FSAPI write). */
  download(onError) {
    const payload = buildPayload();
    const text = JSON.stringify(payload, null, 2);
    try {
      assertPayloadSize(text);
    } catch {
      onError?.("Export file too large (> 10 MB). Clear old chat history or sessions first.");
      return;
    }
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ritmol-data.json";
    // Fix: append the anchor to the document before clicking — detached anchors are
    // silently ignored by Firefox and some other browsers, causing the download to
    // never start. Remove after click so it doesn't linger in the DOM.
    a.style.display = "none";
    document.body.appendChild(a);
    // WARNING: a.click() must be synchronously reachable from a user gesture on
    // iOS Safari. Do NOT add any await or setTimeout before this call or the
    // download will silently fail on those browsers.
    a.click();
    document.body.removeChild(a);
    // Allow extra time for large files to be saved before revoking the URL.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },

  /** Forget the linked sync file handle. */
  async forget() {
    _cachedHandle = null;
    await clearHandleFromDB();
  },
};
