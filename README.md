# RITMOL ◈

A gamified life companion PWA for STEM university students, featuring a monochrome, E-ink safe *Solo Leveling* RPG aesthetic.

**Zero telemetry. No backend. Fully self-hosted.** RITMOL runs entirely in your browser. Your data is stored locally in IndexedDB (via TinyBase) and synced across devices using your own **Dropbox** or **Syncthing** (via the File System Access API).

---

## 📖 Table of Contents
- [Core Features](#-core-features)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Security & Threat Model](#-security--threat-model)
- [Getting Started (Using the App)](#-getting-started-using-the-app)
- [Configuration Guide](#-configuration-guide)
  - [Dropbox Sync](#1-dropbox-sync-optional)
  - [Google Calendar](#2-google-calendar-optional)
- [Local Development](#-local-development)

---

## ✨ Core Features

### 🎮 RPG Progression
*   **XP & Ranks:** Earn XP by completing tasks, habits, and study sessions to rank up (Novice → Apprentice → Adept → Elite → Ascendant).
*   **Economy:** Gacha pulls and streak shields use configurable XP costs (defaults in `constants.js`).
*   **The Chronicle Engine (Gacha):** Spend XP to pull from a static catalog of rank titles and lore-flavored chronicle cards — no network required.
*   **Missions:** Daily missions plus weekly and monthly missions from static templates rotated by calendar period.

### 📚 Study & Health Tracking
*   **Session Logging:** Log Lectures, Tirguls, Homework, and Prep with variable focus levels to calculate XP multipliers.
*   **Calendar Sync:** Connect Google Calendar to import lectures and exams. Manual events can also be added.
*   **Scheduler:** Built-in prompts for daily login bonuses, evening screen-time checks, and sleep quality logging.

---

## 🏗 Architecture & Tech Stack

*   **Frontend:** React 18, Vite.
*   **Data Store:** [TinyBase](https://tinybase.org/) (In-memory reactive store) with write-through persistence to **IndexedDB**.
*   **Validation:** Zod for all incoming sync payloads.
*   **Styling:** Inline React styles with a global injected CSS sheet (`GlobalStyles.jsx`) that explicitly kills all animations for **E-ink display compatibility**.
*   **Sync:** File-based manual sync. Uses Dropbox OAuth PKCE or the browser's native **File System Access API** to read/write a single `ritmol-data.json` file.

### Write-Through Persistence
State management is handled in `useAppState.js`. When React state updates, the changes are synchronously committed to TinyBase, triggering an immediate IndexedDB auto-save. This eliminates race conditions where closing the tab too quickly could cause data loss.

---

## 🛡 Security & Threat Model

RITMOL is designed to be hosted statically (e.g., GitHub Pages, Vercel). **The static host never sees your data.**

Because the app handles user-synced files, it includes aggressive client-side security:

1.  **Prompt Injection Defense:** `sanitizeForPrompt()` strips risky characters from user inputs used in prompts or storage.
2.  **Prototype Pollution Guard:** `isSafeSyncValue()` recursively scans incoming payloads, rejects objects containing `__proto__`, `constructor`, or `prototype` keys.
3.  **Strict Sync Schemas:** Zod strictly enforces the shape, length, and bounds of every field in `ritmol-data.json`. Files exceeding 10MB are rejected.

> **Warning:** Sync is **manual**. Do not run RITMOL in two tabs or on two devices simultaneously. Push before leaving a device; Pull when arriving at a new one.

---

## 🚀 Getting Started (Using the App)

You don't need to clone the repo to use RITMOL. You can use any hosted static build.

1.  **First Run (Onboarding):**
    *   Open the app. The **Initialization Protocol** will start.
    *   Optionally connect **Dropbox** (recommended for cross-device sync) or skip and use export/import later.
    *   Optionally connect **Google Calendar**.
    *   Input your "Hunter" profile (Name, Major, Interests, Semester Goal).
2.  **Returning on a New Device:**
    *   Open the app and use **Connect Dropbox** (or **Import** a backup file), then **Pull ↓** to restore your save.

---

## ⚙️ Configuration Guide

If you are hosting your own instance or running locally, here is how to configure the external services.

### 1. Dropbox Sync (Optional)
To allow users to sync via Dropbox, you must provide a Dropbox App Key at build time.
1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) and click **Create app**.
   * API: Scoped access
   * Access type: App folder
2. Under **OAuth 2 / Redirect URIs**, add your deployed URL (e.g., `https://yourname.github.io/ritmol/dropbox-callback`) and `http://localhost:5173/dropbox-callback`.
3. Under **Permissions**, enable *only* `files.content.read` and `files.content.write`.
4. Copy the **App key**.
5. Create a `.env` file (or set a GitHub Actions Repository Variable) and add:
   ```env
   VITE_DROPBOX_APP_KEY=your_app_key_here
   ```

### 2. Google Calendar (Optional)
Set `VITE_GOOGLE_CLIENT_ID` to your OAuth client ID (`.apps.googleusercontent.com`) so Calendar sync can request read-only access.

---

## 💻 Local Development

```bash
npm install
npm run dev
```

Run `npm run lint` before committing.
