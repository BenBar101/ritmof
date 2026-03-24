# Deploying RITMOL

## Cloudflare Pages (primary)

1. Connect the repository at [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Environment variables (set in the Cloudflare dashboard, not committed):

   - `VITE_DROPBOX_APP_KEY`
   - `VITE_GOOGLE_CLIENT_ID`

5. Optional: set `VITE_BASE_URL` if the site is not served from `/` (for example a subpath). Otherwise `VITE_BASE_PATH` still works for GitHub Pages–style repo roots.

6. Custom domain (optional): Pages → Custom Domains.

## Native builds

After any web change:

```bash
npm run build && npx cap sync
```

- **iOS:** Open `ios/App/App.xcworkspace` in Xcode → Product → Archive.  
  Enable the **HealthKit** capability and **App Groups** (`group.com.ritmol.app`) if you use Health sleep import or home-screen widgets. Add a **Widget Extension** target if you want the widget UI; `RitmolWidgetPlugin` writes JSON to the shared App Group for the extension to read.
- **Android:** `cd android && ./gradlew bundleRelease` (requires a compatible JDK for the project’s Gradle version).

## Changing the Gemini model

Edit `GEMINI_MODEL` in `src/config.js`, then rebuild. Nothing else changes.

## Changing API base URLs or versions

Edit the relevant constants in `src/config.js`, then rebuild.

## Background fetch (iOS)

`AppDelegate` implements `application(_:performFetchWithCompletionHandler:)` and posts `RitmolBackgroundFetch`. To surface that to the web layer, wire a small native bridge or rely on foreground `appStateChange` (already used for AI notification ticks).
