import { useState, useMemo, useEffect } from "react";
import { STYLE_CSS } from "./constants";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { isAuthenticated } from "./api/dropbox";
import { requestGcalAccessToken } from "./api/gcal";
import { RitmolHealth } from "./plugins/RitmolHealth.js";
import GeometricCorners from "./GeometricCorners";

export const primaryBtn = {
  width: "100%", marginTop: "20px", padding: "14px",
  background: "#fff", color: "#000",
  fontFamily: "'Share Tech Mono', monospace", fontSize: "18px", letterSpacing: "2px",
  border: "none", cursor: "pointer",
};

export function inputStyle(s) {
  return {
    width: "100%", background: "#000", border: "2px solid #fff",
    color: "#fff", padding: "14px", fontSize: "16px",
    fontFamily: s.fontFamily, outline: "none", resize: "none",
    borderRadius: "0",
  };
}

// ── Dropbox step ──────────────────────────────────────────────
function DropboxOnboardingStep({ connectDropbox, onSkip, onAdvance }) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  // Check if we just returned from the Dropbox OAuth flow
  const [connected, setConnected] = useState(() => isAuthenticated());

  // Poll for auth on focus — handles the case where the user approved Dropbox
  // in the popup/tab and returned to this page.
  useEffect(() => {
    if (connected) return;
    const check = () => {
      if (isAuthenticated()) {
        setConnected(true);
        setConnecting(false);
      }
    };
    window.addEventListener("focus", check);
    // Also poll every 800ms while connecting so we catch the redirect-back case
    const interval = setInterval(check, 800);
    return () => {
      window.removeEventListener("focus", check);
      clearInterval(interval);
    };
  }, [connected]);

  // Auto-advance 1.2s after connection is confirmed so the user sees the ✓ state
  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => onAdvance?.(), 1200);
    return () => clearTimeout(t);
  }, [connected, onAdvance]);

  function handleConnect() {
    setConnectError("");
    setConnecting(true);
    try {
      connectDropbox();
      // startOAuthFlow() navigates away — if we're still here after 3s,
      // something went wrong (popup blocked, key not configured, etc.)
      setTimeout(() => {
        if (!isAuthenticated()) {
          setConnecting(false);
        }
      }, 3000);
    } catch (e) {
      setConnecting(false);
      if (e?.message === "DROPBOX_NOT_CONFIGURED") {
        setConnectError("Dropbox is not configured in this build. You can skip and sync manually later.");
      } else {
        setConnectError("Could not start Dropbox connection. Try again.");
      }
    }
  }

  if (connected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", padding: "8px 0" }}>
        <div style={{
          width: "64px", height: "64px", borderRadius: "0",
          border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "32px", color: "#fff",
        }}>✓</div>
        <div style={{ fontSize: "18px", color: "#fff", letterSpacing: "2px", fontWeight: "bold", fontFamily: "'Share Tech Mono', monospace" }}>[ DROPBOX CONNECTED ]</div>
        <div style={{ fontSize: "16px", color: "#fff", textAlign: "center", fontFamily: "'Share Tech Mono', monospace" }}>
          CONTINUING TO NEXT STEP...
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "15px", color: "#fff", lineHeight: "1.7" }}>
        Connect Dropbox to sync your data across devices and back it up automatically.
        Your progress stays in your own file — configure once, use everywhere.
      </div>
      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting}
        style={{
          width: "100%", padding: "14px", border: "2px solid #fff",
          background: connecting ? "transparent" : "#fff",
          color: connecting ? "#fff" : "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px",
          cursor: connecting ? "not-allowed" : "pointer",
        }}
      >
        {connecting ? "OPENING DROPBOX…" : "CONNECT DROPBOX"}
      </button>
      {connectError && (
        <div style={{ color: "#fff", fontSize: "16px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {connectError}</div>
      )}
      <div style={{ height: "2px", background: "#fff" }} />
      <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.6", fontFamily: "'Share Tech Mono', monospace" }}>
        Already have a save file? Connecting Dropbox will pull it automatically.
        No account? You can skip this and sync manually later in Profile → Settings.
      </div>
      <button
        type="button"
        onClick={onSkip}
        data-testid="skip-dropbox"
        style={{
          width: "100%", padding: "12px", border: "2px solid #fff", background: "transparent", color: "#fff",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "1px", cursor: "pointer",
          minHeight: "56px",
        }}
      >
        SKIP FOR NOW
      </button>
    </div>
  );
}

