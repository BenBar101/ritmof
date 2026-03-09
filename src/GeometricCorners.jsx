// ═══════════════════════════════════════════════════════════════
// DECORATIVE HELPERS
// ═══════════════════════════════════════════════════════════════
export default function GeometricCorners({ style, small }) {
  if (style === "geometric") {
    const s = small ? 6 : 8;
    const cornerStyle = { position: "absolute", width: s, height: s, borderColor: "#fff" };
    return (
      <>
        <div style={{ ...cornerStyle, top: 4, left: 4, borderTop: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, top: 4, right: 4, borderTop: "1px solid #fff", borderRight: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, left: 4, borderBottom: "1px solid #fff", borderLeft: "1px solid #fff" }} />
        <div style={{ ...cornerStyle, bottom: 4, right: 4, borderBottom: "1px solid #fff", borderRight: "1px solid #fff" }} />
      </>
    );
  }
  if (style === "ascii") {
    return (
      <div style={{ position: "absolute", top: 4, left: 4, fontFamily: "'Share Tech Mono', monospace", fontSize: "8px", color: "#333" }}>
        {small ? ">" : ">>"}
      </div>
    );
  }
  return null;
}
