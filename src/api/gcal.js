// ═══════════════════════════════════════════════════════════════
// GOOGLE CALENDAR (GIS TokenClient + REST — no deprecated gapi.client)
// ═══════════════════════════════════════════════════════════════

// Fix [GC-1]: sanitize helpers for GCal event fields.
// Google Calendar events have user-controlled content (titles, IDs). A crafted
// calendar event with BiDi overrides in the title can visually disguise text in
// the UI. An invalid start/end date string causes new Date("bad") → Invalid Date
// which propagates NaN through all date arithmetic and renders as "NaN" in the UI.
function stripCtrl(s) {
  if (typeof s !== "string") return "";
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")    // C0 / C1 controls
    .replace(/[\u2028\u2029]/g, "")                    // Unicode line/para separators
    .replace(/[\u200B-\u200D\uFEFF]/g, "")             // zero-width chars
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")      // BiDi override chars
    // Tags block (U+E0000–U+E01FF) and variation selectors live in the
    // supplementary planes; approximate them via their UTF-16 surrogate ranges.
    .replace(/\uDB40[\uDC00-\uDFFF]/g, "")             // Tags block surrogates
    .replace(/[\uFE00-\uFE0F]/g, "");                  // Variation Selectors
}

// Validates that a date/datetime string produces a real Date before storing it.
// Returns the original string if valid, or null if it would produce Invalid Date.
function safeDate(s) {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : s;
}

export async function fetchGCalEvents(accessToken, maxResults = 30) {
  // Fix: guard against null/empty token — a missing token would send
  // "Authorization: Bearer null" which gives a misleading 401 error.
  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("GCAL_TOKEN_EXPIRED");
  }
  const safeMax = Math.min(Math.max(1, Number(maxResults) || 30), 100);
  try {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 14 * 86400000).toISOString();
    const params = new URLSearchParams({
      timeMin: now,
      timeMax: future,
      maxResults: String(safeMax),
      singleEvents: "true",
      orderBy: "startTime",
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        // Fix: add request timeout so a slow/unresponsive GCal API doesn't block
        // the UI indefinitely. 15 s is generous for a calendar list fetch.
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      }
    );
    if (!res.ok) {
      if (res.status === 401) throw new Error("GCAL_TOKEN_EXPIRED");
      const label = res.status === 403 ? "GCAL_PERMISSION_DENIED"
                  : res.status === 429 ? "GCAL_RATE_LIMITED"
                  : `GCAL_HTTP_${res.status}`;
      throw new Error(label);
    }
    const data = await res.json();
    return (data.items || []).map((e) => ({
      // Fix [GC-1]: sanitize all fields from the API response before they reach state
      // and localStorage. Although Google's API is trusted, user-controlled calendar
      // content (event titles, external-calendar entries) can contain BiDi overrides,
      // control chars, or invalid date strings.
      id:    typeof e.id === "string" ? e.id.replace(/[^a-zA-Z0-9_@.-]/g, "").slice(0, 150) : `gcal_${Date.now()}`,
      title: stripCtrl(e.summary || "Event").slice(0, 200),
      start: safeDate(e.start?.dateTime || e.start?.date),
      end:   safeDate(e.end?.dateTime   || e.end?.date),
      type:  detectEventType(e.summary || ""),
      source: "gcal",
    })).filter(e => e.start !== null); // drop events with invalid start dates
  } catch (e) {
    if (e?.message?.startsWith("GCAL_")) throw e;
    throw new Error("GCAL_NETWORK_ERROR");
  }
}

// Fix #7: Normalise to NFC before lowercasing so Unicode variants (full-width chars,
// copy-pasted text from some calendar clients) match correctly.
export function detectEventType(title) {
  const t = title.normalize("NFC").toLowerCase();
  if (t.includes("exam") || t.includes("midterm") || t.includes("final") || t.includes("test")) return "exam";
  if (t.includes("lecture") || t.includes("class")) return "lecture";
  if (t.includes("hw") || t.includes("homework") || t.includes("assignment") || t.includes("due")) return "homework";
  if (t.includes("tirgul") || t.includes("tutorial") || t.includes("recitation")) return "tirgul";
  return "other";
}

// Used for Google Calendar OAuth (GIS TokenClient).
export function loadGoogleGIS() {
  return new Promise((resolve, reject) => {
    // Fix: check for google.accounts.oauth2 (the token client used for Calendar),
    // not google.accounts.id (the Sign-In button) — these are different GIS surfaces.
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => {
      // Double-check that the loaded script actually exposed the expected API.
      if (!window.google?.accounts?.oauth2) {
        reject(new Error("Google Identity Services loaded but oauth2 API is unavailable."));
        return;
      }
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(s);
  });
}
