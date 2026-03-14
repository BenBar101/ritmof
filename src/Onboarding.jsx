import { useState } from "react";
import { STYLE_CSS } from "./constants";
import { sanitizeForPrompt } from "./api/systemPrompt";
import GeometricCorners from "./GeometricCorners";

export const primaryBtn = {
  width: "100%", marginTop: "20px", padding: "14px",
  background: "#fff", color: "#000",
  fontFamily: "'Share Tech Mono', monospace", fontSize: "14px", letterSpacing: "2px",
  border: "none", cursor: "pointer",
};

export function inputStyle(s) {
  return {
    width: "100%", background: "rgba(0,0,0,0.6)", border: "1px solid #444",
    color: "#e8e8e8", padding: "12px", fontSize: "15px",
    fontFamily: s.fontFamily, outline: "none", resize: "none",
    borderRadius: "0",
  };
}

function SyncOnboardingStep({ connectDropbox, onSkip }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "11px", color: "#888", lineHeight: "1.8" }}>
        Connect Dropbox to sync your data across devices and back it up automatically.
        Your Gemini API key will be stored securely in your Dropbox — configure once,
        use everywhere.
      </div>
      <button
        onClick={connectDropbox}
        style={{
          width: "100%", padding: "14px", border: "2px solid #fff", background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
        }}
      >
        CONNECT DROPBOX
      </button>
      <div style={{ height: "1px", background: "#333" }} />
      <div style={{ fontSize: "10px", color: "#555", lineHeight: "1.6" }}>
        Already have a save file? Connecting Dropbox will pull it automatically.
        No account? You can skip this and sync manually later in Profile → Settings.
      </div>
      <button
        onClick={onSkip}
        style={{
          width: "100%", padding: "10px", border: "1px solid #444", background: "transparent", color: "#888",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "1px", cursor: "pointer",
        }}
      >
        SKIP FOR NOW
      </button>
    </div>
  );
}

export function GeminiKeySetupScreen({ onSave }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  function handleSave() {
    const trimmed = key.trim();
    if (!/^AIza[A-Za-z0-9_-]{35,45}$/.test(trimmed)) {
      setError("Invalid key format. Get one free at aistudio.google.com/apikey");
      return;
    }
    setError("");
    onSave(trimmed);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ fontSize: "11px", color: "#888", lineHeight: "1.8" }}>
        Enter your Gemini API key to enable RITMOL&apos;s AI features.
        Get one free at aistudio.google.com/apikey
      </div>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="AIza..."
        style={{
          width: "100%", padding: "12px", background: "rgba(0,0,0,0.6)", border: "1px solid #444",
          color: "#e8e8e8", fontSize: "14px", fontFamily: "'Share Tech Mono', monospace", outline: "none",
        }}
      />
      {error && <div style={{ color: "#c44", fontSize: "10px" }}>⚠ {error}</div>}
      <button
        onClick={handleSave}
        style={{
          width: "100%", padding: "14px", border: "2px solid #fff", background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
        }}
      >
        SAVE &amp; CONTINUE
      </button>
    </div>
  );
}

