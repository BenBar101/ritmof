# RITMOL

A gamified life companion PWA for STEM university students. Solo Leveling RPG aesthetic. Black and white. No server — runs entirely in your browser. **Stack:** React, Vite; data lives in **localStorage**. Logic is split across focused hooks (`hooks/`) consumed via `AppContext`; tabs call `useAppContext()` rather than receiving prop bundles. Application logic and UI are split across modular `src/` files (root: **`src/App.jsx`**). Sync across devices by **reading and writing a single JSON file** with [Syncthing](https://syncthing.net/) via the browser File System Access API.

**Using the app (static site):** You don't need to clone this repo — just open the deployed static site (e.g. GitHub Pages). The app expects a single JSON data file in the same format as **`example-data/ritmol-data.json`** (with `_schemaVersion`, `geminiKey`, and your app data). In the app, go to **Profile → Settings → SYNCTHING SYNC** to link or import that file.

### Features

- **Tabs:** Home (daily quote, missions, quick actions), Habits (track with XP), Tasks & Goals, RITMOL (AI chat), Profile.
- **Profile sections:** Overview (Hunter card, streak shield, rank ladder), Achievements, Calendar (Google Calendar events), Gacha, Settings (Syncthing sync, theme).
- **RPG mechanics:** XP, levels, ranks (Novice → Apprentice → Adept → Elite → Ascendant), streak and streak shields, daily missions, achievements, gacha (AI-generated rewards). Costs (XP per level, gacha, streak shield) can be adjusted dynamically by the AI after significant events.
- **AI (Gemini 2.5 Flash):** Daily token budget shown as "neural energy"; when exhausted, AI features (chat, gacha, habit suggestions, etc.) are disabled until the next day. Chat can run commands (add task, set daily goal, suggest sessions, unlock achievement, etc.). See **Gemini API Key** below for how to obtain and configure your key.
- **Study:** Session logging (lecture, tirgul, homework, prep) with focus level, timers, sleep/screen log, daily goal. Optional Google Calendar integration.
- **Daily quote:** Sourced from the free Quotable API — matched to your listed books/authors where possible, themed STEM/philosophy/wisdom fallback otherwise. No AI tokens consumed.

### Project structure

```
src/
  App.jsx               — orchestration only (~280 lines); mounts hooks, renders tabs
  theme.js              — single source of truth for colours, fonts, button/input styles
  context/
    AppContext.js        — React context; useAppContext() hook for tabs to consume
  hooks/
    useAppState.js      — all React state + write-through localStorage persistence
    useSync.js          — Syncthing push/pull/pick/forget + auto-push on tab hide
    useGameEngine.js    — XP, missions, achievements, AI command executor, habit logger
    useDailyLogin.js    — daily login streak math and login XP
    useScheduler.js     — timed prompts: sleep check-in, screen time, lecture reminders
    useUI.js            — ephemeral UI state: banner, toast, modal, levelUpData
  ChatTab.jsx           — AI chat UI
  HabitsTab.jsx         — habit tracking and AI-personalised protocol init
  TasksTab.jsx          — tasks and goals
  HomeTab.jsx           — dashboard: quote, missions, quick stats
  ProfileTab.jsx        — hunter card, achievements, gacha, settings, calendar
  Onboarding.jsx        — first-run wizard
  Layout.jsx            — TopBar, BottomNav, Banner
  Modals.jsx            — DailyLogin, SleepCheckin, ScreenTime, SessionLog, LevelUp, AchievementToast
  GlobalStyles.jsx      — CSS reset and shared styles; ErrorBoundary
  GeometricCorners.jsx  — decorative SVG corner component
  constants.js          — shared constants (ranks, session types, focus levels, XP defaults)
  api/
    gemini.js           — callGemini() with timeout, abort, token counting
    gcal.js             — Google Calendar REST + GIS token client
    quotes.js           — Quotable API daily quote fetch
    systemPrompt.js     — builds the RITMOL system prompt; sanitizeForPrompt()
    dynamicCosts.js     — AI-driven XP economy adjustments
  sync/
    SyncManager.js      — File System Access API sync: push/pull/import/download; payload validation
  utils/
    storage.js          — LS helpers, storageKey() dev/prod isolation, Gemini key in sessionStorage
    state.js            — initState(), flushStateToStorage()
    xp.js               — XP/level/rank math, session XP calc
```

- **`index.html`** — entry point; includes SPA redirect handling for GitHub Pages.
- **`vite.config.js`** — Vite config; `base` is set from `VITE_BASE_PATH` (e.g. repo name for GitHub Pages).
- **`.github/workflows/deploy.yml`** — GitHub Actions workflow: build and deploy `dist` to Pages (no secrets or Variables required).
- **`api/verify-google-id.js`** — optional serverless JWT verification (e.g. Vercel); used when configured in your data file.
- **`manifest.json`**, **`sw.js`** — PWA manifest and service worker.
- **`public/404.html`** — copied to `dist`; redirects 404s to the SPA so client-side routes and OAuth callbacks work on GitHub Pages.

## Architecture

`App.jsx` is pure orchestration — it mounts hooks and renders tabs. All logic lives in hooks:

| Hook | Owns |
|---|---|
| `useAppState` | React state + write-through localStorage (replaces 25 individual `useEffect` flushes) |
| `useSync` | Syncthing push/pull, auto-push on tab hide, pull mutex to prevent push/pull race |
| `useGameEngine` | XP awards, mission checking, achievement unlock, AI command executor, habit logger |
| `useDailyLogin` | Streak math, login XP, shield consumption |
| `useScheduler` | Timed modals/banners: sleep check-in, screen time, lecture reminders, streak panic |
| `useUI` | Ephemeral UI state: banner, toast, modal, level-up overlay |

Tabs consume everything via `useAppContext()` — no more 15-prop function signatures.

### Key fixes in this refactor

**Write-through persistence** — `useAppState` wraps `setState` so localStorage is written synchronously inside the React updater, not in a downstream `useEffect`. This eliminates the render-cycle gap where localStorage lagged React state and caused stale auto-pushes to overwrite fresh Pull data.

**Sync mutex ownership** — `isPullingRef` now lives inside `useSync` alongside the auto-push effect. Previously it lived in App and was captured by a stale closure, sometimes missing the flag entirely. Both sides now always share the same object.

**Scheduler isolation** — The `useScheduler` interval reads state via a `scheduledStateRef` that is updated on every render, so the callback always sees fresh data without the interval effect having stale deps.


## Design Philosophy & Security Model

**RITMOL is intentionally a single-user, self-hosted application.**

The app is designed for one person running it on multiple devices using a static host (e.g. GitHub Pages). It does **not** aim to support multiple users or enterprise-grade authentication.

### Threat Model

The intended deployment model is:

```
Your devices  <->  Syncthing  <->  ritmol-data.json  (your data + Gemini key)
                                          ^
                                   GitHub Pages (static build -- no secrets)
```

There is **no backend server** and no central database. Sync is **file-based**: a single JSON file that Syncthing keeps in sync across your machines. Your config (Gemini API key, Google client ID if you use sign-in, etc.) and all app data live in that file — nothing is stored in GitHub or in build-time variables.

The threat model is a **remote attacker** who finds the static site URL. Your data and keys stay in your own JSON file and in your browser; the static host never sees them. Anyone with **physical access to your running browser session** can read `sessionStorage` via DevTools — that is an accepted risk for a personal app you run on your own machine. Mitigate by restricting the Gemini key in AI Studio (Gemini API only) and setting a daily quota cap.

Therefore:

* The app assumes a **trusted device environment**.
* All config and secrets live in **your** `ritmol-data.json` (or in sessionStorage after Pull). The build contains **no** API keys or account locks.

### Known security risks (and why they are okay here)

**What can go wrong, realistically:**

- **Local attacker with your machine:** If someone already has access to your running session (DevTools, your user account, or worse, root), they can:
  - Read `sessionStorage` and see your Gemini key.
  - Read your `ritmol-data.json` file from disk or your Syncthing folder.
  - Modify the built JS bundle in memory or via a malicious browser extension.
- **Malicious static host compromise:** If the static host is compromised and serves modified JS, the attacker could try to exfiltrate your data or keys while you use the app.

These are **accepted risks** for this project. RITMOL is a **personal life companion** you run on your own devices. If an attacker already has that level of access to your machine or hosting account, you have much bigger problems (password managers, banking, email, etc.) than this app.

**How you can harden things:**

- **Host on Vercel (or similar):** You can deploy the static build (and optionally the `api/verify-google-id.js` serverless function) to Vercel for a managed host with HTTPS. Any verify URL is configured in your data file, not in build variables.
- **Treat your machine as the trust anchor:** Keep your OS up to date, use a password manager, do not install untrusted browser extensions, and avoid running RITMOL on shared/public machines.
- **Lock down your Gemini key:** Restrict it to the Gemini API only, set a daily quota cap, and rotate it if you ever suspect compromise.

The maintainer does **not** aim to defend against a determined local attacker with full access to your machine. The goal is to make remote abuse of a public URL difficult while keeping the architecture simple, and to assume that if someone can already rummage through your browser storage or home directory, they are not going to start by attacking your habit tracker.

### Security implementation notes

The sync layer enforces several layers of defence:

- **Key allowlist:** Only keys in `SYNC_KEYS` are written from an incoming sync payload — unknown keys are silently dropped.
- **Schema versioning:** `SYNC_SCHEMA_VERSION` is checked on every Pull/Import; outdated files are rejected before any data is applied.
- **Per-key validators (`SYNC_VALIDATORS`):** Every sync key has a typed validator checking structure, value ranges, string lengths, and allowed sub-keys. Log objects (habit/sleep/screen) enforce date-string key format and a ~2-year key cap. Array fields (missions, timers, habit suggestions) enforce per-item shape.
- **Prototype pollution guard:** `isSafeSyncValue()` rejects payloads containing `__proto__`, `constructor`, or `prototype` keys.
- **Payload size cap:** `assertPayloadSize()` rejects payloads over 10 MB before writing, so a large Push cannot produce a file that every subsequent Pull immediately rejects.
- **Prompt injection mitigation:** `sanitizeForPrompt()` strips XML-breakout characters and control characters from all user-derived strings injected into the system prompt. Chat history is re-sanitised at replay time so previously-stored messages cannot break out of the `<HUNTER_DATA>` boundary.
- **AI output sanitisation:** Commands returned by Gemini are validated against a strict allowlist; all string fields pass through `sanitizeStr()`. AI-awarded XP is capped per-command, per-response, and per-day.
- **geminiKey isolation:** The key is read from `ritmol-data.json` into `sessionStorage` on Pull/Import and is never written back out on Push. It is never stored in localStorage.

### Important Rules

1. **Never commit your real `ritmol-data.json`** (or any file containing API keys) into the repo. The repo's **`example-data/ritmol-data.json`** is a format reference only.
2. **All config is in the JSON file:** Add `geminiKey`, `googleClientId` (if you use Google sign-in), and any other options to your own `ritmol-data.json`. Pull in the app to load them. No GitHub Variables or build-time secrets are required.

### Non-Goals

The project intentionally avoids:

* backend servers
* databases
* complex authentication systems
* multi-user support
* enterprise security infrastructure
* third-party cloud storage (Dropbox, Google Drive, etc.)

Contributors and automated tools should **not** add server components or cloud sync services unless the project scope changes. The goal is to keep the system **simple, portable, and peer-to-peer friendly**.

**Config lives in your JSON file:** Add `geminiKey` (and optionally `googleClientId` for Google sign-in) as top-level fields in your `ritmol-data.json`. In the app, go to **Profile → Settings → SYNCTHING SYNC**, link or import that file, and click **Pull ↓**. The app reads keys into **sessionStorage** for the tab's lifetime; they are not written back out on Push. If you open a fresh tab without Pulling, the app may show a configuration screen until you Pull. The app enforces a **daily token budget** for Gemini (shown as "neural energy" in the UI); when exhausted, AI features are disabled until the next day.

---

## Gemini API Key

The Gemini key is distributed via your JSON file, not via the build. It never appears in the compiled JS bundle and never needs to touch GitHub.

### Adding the key to your sync file

Open your `ritmol-data.json` in any text editor and add a top-level `geminiKey` field:

```json
{
  "_schemaVersion": 1,
  "geminiKey": "AIza...",
  "...rest of your data": "..."
}
```

Then in the app go to **Profile → Settings → SYNCTHING SYNC** and click **Pull ↓**. The app reads the key into `sessionStorage` for the current tab session. It is not written back out on Push — your key stays in the file only.

If you are setting up a fresh device with no existing sync file, create a minimal `ritmol-data.json` with `_schemaVersion` and `geminiKey`, link it via **LINK SYNCTHING FILE**, and Pull. Your app data will be written to the file on the first Push.

### Getting a key

Go to [Google AI Studio](https://aistudio.google.com/apikey) → **Create API key**. Restrict it to the Gemini API only and set a daily usage quota so a runaway loop cannot silently drain it.

### Security note

After a Pull, the key lives in `sessionStorage` for the lifetime of the tab. It is visible in DevTools → Application → Session Storage to anyone with access to your running browser. This is the accepted risk for this app's threat model (trusted device). Close the tab when done if you are on a shared machine.

---

## Sync: Syncthing + File System Access API

Data is stored in **localStorage**. To use the same data on multiple devices, RITMOL uses the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write a JSON file directly on disk — no OAuth, no cloud accounts, no extra services.

### How it works

1. **Install Syncthing** on all your devices from [syncthing.net](https://syncthing.net/). Create a shared folder (e.g. `~/ritmol-sync/`) and share it between your devices.
2. **On first use**, go to **Profile → Settings → SYNCTHING SYNC** and click **LINK SYNCTHING FILE**. Pick (or create) `ritmol-data.json` inside your Syncthing folder. The browser remembers this file handle across sessions.
3. **Push ↑** — writes your current data to the file. Syncthing picks it up and distributes it to your other devices.
4. **Pull ↓** — reads the file that Syncthing has updated from another device, loads it into the app, **and re-reads `geminiKey` from the file into `sessionStorage`**.
5. The app also **auto-pushes** when you switch tabs or close the browser, so your file is always up to date.

> **Browser support:** File System Access API works in **Chrome and Edge** (desktop). Firefox and iOS Safari do not support it. On unsupported browsers, the app falls back to **Download** (saves a JSON file) and **Import** (loads a JSON file via file picker). You move the downloaded file to your Syncthing folder manually in that case.

The sync file must be **valid JSON** and may not exceed **10 MB**. If you Pull or Import a corrupt or oversized file, the app shows an error and does not overwrite your local data.

### Onboarding (new device)

The last step of the onboarding wizard prompts you to link your Syncthing file. You can skip this and do it later in **Profile → Settings**.

---

## Using the static site (no clone)

The app is meant to be used as a **static site** (e.g. the GitHub Pages deployment). You don't clone the repo or set any variables — you just open the URL.

1. Open the deployed site (e.g. `https://YOUR_USERNAME.github.io/ritmol/`).
2. Have a JSON file in the same format as **`example-data/ritmol-data.json`** (with `_schemaVersion`, `geminiKey`, and optionally `googleClientId`). Create one from scratch or copy the example and add your keys.
3. In the app go to **Profile → Settings → SYNCTHING SYNC**, then **LINK SYNCTHING FILE** (or **Import** on unsupported browsers) and choose that file. Click **Pull ↓** to load your config and data.

That's it. All config and data live in your JSON file; the static host never sees your keys.

---

## Playing with the repo (local dev)

If you want to run the app locally or change the code:

1. **Clone and install**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ritmol.git
   cd ritmol
   npm install
   ```

2. **Data format**  
   The repo includes **`example-data/ritmol-data.json`** as a reference. The app expects a JSON file in that format. No need to rename anything — create your own file (e.g. in a Syncthing folder) with `_schemaVersion`, `geminiKey`, and your data, or use the example as a template.

3. **Run locally**
   ```bash
   npm run dev   # -> http://localhost:5173
   ```
   Link your sync file in the app (Profile → Settings → SYNCTHING SYNC) and Pull. All config (Gemini key, Google client ID, etc.) comes from that file; no `.env` or GitHub Variables required.

4. **Dev mode**  
   When you run `npm run dev`, the app uses a **separate localStorage copy** (prefix `ritmol_dev_`) and a **separate sync file handle**. Your production data stays untouched. A yellow **DEV MODE** bar at the top reminds you.

To test the production build locally: `npm run build` then `npm run preview`.

---

## Deploying your own static site (optional)

If you want to deploy your own copy (e.g. your own GitHub Pages):

1. Push the repo to GitHub and enable **Pages** from **GitHub Actions** (Settings → Pages → Source: GitHub Actions).
2. The workflow at `.github/workflows/deploy.yml` builds and deploys `dist` on every push to `main`. No GitHub Variables or secrets are required — the built app is just static files; all config is loaded by users from their own JSON file.
3. The app is served at `https://YOUR_USERNAME.github.io/REPO_NAME/` (or your custom domain). Users open that URL and link/import their `ritmol-data.json` as above.
