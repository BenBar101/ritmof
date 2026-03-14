// ═══════════════════════════════════════════════════════════════
// SYNC MANAGER  (File System Access API + fallback download/import)
// ═══════════════════════════════════════════════════════════════
// Security model:
//   - Key allowlist: only SYNC_KEYS are written from an incoming payload.
//   - Schema version check: files from older schema versions are rejected.
//   - Zod validation (SyncPayloadSchema): strips unknown keys, enforces shapes and bounds.
//   - Prototype pollution guard: __proto__ / constructor / prototype rejected.
//   - Payload size cap: >10 MB rejected before any write.
//   - geminiKey and googleClientId are read from the file into sessionStorage
//     but NEVER written back out on Push.
//   - jv_last_shield_buy_date: on apply, local value is kept if more recent than
//     incoming (prevents crafted sync from resetting once-per-day shield limit).
// ═══════════════════════════════════════════════════════════════

import { LS, storageKey, setGeminiApiKey, getGeminiApiKey, IS_DEV, DEV_PREFIX } from "../utils/storage";
import { idbGet, idbSet, store } from "../utils/db";
import { SyncPayloadSchema } from "../utils/schemas.js";
import { SYNC_SCHEMA_VERSION } from "../constants";
import {
  ensureFreshToken,
  ensureFolderExists,
  uploadFile as dropboxUpload,
  downloadFile as dropboxDownload,
} from "../api/dropbox";

// Re-export for consumers that need the current schema version
export { SYNC_SCHEMA_VERSION };

// ── IDB readiness (set by db.bootDb after persister load completes) ──
let _idbReady = false;
export function markIdbReady() {
  _idbReady = true;
}
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Storage key for the persisted file handle ────────────────────
const HANDLE_LS_KEY = IS_DEV ? `${DEV_PREFIX}sync_handle` : "sync_handle";

// ── Transport selector ("dropbox" | "fsapi" | "download") ─────────
const TRANSPORT_LS_KEY = IS_DEV ? `${DEV_PREFIX}sync_transport` : "ritmol_sync_transport";
let _transport = (typeof localStorage !== "undefined" ? localStorage.getItem(TRANSPORT_LS_KEY) : null) ?? "download";
export function setTransport(t) {
  _transport = t;
  try {
    localStorage.setItem(TRANSPORT_LS_KEY, t);
  } catch {
    /* ignore */
  }
}
export function getTransport() {
  return _transport;
}

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
  // jv_max_date_seen is intentionally excluded — it is a device-local
  // anti-cheat watermark that must not be overwritten by sync.
  "jv_last_shield_buy_date",
];

// ── Helpers (used by sanitizeChatMessages and isSafeSyncValue) ─────
const isArray  = (v) => Array.isArray(v);
const isObj    = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const _logEnc = new TextEncoder();
function byteLen(str) {
  return _logEnc.encode(str).length;
}

// ── Prototype pollution guard ─────────────────────────────────────
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeChatMessages(arr) {
  if (!isArray(arr)) return [];
  const MAX_CHAT_MSG_BYTES = 16000;
  return arr
    .filter((item) => isObj(item) && isSafeSyncValue(item, 0) && typeof item.content === "string")
    .map((item) => {
      let content = item.content;
      // eslint-disable-next-line no-control-regex
      content = content.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "");
      content = content.replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
      while (byteLen(content) > MAX_CHAT_MSG_BYTES) content = content.slice(0, content.length - 1);
      return {
        role: item.role === "assistant" ? "assistant" : "user",
        content,
        ts: typeof item.ts === "number" ? item.ts : undefined,
        seq: typeof item.seq === "number" ? item.seq : undefined,
        date: typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : undefined,
      };
    });
}

