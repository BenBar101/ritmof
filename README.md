# RITMOL

A gamified life companion PWA for STEM university students. Solo Leveling RPG aesthetic. Black and white. No server — runs entirely in your browser. **Stack:** React, Vite; data lives in **localStorage**. All application logic and UI live in **`src/App.jsx`**. Sync across devices by **reading and writing a single JSON file** with [Syncthing](https://syncthing.net/) via the browser File System Access API.

### Features

- **Tabs:** Home (daily quote, missions, quick actions), Habits (track with XP), Tasks & Goals, RITMOL (AI chat), Profile.
- **Profile sections:** Overview (Hunter card, streak shield, rank ladder), Achievements, Calendar (Google Calendar events), Gacha, Settings (Syncthing sync, theme).
- **RPG mechanics:** XP, levels, ranks (Rookie → Transcendent), streak and streak shields, daily missions, achievements, gacha (AI-generated rewards). Costs (XP per level, gacha, streak shield) can be updated by the AI.
- **AI (Gemini 2.5 Flash):** Daily token budget shown as "neural energy"; when exhausted, AI features (chat, gacha, daily quote, habit suggestions, etc.) are disabled until the next day. Chat can run commands (add task, set daily goal, suggest sessions, unlock achievement, etc.). See **Gemini API Key** below for how to obtain and configure your key.
- **Study:** Session logging (lecture, tirgul, homework, prep) with focus level, timers, sleep/screen log, daily goal. Optional Google Calendar integration.

### Project structure

- **`src/App.jsx`** — all app logic, UI, sync, and auth.
- **`index.html`** — entry point; includes SPA redirect handling for GitHub Pages.
- **`vite.config.js`** — Vite config; `base` is set from `VITE_BASE_PATH` (e.g. repo name for GitHub Pages).
- **`.github/workflows/deploy.yml`** — GitHub Actions workflow: build with repo Variables, deploy `dist` to Pages.
- **`api/verify-google-id.js`** — optional serverless JWT verification (e.g. Vercel); used when `VITE_VERIFY_GOOGLE_ID_URL` is set.
- **`manifest.json`**, **`sw.js`** — PWA manifest and service worker.
- **`public/404.html`** — copied to `dist`; redirects 404s to the SPA so client-side routes and OAuth callbacks work on GitHub Pages.

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

There is **no backend server** and no central database. Sync is **file-based**: a single JSON file that Syncthing keeps in sync across your machines. The Gemini API key lives in that file — it never touches GitHub.

The threat model is a **remote attacker** who finds your GitHub Pages URL. They are stopped by the Google sign-in gate (only your email can pass). Anyone with **physical access to your running browser session** can read `sessionStorage` via DevTools — that is an accepted risk for a personal app you run on your own machine. The Gemini key is visible there like any other credential held in memory by a single-page app; mitigate by restricting the key in AI Studio (Gemini API only) and setting a daily quota cap.

Therefore:

* Authentication gates (Google sign-in) are **convenience access filters** against remote access, not cryptographic guarantees against a local attacker.
* The Gemini key is **not in the build** and **not in GitHub Variables** — it is distributed only via your private Syncthing file and held in `sessionStorage` for the tab's lifetime.
* The app assumes a **trusted device environment**.

### Known security risks (and why they are okay here)

**What can go wrong, realistically:**

- **Local attacker with your machine:** If someone already has access to your running session (DevTools, your user account, or worse, root), they can:
  - Read `sessionStorage` and see your Gemini key.
  - Read your `ritmol-data.json` file from disk or your Syncthing folder.
  - Modify the built JS bundle in memory or via a malicious browser extension.
- **Malicious static host compromise:** If your static host is compromised and serves modified JS, the attacker could try to bypass the in-browser Google token checks or exfiltrate your data/Gemini key while you are using the app.

These are **accepted risks** for this project. RITMOL is a **personal life companion** you run on your own devices. If an attacker already has that level of access to your machine or hosting account, you have much bigger problems (password managers, banking, email, etc.) than this app.

**How you can harden things:**

- **Host on Vercel (or similar):** You can deploy the static build and the `api/verify-google-id.js` serverless function to Vercel instead of (or in addition to) GitHub Pages. This gives you:
  - A managed static host with HTTPS out of the box.
  - Optional server-side verification of the Google ID token via `VITE_VERIFY_GOOGLE_ID_URL`, so the gate is backed by a signed JWT check on your own endpoint.
- **Treat your machine as the trust anchor:** Keep your OS up to date, use a password manager, do not install untrusted browser extensions, and avoid running RITMOL on shared/public machines.
- **Lock down your Gemini key:** Restrict it to the Gemini API only, set a daily quota cap, and rotate it if you ever suspect compromise.

The maintainer does **not** aim to defend against a determined local attacker with full access to your machine. The goal is to make remote abuse of a public URL difficult while keeping the architecture simple, and to assume that if someone can already rummage through your browser storage or home directory, they are not going to start by attacking your habit tracker.

### Important Rules

When cloning or deploying:

1. **Never commit `.env` files or API keys**
2. For the **sign-in gate**, set `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` in GitHub repo Variables (see **How to get the Google Client ID** below). These are the only two variables the build needs.
3. For AI features, add `"geminiKey": "AIza..."` to your `ritmol-data.json` sync file, then **Pull** it into the app. The key never appears in the build or in GitHub.
4. **(Optional)** Add `VITE_VERIFY_GOOGLE_ID_URL` if you deploy the server-side JWT verification endpoint.

### Non-Goals

The project intentionally avoids:

* backend servers
* databases
* complex authentication systems
* multi-user support
* enterprise security infrastructure
* third-party cloud storage (Dropbox, Google Drive, etc.)

Contributors and automated tools should **not** add server components or cloud sync services unless the project scope changes. The goal is to keep the system **simple, portable, and peer-to-peer friendly**.

---

**Access control:** The app is single-user. In **production** the Google sign-in gate is always on (fail-closed). Only the Google account set in `VITE_ALLOWED_EMAIL` can use the app. The sign-in session is stored in **sessionStorage** (tab-scoped); closing the tab logs you out. Set `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` in GitHub repo Variables — these are the only two variables needed at build time. **No server is required** — the app validates the Google token in the browser. Optionally, set `VITE_VERIFY_GOOGLE_ID_URL` to a deployed JWT verification endpoint for stronger assurance. In **local dev**, leave both auth vars empty to run without the gate; if you set either one you must set both or the app shows a configuration error. After too many failed sign-in attempts the gate asks you to refresh the page.

**Gemini API key:** The key is **not** baked into the build and **not** stored in GitHub Variables. Add `"geminiKey": "AIza..."` as a top-level field in your `ritmol-data.json` sync file. On Pull (or on first load when a file handle is already linked), the app reads the key and stores it in **sessionStorage** only — it is never written to `localStorage` and never included in outgoing Push payloads. If you open a fresh tab without Pulling, the app shows a configuration screen prompting you to Pull. The app enforces a **daily token budget** for Gemini (shown as "neural energy" in the UI); when exhausted, AI features are disabled until the next day.

---

## After cloning

1. **Clone and enter the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ritmol.git
   cd ritmol
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Prepare example data (optional)**
   If you want to start with the provided sample data, you can **rename the `example-data` folder to `data` (remove the `example-` prefix)** so you are using the example `ritmol-data.json` as your app data.

4. **Run locally**
   ```bash
   npm run dev
   ```
   For **single-account access**, create a `.env` from `.env.example` and set `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`. To run **without the gate**, leave those two empty. The Gemini key comes from your sync file — see the **Gemini API Key** section below.

5. **(Optional) Local `.env` reference**
   The only build-time variables are the two auth vars. `VITE_SYNC_FILE_PATH` is a display-only path hint shown in Settings (e.g. `/Users/you/Syncthing/ritmol-data.json`). The Gemini key is not an env var — it lives in `ritmol-data.json`.

---

## Gemini API Key

The Gemini key is distributed via your Syncthing file, not via the build. It never appears in the compiled JS bundle and never needs to touch GitHub.

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

After a Pull, the key lives in `sessionStorage` for the lifetime of the tab. It is visible in DevTools → Application → Session Storage to anyone with access to your running browser. This is the accepted risk for this app's threat model (trusted device; remote attacker blocked by Google sign-in). Close the tab when done if you are on a shared machine.

---

## Sync: Syncthing + File System Access API

Data is stored in **localStorage**. To use the same data on multiple devices, RITMOL uses the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write a JSON file directly on disk — no OAuth, no cloud accounts, no extra services.

### How it works

1. **Install Syncthing** on all your devices from [syncthing.net](https://syncthing.net/). Create a shared folder (e.g. `~/ritmol-sync/`) and share it between your devices.
2. **On first use**, go to **Profile → Settings → SYNCTHING SYNC** and click **LINK SYNCTHING FILE**. Pick (or create) `ritmol-data.json` inside your Syncthing folder. The browser remembers this file handle across sessions.
3. **Push ↑** — writes your current data to the file. Syncthing picks it up and distributes it to your other devices.
4. **Pull ↓** — reads the file that Syncthing has updated from another device and loads it into the app. Also re-reads `geminiKey` from the file into `sessionStorage`.
5. The app also **auto-pushes** when you switch tabs or close the browser, so your file is always up to date.

> **Browser support:** File System Access API works in **Chrome and Edge** (desktop). Firefox and iOS Safari do not support it. On unsupported browsers, the app falls back to **Download** (saves a JSON file) and **Import** (loads a JSON file via file picker). You move the downloaded file to your Syncthing folder manually in that case.

The sync file must be **valid JSON** and may not exceed **10 MB**. If you Pull or Import a corrupt or oversized file, the app shows an error and does not overwrite your local data.

### Implementation notes (sync & security)

The app applies a number of safeguards documented in code comments in `src/App.jsx`:

- **Sync:** Corrupt or oversized sync files are rejected (no tab crash). Only allowlisted keys (`SYNC_KEYS`) are written from incoming payloads; `geminiKey` is extracted into `sessionStorage` only and never re-exported in Push. Incoming payloads are validated with `SYNC_VALIDATORS` per key; schema version is enforced (`SYNC_SCHEMA_VERSION`, `buildSyncPayload` / `applySyncPayload`). Timers and habit suggestions are included in the sync payload. Dev and prod use separate localStorage prefixes and **separate sync file handles** (different IndexedDB key); in dev you can link a test file and use **Pull** to refresh the dev copy without affecting production. Before each Push (manual or auto-push on tab hide), the app **flushes the latest in-memory state to localStorage** so the sync file always reflects current data. The sync file handle is stored in **IndexedDB**; the DB connection is **cached and reused** (and cleared on error so the next call retries) for reliability on low-end devices.
- **Auth:** Google JWT payload is validated (iss, aud, exp, email_verified); malformed tokens are rejected. The in-app session (nonce in sessionStorage) is a **UX guard**, not a strong security boundary; the **trust anchor** is the Google-signed JWT verified above. Sign-in retry is rate-limited; the failure counter resets on success. Unlinking the sync file uses an in-app confirmation (no `window.confirm`) for PWA compatibility.
- **AI safety:** All user-supplied and prompt data (profile, tasks, goals, habits, data tables sent to the AI) is **sanitized** to reduce JSON/prompt injection. Token usage is capped per day; AI-awarded XP is capped per day to prevent runaway accumulation.

### Onboarding (new device)

The last step of the onboarding wizard prompts you to link your Syncthing file. You can skip this and do it later in **Profile → Settings**.

---

## Deploy: GitHub Pages (recommended, free)

**Checklist:** Push repo → enable Pages from GitHub Actions → add **GitHub repo Variables** for `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`. Add your Gemini key to `ritmol-data.json` (not to GitHub). No `.env` file is used for the deployed build.

**Live site config:** Set the variables below under **Settings → Secrets and variables → Actions → Variables**. In production the sign-in gate is always enforced. **No server required** — the app validates the Google token in the browser.

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/ritmol.git
git push -u origin main
```

**If you rewrote history** (e.g. to remove a committed secret): use `git push --force origin main`. Only force-push when you're sure no one else is building on the old history.

### 2 — Enable GitHub Pages

1. Repo → **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not "Deploy from a branch").
3. The workflow at `.github/workflows/deploy.yml` runs on every push to `main`.

**If the page is blank** and the console shows a disallowed MIME type for `App.jsx` → the site is serving source instead of the built app. Set **Source** to **GitHub Actions**, then push a commit so the workflow deploys the `dist` folder.

### 3 — Base path

The workflow sets `VITE_BASE_PATH` from your repo name. The app is served at `https://YOUR_USERNAME.github.io/REPO_NAME/`. No change needed.

### 4 — Restrict access (single Google account) and set GitHub Variables

Only the Google account in `VITE_ALLOWED_EMAIL` can use the app. In production the gate is always on.

#### How to get the Google Client ID and set GitHub Variables

1. **Get a Google OAuth Client ID (Web application)**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Click the project dropdown at the top → **New Project** (or select an existing one).
   - Open **APIs & Services** → **Credentials**.
   - Click **+ Create Credentials** → **OAuth client ID**.
   - If prompted, set the OAuth consent screen (e.g. External, add your email as test user).
   - Application type: **Web application**.
   - Name it (e.g. "RITMOL").
   - Under **Authorized JavaScript origins**, add:
     - Your GitHub Pages URL: `https://YOUR_USERNAME.github.io` (and if you use a custom domain, add it too).
     - For local dev: `http://localhost:5173`.
   - Under **Authorized redirect URIs** you can leave empty for the Google Identity Services (GIS) one-tap flow used by RITMOL.
   - Click **Create**. Copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).

2. **Add GitHub repository Variables**
   In your repo go to **Settings → Secrets and variables → Actions → Variables** and add:

   | Variable | Description |
   |----------|-------------|
   | `VITE_ALLOWED_EMAIL` | Your Google account email (the only account that can sign in). |
   | `VITE_GOOGLE_CLIENT_ID` | The Web application Client ID from step 1 (e.g. `xxxxx.apps.googleusercontent.com`). |

   That is all that is needed for the build. The Gemini key is **not** a GitHub Variable — see the **Gemini API Key** section above.

3. **(Optional) Stronger security: JWT verification endpoint**
   If you want server-side verification of the Google token:
   - Deploy the repo's `api/verify-google-id.js` to [Vercel](https://vercel.com) (or another serverless platform).
   - In the function's environment, set `GOOGLE_CLIENT_ID` (or `VITE_GOOGLE_CLIENT_ID`) to the **same** Client ID from step 1.
   - Add a third variable: `VITE_VERIFY_GOOGLE_ID_URL` = the public URL of your deployed function (e.g. `https://your-app.vercel.app/api/verify-google-id`).

**Security note:** Without a verify endpoint, the app decodes the Google ID token in the browser and validates claims (iss, aud, exp, email_verified). That is fine for a single-user personal app. If you set `VITE_VERIFY_GOOGLE_ID_URL`, the app sends the token to your serverless function, which verifies the JWT signature with Google's public keys for stronger assurance.

---

## Local Dev

The app shows a **configuration screen** until a Gemini key is available in `sessionStorage` (loaded via Pull from your sync file). Run:

```bash
npm install
npm run dev   # -> http://localhost:5173
```

For **single-account access**, create a `.env` from `.env.example` and set `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`. To run **without the sign-in gate**, leave those two empty. Then link your sync file (which contains `geminiKey`) and Pull to activate AI features.

To test the production build locally, run `npm run build` then `npm run preview`.

**Dev mode protects your real data:** When you run `npm run dev`, the app uses a **separate localStorage copy** for all its own keys (prefixed with `ritmol_dev_`) and a **separate sync file handle** (stored under a different IndexedDB key). Caches and app data are isolated from production. Use **Pull** in Profile → Settings to refresh the dev copy from your Syncthing file. A yellow **DEV MODE** bar at the top reminds you.
