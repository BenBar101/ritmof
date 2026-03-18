---
name: RITMOL Bug Fix Plan
overview: Fix IDB persistence, daily login Strict Mode, sync false-success, isPullingRef release, UTC time, and emergency fallback state.
todos:
  - id: "1"
    content: Wrap persistState in try/catch and surface IDB write errors
    status: pending
isProject: false
---

# RITMOL Bug Fix Plan

## Relevant files

- `src/hooks/useAppState.js`
- `src/hooks/useDailyLogin.js`
- `src/hooks/useSync.js`
- `src/sync/SyncManager.js`
- `src/utils/db.js`
- `src/hooks/useScheduler.js`

---

## Tasks

- 1. Wrap `persistState` in try/catch and surface IDB write errors

---

### Task 1: Wrap `persistState` in try/catch and surface IDB write errors

**File:** `src/hooks/useAppState.js`

**Context:**
`persistState(s)` calls `idbSet()` on ~25 keys. Each call is fire-and-forget — if TinyBase's IDB auto-save fails (quota, lock, browser backgrounded), the failure is completely silent. The user sees stale data on the next tab open with no warning.

**Changes:**

1. Above the `persistState` function declaration, add this module-level variable:

```js
let _persistErrorCount = 0;
```

1. Wrap the entire body of `persistState` in `try { ... } catch (e) { ... }`. The catch block must:
  - Increment `_persistErrorCount`
  - If `e?.name === "QuotaExceededError"`, immediately dispatch `window.dispatchEvent(new CustomEvent("ls-quota-exceeded"))`
  - If `_persistErrorCount >= 3` (and it was not a quota error), also dispatch `window.dispatchEvent(new CustomEvent("ls-quota-exceeded"))` and log `console.error("[persistState] IDB write failed:", e?.message ?? e)` behind `if (import.meta.env.DEV)`
  - Add `_persistErrorCount = 0;` at the end of the `try` block (after the last `idbSet` call) to reset the counter on success

The existing `idbSet` calls inside the function body are not changed — only wrapped.

**Verify:**

- `let _persistErrorCount = 0;` exists at module scope, outside the function
- All `idbSet(...)` calls are inside the `try` block
- `_persistErrorCount = 0;` is the last line of the `try` block
- The `catch` block dispatches `ls-quota-exceeded` for quota errors (immediately) and for 3+ consecutive non-quota errors
- No `idbSet` calls were removed or reordered