// ── Google Calendar step ───────────────────────────────────────
function GCalOnboardingStep({ onSkip, onAdvance, profile, onClientIdChange }) {
  const envClientId = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID || "").trim();
  const [clientId, setClientId] = useState(profile?.googleClientId || envClientId || "");
  const [status, setStatus] = useState("idle"); // "idle" | "connecting" | "connected"
  const [error, setError] = useState("");
  const needsClientId = !envClientId && !(profile?.googleClientId);

  function handleClientIdChange(val) {
    setClientId(val);
    onClientIdChange?.(val);
  }

  async function handleConnect() {
    const id = clientId.trim();
    if (!id) {
      setError("Enter your Google Client ID to continue, or skip.");
      return;
    }
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
      setError("Invalid format — must end in .apps.googleusercontent.com");
      return;
    }
    setStatus("connecting");
    setError("");
    try {
      await requestGcalAccessToken(id, { promptConsent: true });
      setStatus("connected");
      // Auto-advance after briefly showing success
      setTimeout(() => onAdvance?.(), 1200);
    } catch (e) {
      setStatus("idle");
      if (e?.message === "popup_closed_by_user" || e?.message === "access_denied") {
        setError("Auth cancelled. You can connect later in Profile → Calendar.");
      } else {
        setError("Could not connect. Check your Client ID or try again.");
      }
    }
  }

  if (status === "connected") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", padding: "8px 0" }}>
        <div style={{
          width: "64px", height: "64px", borderRadius: "0",
          border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "32px", color: "#fff",
        }}>✓</div>
        <div style={{ fontSize: "18px", color: "#fff", letterSpacing: "2px", fontWeight: "bold", fontFamily: "'Share Tech Mono', monospace" }}>[ GCAL CONNECTED ]</div>
        <div style={{ fontSize: "16px", color: "#fff", textAlign: "center", fontFamily: "'Share Tech Mono', monospace" }}>CONTINUING TO NEXT STEP...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "15px", color: "#fff", lineHeight: "1.7" }}>
        Connect Google Calendar to automatically import lectures, exams, and deadlines.
        RITMOL will adapt your study plan around your schedule.
      </div>

      {needsClientId && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>
            GOOGLE CLIENT ID
          </label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => handleClientIdChange(e.target.value)}
            placeholder="xxxx.apps.googleusercontent.com"
            style={{
              width: "100%", background: "#000", border: "2px solid #fff",
              color: "#fff", padding: "12px", fontSize: "16px",
              fontFamily: "'Share Tech Mono', monospace", outline: "none",
            }}
          />
          <div style={{ fontSize: "16px", color: "#fff", lineHeight: "1.6", fontFamily: "'Share Tech Mono', monospace" }}>
            Get one at console.cloud.google.com → APIs &amp; Services → Credentials.
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={status === "connecting"}
        style={{
          width: "100%", padding: "14px", border: "2px solid #fff",
          background: status === "connecting" ? "#000" : "#fff",
          color: status === "connecting" ? "#fff" : "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "2px",
          cursor: status === "connecting" ? "not-allowed" : "pointer",
          transition: "none",
        }}
      >
        {status === "connecting" ? "OPENING GOOGLE…" : "CONNECT GOOGLE CALENDAR"}
      </button>

      {error && <div style={{ color: "#fff", fontSize: "16px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {error}</div>}

      <div style={{ height: "2px", background: "#fff" }} />

      <button
        type="button"
        onClick={onSkip}
        data-testid="skip-calendar"
        style={{
          width: "100%", padding: "12px", border: "2px solid #fff", background: "transparent", color: "#fff",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", letterSpacing: "1px", cursor: "pointer",
          minHeight: "56px",
        }}
      >
        SKIP FOR NOW
      </button>
    </div>
  );
}

function HealthKitOnboardingStep({ setState, onAdvance }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "15px", color: "#fff", lineHeight: "1.7", fontFamily: "'Share Tech Mono', monospace" }}>
        Optional: allow RITMOL to read sleep data from Apple Health to pre-fill your log. No health data is sent to Dropbox or any server.
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            const { granted } = await RitmolHealth.requestPermission();
            setState?.((s) => ({ ...s, healthKitEnabled: !!granted }));
          } catch {
            setState?.((s) => ({ ...s, healthKitEnabled: false }));
          }
          onAdvance?.();
        }}
        style={{ ...primaryBtn }}
      >
        ALLOW HEALTH ACCESS
      </button>
      <button
        type="button"
        onClick={() => onAdvance?.()}
        style={{
          width: "100%", padding: "12px", border: "2px solid #fff", background: "transparent", color: "#fff",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", cursor: "pointer", minHeight: "48px",
        }}
      >
        SKIP
      </button>
    </div>
  );
}

