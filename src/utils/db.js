import { createStore } from 'tinybase'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { useValues as _useValues, useValue as _useValue } from 'tinybase/ui-react'
import { DATA_DISCLOSURE_SEEN_KEY, THEME_KEY } from '../constants'
import { isSafeSyncValue } from '../sync/SyncManager'

// ── Date utilities (previously in storage.js) ─────────────────
// Keep these here so imports from storage.js can be redirected here.
// Use UTC everywhere — single canonical date for habits, missions,
// streaks, token usage, and anti-cheat watermark.
export const todayUTC = () => new Date().toISOString().slice(0, 10)
// today() is kept as an alias for todayUTC() — the old local-date
// version caused habit-log vs mission-date mismatches (bug-25).
// All callers that previously used today() now get UTC.
export const today = todayUTC

/**
 * Returns the user's current local calendar date as "YYYY-MM-DD".
 * Uses the browser's live UTC offset so DST transitions are handled automatically.
 * Use this for ALL habit log keys, mission date keys, streak date comparisons,
 * and scheduler date checks. Do NOT use todayUTC() for those purposes.
 */
export const localDateFromUTC = () => {
  const offsetMs = -(new Date().getTimezoneOffset()) * 60_000
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10)
}

/**
 * Returns the user's current local hour (0-23).
 * Replaces nowHour() for all scheduler trigger comparisons.
 */
export const localHour = () => {
  const offsetMs = -(new Date().getTimezoneOffset()) * 60_000
  return new Date(Date.now() + offsetMs).getUTCHours()
}

/**
 * Returns the user's current local minute (0-59).
 * Replaces nowMin() for all scheduler trigger comparisons.
 */
export const localMin = () => {
  const offsetMs = -(new Date().getTimezoneOffset()) * 60_000
  return new Date(Date.now() + offsetMs).getUTCMinutes()
}

/** @deprecated Use localHour() instead. Returns local hour via getHours() which is
 *  equivalent but kept for compatibility. Will be removed in a future cleanup. */
export const nowHour = () => new Date().getHours()
/** @deprecated Use localMin() instead. */
export const nowMin  = () => new Date().getMinutes()

