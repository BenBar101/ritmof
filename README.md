# JARVIS

A gamified life companion PWA for STEM university students. Solo Leveling RPG aesthetic. Black and white. No server — runs entirely in your browser.

---

## Deploy: GitHub Pages (recommended, free)

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/jarvis.git
git push -u origin main
```

### 2 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. The workflow at `.github/workflows/deploy.yml` runs automatically on every push to `main`

### 3 — Base path

The workflow sets `VITE_BASE_PATH` from your repo name automatically, so the app is served at `https://YOUR_USERNAME.github.io/REPO_NAME/`. No change needed.

### 4 — (Optional) Single-account access

To restrict the app to one Google account, set **Repository variables** (repo → Settings → Secrets and variables → Actions → Variables):

- `VITE_ALLOWED_EMAIL` — the only Google email that can sign in (e.g. `you@gmail.com`).
- `VITE_GOOGLE_CLIENT_ID` — OAuth Web application Client ID from [Google Cloud Console](https://console.cloud.google.com/). Use the same app as for Calendar, or create one. Add your GitHub Pages URL to **Authorized JavaScript origins** (e.g. `https://YOUR_USERNAME.github.io`).

Leave both empty to allow anyone to use the app. After setting them, push to trigger a new build.

Your app: `https://YOUR_USERNAME.github.io/REPO_NAME/`

---

## Deploy: Vercel (alternative)

1. Push to GitHub → [vercel.com](https://vercel.com) → New Project → import
2. Deploy — zero config (`vercel.json` handles SPA routing)
3. Remove `VITE_BASE_PATH` env var if set (Vercel uses `/`)

---

## Dropbox Sync

1. [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → Create app → Scoped → App folder
2. Permissions: enable `files.content.read` + `files.content.write` → Submit
3. Settings → Redirect URIs → add your deployed URL (and `http://localhost:5173`)
4. Copy the **App Key**
5. JARVIS → Profile → Settings → paste App Key → **CONNECT DROPBOX**

---

## Local Dev

```bash
npm install
npm run dev   # → http://localhost:5173
```
