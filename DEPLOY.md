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

### Google Sign-In (Gemini on iOS / Android)

Native apps use **Google Sign-In** (`@capgo/capacitor-social-login`), not a custom `ritmol://` redirect.

1. **Web client** — `VITE_GOOGLE_CLIENT_ID`: OAuth client type **Web application** (same as the browser). Use authorised JavaScript origins and redirect URIs for your deployed site (e.g. `https://…/google-callback`).
2. **iOS client** — `VITE_GOOGLE_IOS_CLIENT_ID`: create an OAuth client type **iOS** with bundle ID `com.ritmol.app`. Pass this into Xcode / CI for native builds. The web client ID is still required: it is used as the server client ID on iOS and for Android.
3. **Android** — use the web client ID; add your app’s **SHA-1** fingerprint in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (signing certificate from Android Studio or Play App Signing).

### Dropbox (native iOS / Android)

Native builds use **OAuth2** via `@capgo/capacitor-social-login` (in-app browser / `ASWebAuthenticationSession` on iOS), not a full-page web redirect.

In the [Dropbox App Console](https://www.dropbox.com/developers/apps), add this **OAuth 2 redirect URI** (in addition to your `https://…/dropbox-callback` URLs for the web app):

`ritmol://auth/dropbox`

**Store builds**

- **iOS:** Open `ios/App/App.xcworkspace` in Xcode → Product → Archive.  
  Enable the **HealthKit** capability and **App Groups** (`group.com.ritmol.app`) if you use Health sleep import or home-screen widgets. Add a **Widget Extension** target if you want the widget UI; `RitmolWidgetPlugin` writes JSON to the shared App Group for the extension to read.
- **Android:** `cd android && ./gradlew bundleRelease` (requires a compatible JDK for the project’s Gradle version).

## Changing the Gemini model

Edit `GEMINI_MODEL` in `src/config.js`, then rebuild. Nothing else changes.

## Changing API base URLs or versions

Edit the relevant constants in `src/config.js`, then rebuild.

## Background fetch (iOS)

`AppDelegate` implements `application(_:performFetchWithCompletionHandler:)` and posts `RitmolBackgroundFetch`. To surface that to the web layer, wire a small native bridge or rely on foreground `appStateChange` (already used for AI notification ticks).
for local iphone:
npm run build && npx cap sync ios

npx cap run ios --target "D26CC21B-708D-4EA0-B15B-758BDF69ABD5"

---

npm run dev