// Temporary compatibility layer: re-export everything from the new db.js
// so legacy imports from ./storage keep working during the migration.
export {
  LS,
  storageKey,
  today,
  todayUTC,
  nowHour,
  nowMin,
  sanitizeForDisplay,
  IS_DEV,
  DEV_PREFIX,
  APP_ICON_URL,
  getGeminiApiKey,
  setGeminiApiKey,
  getMaxDateSeen,
  updateMaxDateSeen,
} from "./db";

