import { LS, storageKey } from "../utils/storage";
import { setGeminiApiKey } from "../utils/storage";

// ═══════════════════════════════════════════════════════════════
// SYNCTHING FILE SYNC (File System Access API)
// ═══════════════════════════════════════════════════════════════
const IS_DEV = import.meta.env.DEV === true;

const IDB_DB_NAME = "ritmol_sync";
const IDB_STORE   = "handles";
const IDB_KEY     = IS_DEV ? "syncFile_dev" : "syncFile";

let _idbPromise = null;
function openIDB() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => { _idbPromise = null; reject(e.target.error); };
  });
  return _idbPromise;
}

async function idbGet(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbDel(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export const FSAPI_SUPPORTED = typeof window !== "undefined" && "showOpenFilePicker" in window;

// Sync file size cap: 10 MB to prevent sync blocking
const MAX_SYNC_FILE_BYTES = 10 * 1024 * 1024;

const SYNC_KEYS = [
  "jv_profile","jv_xp","jv_streak","jv_shields","jv_last_login",
  "jv_habits","jv_habit_log","jv_tasks","jv_goals","jv_sessions",
  "jv_achievements","jv_gacha","jv_cal_events","jv_chat","jv_daily_goal",
  "jv_sleep_log","jv_screen_log","jv_missions","jv_mission_date",
  "jv_chronicles","jv_gcal_connected","jv_habits_init","jv_token_usage",
  "jv_dynamic_costs","jv_last_shield_use_date",
  "jv_timers",
  "jv_habit_suggestions",
  // NOTE: geminiKey is intentionally NOT synced
  // NOTE: jv_last_synced is intentionally NOT in SYNC_KEYS — it is device-local metadata
];

const SYNC_SCHEMA_VERSION = 1;

function buildSyncPayload() {
  const payload = { _syncedAt: Date.now(), _schemaVersion: SYNC_SCHEMA_VERSION };
  SYNC_KEYS.forEach((k) => {
    const raw = localStorage.getItem(storageKey(k));
    if (raw === null) return;
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    // defence-in-depth — strip geminiKey from profile even if a writer forgot to
    if (k === "jv_profile" && value !== null && typeof value === "object" && !Array.isArray(value) && "geminiKey" in value) {
      const { geminiKey: _skip, ...rest } = value;
      value = rest;
    }
    payload[k] = value;
  });
  return payload;
}

// Fix #14: check payload size before writing so a push() that would produce an
// oversized file is caught early rather than leaving the sync file in a state where
// pull() rejects it with SYNC_FILE_TOO_LARGE on every subsequent device.
function assertPayloadSize(payload) {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized.length > MAX_SYNC_FILE_BYTES) {
    throw new Error("SYNC_PAYLOAD_TOO_LARGE");
  }
  return serialized;
}

const MAX_SYNC_VALUE_SIZE = 2_000_000;
const PROTO_POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isSafeSyncValue(v) {
  if (v === undefined) return false;
  if (v === null) return true;
  const type = typeof v;
  if (type === "string") return v.length <= MAX_SYNC_VALUE_SIZE;
  if (type === "number" || type === "boolean") return true;
  if (Array.isArray(v) || type === "object") {
    try {
      const serialized = JSON.stringify(v);
      if (serialized.length > MAX_SYNC_VALUE_SIZE) return false;
      JSON.parse(serialized, (key, val) => {
        if (PROTO_POISON_KEYS.has(key)) throw new Error("Prototype pollution key: " + key);
        return val;
      });
      return true;
    } catch { return false; }
  }
  return false;
}

// Fix #13: added validators for boolean flags jv_habits_init and jv_gcal_connected,
// and for jv_mission_date (same date-string pattern as jv_last_login).
// Fix #4: jv_chat now enforces a per-message content length cap (10 000 chars) so a
// crafted sync file cannot insert huge messages that exhaust the daily token budget.
// Fix #6: jv_token_usage now enforces structure, value ranges, and an allowed-key
// whitelist so a crafted file cannot reset the date to the future or pre-fill aiXpToday.
const SYNC_VALIDATORS = {
  jv_xp:         (v) => typeof v === "number" && v >= 0 && v < 10_000_000,
  jv_streak:     (v) => typeof v === "number" && v >= 0 && v < 10_000,
  jv_shields:    (v) => typeof v === "number" && v >= 0 && v < 1_000,
  jv_habits:     (v) => Array.isArray(v) && v.length <= 200 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.label === "string" && typeof i.xp === "number"),
  jv_tasks:      (v) => Array.isArray(v) && v.length <= 2_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.text === "string" && i.text.length <= 2000),
  jv_goals:      (v) => Array.isArray(v) && v.length <= 1_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.title === "string" && i.title.length <= 2000),
  jv_sessions:   (v) => Array.isArray(v) && v.length <= 5_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.type === "string" && typeof i.date === "string"),
  jv_achievements:(v) => Array.isArray(v) && v.length <= 10_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.title === "string"),
  jv_gacha:      (v) => Array.isArray(v) && v.length <= 10_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i)),
  jv_habit_log:  (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  jv_sleep_log:  (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  jv_screen_log: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  jv_profile:    (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const ALLOWED_PROFILE_KEYS = new Set(["name","major","books","interests","semesterGoal","university","year"]);
    const keys = Object.keys(v);
    if (keys.length > 20) return false;
    for (const k of keys) {
      if (!ALLOWED_PROFILE_KEYS.has(k)) return false;
      const val = v[k];
      if (val !== null && val !== undefined && typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") return false;
      if (typeof val === "string" && val.length > 1000) return false;
    }
    return true;
  },
  // Fix #6: enforce structure, date format, numeric bounds, and key whitelist on
  // jv_token_usage so a crafted sync file cannot reset the daily counter to a future
  // date (disabling AI) or pre-fill aiXpToday to block legitimate XP awards.
  jv_token_usage: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const ALLOWED_USAGE_KEYS = new Set(["date","tokens","warnedAt","aiXpToday"]);
    for (const k of Object.keys(v)) {
      if (!ALLOWED_USAGE_KEYS.has(k)) return false;
    }
    if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return false;
    if (typeof v.tokens !== "number" || v.tokens < 0 || v.tokens > 10_000_000) return false;
    if (v.warnedAt !== undefined && !Array.isArray(v.warnedAt)) return false;
    if (v.aiXpToday !== undefined && (typeof v.aiXpToday !== "number" || v.aiXpToday < 0 || v.aiXpToday > 100_000)) return false;
    return true;
  },
  jv_daily_goal: (v) => typeof v === "string" && v.length <= 500,
  jv_last_login: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  // Fix #4: cap per-message content at 10 000 chars to prevent token-budget exhaustion
  // via a crafted sync file that embeds a huge message in chat history.
  jv_chat:       (v) => Array.isArray(v) && v.length <= 2_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.role === "string" && typeof i.content === "string" && i.content.length <= 10_000),
  jv_chronicles: (v) => Array.isArray(v) && v.length <= 2_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i)),
  jv_missions:   (v) => Array.isArray(v) || v === null,
  jv_cal_events: (v) => Array.isArray(v) && v.length <= 500 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.title === "string"),
  jv_dynamic_costs: (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const a = v.xpPerLevel, b = v.gachaCost, c = v.streakShieldCost;
    return typeof a === "number" && a >= 200 && a <= 10000 &&
           typeof b === "number" && b >= 50 && b <= 5000 &&
           typeof c === "number" && c >= 100 && c <= 5000;
  },
  jv_last_shield_use_date: (v) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)),
  jv_timers:           (v) => Array.isArray(v) && v.length <= 100 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i)),
  jv_habit_suggestions:(v) => Array.isArray(v) && v.length <= 200 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i)),
  // Fix #13: boolean flag validators
  jv_habits_init:   (v) => typeof v === "boolean",
  jv_gcal_connected:(v) => typeof v === "boolean",
  // Fix #13: date-string validator for mission date
  jv_mission_date:  (v) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)),
};