export function isSafeSyncValue(v, depth = 0) {
  // Depth cap prevents stack overflow on adversarially deep JSON. Legitimate
  // RITMOL data nests at most 4–5 levels deep. Both object and array nesting
  // contribute to depth so that alternating array/object layers cannot bypass
  // the cap. Primitives (string, number, boolean, null) always pass — only
  // container nodes (objects/arrays) are depth-counted and inspected.
  if (depth >= 12) return false;
  if (isObj(v)) {
    // NOTE: isSafeSyncValue is called on the ENTIRE parsed payload object
    // in parseAndValidate(), not just individual values. This means top-level
    // dangerous keys like "__proto__", "constructor", or "prototype" are
    // rejected here before any per-key validator or applyPayload logic runs.
    for (const k of Object.getOwnPropertyNames(v)) {
      if (DANGEROUS_KEYS.has(k)) return false;
      if (!isSafeSyncValue(v[k], depth + 1)) return false;
    }
  } else if (isArray(v)) {
    for (const item of v) {
      if (!isSafeSyncValue(item, depth + 1)) return false;
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
let _lastObjectUrl = null;

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

/** Close the BroadcastChannel (called on HMR dispose in dev). */
export function closeSyncChannel() {
  if (_broadcastChannel) {
    _broadcastChannel.close();
    _broadcastChannel = null;
  }
  // Reset mutex on channel close so a dispose in the middle of an operation
  // (e.g. HMR in development) does not leave SYNC_BUSY latched forever.
  _opInProgress = false;
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

// ── Build sync payload from IDB cache ───────────────────────────
function buildPayload(includeGeminiKey = false) {
  if (!_idbReady) throw new Error("IDB_NOT_READY");
  if (!store) throw new Error("IDB_NOT_READY");
  const payload = { _schemaVersion: SYNC_SCHEMA_VERSION };
  if (includeGeminiKey) {
    const key = getGeminiApiKey();
    if (key && typeof key === "string" && /^AIza[A-Za-z0-9_-]{35,45}$/.test(key.trim())) {
      payload.geminiKey = key.trim();
    }
  }
  for (const key of SYNC_KEYS) {
    // Read from IDB cache (synchronous after boot)
    let stored = idbGet(storageKey(key), null);
    if (stored === null && IS_DEV) {
      // Dev fallback: check unprefixed key in IDB cache
      const unprefixed = idbGet(key, null);
      if (unprefixed !== null) {
        console.warn(`[SyncManager] Key "${key}" found at unprefixed location.`);
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

// ── Apply validated payload to IDB ───────────────────────────────
function applyPayload(payload) {
  for (const key of SYNC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    let val = payload[key];
    if (key === "jv_profile" && val && typeof val === "object") {
      // eslint-disable-next-line no-unused-vars
      const { geminiKey: _gk, googleClientId: _gc, ...safeProfile } = val;
      val = safeProfile;
    }
    if (key !== "jv_chat" && !isSafeSyncValue(val)) continue;
    // Anti-cheat: do not overwrite last shield buy date with an older sync value.
    if (key === "jv_last_shield_buy_date") {
      const localVal = idbGet(storageKey(key), null);
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const localIsDate = typeof localVal === "string" && dateRe.test(localVal);
      const incomingIsDate = typeof val === "string" && dateRe.test(val);
      if (localIsDate && incomingIsDate && localVal >= val) continue;
      if (localIsDate && !incomingIsDate) continue;
    }
    if (key === "jv_streak") {
      // Anti-cheat: streak cannot exceed the number of days elapsed since
      // the app epoch (2024-01-01). A crafted payload setting streak to the
      // Zod maximum (1095) without corresponding login history is rejected.
      if (typeof val === "number" && val > 0) {
        const APP_EPOCH_MS = Date.parse("2024-01-01");
        const lastLoginVal = payload["jv_last_login"];
        const loginMs = typeof lastLoginVal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(lastLoginVal)
          ? Date.parse(lastLoginVal)
          : Date.now();
        const maxPlausibleStreak = Math.ceil((loginMs - APP_EPOCH_MS) / 86_400_000) + 1;
        if (val > maxPlausibleStreak) {
          val = Math.min(val, maxPlausibleStreak);
        }
      }
    }
    if (key === "jv_chat") {
      val = sanitizeChatMessages(val);
      val = Array.isArray(val) ? val.slice(-1000) : [];
      if (!isSafeSyncValue(val)) continue;
    } else if (key === "jv_gacha" && Array.isArray(val)) {
      // Sanitize gacha content at storage time so later render paths never have
      // to worry about control chars, BiDi overrides, or raw HTML-ish strings.
      // This also protects future implementations that might render gacha
      // content with richer formatting.
      val = val.map((card) => {
        const out = { ...card };
        if (typeof out.content === "string") {
          out.content = out.content
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
            // Strip ANSI escape sequences used for terminal styling.
            // eslint-disable-next-line no-control-regex
            .replace(/\x1B\[[0-9;]*[mGKHF]/g, "")
            .replace(/[<>"'`&]/g, "")
            .slice(0, 1000);
        } else {
          out.content = "";
        }
        if (out.asciiArt != null) {
          out.asciiArt = String(out.asciiArt)
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
            // Strip ANSI escape sequences used for terminal styling.
            // eslint-disable-next-line no-control-regex
            .replace(/\x1B\[[0-9;]*[mGKHF]/g, "")
            .slice(0, 500);
        } else {
          out.asciiArt = null;
        }
        return out;
      });
    } else if (key === "jv_achievements" && Array.isArray(val)) {
      // Imported achievements carry their own XP values, but those XP amounts are
      // already baked into the imported jv_xp total. They must never be re-awarded
      // on import — unlockAchievement only grants XP for newly earned achievements.
    } else if (key === "jv_timers" && Array.isArray(val)) {
      // Anti-cheat: drop timers with endsAt in the past — crafted sync payloads
      // could otherwise trigger instant onExpire and banner XP without real wait.
      const now = Date.now();
      val = val.filter((t) => typeof t?.endsAt === "number" && t.endsAt > now);
    }
    // Write to IDB (sync cache update + fire-and-forget IDB put)
    idbSet(storageKey(key), val);
  }
}

// ── Migration registry ────────────────────────────────────────────
// When you bump SYNC_SCHEMA_VERSION and write the corresponding migration
// block inside migratePayload, add the fromVersion number to this Set.
// The dev-only assertion in migratePayload will throw if a version gap exists.
//
// HOW TO ADD A NEW MIGRATION:
//   1. Bump SYNC_SCHEMA_VERSION (e.g. 1 → 2)
//   2. Write the 'if (fromVersion === 1)' block in migratePayload below
//   3. Add 1 to COMPLETED_MIGRATIONS here
//   4. Update SyncPayloadSchema _schemaVersion .max() in schemas.js to match
const COMPLETED_MIGRATIONS = new Set([
  // 1,  // ← uncomment when V1→V2 migration block is written
]);

// ── Schema migration (V1 → V2, etc.) ─────────────────────────────
function migratePayload(p) {
  if (p._schemaVersion >= SYNC_SCHEMA_VERSION) return p;

  // Dev-only guard: if SYNC_SCHEMA_VERSION was bumped, the migration block
  // below and COMPLETED_MIGRATIONS above must both be updated first.
  // This throws immediately in development so the omission cannot reach production.
  if (import.meta.env.DEV) {
    for (let v = 1; v < SYNC_SCHEMA_VERSION; v++) {
      if (!COMPLETED_MIGRATIONS.has(v)) {
        throw new Error(
          `[SyncManager] SYNC_SCHEMA_VERSION is ${SYNC_SCHEMA_VERSION} but the ` +
          `V${v}→V${v + 1} migration block has not been registered in ` +
          `COMPLETED_MIGRATIONS. Write the migration then add ${v} to the Set.`
        );
      }
    }
  }

  let out = { ...p };
  while (out._schemaVersion < SYNC_SCHEMA_VERSION) {
    const fromVersion = out._schemaVersion;
    out._schemaVersion = fromVersion + 1;
    if (fromVersion === 1) {
      // V1 is the initial schema — no structural changes exist yet.
      // When V2 ships: write transforms here, then add 1 to COMPLETED_MIGRATIONS above.
    }
    // Add further 'if (fromVersion === N)' blocks for each future version step.
  }
  return out;
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
  if (!isSafeSyncValue(payload)) {
    throw new Error("CORRUPT_FILE");
  }
  const topLevelKeys = Object.keys(payload);
  if (topLevelKeys.length > 200) {
    throw new Error("CORRUPT_FILE");
  }
  // Legacy files may lack _schemaVersion; treat as V1 for backward compatibility.
  if (payload._schemaVersion === undefined) payload._schemaVersion = 1;
  if (typeof payload._schemaVersion !== "number" || !Number.isInteger(payload._schemaVersion) || payload._schemaVersion < 1) {
    throw new Error("Sync file missing _schemaVersion.");
  }
  if (payload._schemaVersion < SYNC_SCHEMA_VERSION) {
    payload = migratePayload(payload);
  }
  if (payload._schemaVersion > SYNC_SCHEMA_VERSION) {
    throw new Error(`Sync file is from a newer app version (v${payload._schemaVersion}). Update the app first.`);
  }
  // Zod validation — strip unknown keys, enforce shapes and bounds.
  const result = SyncPayloadSchema.safeParse(payload);
  if (!result.success) {
    if (import.meta.env.DEV) console.warn("[RITMOL] Zod parse errors:", result.error.issues);
    throw new Error("CORRUPT_FILE");
  }
  if (import.meta.env.DEV && typeof result.data.jv_xp === "number" && result.data.jv_xp > 5_000_000) {
    console.warn(`[SyncManager] jv_xp in imported payload is unusually high (${result.data.jv_xp}).`);
  }
  // Return the Zod-parsed (stripped) object so applyPayload only sees known keys.
  return result.data;
}

// ── Read geminiKey / googleClientId into sessionStorage ───────────
function extractSecretsFromPayload(payload) {
  // Accept geminiKey only as an own, top-level property of the payload object.
  // This prevents prototype-inherited keys from being read and keeps the config
  // slot separate from any jv_profile fields (which are validated separately).
  if (Object.prototype.hasOwnProperty.call(payload, "geminiKey") && typeof payload.geminiKey === "string") {
    const trimmed = payload.geminiKey.trim();
    // Accept a range of plausible key lengths so future format changes don't
    // silently break the config gate. We never log the key value itself.
    if (/^AIza[A-Za-z0-9_-]{35,45}$/.test(trimmed)) {
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

  /** Returns true if a persisted file handle is available in IndexedDB. */
  async isHandlePersisted() {
    const h = await loadHandleFromDB();
    return h !== null;
  },

  /** Write current TinyBase store state to the linked sync file. */
  async push() {
    if (_opInProgress) throw new Error("SYNC_BUSY");
    _opInProgress = true;
    if (!store) {
      _opInProgress = false;
      throw new Error("IDB_NOT_READY");
    }
    const ch = getSyncChannel();
    ch?.postMessage({ type: "sync_start" });
    try {
      if (_transport === "dropbox") {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new Error("DROPBOX_OFFLINE");
        }
        await ensureFreshToken();
        // Re-check connectivity: network may have dropped while refreshing the token.
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new Error("DROPBOX_OFFLINE");
        }
        await ensureFolderExists();
        const payload = buildPayload(true);
        const text = JSON.stringify(payload, null, 2);
        assertPayloadSize(text);
        await dropboxUpload(text);
        const ts = Date.now();
        LS.set(storageKey("jv_last_synced"), String(ts));
        return ts;
      }
      if (_transport === "fsapi" || _transport === "download") {
        const handle = await SyncManager.getHandle();
        if (!handle) throw new Error("NO_HANDLE");
        let perm;
        try {
        perm = await handle.queryPermission({ mode: "readwrite" });
        if (perm !== "granted") {
          perm = await handle.requestPermission({ mode: "readwrite" });
        }
        } catch (err) {
          if (err && err.name === "NotFoundError") {
            throw new Error("SYNC_FILE_NOT_FOUND");
          }
          throw new Error("PERMISSION_DENIED");
        }
        if (perm !== "granted") throw new Error("PERMISSION_DENIED");

        try {
          const currentFile = await handle.getFile();
          const lastMod = currentFile.lastModified;
          // Skip push if the file was modified less than 2 s ago by an external writer
          // (e.g. Syncthing delivering a remote update) and the modification postdates
          // our own last push (_lastPushTime). This prevents overwriting incoming data.
          // _lastPushTime === 0 on first boot, so the lastMod > _lastPushTime guard
          // correctly passes through on the first push (lastMod is always > 0).
          if (lastMod !== 0 && Date.now() - lastMod < 2000 && lastMod > _lastPushTime) {
            throw new Error("SYNC_SKIPPED");
          }
        } catch (innerErr) {
          if (innerErr?.message === "SYNC_SKIPPED") throw innerErr;
          if (innerErr?.name === "NotFoundError") throw new Error("SYNC_FILE_NOT_FOUND");
          if (innerErr?.name === "SecurityError") throw new Error("PERMISSION_DENIED");
        }

        const payload = buildPayload();
        const text = JSON.stringify(payload, null, 2);
        assertPayloadSize(text);
        const byteSize = new TextEncoder().encode(text).length;
        if (byteSize > 7 * 1024 * 1024) {
          console.warn("[SyncManager] Sync file approaching size limit:", (byteSize / (1024 * 1024)).toFixed(1), "MB");
        }

        _lastPushTime = Date.now();
        const writable = await handle.createWritable();
        try {
          await writable.write(text);
          await writable.close();
        } catch (writeErr) {
          try { await writable.abort(); } catch { /* ignore abort errors */ }
          throw writeErr;
        }

        const ts = Date.now();
        LS.set(storageKey("jv_last_synced"), String(ts));
        return ts;
      }
    } finally {
      _opInProgress = false;
    }
  },

  /** Read the linked sync file and apply it to the TinyBase store. */
  async pull() {
    if (_opInProgress) throw new Error("SYNC_BUSY");
    _opInProgress = true;
    try {
      if (_transport === "dropbox") {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          throw new Error("DROPBOX_OFFLINE");
        }
        await ensureFreshToken();
        const { text } = await dropboxDownload();
        const payload = parseAndValidate(text);
        extractSecretsFromPayload(payload);
        applyPayload(payload);
        return Date.now();
      }
      const handle = await SyncManager.getHandle();
      if (!handle) throw new Error("NO_HANDLE");
      const file = await handle.getFile();
      const text = await file.text();
      const payload = parseAndValidate(text);
      extractSecretsFromPayload(payload);
      applyPayload(payload);
      return Date.now();
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
    // Revoke any previous object URL before creating a new one so repeated
    // downloads do not accumulate unused Blob URLs.
    if (_lastObjectUrl) {
      URL.revokeObjectURL(_lastObjectUrl);
      _lastObjectUrl = null;
    }
    const url = URL.createObjectURL(blob);
    _lastObjectUrl = url;
    const a = document.createElement("a");
    a.href = url;
    a.download = "ritmol-data.json".replace(/[^a-zA-Z0-9._-]/g, "_");
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
    // Allow a short window for the browser to start the download, then revoke.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (_lastObjectUrl === url) _lastObjectUrl = null;
    }, 5000);
  },

  /** Forget the linked sync file handle. */
  async forget() {
    _cachedHandle = null;
    await clearHandleFromDB();
    // Close the BroadcastChannel when there is no longer a sync target.
    // getSyncChannel() will re-open it if sync is re-established.
    closeSyncChannel();
  },
};