// ── Dev/prod isolation ─────────────────────────────────────────
export const IS_DEV     = import.meta.env.DEV === true
export const DEV_PREFIX = 'ritmol_dev_'
export const APP_ICON_URL = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/icon-192.png`

// The IDB database name is isolated between dev and prod.
// Use a separate namespace from idb.js ('ritmol' / 'ritmol_dev') to avoid schema conflict.
const DB_NAME = IS_DEV ? 'ritmol_tb_dev' : 'ritmol_tb'
const OLD_IDB_NAME = IS_DEV ? 'ritmol_dev' : 'ritmol' // legacy idb.js store for migration reads

// ── Gemini key (sessionStorage only — never in IDB or state) ──
const GEMINI_SESSION_KEY = IS_DEV ? 'ritmol_dev_gemini_key' : 'ritmol_gemini_key'
export const getGeminiApiKey = () => {
  try { return sessionStorage.getItem(GEMINI_SESSION_KEY) || '' } catch { return '' }
}
export const setGeminiApiKey = (key) => {
  try {
    if (key && typeof key === 'string' && key.trim()) {
      sessionStorage.setItem(GEMINI_SESSION_KEY, key.trim())
    } else {
      sessionStorage.removeItem(GEMINI_SESSION_KEY)
    }
  } catch { /* sessionStorage unavailable */ }
}

// ── Storage key helper (dev prefix) ───────────────────────────
// TinyBase uses a single IDB database keyed by DB_NAME above.
// storageKey() is kept for localStorage items that remain outside
// TinyBase (theme, disclosure flag, quote cache, last-synced ts).
const APP_LS_KEYS = new Set([DATA_DISCLOSURE_SEEN_KEY, THEME_KEY, 'jv_last_synced'])
export const storageKey = (k) => {
  if (!IS_DEV) return k
  if (k.startsWith('jv_') || APP_LS_KEYS.has(k)) return DEV_PREFIX + k
  return k
}

// ── LS helper (localStorage — only for non-IDB items) ─────────
export const LS = {
  get: (k, def = null) => {
    try {
      const v = localStorage.getItem(k)
      if (v === null || v === 'undefined') return def
      return JSON.parse(v)
    } catch { return def }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch (e) {
      if (e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ls-quota-exceeded'))
        }
      }
    }
  },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}

// NOTE: intentionally does NOT strip < > & — React escapes these in JSX text nodes.
// Safe for JSX text nodes AND inline style string values after this fix.
// For rendering user content in the UI — strips control/BiDi chars and CSS-injectable chars.
// Does NOT strip display-safe chars like [ ] which sanitizeForPrompt removes.
export function sanitizeForDisplay(str, maxLen = 500) {
  if (typeof str !== 'string') return ''
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u27E8\u27E9\u276C\u276D\u276E\u276F\uFE3D\uFE3E\u2329\u232A]/g, '')
    .replace(/[\\";':(){}]/g, '')
    .slice(0, maxLen)
}

// ── TinyBase store ─────────────────────────────────────────────
// All app data lives in a single TinyBase Values store (flat key-value).
// Keys map 1:1 to the old jv_* IDB keys.
// The store is a module singleton — import { store } wherever you need
// direct reads or writes outside of React hooks.
export const store = createStore()

// ── Anti-cheat watermark ───────────────────────────────────────
// jv_max_date_seen is device-local and must never be synced or reset.
// Dual-read/write with idb.js so the watermark survives reloads even when
// TinyBase store is not yet booted.
// NOTE: store.getValue / store.setValue use a raw key — NOT the storageKey()-prefixed form.
// The TinyBase persister maps store keys directly to IDB values. storageKey() is only
// used for legacy localStorage and for IDB keys written outside TinyBase.
// jv_max_date_seen is stored under the bare key in the TinyBase store in all environments.
const _MAX_DATE_STORE_KEY = 'jv_max_date_seen';
const _DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const getMaxDateSeen = () => {
  const v = store.getValue(_MAX_DATE_STORE_KEY)
  if (typeof v === 'string' && _DATE_RE.test(v)) return v
  try {
    const lsKey = (IS_DEV ? DEV_PREFIX : '') + _MAX_DATE_STORE_KEY
    const raw = localStorage.getItem(lsKey)
    if (raw) {
      try {
        const p = JSON.parse(raw)
        if (typeof p === 'string' && _DATE_RE.test(p)) return p
      } catch { /* ignore */ }
    }
  } catch { /* localStorage unavailable or invalid JSON */ }
  const legacy = idbGet(_MAX_DATE_STORE_KEY, null)
  return (typeof legacy === 'string' && _DATE_RE.test(legacy)) ? legacy : null
}
export const updateMaxDateSeen = (dateStr) => {
  if (typeof dateStr !== 'string' || !_DATE_RE.test(dateStr)) return
  const current = getMaxDateSeen()
  if (!current || dateStr > current) {
    // Write to TinyBase store under the bare key (consistent with getMaxDateSeen read).
    store.setValue(_MAX_DATE_STORE_KEY, dateStr)
    // Write to legacy IDB via idbSet (also uses bare key for TinyBase path).
    idbSet(_MAX_DATE_STORE_KEY, dateStr)
    // Write to localStorage for cross-boot persistence fallback.
    try {
      localStorage.setItem((IS_DEV ? DEV_PREFIX : '') + _MAX_DATE_STORE_KEY, JSON.stringify(dateStr))
    } catch { /* localStorage full or unavailable */ }
  }
}

// ── Persister ─────────────────────────────────────────────────
// createIndexedDbPersister handles:
//   - Initial load from IDB on startLoad()
//   - Auto-save to IDB on every store change via startAutoSave()
//   - Quota errors are surfaced via the persister's onError callback
let _persister = null

export async function bootDb() {
  _persister = createIndexedDbPersister(store, DB_NAME, {
    onError: (e) => {
      if (e?.name === 'QuotaExceededError') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ls-quota-exceeded'))
        }
      }
      console.warn('[TinyBase] IDB error:', e?.message ?? e)
    },
  })
  // Load existing data from IDB into the store before the app renders.
  await _persister.load()
  // Auto-save every store change to IDB. Fire-and-forget per TinyBase design.
  await _persister.startAutoSave()
  // Run one-shot migration from old localStorage data if needed.
  await _migrateFromLocalStorage()
  import("../sync/SyncManager").then((m) => m.markIdbReady())
}

// ── One-shot migration from old localStorage/IDB ──────────────
// If the old idb.js data exists (user upgraded from previous version),
// copy it into the TinyBase store. Runs once, guarded by a flag.
const MIGRATION_FLAG = IS_DEV ? `${DEV_PREFIX}jv_tb_migrated` : 'jv_tb_migrated'

async function _migrateFromLocalStorage() {
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return

  // Check for old IDB data via the old DB name pattern
  // Try to open the old 'ritmol' IDB store (key-value store named 'kv')
  try {
    const oldData = await _readOldIdb()
    if (oldData && Object.keys(oldData).length > 0) {
      console.info('[RITMOL] Migrating data from old IDB store to TinyBase…')
      Object.entries(oldData).forEach(([k, v]) => {
        if (k.length > 200) return
        if (v !== null && v !== undefined && isSafeSyncValue(v)) {
          store.setValue(k, v)
        }
      })
      console.info('[RITMOL] Migration complete.')
    }
  } catch (e) {
    console.warn('[RITMOL] Migration failed (non-fatal):', e?.message)
  }
  localStorage.setItem(MIGRATION_FLAG, '1')
}

async function _readOldIdb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(OLD_IDB_NAME)
      req.onupgradeneeded = (e) => {
        e.target.transaction?.abort()
        resolve({})
      }
      req.onerror = () => resolve({})
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('kv')) { db.close(); resolve({}); return }
        const tx = db.transaction('kv', 'readonly')
        const result = {}
        const cursor = tx.objectStore('kv').openCursor()
        cursor.onsuccess = (e) => {
          const c = e.target.result
          if (c) { result[c.key] = c.value; c.continue() }
          else { db.close(); resolve(result) }
        }
        cursor.onerror = () => { db.close(); resolve({}) }
      }
    } catch { resolve({}) }
  })
}

// ── React hooks (thin wrappers over TinyBase ui-react) ────────
export const useValues = (selector) => _useValues(store, selector)
export const useValue  = (key) => _useValue(store, key)

// ── IDB shims (delegate to TinyBase store; replace legacy idb.js) ──
// NOTE: 0 and false are valid stored values and pass the !== null check correctly.
export function idbGet(key, def = null) {
  const v = store.getValue(key)
  return (v !== undefined && v !== null) ? v : def
}
export function idbSet(key, value) {
  store.setValue(key, value)
}
export function idbDel(key) {
  store.delValue(key)
}
export async function idbClear(keys) {
  keys.forEach((k) => store.delValue(k))
}
export async function idbClearAll() {
  store.delValues()
}
export async function idbGetAll() {
  return store.getValues()
}
export function isIdbAvailable() {
  return true
}

