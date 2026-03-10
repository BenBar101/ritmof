// ═══════════════════════════════════════════════════════════════
// THEME — single source of truth for all shared styles.
// Eliminates the inline style objects scattered across components.
// Import what you need; tree-shaking removes the rest.
// ═══════════════════════════════════════════════════════════════

export const FONT = "'Share Tech Mono', monospace";
export const FONT_SERIF = "'IM Fell English', serif";

export const COLOR = {
  bg:          "#0a0a0a",
  bgCard:      "#050505",
  bgAlt:       "#111",
  border:      "#222",
  borderMid:   "#333",
  borderBright:"#444",
  text:        "#e8e8e8",
  textMid:     "#aaa",
  textDim:     "#666",
  textDimmer:  "#555",
  textFaint:   "#333",
  white:       "#fff",
  black:       "#000",
  alert:       "#c44",
  // Banner type → border colour
  bannerInfo:    "#555",
  bannerWarning: "#888",
  bannerSuccess: "#aaa",
  bannerAlert:   "#fff",
};

// Shared button presets
export const BTN = {
  primary: {
    width: "100%",
    padding: "14px",
    background: COLOR.white,
    color: COLOR.black,
    fontFamily: FONT,
    fontSize: "14px",
    letterSpacing: "2px",
    border: "none",
    cursor: "pointer",
  },
  ghost: (active = false) => ({
    padding: "6px 12px",
    border: `1px solid ${active ? COLOR.white : COLOR.borderMid}`,
    background: active ? COLOR.white : "transparent",
    color: active ? COLOR.black : COLOR.textDim,
    fontFamily: FONT,
    fontSize: "9px",
    letterSpacing: "1px",
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: "pointer",
  }),
  icon: {
    background: "none",
    border: "none",
    fontFamily: FONT,
    cursor: "pointer",
  },
};

// Shared input style factory (takes an optional style-variant object)
export const inputStyle = (variant = {}) => ({
  width: "100%",
  background: "rgba(0,0,0,0.6)",
  border: `1px solid ${COLOR.borderBright}`,
  color: COLOR.text,
  padding: "12px",
  fontSize: "15px",
  fontFamily: variant.fontFamily || FONT,
  outline: "none",
  resize: "none",
  borderRadius: "0",
});

// Fixed chrome dimensions — keep in sync with Layout.jsx padding
export const CHROME = {
  topBarH:    56,
  bottomNavH: 60,
};