export default function Onboarding({ onComplete, showGeminiKeySetup, onGeminiKeySaved, connectDropbox }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", major: "", books: "", interests: "", semesterGoal: "" });
  const [error, setError] = useState("");

  const steps = [
    {
      title: "SYSTEM INITIALIZATION",
      subtitle: "Hunter identification required.",
      field: "name", label: "YOUR NAME", placeholder: "Enter designation...", type: "text",
      style: "ascii",
    },
    {
      title: "FIELD OF STUDY",
      subtitle: "Specialization determines mission parameters.",
      field: "major", label: "MAJOR / FIELD", placeholder: "e.g. Computer Science, Physics...", type: "text",
      style: "geometric",
    },
    {
      title: "KNOWLEDGE BASE",
      subtitle: "Books and authors you read. This shapes your quotes and lore cards.",
      field: "books", label: "FAVORITE BOOKS / AUTHORS", placeholder: "e.g. Richard Feynman, Brandon Sanderson, Dune...", type: "textarea",
      style: "dots",
    },
    {
      title: "INTEREST MAPPING",
      subtitle: "Hobbies and subjects outside study. Used to personalize observations.",
      field: "interests", label: "INTERESTS", placeholder: "e.g. Chess, weightlifting, philosophy...", type: "textarea",
      style: "typewriter",
    },
    {
      title: "SEMESTER OBJECTIVE",
      subtitle: "State your primary goal for this semester.",
      field: "semesterGoal", label: "SEMESTER GOAL", placeholder: "e.g. Finish with >90 GPA, land internship...", type: "textarea",
      style: "geometric",
    },
    {
      title: "SYNC SETUP",
      subtitle: "Connect Dropbox to sync your data across devices and back it up automatically.",
      field: "_syncStep", label: "", placeholder: "", type: "_syncStep",
      style: "ascii",
      isSyncStep: true,
      optional: true,
    },
  ];

  const current = steps[step];

  function sanitizeField(str, maxLen = 300) {
    return sanitizeForPrompt(str ?? "", maxLen);
  }

  function sanitizeForm(f) {
    const allowed = {
      name: sanitizeField(f.name, 60),
      major: sanitizeField(f.major, 80),
      books: sanitizeField(f.books, 200),
      interests: sanitizeField(f.interests, 200),
      semesterGoal: sanitizeField(f.semesterGoal, 300),
      // utcOffsetMinutes: the user's current UTC offset in minutes (positive = east of UTC).
      // Re-read from the browser at onboarding time. DST is handled automatically because
      // we re-read this value at every call to localDateFromUTC() — it is stored here only
      // as the initial profile snapshot for the sync file.
      utcOffsetMinutes: -(new Date().getTimezoneOffset()),
      // timezoneLabel: human-readable string for display only. Never used in date math.
      timezoneLabel: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Unknown",
    };
    return allowed;
  }

  function handleNext() {
    if (current.optional && !form[current.field]?.trim()) {
      setError("");
      if (step < steps.length - 1) { setStep(step + 1); } else { onComplete(sanitizeForm(form)); }
      return;
    }
    if (current.type === "_infoOnly" || current.type === "_syncStep") {
      setError("");
      if (step < steps.length - 1) { setStep(step + 1); } else { onComplete(sanitizeForm(form)); }
      return;
    }
    if (!form[current.field]?.trim()) {
      setError("This field is required.");
      return;
    }
    setError("");
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      const sanitized = sanitizeForm(form);
      onComplete(sanitized);
    }
  }

  const styleMap = STYLE_CSS;
  const s = styleMap[current.style] || styleMap.ascii;

  if (showGeminiKeySetup) {
    return (
      <div style={{
        height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "flex-start", padding: "24px", background: "#0a0a0a",
      }}>
        <div style={{
          width: "100%", maxWidth: "380px", padding: "24px",
          background: "#050505", border: "1px solid #444",
          fontFamily: "'Share Tech Mono', monospace",
        }}>
          <GeometricCorners style="ascii" />
          <div style={{ fontSize: "11px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>
            CONFIGURE AI
          </div>
          <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "18px", letterSpacing: "1px" }}>
            GEMINI API KEY
          </div>
          <GeminiKeySetupScreen onSave={(key) => onGeminiKeySaved(key, sanitizeForm(form))} />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "flex-start", padding: "24px", background: "#0a0a0a",
    }}>
      {/* Progress */}
      <div style={{ width: "100%", maxWidth: "380px", marginBottom: "24px", marginTop: "16px" }}>
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: "2px", background: i <= step ? "#fff" : "#333" }} />
          ))}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#666", textAlign: "right" }}>
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
        <div style={{ fontSize: "11px", color: "#888", letterSpacing: "3px", marginBottom: "8px" }}>
          PROTOCOL {step + 1}
        </div>
        <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "6px", letterSpacing: "1px" }}>
          {current.title}
        </div>
        <div style={{ fontSize: "13px", color: "#999", marginBottom: "18px", fontStyle: current.style === "dots" ? "italic" : "normal" }}>
          {current.subtitle}
        </div>

        {current.isSyncStep ? (
          <SyncOnboardingStep
            connectDropbox={connectDropbox}
            onSkip={() => handleNext()}
          />
        ) : current.type === "_infoOnly" ? null : (
          <>
            <label style={{ fontSize: "11px", color: "#aaa", letterSpacing: "2px", display: "block", marginBottom: "6px", marginTop: "0" }}>
              {current.label} {current.optional && !current.isSyncStep && <span style={{ color: "#444" }}>— OPTIONAL</span>}
            </label>
            {current.type === "textarea" ? (
              <textarea
                value={form[current.field]}
                onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
                placeholder={current.placeholder}
                rows={3}
                style={inputStyle(s)}
              />
            ) : (
              <input
                type={current.type}
                value={form[current.field]}
                onChange={(e) => setForm((f) => ({ ...f, [current.field]: e.target.value }))}
                placeholder={current.placeholder}
                style={inputStyle(s)}
              />
            )}
          </>
        )}

        {error && <div style={{ color: "#ccc", fontSize: "12px", marginTop: "8px" }}>⚠ {error}</div>}

        <div style={{ fontSize: "11px", color: "#555", fontFamily: "'Share Tech Mono', monospace", marginTop: "8px" }}>
          DETECTED TIMEZONE: {Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Unknown"}
          {" "}(UTC{-(new Date().getTimezoneOffset()) >= 0 ? "+" : ""}{(-(new Date().getTimezoneOffset()) / 60).toFixed(0)})
        </div>

        <button onClick={handleNext} style={{ ...primaryBtn, marginTop: "16px" }}>
          {step === steps.length - 1 ? "INITIALIZE RITMOL" : current.optional ? "NEXT › (or skip)" : "NEXT ›"}
        </button>
      </div>

      <div style={{ marginTop: "16px", marginBottom: "32px", fontSize: "10px", color: "#444", fontFamily: "'Share Tech Mono', monospace" }}>
        RITMOL v1.0 // LOCAL STORAGE ONLY // ZERO TELEMETRY
      </div>
    </div>
  );
}
