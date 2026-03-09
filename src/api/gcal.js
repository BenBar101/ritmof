// ═══════════════════════════════════════════════════════════════
// GOOGLE CALENDAR (GIS TokenClient + REST — no deprecated gapi.client)
// ═══════════════════════════════════════════════════════════════
export async function fetchGCalEvents(accessToken, maxResults = 30) {
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
      { headers: { Authorization: `Bearer ${accessToken}` } }
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
      id: e.id,
      title: e.summary || "Event",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      type: detectEventType(e.summary || ""),
    }));
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
    if (window.google?.accounts?.id) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(s);
  });
}
