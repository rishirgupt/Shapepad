/**
 * Colour helpers used to keep editor text readable against whatever
 * background colour the user dials in on the wheel.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses `#rgb`, `#rrggbb` and `#rrggbbaa`. Returns black on garbage input. */
export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG relative luminance, 0 (black) → 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Picks near-black or near-white ink for the given background.
 *
 * `opacity` matters because a translucent pad lets the desktop show
 * through; below ~0.45 we can no longer trust the fill colour, so we fall
 * back to light ink (which also carries a text-shadow, see `App.tsx`).
 */
export function readableInk(backgroundHex: string, opacity = 1): string {
  if (opacity < 0.45) return "#fafafa";
  return relativeLuminance(backgroundHex) > 0.45 ? "#101014" : "#fafafa";
}

/** Same decision as `readableInk`, exposed as a boolean for callers. */
export function isLightBackground(backgroundHex: string, opacity = 1): boolean {
  if (opacity < 0.45) return false;
  return relativeLuminance(backgroundHex) > 0.45;
}
