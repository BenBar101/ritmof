import { LS, storageKey } from "./utils/storage";
import { setGeminiApiKey } from "./utils/storage";

// ═══════════════════════════════════════════════════════════════
// SYNCTHING FILE SYNC (File System Access API)
// ═══════════════════════════════════════════════════════════════
// Strategy: user picks ritmol-data.json inside their Syncthing folder once.
// The FileSystemFileHandle is persisted in IndexedDB so permission survives
// page reloads (on Chromium — the user may need to re-grant once per browser session).
// On browsers that don't support the API (Firefox, Safari iOS) we fall back to
// manual Download + Import.

const IS_DEV = import.meta.env.DEV === true;

// IndexedDB helpers for persisting the FileSystemFileHandle.
const IDB_DB_NAME = "ritmol_sync";
const IDB_STORE   = "handles";
const IDB_KEY     = IS_DEV ? "syncFile_dev" : "syncFile";  // never share handles between envs

// Cache the DB connection to avoid re-opening on every get/set.
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
  "jv_timers",            // fix #1: was missing — active timers lost on sync
  "jv_habit_suggestions", // fix #1: was missing — pending suggestions lost on sync
  // NOTE: geminiKey is intentionally NOT synced
  // NOTE: jv_last_synced is intentionally NOT in SYNC_KEYS — it is device-local metadata
];

const SYNC_SCHEMA_VERSION = 1; // bump this when making breaking data model changes

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

const SYNC_VALIDATORS = {
  jv_xp:         (v) => typeof v === "number" && v >= 0 && v < 10_000_000,
  jv_streak:     (v) => typeof v === "number" && v >= 0 && v < 10_000,
  jv_shields:    (v) => typeof v === "number" && v >= 0 && v < 1_000,
  jv_habits:     (v) => Array.isArray(v) && v.length <= 200 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.label === "string" && typeof i.xp === "number"),
  jv_tasks:      (v) => Array.isArray(v) && v.length <= 2_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.text === "string"),
  jv_goals:      (v) => Array.isArray(v) && v.length <= 1_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.id === "string" && typeof i.title === "string"),
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
      // FIX (security): removed `&& k !== "geminiKey"` exception. geminiKey must NEVER
      // pass profile validation — allowing it meant a crafted sync file could store the
      // raw API key into localStorage under jv_profile, leaking it to any LS reader.
      if (!ALLOWED_PROFILE_KEYS.has(k)) return false;
      const val = v[k];
      if (val !== null && val !== undefined && typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") return false;
      if (typeof val === "string" && val.length > 1000) return false;
    }
    return true;
  },
  jv_token_usage:(v) => v !== null && typeof v === "object" && !Array.isArray(v),
  jv_daily_goal: (v) => typeof v === "string" && v.length <= 500,
  jv_last_login: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  jv_chat:       (v) => Array.isArray(v) && v.length <= 2_000 &&
    v.every(i => i !== null && typeof i === "object" && !Array.isArray(i) &&
      typeof i.role === "string" && typeof i.content === "string"),
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
  // FIX (security): removed unconditional top-level geminiKey read here.
  // geminiKey is intentionally excluded from SYNC_KEYS. Reading it outside the allowlist
  // loop meant a crafted sync file could silently overwrite the key in sessionStorage
  // without going through any of the per-key validators. The only sanctioned path for
  // loading the key is through the KeysConfigGate flow in App.jsx.
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
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
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
    const blob    = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