function parseSyncValue(k, v) {
  if (typeof v !== "string") return v;
  if (!SYNC_VALIDATORS[k]) return v;
  try { return JSON.parse(v); } catch { return v; }
}

function applySyncPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const remoteVersion = typeof payload._schemaVersion === "number" ? payload._schemaVersion : 0;
  if (remoteVersion < SYNC_SCHEMA_VERSION) {
    console.warn(`applySyncPayload: remote schema version ${remoteVersion} < local ${SYNC_SCHEMA_VERSION}. Rejecting to avoid data corruption.`);
    throw new Error("SYNC_SCHEMA_OUTDATED");
  }
  if (remoteVersion > SYNC_SCHEMA_VERSION) {
    console.warn(`applySyncPayload: remote schema version ${remoteVersion} > local ${SYNC_SCHEMA_VERSION}. Update the app first.`);
    return;
  }
  const allowedSet = new Set(SYNC_KEYS);
  Object.entries(payload).forEach(([k, v]) => {
    if (!allowedSet.has(k)) return;
    if (!isSafeSyncValue(v)) return;
    let value = parseSyncValue(k, v);
    const validator = SYNC_VALIDATORS[k];
    if (validator && !validator(value)) {
      console.warn(`applySyncPayload: rejected invalid value for key "${k}"`);
      return;
    }
    if (k === "jv_profile") {
      let profileObj = value;
      if (typeof profileObj === "string") {
        try { profileObj = JSON.parse(profileObj); } catch { profileObj = value; }
      }
      if (profileObj !== null && typeof profileObj === "object" && !Array.isArray(profileObj) && "geminiKey" in profileObj) {
        const { geminiKey: _skip, ...rest } = profileObj;
        value = rest;
      }
    }
    LS.set(storageKey(k), value);
  });
}

