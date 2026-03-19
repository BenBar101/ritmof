# RPG System Style Guide (CSS Implementation)

This document defines the **Solo Leveling / System Interface** visual style for the app.  
The style is optimized for **high-contrast black-and-white E-Ink displays**.

## 1) Global Core Principles

- **Colors:** Use only `#000000` (black) and `#FFFFFF` (white).
- **Typography:** Use monospaced or sharp sans-serif fonts.
  - Recommended: `Space Grotesk`, `Share Tech Mono`, `JetBrains Mono`
- **Borders:** Use `border: 2px solid #000;` as standard.
  - For emphasis: `border-bottom: 4px double #000;`
- **Shapes:** Avoid rounded corners (`border-radius`) except for intentionally circular UI elements.
  - Prefer notched corners via `clip-path` (see below).

## 2) System Window Frame

Use this frame style for primary sections/cards to create a floating RPG system window feel.

```css
.system-frame {
  position: relative;
  border: 2px solid #000;
  background-color: #fff;
  padding: 1.5rem;
  /* Notched corners effect */
  clip-path: polygon(
    0% 10px,
    10px 0%,
    calc(100% - 10px) 0%,
    100% 10px,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    10px 100%,
    0% calc(100% - 10px)
  );
  margin-bottom: 1.5rem;
}

/* Double-lined border decoration */
.system-frame::after {
  content: "";
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  bottom: 4px;
  border: 1px solid #000;
  pointer-events: none;
  clip-path: inherit;
}
```

## 3) Headers and Dividers

Headers should be bold, uppercase, and paired with a technical divider motif.

```css
.system-header {
  font-family: "Space Grotesk", sans-serif;
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: -0.05em;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.system-divider {
  height: 2px;
  background-color: #000;
  flex-grow: 1;
  position: relative;
}

/* Circuit dot at line end */
.system-divider::after {
  content: "";
  position: absolute;
  right: -8px;
  top: -3px;
  width: 8px;
  height: 8px;
  background-color: #000;
  transform: rotate(45deg);
}
```

## 4) Buttons (High Contrast)

Buttons should feel clear, tactile, and binary in state.

```css
.system-button {
  border: 2px solid #000;
  background-color: #fff;
  color: #000;
  padding: 0.75rem 2rem;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.1s ease;
}

.system-button:hover,
.system-button:active {
  background-color: #000;
  color: #fff;
}
```

## 5) Quest / Task Row

Task lists should use clean rows with high-contrast status badges (`OVERDUE`, `STATUS`, etc.).

```css
.task-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #000;
  padding: 1rem 0.5rem;
}

.status-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border: 1px solid #000;
  font-weight: bold;
}
```

## Implementation Checklist (for LLM/Developer)

- Replace all colors with `#000000` and `#FFFFFF`.
- Remove all `border-radius` from existing cards and buttons.
- Apply `.system-frame` to main dashboard sections.
- Wrap headers with `.system-header` and include a `.system-divider`.
- Use uppercase for primary labels/navigation to mimic the "System Voice".
- Slightly increase base font size for E-Ink readability and refresh clarity.



---
## Alternate Markdown Version (Structured)

This section restates the same style guide in a compact Markdown-first format.

### 1. Global Core Principles

- **Colors:** strictly use `#000000` (black) and `#FFFFFF` (white).
- **Typography:** use monospaced or sharp sans-serif fonts.
  - Recommended: `Space Grotesk`, `Share Tech Mono`, `JetBrains Mono`
- **Borders:** use `border: 2px solid #000;` as standard.
  - Emphasis variant: `border-bottom: 4px double #000;`
- **Shapes:** avoid rounded corners (`border-radius`) unless intentionally circular.
  - Prefer notched corners with `clip-path`.

### 2. The System Window Frame

Every main section/card should use this "notched" frame style:

```css
.system-frame {
  position: relative;
  border: 2px solid #000;
  background-color: #fff;
  padding: 1.5rem;
  clip-path: polygon(
    0% 10px, 10px 0%,
    calc(100% - 10px) 0%, 100% 10px,
    100% calc(100% - 10px), calc(100% - 10px) 100%,
    10px 100%, 0% calc(100% - 10px)
  );
  margin-bottom: 1.5rem;
}

.system-frame::after {
  content: "";
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  bottom: 4px;
  border: 1px solid #000;
  pointer-events: none;
  clip-path: inherit;
}
```

### 3. Headers and Dividers

> Headers should be bold, uppercase, and paired with a technical divider motif.

```css
.system-header {
  font-family: "Space Grotesk", sans-serif;
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: -0.05em;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.system-divider {
  height: 2px;
  background-color: #000;
  flex-grow: 1;
  position: relative;
}

.system-divider::after {
  content: "";
  position: absolute;
  right: -8px;
  top: -3px;
  width: 8px;
  height: 8px;
  background-color: #000;
  transform: rotate(45deg);
}
```

### 4. Buttons (High Contrast)

```css
.system-button {
  border: 2px solid #000;
  background-color: #fff;
  color: #000;
  padding: 0.75rem 2rem;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.1s ease;
}

.system-button:hover,
.system-button:active {
  background-color: #000;
  color: #fff;
}
```

### 5. Quest / Task Row

```css
.task-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #000;
  padding: 1rem 0.5rem;
}

.status-badge {
  font-size: 0.7rem;
  padding: 2px 8px;
  border: 1px solid #000;
  font-weight: bold;
}
```

### Implementation Steps

1. Replace all colors with `#000000` and `#FFFFFF`.
2. Remove all `border-radius` from existing cards and buttons.
3. Apply `.system-frame` to main dashboard sections.
4. Wrap headers with `.system-header` and include `.system-divider`.
5. Use uppercase for primary labels/navigation ("System Voice" style).
6. Increase base font size slightly for E-Ink readability.

### Quick Reference Table

| Element | Required Style | Notes |
| --- | --- | --- |
| Frame | `2px` solid border + notch | Use `clip-path` |
| Header | Uppercase + heavy weight | Pair with divider |
| Button | Invert on hover/active | Keep transitions short |
| Task Row | Clean row + status badge | High contrast only |