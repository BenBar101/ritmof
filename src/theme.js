// ═══════════════════════════════════════════════════════════════
// THEME — single source of truth for all shared styles.
// Eliminates the inline style objects scattered across components.
// Import what you need; tree-shaking removes the rest.
// ═══════════════════════════════════════════════════════════════

export const FONT = "'Share Tech Mono', monospace";
export const FONT_SERIF = "'IM Fell English', serif";

export const COLOR = {
  bg:          "#000",
  bgCard:      "#000",
  bgAlt:       "#000",
  border:      "#fff",
  borderMid:   "#fff",
  borderBright:"#fff",
  text:        "#fff",
  textMid:     "#fff",
  textDim:     "#fff",
  textDimmer:  "#fff",
  textFaint:   "#fff",
  white:       "#fff",
  black:       "#000",
  alert:       "#fff",
  // Banner type → border colour
  bannerInfo:    "#fff",
  bannerWarning: "#fff",
  bannerSuccess: "#fff",
  bannerAlert:   "#fff",
};

// Shared button presets
export const BTN = {
  primary: {
    width: "100%",
    padding: "16px",
    background: COLOR.white,
    color: COLOR.black,
    fontFamily: FONT,
    fontSize: "18px",
    letterSpacing: "2px",
    border: "none",
    cursor: "pointer",
    minHeight: "56px",
  },
  ghost: (active = false) => ({
    padding: "10px 16px",
    border: `2px solid ${COLOR.white}`,
    background: active ? COLOR.white : "transparent",
    color: active ? COLOR.black : COLOR.white,
    fontFamily: FONT,
    fontSize: "16px",
    letterSpacing: "2px",
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: "pointer",
    minHeight: "48px",
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
  background: "#000",
  border: "2px solid #fff",
  color: "#fff",
  padding: "14px",
  fontSize: "18px",
  fontFamily: variant.fontFamily || FONT,
  outline: "none",
  resize: "none",
  borderRadius: "0",
});

// Fixed chrome dimensions — keep in sync with Layout.jsx padding
export const CHROME = {
  topBarH:    56,
  bottomNavH: 60, // visual height; actual bottom padding also adds safe-area-inset-bottom
};
