// Tiny module: db.js calls markIdbReady() after TinyBase IDB boot without importing
// SyncManager (SyncManager already imports db — a static import would cycle).

let _idbReady = false;

export function markIdbReady() {
  _idbReady = true;
}

export function isIdbReadyForSync() {
  return _idbReady;
}
