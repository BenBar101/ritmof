# RITMOF

A gamified life companion PWA for STEM university students. Solo Leveling RPG aesthetic. Black and white. No server — runs entirely in your browser. **Stack:** React, Vite; data lives in **localStorage**; optional **Dropbox** sync backs it up and can sync across devices.

**Access control:** The app is single-user. In **production** the Google sign-in gate is always on (fail-closed). Only the Google account set in `VITE_ALLOWED_EMAIL` can use the app. You must set **both** `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` in your environment (e.g. GitHub Actions Variables or `.env`) and never commit secrets. In **local dev**, you can leave both empty to run without the gate; if you set either one, you must set both or the app shows a configuration error. After too many failed sign-in attempts the gate asks you to refresh the page before trying again.

**API keys:** The app expects **Gemini API key** (`VITE_GEMINI_API_KEY`) and **Dropbox App Key** (`VITE_DROPBOX_APP_KEY`) from the environment (GitHub repo Variables or `.env`). These are not entered in the UI. See `.env.example` and the deploy section below. Restrict the Gemini key in [Google AI Studio](https://aistudio.google.com/apikey) (API restrictions → Gemini only; optionally add an HTTP referrer for your domain) since it is embedded in the browser bundle at build time. The app enforces a **daily token budget** for Gemini (shown as “neural energy” in the UI); when the budget is exhausted, AI features (chat, gacha, daily quote, etc.) are disabled until the next day.

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
   Opens at `http://localhost:5173`. To use **single-account access** and **Dropbox sync**, copy `.env.example` to `.env` and set `VITE_ALLOWED_EMAIL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GEMINI_API_KEY`, and `VITE_DROPBOX_APP_KEY`. To run **without the gate** (no sign-in), leave `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` empty — you still need `VITE_GEMINI_API_KEY` and `VITE_DROPBOX_APP_KEY` or the app will show the configuration screen.

4. **Local `.env`**  
   Copy `.env.example` to `.env`. Set `VITE_GEMINI_API_KEY` and `VITE_DROPBOX_APP_KEY` so the app can run. For the sign-in gate, set both `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID`, or leave both empty in dev. Never put real secrets in the repo.

---

## Deploy: GitHub Pages (recommended, free)

**Checklist:** Push repo → enable Pages from GitHub Actions → add **GitHub repo Variables** for `VITE_ALLOWED_EMAIL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GEMINI_API_KEY`, and `VITE_DROPBOX_APP_KEY`. Optionally add a JWT verification endpoint URL if you use a backend.

**Live site config:** Set the four variables above under **Settings → Secrets and variables → Actions → Variables**. No `.env` file is used for the deployed build. In production the sign-in gate is always enforced.

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/ritmof.git
git push -u origin main
```

**If you rewrote history** (e.g. to remove a committed secret): use `git push --force origin main` so the remote matches your cleaned history. Only force-push when you're sure no one else is building on the old history.

### 2 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not "Deploy from a branch").
3. The workflow at `.github/workflows/deploy.yml` runs automatically on every push to `main`

**If the page is blank and the console shows**  
`Loading module from ".../src/App.jsx" was blocked because of a disallowed MIME type ("text/html")`  
→ The site is serving the repo source instead of the built app. Fix: set **Source** to **GitHub Actions** (step 2 above), then push a commit so the workflow runs and deploys the `dist` folder.

### 3 — Base path

The workflow sets `VITE_BASE_PATH` from your repo name automatically, so the app is served at `https://YOUR_USERNAME.github.io/REPO_NAME/`. No change needed.

### 4 — Restrict access (single Google account)

Only the Google account in `VITE_ALLOWED_EMAIL` can use the app. In production the gate is always on.

1. Add **GitHub repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `VITE_ALLOWED_EMAIL`: your Google account email (e.g. `you@gmail.com`)
   - `VITE_GOOGLE_CLIENT_ID`: your Google OAuth Client ID (Web application, with your GitHub Pages URL in Authorized JavaScript origins)
   - `VITE_GEMINI_API_KEY`: your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
   - `VITE_DROPBOX_APP_KEY`: your Dropbox App Key from [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)

2. Push a commit so the workflow rebuilds. The app will show the Google sign-in gate; only the configured email can continue.

**Security note:** Without server-side verification, the client decodes the Google ID token in the browser and validates claims (`iss`, `aud`, `exp`, `email_verified`) but cannot verify the JWT signature. For stronger assurance, add a small backend that verifies the token and returns the email. The repo includes an example serverless function at `api/verify-google-id.js` (Vercel-style). Deploy it (e.g. to Vercel), set `GOOGLE_CLIENT_ID` in the function's environment, and set `VITE_VERIFY_GOOGLE_ID_URL` in your front-end env to the function URL. The client will then POST the credential there and only continue if the response email matches.

---

## Dropbox Sync

1. [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → Create app → Scoped → App folder
2. Permissions: enable `files.content.read` + `files.content.write` → Submit
3. Settings → Redirect URIs → add your deployed URL (and `http://localhost:5173` for local testing)
4. Copy the **App Key** and set **`VITE_DROPBOX_APP_KEY`** in GitHub repo Variables (or `.env` locally). The app reads the key only from the environment, not from the UI. In the app: Profile → Settings → **CONNECT DROPBOX** to complete OAuth and enable sync.

**Token storage:** OAuth tokens and OAuth state (e.g. PKCE verifier) are kept in **sessionStorage** (tab-scoped). Closing the browser or tab clears them, so you’ll need to click **CONNECT DROPBOX** again after a full browser restart. App data (habits, tasks, XP, etc.) stays in localStorage and is unchanged; only the Dropbox connection is re-established.

---

## Local Dev

The app shows a **configuration screen** until `VITE_GEMINI_API_KEY` and `VITE_DROPBOX_APP_KEY` are set in the environment (GitHub Variables or `.env`). Run:

```bash
npm install
npm run dev   # → http://localhost:5173
```

To run with **single-account access** and **sync**, create a `.env` from `.env.example` and set all four: `VITE_ALLOWED_EMAIL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GEMINI_API_KEY`, `VITE_DROPBOX_APP_KEY`. To run **without the sign-in gate**, leave `VITE_ALLOWED_EMAIL` and `VITE_GOOGLE_CLIENT_ID` empty; you still need the Gemini and Dropbox keys.

**Dev mode protects your real data:** When you run `npm run dev`, the app uses a **separate localStorage copy** (all app keys prefixed with `ritmof_dev_`). Caches (e.g. daily quote) and app data are fully isolated from production. The app **never pushes to Dropbox** in dev; use the sync button to **pull** from Dropbox and refresh the local copy. A yellow "DEV MODE" bar at the top reminds you.
