import { useState, useEffect } from "react";

const NAV_TAB_ORDER = ["home", "habits", "tasks", "chat", "profile"];

const STEPS = [
  {
    id: "home",
    title: "[ HOME BASE ]",
    body: "Your command centre. Check your rank, daily missions, active streak, and upcoming tasks at a glance. Complete missions to earn XP.",
    spotlight: { top: "auto", bottom: 0, left: "0%", width: "20%", height: "calc(60px + env(safe-area-inset-bottom, 0px))" },
    tooltipPosition: "above-nav",
  },
  {
    id: "habits",
    title: "[ HABITS ]",
    body: "Log daily habits to keep your streak alive. Each check earns XP. Miss a day and your streak resets — unless you use a Streak Shield.",
    spotlight: { top: "auto", bottom: 0, left: "20%", width: "20%", height: "calc(60px + env(safe-area-inset-bottom, 0px))" },
    tooltipPosition: "above-nav",
  },
  {
    id: "tasks",
    title: "[ TASKS ]",
    body: "Add one-off tasks with optional due dates. Completing tasks awards XP. Overdue tasks are flagged automatically.",
    spotlight: { top: "auto", bottom: 0, left: "40%", width: "20%", height: "calc(60px + env(safe-area-inset-bottom, 0px))" },
    tooltipPosition: "above-nav",
  },
  {
    id: "chat",
    title: "[ AI ADVISOR ]",
    body: "Chat with your AI companion. Ask for study advice, task breakdowns, or motivation. Uses your AI API key — token budget is shared across the day.",
    spotlight: { top: "auto", bottom: 0, left: "60%", width: "20%", height: "calc(60px + env(safe-area-inset-bottom, 0px))" },
    tooltipPosition: "above-nav",
  },
  {
    id: "profile",
    title: "[ PROFILE & GACHA ]",
    body: "Track achievements, roll the Gacha for personalised rewards, and connect Google Calendar. Spend XP to roll — higher rarity means a rarer drop.",
    spotlight: { top: "auto", bottom: 0, left: "80%", width: "20%", height: "calc(60px + env(safe-area-inset-bottom, 0px))" },
    tooltipPosition: "above-nav",
  },
  {
    id: "xpbar",
    title: "[ XP & RANK ]",
    body: "Every action earns XP. Fill the bar to level up and climb the Hunter ranks. Your rank title updates automatically — aim for the top.",
    spotlight: { top: 0, left: 0, width: "100%", height: "56px" },
    tooltipPosition: "below-topbar",
  },
  {
    id: "calendar-icon",
    title: "[ CALENDAR ]",
    body: "Tap the calendar icon in the top bar to open your schedule overlay — add events, sync Google Calendar, or check upcoming exams without leaving your current tab. A dot appears on the icon until you sync Google Calendar.",
    spotlight: { top: 0, left: 0, width: "100%", height: "56px" },
    tooltipPosition: "below-topbar",
  },
];

const panelBase = {
  position: "absolute",
  background: "rgba(0,0,0,0.82)",
  borderRadius: 0,
  pointerEvents: "none",
};

const primaryBtn = {
  flex: 1,
  minWidth: 0,
  padding: "14px",
  background: "#fff",
  color: "#000",
  fontFamily: "'Share Tech Mono', monospace",
  fontSize: "18px",
  letterSpacing: "2px",
  border: "none",
  cursor: "pointer",
  borderRadius: 0,
};

const NAV_H = "calc(60px + env(safe-area-inset-bottom, 0px))";

function SpotlightMasks({ spotlight }) {
  if (spotlight.top === 0) {
    return (
      <div
        style={{
          ...panelBase,
          top: spotlight.height,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
    );
  }

  const { left, width, height } = spotlight;
  return (
    <>
      <div
        style={{
          ...panelBase,
          top: 0,
          left: 0,
          right: 0,
          bottom: NAV_H,
        }}
      />
      <div
        style={{
          ...panelBase,
          bottom: 0,
          left: 0,
          width: left,
          height,
        }}
      />
      <div
        style={{
          ...panelBase,
          bottom: 0,
          right: 0,
          height,
          left: `calc(${left} + ${width})`,
        }}
      />
    </>
  );
}

export default function TutorialOverlay({ onDone, tab, setTab }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (step === 5) return;
    const idx = NAV_TAB_ORDER.indexOf(tab);
    if (idx === -1) return;
    if (idx !== step) setStep(idx);
  }, [tab, step]);

  function handleNext() {
    if (isLast) {
      onDone();
      return;
    }
    const next = step + 1;
    setStep(next);
    if (next < 5) setTab(STEPS[next].id);
  }

  const tooltipStyle =
    current.tooltipPosition === "above-nav"
      ? {
          position: "absolute",
          bottom: "calc(60px + env(safe-area-inset-bottom, 0px) + 12px)",
          left: "50%",
          transform: "translateX(-50%)",
        }
      : {
          position: "absolute",
          top: "68px",
          left: "50%",
          transform: "translateX(-50%)",
        };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 8000,
        pointerEvents: "none",
        borderRadius: 0,
      }}
    >
      <SpotlightMasks spotlight={current.spotlight} />
      <div
        style={{
          ...tooltipStyle,
          background: "#000",
          border: "2px solid #fff",
          padding: "20px",
          fontFamily: "'Share Tech Mono', monospace",
          color: "#fff",
          maxWidth: "340px",
          width: "calc(100% - 40px)",
          zIndex: 8001,
          borderRadius: 0,
          boxSizing: "border-box",
          pointerEvents: "auto",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "3px",
            opacity: 0.5,
            borderRadius: 0,
          }}
        >
          STEP {step + 1} / {STEPS.length}
        </div>
        <h2
          style={{
            fontSize: "16px",
            letterSpacing: "3px",
            margin: "12px 0 8px",
            fontWeight: 900,
            borderRadius: 0,
          }}
        >
          {current.title}
        </h2>
        <p
          style={{
            fontSize: "13px",
            lineHeight: 1.6,
            letterSpacing: "1px",
            margin: "0 0 20px",
            borderRadius: 0,
          }}
        >
          {current.body}
        </p>
        <div style={{ display: "flex", gap: "12px", alignItems: "stretch", borderRadius: 0 }}>
          {!isLast && (
            <button
              type="button"
              onClick={onDone}
              style={{
                border: "none",
                background: "none",
                padding: 0,
                color: "rgba(255,255,255,0.4)",
                fontSize: "11px",
                letterSpacing: "2px",
                cursor: "pointer",
                fontFamily: "'Share Tech Mono', monospace",
                borderRadius: 0,
                alignSelf: "center",
                flexShrink: 0,
              }}
            >
              SKIP
            </button>
          )}
          <button type="button" style={primaryBtn} onClick={handleNext}>
            {isLast ? "LET'S GO →" : "NEXT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
