# RITMOF

A gamified life companion PWA for STEM university students. Solo Leveling RPG aesthetic. Black and white. No server — runs entirely in your browser. **Stack:** React, Vite; data lives in **localStorage**. Sync across devices by **reading and writing a single JSON file** with [Syncthing](https://syncthing.net/) via the browser File System Access API.

## Design Philosophy & Security Model

**RITMOF is intentionally a single-user, self-hosted application.**

The app is designed for one person running it on multiple devices using a static host (e.g. GitHub Pages). It does **not** aim to support multiple users or enterprise-grade authentication.

Because the app runs entirely in the browser and is open source, some API keys (such as the Gemini key) are included in the frontend build via environment variables. This is **acceptable for the intended use case** because:

* the **deployer** (repo owner) sets the Gemini key in **GitHub repository Variables** — end users do not enter API keys in the app
* keys are **not committed to the repository**
* the app is **not a public multi-user service**

### Threat Model

The intended deployment model is:

```
Your devices  ←→  Syncthing  ←→  one JSON file (your data)
                     ↑
              GitHub Pages (static site only)
```

There is **no backend server** and no central database. Sync is **file-based**: you export/import (or point the app at) a single JSON file that Syncthing keeps in sync across your machines.

Therefore:

* Authentication gates (Google sign-in) are **convenience access filters**, not strong security guarantees.
* API keys embedded in the frontend bundle are acceptable when restricted in the provider dashboard.
* The app assumes **a trusted user environment**.

### Important Rules

When cloning or deploying:

1. **Never commit `.env` files or API keys**
2. For AI features, set the **Gemini API key** (`VITE_GEMINI_API_KEY`) in **GitHub repo Variables** (deploy) or in `.env` (local dev) — it is never entered in the app UI
3. Optionally restrict the key in [Google AI Studio](https://aistudio.google.com/apikey) (API restrictions → Gemini only; optionally add an HTTP referrer for your domain)

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

**Access control:** The app is single-user. In **production** the Google sign-in gate is always on (fail-closed). Only the Google account set in `VITE_ALLOWED_EMAIL` can use the app. The sign-in session is stored in **sessionStorage** (tab-scoped); closing the tab logs you out. Set **both** `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` in your environment (e.g. GitHub Actions Variables or `.env`); never commit secrets. In **local dev**, leave both empty to run without the gate; if you set either one, you must set both or the app shows a configuration error. After too many failed sign-in attempts the gate asks you to refresh the page.

**API keys:** The Gemini API key (`VITE_GEMINI_API_KEY`) is supplied via **GitHub repository Variables** for the deployed build (set by the repo owner in Settings → Secrets and variables → Actions → Variables). For local dev it comes from `.env`. It is **not** entered by users in the app. See `.env.example` and the deploy section below. The app enforces a **daily token budget** for Gemini (shown as “neural energy” in the UI); when exhausted, AI features (chat, gacha, daily quote, etc.) are disabled until the next day.

---

## After cloning

1. **Clone and enter the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ritmof.git
   cd ritmof
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run locally**
   ```bash
   npm run dev
   ```
   Opens at `http://localhost:5173`. Copy `.env.example` to `.env` and set `VITE_GEMINI_API_KEY`. For **single-account access**, also set `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`; to run **without the gate**, leave those two empty.

4. **Local `.env`**  
   Copy `.env.example` to `.env`. Set `VITE_GEMINI_API_KEY` so the app can run. For the sign-in gate, set both `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`, or leave both empty in dev. Never put real secrets in the repo.

---

## Sync: Syncthing + File System Access API

Data is stored in **localStorage**. To use the same data on multiple devices, RITMOF uses the browser's [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write a JSON file directly on disk — no OAuth, no cloud accounts, no API keys.

### How it works

1. **Install Syncthing** on all your devices from [syncthing.net](https://syncthing.net/). Create a shared folder (e.g. `~/ritmof-sync/`) and share it between your devices.
2. **On first use**, go to **Profile → Settings → SYNCTHING SYNC** and click **LINK SYNCTHING FILE**. Pick (or create) `ritmof-data.json` inside your Syncthing folder. The browser remembers this file handle across sessions.
3. **Push ↑** — writes your current data to the file. Syncthing picks it up and distributes it to your other devices.
4. **Pull ↓** — reads the file that Syncthing has updated from another device and loads it into the app.
5. The app also **auto-pushes** when you switch tabs or close the browser, so your file is always up to date.

> **Browser support:** File System Access API works in **Chrome and Edge** (desktop). Firefox and iOS Safari do not support it. On unsupported browsers, the app falls back to **Download** (saves a JSON file) and **Import** (loads a JSON file via file picker). You move the downloaded file to your Syncthing folder manually in that case.

The sync file must be **valid JSON** and may not exceed **10 MB**. If you Pull or Import a corrupt or oversized file, the app shows an error and does not overwrite your local data.

### Onboarding (new device)

The last step of the onboarding wizard prompts you to link your Syncthing file. You can skip this and do it later in **Profile → Settings**.

---

## Deploy: GitHub Pages (recommended, free)

**Checklist:** Push repo → enable Pages from GitHub Actions → add **GitHub repo Variables** for `VITE_ALLOWED_EMAIL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_GEMINI_API_KEY` (the Gemini key is configured here, not by end users). Optionally add a JWT verification endpoint URL if you use a backend.

**Live site config:** Set the variables above under **Settings → Secrets and variables → Actions → Variables**. No `.env` file is used for the deployed build; the workflow reads the Gemini key (and other secrets) from GitHub Variables. In production the sign-in gate is always enforced.

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/ritmof.git
git push -u origin main
```

**If you rewrote history** (e.g. to remove a committed secret): use `git push --force origin main`. Only force-push when you're sure no one else is building on the old history.

### 2 — Enable GitHub Pages

1. Repo → **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. The workflow at `.github/workflows/deploy.yml` runs on every push to `main`.

**If the page is blank** and the console shows a disallowed MIME type for `App.jsx` → the site is serving source instead of the built app. Set **Source** to **GitHub Actions**, then push a commit so the workflow deploys the `dist` folder.

### 3 — Base path

The workflow sets `VITE_BASE_PATH` from your repo name. The app is served at `https://YOUR_USERNAME.github.io/REPO_NAME/`. No change needed.

### 4 — Restrict access (single Google account)

Only the Google account in `VITE_ALLOWED_EMAIL` can use the app. In production the gate is always on.

1. Add **GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `VITE_ALLOWED_EMAIL`: your Google account email
   - `VITE_GOOGLE_CLIENT_ID`: your Google OAuth Client ID (Web application, with your GitHub Pages URL in Authorized JavaScript origins)
   - `VITE_GEMINI_API_KEY`: your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) — the deployed app gets this from GitHub Variables; users do not enter it in the app
   - No `VITE_DROPBOX_APP_KEY` needed — sync is handled via Syncthing directly.

2. Push a commit so the workflow rebuilds. The app will show the Google sign-in gate; only the configured email can continue.

**Security note:** Without server-side verification, the client decodes the Google ID token in the browser and validates claims (`iss`, `aud`, `exp`, `email_verified`) but cannot verify the JWT signature. For stronger assurance, you can add a small backend that verifies the token and returns the email. The repo includes an example serverless function at `api/verify-google-id.js` (Vercel-style). Deploy it (e.g. to Vercel), set `GOOGLE_CLIENT_ID` in the function’s environment, and set `VITE_VERIFY_GOOGLE_ID_URL` in your front-end env to the function URL.

---

## Local Dev

The app shows a **configuration screen** until `VITE_GEMINI_API_KEY` is set in the environment (GitHub Variables or `.env`). Run:

```bash
npm install
npm run dev   # → http://localhost:5173
```

For **single-account access**, create a `.env` from `.env.example` and set `VITE_ALLOWED_EMAIL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_GEMINI_API_KEY`. To run **without the sign-in gate**, leave `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` empty; you still need the Gemini key.

**Dev mode protects your real data:** When you run `npm run dev`, the app uses a **separate localStorage copy** for all its own keys (prefixed with `ritmof_dev_`). Caches and app data are isolated from production. A yellow **DEV MODE** bar at the top reminds you.