// ═══════════════════════════════════════════════════════════════
// SyncManager — all file operations go through here.
// ═══════════════════════════════════════════════════════════════
export const SyncManager = {
  async getHandle() {
    try { return await idbGet(IDB_KEY); } catch { return null; }
  },

  async pickFile() {
    if (!FSAPI_SUPPORTED) throw new Error("FILE_API_UNSUPPORTED");
    const [handle] = await window.showOpenFilePicker({
      id: "ritmol-sync",
      startIn: "documents",
      types: [{ description: "RITMOL data", accept: { "application/json": [".json"] } }],
    });
    await idbSet(IDB_KEY, handle);
    return handle;
  },

  async ensureWritePermission(handle) {
    if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
    return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
  },

  async push() {
    const handle = await this.getHandle();
    if (!handle) throw new Error("NO_HANDLE");
    const ok = await this.ensureWritePermission(handle);
    if (!ok) throw new Error("PERMISSION_DENIED");
    const payload = buildSyncPayload();
    // Fix #14: validate size before writing so a large payload doesn't produce a file
    // that pull() will immediately reject on every subsequent device.
    const serialized = assertPayloadSize(payload);
    const writable = await handle.createWritable();
    await writable.write(serialized);
    await writable.close();
    return payload._syncedAt;
  },

  async pull() {
    const handle = await this.getHandle();
    if (!handle) throw new Error("NO_HANDLE");
    const file = await handle.getFile();
    if (file.size > MAX_SYNC_FILE_BYTES) throw new Error("SYNC_FILE_TOO_LARGE");
    const text = await file.text();
    let remote;
    try { remote = JSON.parse(text); }
    catch { throw new Error("CORRUPT_FILE"); }
    applySyncPayload(remote);
    return remote._syncedAt ?? Date.now();
  },

  async forget() {
    try { await idbDel(IDB_KEY); } catch {}
  },

  download() {
    const payload = buildSyncPayload();
    // Fix #14: warn on oversized payload for download path too.
    let serialized;
    try {
      serialized = assertPayloadSize(payload);
    } catch {
      console.warn("SyncManager.download: payload exceeds 10 MB. Consider clearing old sessions or chat history.");
      serialized = JSON.stringify(payload, null, 2);
    }
    const blob    = new Blob([serialized], { type: "application/json" });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement("a");
    a.href     = url;
    a.download = "ritmol-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
    return payload._syncedAt;
  },

  async importFile(file) {
    if (file.size > MAX_SYNC_FILE_BYTES) throw new Error("SYNC_FILE_TOO_LARGE");
    const text = await file.text();
    let remote;
    try { remote = JSON.parse(text); }
    catch { throw new Error("CORRUPT_FILE"); }
    applySyncPayload(remote);
    return remote._syncedAt ?? Date.now();
  },
};
