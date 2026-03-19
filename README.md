# RITMOL ◈ 

A gamified, AI-powered life companion PWA for STEM university students, featuring a monochrome, E-ink safe *Solo Leveling* RPG aesthetic. 

**Zero telemetry. No backend. Fully self-hosted.** RITMOL runs entirely in your browser. Your data is stored locally in IndexedDB (via TinyBase) and synced across devices using your own **Dropbox** or **Syncthing** (via the File System Access API). 

---

## 📖 Table of Contents
- [Core Features](#-core-features)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Security & Threat Model](#-security--threat-model)
- [Getting Started (Using the App)](#-getting-started-using-the-app)
- [Configuration Guide](#-configuration-guide)
  - [Gemini API Key](#1-gemini-api-key-required)
  - [Dropbox Sync](#2-dropbox-sync-optional)
  - [Google Calendar](#3-google-calendar-optional)
- [Local Development](#-local-development)

---

## ✨ Core Features

### 🎮 RPG Progression
*   **XP & Ranks:** Earn XP by completing tasks, habits, and study sessions to rank up (Novice → Apprentice → Adept → Elite → Ascendant).
*   **Dynamic Economy:** The AI dynamically adjusts the XP cost of Gacha pulls and Streak Shields based on your current wealth and level.
*   **The Chronicle Engine (Gacha):** Spend XP to "pull" AI-generated aesthetic cards—either striking ASCII rank cosmetics or atmospheric prose styled after your favorite books.
*   **Missions:** Daily hardcoded missions, plus AI-generated Weekly and Monthly missions tailored to your specific university major and interests.

### 🧠 AI Integration (Gemini 2.5 Flash)
*   **Neural Energy:** RITMOL tracks your daily API token usage. If you hit the daily cap (80k-100k tokens), AI features safely lock until midnight.
*   **Voice-Enabled Chat:** Chat with RITMOL to ask for study advice, have it assign you tasks, or reflect on your day.
*   **Personalized Habit Generation:** On first run, RITMOL generates a customized habit protocol based on your major and semester goals.

### 📚 Study & Health Tracking
*   **Session Logging:** Log Lectures, Tirguls, Homework, and Prep with variable focus levels to calculate XP multipliers.
*   **Calendar Sync:** Connect Google Calendar to import lectures and exams. RITMOL will detect upcoming exams and issue "EXAM WARNINGS" on your HUD.
*   **Scheduler:** Built-in prompts for daily login bonuses, evening screen-time checks, and sleep quality logging.

---

## 🏗 Architecture & Tech Stack

*   **Frontend:** React 18, Vite.
*   **Data Store:** [TinyBase](https://tinybase.org/) (In-memory reactive store) with write-through persistence to **IndexedDB**. 
*   **Validation:** Zod for all incoming sync payloads and API responses.
*   **Styling:** Inline React styles with a global injected CSS sheet (`GlobalStyles.jsx`) that explicitly kills all animations for **E-ink display compatibility**.
*   **Sync:** File-based manual sync. Uses Dropbox OAuth PKCE or the browser's native **File System Access API** to read/write a single `ritmol-data.json` file.

### Write-Through Persistence
State management is handled in `useAppState.js`. When React state updates, the changes are synchronously committed to TinyBase, triggering an immediate IndexedDB auto-save. This eliminates race conditions where closing the tab too quickly could cause data loss.

---

## 🛡 Security & Threat Model

RITMOL is designed to be hosted statically (e.g., GitHub Pages, Vercel). **The static host never sees your data or API keys.**

Because the app handles raw AI JSON responses and user-synced files, it includes aggressive client-side security:

1.  **Prompt Injection Defense:** `sanitizeForPrompt()` explicitly strips XML-breakout characters (`< > { } [ ]`), bi-directional override characters (`U+202A–U+202E`), zero-width chars, and ANSI escape sequences from all user inputs before they are sent to Gemini.
2.  **Prototype Pollution Guard:** `isSafeSyncValue()` recursively scans incoming AI JSON and Syncthing payloads, immediately rejecting any object containing `__proto__`, `constructor`, or `prototype` keys.
3.  **Strict Sync Schemas:** Zod strictly enforces the shape, length, and bounds of every field in `ritmol-data.json`. Files exceeding 10MB are rejected.
4.  **Key Isolation:** The Gemini API key is read from the sync file directly into `sessionStorage`. It is *never* saved to IndexedDB or `localStorage`, and it is *never* written back out during a Push.

> **Warning:** Sync is **manual**. Do not run RITMOL in two tabs or on two devices simultaneously. Push before leaving a device; Pull when arriving at a new one.

---

## 🚀 Getting Started (Using the App)

You don't need to clone the repo to use RITMOL. You can use any hosted static build.

1.  **First Run (Onboarding):**
    *   Open the app. The **Initialization Protocol** will start.
    *   Choose to connect **Dropbox** (recommended for cross-device sync).
    *   Enter your **Gemini API Key** (see below).
    *   Input your "Hunter" profile (Name, Major, Interests, Semester Goal). Optional details like favorite books can be added later in Profile.
2.  **Returning on a New Device:**
    *   Open the app. You will hit the **Missing Key Gate / Lock Screen**.
    *   Click **Connect Dropbox** (or "Load from Syncthing file").
    *   Click **Pull ↓**. RITMOL will load your save file, extract your Gemini key into session storage, and restore your UI.

---

## ⚙️ Configuration Guide

If you are hosting your own instance or running locally, here is how to configure the external services.

### 1. Gemini API Key (Required)
RITMOL requires a free Google Gemini API key.
1. Get one at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Enter it during the app's Onboarding flow. It will be saved securely inside your `ritmol-data.json` sync file.
3. **Recommended Security:** Go to the [Google Cloud Console](https://console.cloud.google.com/), find your API key under *APIs & Services > Credentials*, and restrict it to the **Generative Language API**. Set a daily quota (e.g., 500 requests/day).

### 2. Dropbox Sync (Optional)
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