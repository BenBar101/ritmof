import { useState } from "react";
import { STYLE_CSS } from "./constants";
import { sanitizeForPrompt } from "./api/systemPrompt";
import { SyncManager, FSAPI_SUPPORTED } from "./sync/SyncManager";
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

function SyncthingSetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "12px", border: "1px solid #333", fontFamily: "'Share Tech Mono', monospace" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "10px 12px", background: "transparent", border: "none",
        color: "#888", fontFamily: "'Share Tech Mono', monospace", fontSize: "10px",
        letterSpacing: "1px", display: "flex", justifyContent: "space-between", cursor: "pointer",
      }}>
        <span>▸ HOW TO SET UP SYNCTHING SYNC</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "12px", borderTop: "1px solid #222", fontSize: "11px", color: "#666", lineHeight: "2" }}>
          <div style={{ color: "#aaa", marginBottom: "8px" }}>One-time setup per device. No account needed. Free forever.</div>
          <div style={{ color: "#888", fontWeight: "bold", marginBottom: "4px" }}>STEP 1 — Install Syncthing</div>
          <div>1. Download from <span style={{ color: "#ccc" }}>syncthing.net</span> and install on all devices.</div>
          <div>2. Open the Syncthing UI (usually <span style={{ color: "#ccc" }}>localhost:8384</span>).</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 2 — Create a shared folder</div>
          <div>3. Click <span style={{ color: "#ccc" }}>Add Folder</span>.</div>
          <div>4. Set a folder path on your machine, e.g. <span style={{ color: "#ccc" }}>~/ritmol-sync/</span></div>
          <div>5. Share the folder with your other devices in Syncthing.</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 3 — Link the file in RITMOL</div>
          <div>6. Come back here and click <span style={{ color: "#ccc" }}>LINK SYNCTHING FILE</span>.</div>
          <div>7. Navigate to your Syncthing folder and pick <span style={{ color: "#ccc" }}>ritmol-data.json</span>.</div>
          <div style={{ color: "#555", fontSize: "10px" }}>&nbsp;&nbsp;&nbsp;(If the file doesn&apos;t exist yet, Push first — it will be created.)</div>
          <div style={{ color: "#888", fontWeight: "bold", marginTop: "10px", marginBottom: "4px" }}>STEP 4 — Sync between devices</div>
          <div>8. On Device A: click <span style={{ color: "#ccc" }}>PUSH ↑</span> to write data to the file.</div>
          <div>9. Syncthing propagates the file to Device B automatically.</div>
          <div>10. On Device B: click <span style={{ color: "#ccc" }}>PULL ↓</span> to load the latest data.</div>
          <div style={{ marginTop: "10px", padding: "8px", border: "1px dashed #333", color: "#555", fontSize: "10px" }}>
            ✓ No OAuth. No cloud account. No API keys. Your data never leaves your devices.
          </div>
        </div>
      )}
    </div>
  );
}

function SyncOnboardingStep() {
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState("");

  async function handlePick() {
    setError("");
    try {
      await SyncManager.pickFile();
      setLinked(true);
    } catch (e) {
      if (e.name !== "AbortError") setError("Could not link file. Try again.");
    }
  }

  if (!FSAPI_SUPPORTED) {
    return (
      <div style={{ fontSize: "11px", color: "#666", lineHeight: "1.8", padding: "8px", border: "1px dashed #333" }}>
        ⚠ Your browser doesn&apos;t support direct file access.<br />
        Use <strong>Profile → Settings → Download / Import</strong> to sync manually after setup.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <SyncthingSetupGuide />
      {linked ? (
        <div style={{ padding: "10px", border: "1px solid #aaa", fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", color: "#aaa" }}>
          ✓ SYNC FILE LINKED — you can Push/Pull from Profile → Settings.
        </div>
      ) : (
        <button onClick={handlePick} style={{
          padding: "12px", border: "2px solid #fff", background: "#fff", color: "#000",
          fontFamily: "'Share Tech Mono', monospace", fontSize: "11px", letterSpacing: "2px", cursor: "pointer",
        }}>
          LINK SYNCTHING FILE →
        </button>
      )}
      {error && <div style={{ color: "#888", fontSize: "10px" }}>⚠ {error}</div>}
      <div style={{ fontSize: "10px", color: "#444" }}>
        — OPTIONAL — You can do this later in Profile → Settings.
      </div>
    </div>
  );
}

export default function Onboarding({ onComplete }) {
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
      subtitle: "Link a Syncthing-watched file so your data syncs across devices. You can skip this and do it later in Settings.",
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
    return {
      name:         sanitizeField(f.name, 60),
      major:        sanitizeField(f.major, 80),
      books:        sanitizeField(f.books, 200),
      interests:    sanitizeField(f.interests, 200),
      semesterGoal: sanitizeField(f.semesterGoal, 300),
    };
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
      onComplete(sanitizeForm(form));
    }
  }

  const styleMap = STYLE_CSS;
  const s = styleMap[current.style] || styleMap.ascii;

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
          <SyncOnboardingStep />
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