const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
const APP_ICON_URL = BASE_URL ? `${BASE_URL}/icon-192.png` : "/icon-192.png";

// ── Main onboarding ───────────────────────────────────────────
export default function Onboarding({ onComplete, connectDropbox, setState, healthKitEnabled }) {
  // needsDropbox is snapshotted once — Dropbox auth navigates away and back,
  // so by the time we're here the auth state is already final.
  const needsDropbox = useMemo(() => !isAuthenticated(), []);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", major: "", interests: "", semesterGoal: "", gcalClientId: "" });
  const [error, setError] = useState("");

  // ── Build step list dynamically ──────────────────────────────
  const steps = useMemo(() => {
    const list = [];

    if (needsDropbox) {
      list.push({
        key: "_dropbox",
        title: "SYNC SETUP",
        subtitle: "Connect Dropbox to back up and sync your data across devices.",
        type: "_dropbox",
        style: "ascii",
        optional: true,
      });
    }

    // Google Calendar — always offered (skippable)
    list.push({
      key: "_gcal",
      title: "CALENDAR SYNC",
      subtitle: "Import lectures, exams, and deadlines from Google Calendar.",
      type: "_gcal",
      style: "geometric",
      optional: true,
    });

    // Profile fields — always shown
    list.push(
      {
        key: "name",
        title: "SYSTEM INITIALIZATION",
        subtitle: "Hunter identification required.",
        field: "name", label: "YOUR NAME", placeholder: "Enter designation...", type: "text",
        style: "ascii",
        maxLen: 60,
      },
      {
        key: "major",
        title: "FIELD OF STUDY",
        subtitle: "Specialization determines mission parameters.",
        field: "major", label: "MAJOR / FIELD", placeholder: "e.g. Computer Science, Physics...", type: "text",
        style: "geometric",
        maxLen: 80,
      },
      {
        key: "interests",
        title: "INTEREST MAPPING",
        subtitle: "Hobbies and subjects outside study. Used to personalize observations.",
        field: "interests", label: "INTERESTS", placeholder: "e.g. Chess, weightlifting, philosophy...", type: "textarea",
        style: "typewriter",
        maxLen: 200,
      },
      {
        key: "semesterGoal",
        title: "SEMESTER OBJECTIVE",
        subtitle: "State your primary goal for this semester.",
        field: "semesterGoal", label: "SEMESTER GOAL", placeholder: "e.g. Finish with >90 GPA, land internship...", type: "textarea",
        style: "geometric",
        maxLen: 300,
      },
    );

    const capIos =
      typeof window !== "undefined" &&
      window.Capacitor?.isNativePlatform?.() &&
      window.Capacitor?.getPlatform?.() === "ios";
    if (capIos && !healthKitEnabled) {
      list.push({
        key: "_healthkit",
        title: "APPLE HEALTH",
        subtitle: "Optional sleep import from Health (iOS only).",
        type: "_healthkit",
        style: "geometric",
        optional: true,
      });
    }

    return list;
  }, [needsDropbox, healthKitEnabled]);

  const current = steps[step];

  // ── Helpers ──────────────────────────────────────────────────
  function sanitizeField(str, maxLen = 300) {
    return sanitizeForPrompt(str ?? "", maxLen);
  }

  // sanitizeForPrompt strips ALL control chars (code <= 31), including newlines.
  // For textarea fields where users press Enter to separate items, normalise
  // newlines into ", " first so entries don't get jammed together.
  function sanitizeMultilineField(str, maxLen = 300) {
    const normalized = (str ?? "").replace(/[\n\r]+/g, ", ").replace(/,\s*,+/g, ",").trim();
    return sanitizeForPrompt(normalized, maxLen);
  }

  function sanitizeForm(f) {
    return {
      name: sanitizeField(f.name, 60),
      major: sanitizeField(f.major, 80),
      books: "",
      interests: sanitizeMultilineField(f.interests, 200),
      semesterGoal: sanitizeMultilineField(f.semesterGoal, 300),
      // Persist the Client ID entered during onboarding so the profile has it immediately.
      // Validate format before saving — same rule as ProfileTab's saveClientId().
      ...(f.gcalClientId && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(f.gcalClientId.trim())
        ? { googleClientId: f.gcalClientId.trim() }
        : {}),
      utcOffsetMinutes: -(new Date().getTimezoneOffset()),
      timezoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Unknown",
    };
  }

  function advance() {
    setError("");
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete(sanitizeForm(form));
    }
  }

  function handleNext() {
    if (current.type === "_dropbox" || current.type === "_gcal" || current.type === "_healthkit") {
      advance();
      return;
    }
    if (!form[current.field]?.trim()) {
      setError("This field is required.");
      return;
    }
    advance();
  }

  const isLastStep = step === steps.length - 1;
  const styleMap = STYLE_CSS;
  const s = styleMap[current.style] || styleMap.ascii;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={{
      height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "24px", background: "#000",
    }}>
      {/* App icon */}
      <img
        src={APP_ICON_URL}
        alt=""
        style={{ width: 44, height: 44, marginTop: "16px", marginBottom: "12px" }}
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      {/* Progress bar */}
      <div style={{ width: "100%", maxWidth: "380px", marginBottom: "24px", marginTop: "16px" }}>
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: "4px", background: i <= step ? "#fff" : "#555" }} />
          ))}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "16px", color: "#fff", textAlign: "right", fontWeight: "bold" }}>
          {step + 1}/{steps.length}
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: "100%", maxWidth: "380px", padding: "24px",
        background: s.background, border: s.border,
        fontFamily: s.fontFamily,
      }}>
        <GeometricCorners style={current.style} />
        <div style={{ fontSize: "14px", color: "#fff", letterSpacing: "3px", marginBottom: "8px", fontWeight: "bold" }}>
          PROTOCOL {step + 1}
        </div>
        <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "6px", letterSpacing: "1px" }}>
          {current.title}
        </div>
        <div style={{ fontSize: "16px", color: "#fff", marginBottom: "18px", fontStyle: current.style === "dots" ? "italic" : "normal", fontFamily: "'Share Tech Mono', monospace" }}>
          {current.subtitle}
        </div>

        {/* ── Step-specific content ── */}
        {current.type === "_dropbox" && (
          <DropboxOnboardingStep
            connectDropbox={connectDropbox}
            onSkip={advance}
            onAdvance={advance}
          />
        )}

        {current.type === "_gcal" && (
          <GCalOnboardingStep
            profile={null}
            onSkip={advance}
            onAdvance={advance}
            onClientIdChange={(id) => setForm((f) => ({ ...f, gcalClientId: id }))}
          />
        )}

        {current.type === "_healthkit" && (
          <HealthKitOnboardingStep setState={setState} onAdvance={advance} />
        )}

        {current.type !== "_dropbox" && current.type !== "_gcal" && current.type !== "_healthkit" && (
          <>
            <label style={{ fontSize: "16px", color: "#fff", letterSpacing: "2px", display: "block", marginBottom: "6px", marginTop: "0", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>
              {current.label}
            </label>
            {current.type === "textarea" ? (
              <textarea
                value={form[current.field]}
                onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
                placeholder={current.placeholder}
                rows={3}
                maxLength={current.maxLen}
                style={inputStyle(s)}
                data-testid={current.field === "semesterGoal" ? "goal" : current.field}
              />
            ) : (
              <input
                type={current.type}
                value={form[current.field]}
                onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
                placeholder={current.placeholder}
                maxLength={current.maxLen}
                style={inputStyle(s)}
                data-testid={current.field === "semesterGoal" ? "goal" : current.field}
              />
            )}

            {error && <div style={{ color: "#fff", fontSize: "16px", marginTop: "8px", fontFamily: "'Share Tech Mono', monospace", fontWeight: "bold" }}>[ ERR ] {error}</div>}

            <div style={{ fontSize: "16px", color: "#fff", fontFamily: "'Share Tech Mono', monospace", marginTop: "8px" }}>
              DETECTED TIMEZONE: {Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Unknown"}
              {" "}(UTC{-(new Date().getTimezoneOffset()) >= 0 ? "+" : ""}{(-(new Date().getTimezoneOffset()) / 60).toFixed(0)})
            </div>

            <button type="button" onClick={handleNext} data-testid="start" style={{ ...primaryBtn, marginTop: "16px" }}>
              {isLastStep ? "INITIALIZE RITMOL" : "NEXT ›"}
            </button>
          </>
        )}
      </div>

      <div style={{ marginTop: "16px", marginBottom: "32px", fontSize: "16px", color: "#fff", fontFamily: "'Share Tech Mono', monospace" }}>
        RITMOL v1.0 // LOCAL STORAGE ONLY // ZERO TELEMETRY
      </div>
    </div>
  );
}
