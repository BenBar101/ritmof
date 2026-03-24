import { useState, useMemo, useEffect } from "react";
import { STYLE_CSS } from "./constants";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { getGeminiApiKey } from "./utils/db";
import { isAuthenticated } from "./api/dropbox";
import { loadGoogleGIS, GCAL_SCOPE } from "./api/gcal";
import { isGoogleAuthConnected, startGoogleOAuthFlow } from "./api/googleAuth";
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
        setConnectError("Dropbox is not configured in this build. Skip and enter your Gemini key manually.");
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
        Your Gemini API key will be stored securely in your Dropbox — configure once,
        use everywhere.
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
      await loadGoogleGIS();
      await new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: id,
          scope: GCAL_SCOPE,
          callback: (resp) => {
            if (resp.error) reject(new Error(resp.error));
            else resolve(resp);
          },
        });
        // Always use "consent" on first connect so the OAuth consent screen appears
        tokenClient.requestAccessToken({ prompt: "consent" });
      });
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


export function GeminiKeySetupScreen({ onSave }) {
  const [key, setKey]           = useState("");
  const [showKey, setShowKey]   = useState(false);
  const [error, setError]       = useState("");

  const mono = { fontFamily: "'Share Tech Mono', monospace" };

  // Format-only validation — no network ping needed.
  // The key will be tested naturally on first real AI use.
  const formatOk = /^AIza[A-Za-z0-9_-]{20,60}$/.test(key.trim());

  function handleSave() {
    const trimmed = key.trim();
    if (!formatOk) {
      setError("Key must start with AIza and be 24–64 characters.");
      return;
    }
    setError("");
    onSave(trimmed);
  }

  // Row helper for the "where it goes" disclosure table
  function InfoRow({ icon, text }) {
    return (
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <span style={{ ...mono, fontSize: "14px", color: "#fff", flexShrink: 0, lineHeight: "1.6" }}>{icon}</span>
        <span style={{ ...mono, fontSize: "13px", color: "#fff", lineHeight: "1.6" }}>{text}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── Step-by-step guide ── */}
      <div style={{ border: "2px solid #fff", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ ...mono, fontSize: "11px", letterSpacing: "3px", color: "#fff", fontWeight: "bold", marginBottom: "2px" }}>
          HOW TO GET YOUR FREE KEY
        </div>
        {[
          ["1", "Open", "aistudio.google.com/apikey", "https://aistudio.google.com/apikey"],
          ["2", "Click", "Create API key", null],
          ["3", "Copy the key and paste it below", null, null],
        ].map(([num, prefix, label, href]) => (
          <div key={num} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{
              ...mono, fontSize: "11px", fontWeight: "bold", color: "#000",
              background: "#fff", width: "20px", height: "20px",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>{num}</span>
            <span style={{ ...mono, fontSize: "13px", color: "#fff", lineHeight: "1.5" }}>
              {prefix}{" "}
              {href
                ? <a href={href} target="_blank" rel="noopener noreferrer"
                     style={{ color: "#fff", textDecoration: "underline" }}>{label}</a>
                : <strong>{label}</strong>
              }
            </span>
          </div>
        ))}
      </div>

      {/* ── Key input ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label style={{ ...mono, fontSize: "11px", letterSpacing: "3px", color: "#fff", fontWeight: "bold" }}>
          YOUR API KEY
        </label>
        <div style={{ display: "flex", gap: "0", border: "2px solid #fff" }}>
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(""); }}
            placeholder="AIza..."
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            data-testid="api-key"
            style={{
              flex: 1, padding: "12px", background: "#000",
              color: "#fff", fontSize: "15px", ...mono,
              outline: "none", border: "none",
              // Mask placeholder dots for password type
              letterSpacing: showKey ? "0.5px" : "2px",
            }}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? "Hide key" : "Show key"}
            style={{
              ...mono, fontSize: "13px", padding: "0 12px",
              background: "none", border: "none", borderLeft: "2px solid #fff",
              color: "#fff", cursor: "pointer", minWidth: "52px",
            }}
          >
            {showKey ? "HIDE" : "SHOW"}
          </button>
        </div>
      </div>

      {/* ── Transparency disclosure ── */}
      <div style={{ border: "2px solid #555", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ ...mono, fontSize: "11px", letterSpacing: "3px", color: "#fff", fontWeight: "bold", marginBottom: "2px" }}>
          WHERE YOUR KEY GOES
        </div>
        <InfoRow icon="▸" text="Stored in sessionStorage only — cleared when you close the tab." />
        <InfoRow icon="▸" text="Saved inside your own sync file (ritmol-data.json) on Dropbox or your local drive. Never on any RITMOL server — there is no server." />
        <InfoRow icon="▸" text={'Sent only to generativelanguage.googleapis.com. You can verify this in DevTools → Network and filter by "generativelanguage".'} />
        <InfoRow icon="▸" text="Never logged, never sent to analytics, never embedded in bug reports." />
      </div>

      {/* ── Save button ── */}
      <button
        type="button"
        onClick={handleSave}
        disabled={!formatOk}
        data-testid="save-gemini"
        style={{
          ...mono, width: "100%", padding: "14px",
          border: "2px solid #fff",
          background: !formatOk ? "transparent" : "#fff",
          color: !formatOk ? "#555" : "#000",
          fontSize: "15px", letterSpacing: "2px",
          cursor: !formatOk ? "not-allowed" : "pointer",
          fontWeight: "bold",
        }}
      >
        SAVE &amp; CONTINUE ›
      </button>

      {/* ── Error ── */}
      {error && (
        <div style={{ ...mono, color: "#fff", fontSize: "14px", fontWeight: "bold", border: "2px solid #fff", padding: "10px" }}>
          [ ERR ] {error}
        </div>
      )}

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

function GeminiAiOnboardingStep({ onGeminiKeySaved, onAdvance }) {
  const envClientId = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID || "").trim();
  const [oauthConnected, setOauthConnected] = useState(() => isGoogleAuthConnected());
  const [connectErr, setConnectErr] = useState("");
  // If no env client ID, let user enter their own
  const [manualClientId, setManualClientId] = useState("");
  // "oauth" (default) | "apikey" — tab switcher for power users
  const [authMode, setAuthMode] = useState("oauth");
  const [oauthStarted, setOauthStarted] = useState(false);

  const mono = { fontFamily: "'Share Tech Mono', monospace" };

  const activeClientId = envClientId || manualClientId.trim();

  useEffect(() => {
    const id = setInterval(() => {
      if (isGoogleAuthConnected()) setOauthConnected(true);
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Auto-advance once OAuth is confirmed
  useEffect(() => {
    if (!oauthConnected) return;
    const t = setTimeout(() => onAdvance?.(), 1000);
    return () => clearTimeout(t);
  }, [oauthConnected, onAdvance]);

  function handleOAuth() {
    setConnectErr("");
    const id = activeClientId;
    if (!id) {
      setConnectErr("Enter your Google Client ID above to continue.");
      return;
    }
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) {
      setConnectErr("Invalid format — must end in .apps.googleusercontent.com");
      return;
    }
    try {
      setOauthStarted(true);
      startGoogleOAuthFlow(id);
    } catch (e) {
      setOauthStarted(false);
      setConnectErr(e?.message || "Could not start Google sign-in.");
    }
  }

  if (oauthConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center", padding: "8px 0" }}>
        <div style={{
          width: "64px", height: "64px", borderRadius: "0",
          border: "3px solid #fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "32px", color: "#fff",
        }}>✓</div>
        <div style={{ fontSize: "18px", color: "#fff", letterSpacing: "2px", fontWeight: "bold", ...mono }}>[ GOOGLE CONNECTED ]</div>
        <div style={{ fontSize: "16px", color: "#fff", textAlign: "center", ...mono }}>CONTINUING…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "0", border: "2px solid #fff" }}>
        {[["oauth", "SIGN IN WITH GOOGLE"], ["apikey", "RAW API KEY"]].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => { setAuthMode(mode); setConnectErr(""); }}
            style={{
              flex: 1, padding: "10px", border: "none",
              background: authMode === mode ? "#fff" : "transparent",
              color: authMode === mode ? "#000" : "#fff",
              ...mono, fontSize: "11px", letterSpacing: "2px",
              cursor: "pointer", fontWeight: "bold",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {authMode === "oauth" ? (
        <>
          <div style={{ fontSize: "13px", color: "#fff", lineHeight: "1.7", ...mono }}>
            Sign in with Google — no API key to copy/paste. Uses OAuth so your credentials are never stored in plain text.
          </div>

          {/* Client ID input — only shown when not baked in at build time */}
          {!envClientId && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ ...mono, fontSize: "11px", letterSpacing: "3px", color: "#fff", fontWeight: "bold" }}>
                GOOGLE CLIENT ID
              </label>
              <input
                type="text"
                value={manualClientId}
                onChange={(e) => { setManualClientId(e.target.value); setConnectErr(""); }}
                placeholder="xxxx.apps.googleusercontent.com"
                style={{
                  background: "#000", border: "2px solid #fff", color: "#fff",
                  padding: "10px", fontSize: "13px", ...mono, outline: "none",
                }}
              />
              <div style={{ ...mono, fontSize: "11px", color: "#aaa", lineHeight: "1.6" }}>
                Get one free at{" "}
                <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer"
                   style={{ color: "#fff" }}>console.cloud.google.com</a>
                {" "}→ APIs &amp; Services → Credentials → Create OAuth 2.0 Client ID.
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleOAuth}
            disabled={oauthStarted}
            style={{
              width: "100%", padding: "14px", border: "2px solid #fff",
              background: oauthStarted ? "transparent" : "#fff",
              color: oauthStarted ? "#fff" : "#000",
              ...mono, fontSize: "16px", letterSpacing: "2px",
              cursor: oauthStarted ? "not-allowed" : "pointer",
            }}
          >
            {oauthStarted ? "OPENING GOOGLE…" : "SIGN IN WITH GOOGLE"}
          </button>

          {!!getGeminiApiKey() && (
            <button
              type="button"
              onClick={() => onAdvance?.()}
              style={{
                width: "100%", padding: "12px", border: "2px solid #555", background: "transparent", color: "#888",
                ...mono, fontSize: "13px", letterSpacing: "1px", cursor: "pointer",
              }}
            >
              Continue with existing API key from synced data
            </button>
          )}

          {connectErr && (
            <div style={{ color: "#fff", fontSize: "13px", ...mono, fontWeight: "bold", border: "2px solid #fff", padding: "10px" }}>
              [ ERR ] {connectErr}
            </div>
          )}
        </>
      ) : (
        <GeminiKeySetupScreen
          onSave={(key) => {
            onGeminiKeySaved(key, null);
            onAdvance();
          }}
        />
      )}
    </div>
  );
}

const BASE_URL = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || "";
const APP_ICON_URL = BASE_URL ? `${BASE_URL}/icon-192.png` : "/icon-192.png";

// ── Main onboarding ───────────────────────────────────────────
export default function Onboarding({ onComplete, onGeminiKeySaved, connectDropbox, setState, healthKitEnabled }) {
  // needsDropbox is snapshotted once — Dropbox auth navigates away and back,
  // so by the time we're here the auth state is already final.
  const needsDropbox = useMemo(() => !isAuthenticated(), []);
  const envGoogleClientId = (typeof import.meta !== "undefined" && import.meta.env?.VITE_GOOGLE_CLIENT_ID || "").trim();
  // needsGemini is reactive state so it updates when Dropbox connects and
  // pulls the Gemini key into sessionStorage during the onboarding flow.
  const [needsGemini, setNeedsGemini] = useState(() => {
    if (getGeminiApiKey()) return false;
    if (isGoogleAuthConnected()) return false;
    return true;
  });

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

    if (needsGemini) {
      list.push({
        key: "_gemini",
        title: envGoogleClientId ? "GOOGLE AI ACCESS" : "AI AUTHENTICATION",
        subtitle: envGoogleClientId
          ? "Sign in with Google for Gemini access — no API key needed."
          : "Sign in with Google OAuth (recommended) or paste a raw Gemini API key.",
        type: "_gemini",
        style: "geometric",
        optional: false,
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
  }, [needsDropbox, needsGemini, envGoogleClientId, healthKitEnabled]);

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
    // Re-check whether we still need the Gemini step — Dropbox may have
    // pulled the key into sessionStorage while the user was on that step.
    // setNeedsGemini(false) will cause steps to rebuild (shorter list) on
    // the next render, so we read the key first before calling setStep.
    const keyNowPresent = !!getGeminiApiKey();
    const googleConnected = isGoogleAuthConnected();
    if (keyNowPresent || googleConnected) setNeedsGemini(false);
    // Calculate next step against the list length that will exist after the
    // rebuild: if the Gemini step is being dropped, the list shrinks by 1.
    const nextListLength = steps.length - ((keyNowPresent || googleConnected) && needsGemini ? 1 : 0);
    if (step < nextListLength - 1) {
      setStep(step + 1);
    } else {
      onComplete(sanitizeForm(form));
    }
  }

  function handleNext() {
    if (current.type === "_dropbox" || current.type === "_gemini" || current.type === "_gcal" || current.type === "_healthkit") {
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

        {current.type === "_gemini" && (
          <GeminiAiOnboardingStep onGeminiKeySaved={onGeminiKeySaved} onAdvance={advance} />
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

        {current.type !== "_dropbox" && current.type !== "_gemini" && current.type !== "_gcal" && current.type !== "_healthkit" && (
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
