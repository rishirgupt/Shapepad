/**
 * ShapePad — shared domain types.
 *
 * `PadState` is the guaranteed core of a `.shapepad` document; `ShapePadFile`
 * adds everything else and keeps it optional so older files still load.
 * `PadDocument` is the live, in-memory shape of one open tab — a superset of
 * `ShapePadFile` with concrete (non-optional) values plus session-only UI
 * state that is never written to disk.
 */

import type { BuiltinShapeId } from "./lib/geometry";

/**
 * v2 moved stroke/image coordinates from the inset content box to the full
 * shape container, so v1 sketches would land offset.
 * v3 added text boxes and the authoring window size, so a document reopens
 * at the dimensions it was composed at.
 * v4 broadened strokes into general draw objects (shapes, not just pen),
 * added background line/grid/dot patterns and holes in custom shapes.
 */
export const SHAPEPAD_FORMAT_VERSION = 4;

export type ShapeId = BuiltinShapeId;
export type PadMode = "markdown" | "draw" | "image" | "text";

export interface Point {
  x: number;
  y: number;
}

/** Drawing tools available on the ink layer. */
export type DrawTool = "pen" | "line" | "rect" | "ellipse" | "arrow";

/**
 * One object on the ink layer, in shape-container pixels.
 *
 * Every tool is represented the same way — a point list — so rendering,
 * hit-testing and persistence don't need a tool-specific data shape:
 *  - `pen`: the raw (or ink-corrected) sampled path, rendered as a smoothed
 *    open curve.
 *  - `line` / `arrow`: exactly two points, the segment's endpoints.
 *  - `rect`: four corner points in order — a plain drag produces an
 *    axis-aligned box, but ink correction can fit a *rotated* rectangle to a
 *    hand-drawn one, which a 2-corner representation can't express.
 *  - `ellipse`: a fixed ring of sampled boundary points, so a rotated
 *    ink-corrected ellipse renders identically to a dragged one.
 */
export interface DrawObject {
  id: string;
  tool: DrawTool;
  points: Point[];
  /** Stroke colour. */
  color: string;
  /** Stroke width. */
  brushSize: number;
  /** Fill colour, or `null` for no fill. Only rect/ellipse/pen(closed) use it. */
  fill: string | null;
  fillOpacity: number;
  /** Overall object opacity, applied to both stroke and fill. */
  opacity: number;
  /** Set when ink correction reshaped this from a raw pen stroke. Informational. */
  corrected?: boolean;
}

/** @deprecated Pre-v4 shape of a pen stroke, kept only for migration. */
export interface Stroke {
  points: Point[];
  color: string;
  brushSize: number;
}

/**
 * A user-authored outline. Points are normalised to the unit square so the
 * shape scales with the window; `authoredWidth`/`authoredHeight` remember the
 * pixel size it was actually drawn at, which is what the pad resizes to when
 * the shape is first applied.
 *
 * `holes` are additional closed loops (also normalised) subtracted from the
 * outline via an evenodd `clip-path: path()` — content and the desktop show
 * through them, and clicks over them pass through like the outside area.
 */
export interface CustomShape {
  id: string;
  name: string;
  points: Point[];
  holes?: Point[][];
  authoredWidth?: number;
  authoredHeight?: number;
}

/**
 * A free-floating text box. Unlike the notepad layer, typography here is
 * per-box: `fontSize` styles this text, not the whole document.
 */
export interface TextBox {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  opacity: number;
}

/** Sub-rectangle of the source image, normalised 0–1. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A placed image. `x`/`y`/`width`/`height` are the unrotated box in
 * shape-container pixels; `rotation` spins it about the box centre.
 */
export interface PadImage {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect;
  naturalWidth: number;
  naturalHeight: number;
}

export type BackgroundPatternType = "none" | "lines" | "grid" | "dots";

/** Ruled-paper / graph-paper style guide lines drawn behind the content. */
export interface BackgroundPattern {
  type: BackgroundPatternType;
  /** Distance between lines/dots, in pixels. */
  spacing: number;
  color: string;
  opacity: number;
  /** Stroke width for lines/grid, diameter for dots. */
  lineWidth: number;
}

export const DEFAULT_BACKGROUND_PATTERN: BackgroundPattern = {
  type: "none",
  spacing: 28,
  color: "#ffffff",
  opacity: 0.16,
  lineWidth: 1,
};

/** The stable core schema. */
export interface PadState {
  shape: string;
  backgroundColor: string;
  markerColor: string;
  markdownContent: string;
  drawings: DrawObject[];
}

/** What is actually written to disk. */
export interface ShapePadFile extends PadState {
  version: number;
  customShapes?: CustomShape[];
  images?: PadImage[];
  textBoxes?: TextBox[];
  backgroundPattern?: BackgroundPattern;
  /**
   * Logical size of the pad when it was saved. Strokes, images and text boxes
   * are stored in container pixels, so reopening at a different size would
   * scatter them — loading restores this first.
   */
  windowWidth?: number;
  windowHeight?: number;
  backgroundOpacity?: number;
  brushSize?: number;
  drawTool?: DrawTool;
  drawFill?: string | null;
  drawFillOpacity?: number;
  drawOpacity?: number;
  /** Whiteboard-style ink correction: straightens/fits pen strokes on completion. */
  correctDrawings?: boolean;
  mode?: PadMode;
  fontFamily?: string;
  fontSize?: number;
  /** `null` means "derive a readable colour from the background". */
  textColor?: string | null;
  clickThrough?: boolean;
}

/**
 * The live, in-memory document behind one open tab. A superset of
 * `ShapePadFile` with concrete values (a tab always has *a* font, *a* mode —
 * `ShapePadFile`'s optionality exists only for loading old files) plus
 * session-only UI state that never round-trips through a save/load.
 */
export interface PadDocument extends PadState {
  /** Ephemeral tab identity — not persisted, regenerated on load. */
  id: string;
  /** Absolute path if this tab has been saved/opened from disk, else unsaved. */
  filePath: string | null;
  /** True when there are changes since the last save. Drives the tab dot. */
  dirty: boolean;
  /** Display name shown in the tab. Derived from the file name or content. */
  title: string;

  customShapes: CustomShape[];
  images: PadImage[];
  textBoxes: TextBox[];
  backgroundPattern: BackgroundPattern;
  backgroundOpacity: number;
  brushSize: number;
  drawTool: DrawTool;
  drawFill: string | null;
  drawFillOpacity: number;
  drawOpacity: number;
  correctDrawings: boolean;
  mode: PadMode;
  fontFamily: string;
  fontSize: number;
  textColor: string | null;
  clickThrough: boolean;
  windowWidth: number;
  windowHeight: number;

  // --- session-only selection/editing state, never saved ---
  selectedImageId: string | null;
  selectedTextId: string | null;
  editingTextId: string | null;
  cropping: boolean;
  cropDraft: CropRect | null;
}

/** Payload handed from one window to another when a tab is moved. */
export interface TabHandoffPayload {
  document: Omit<
    PadDocument,
    | "selectedImageId"
    | "selectedTextId"
    | "editingTextId"
    | "cropping"
    | "cropDraft"
  >;
}

export const SHAPE_IDS: ShapeId[] = [
  "square",
  "circle",
  "triangle",
  "star",
  "polygon",
];

export const SHAPE_LABELS: Record<ShapeId, string> = {
  square: "Square",
  circle: "Circle",
  triangle: "Triangle",
  star: "Star",
  polygon: "Hexagon",
};

export interface FontOption {
  label: string;
  stack: string;
}

/**
 * Appended to every font stack so emoji and other symbol characters render
 * as colour glyphs instead of falling back to whatever the browser picks —
 * `Courier New` and friends have no emoji glyphs of their own.
 */
const EMOJI_FALLBACK = '"Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol"';

function withEmojiFallback(stack: string): string {
  return `${stack}, ${EMOJI_FALLBACK}`;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    label: "Mono",
    stack: withEmojiFallback(
      'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace',
    ),
  },
  {
    label: "Sans",
    stack: withEmojiFallback(
      'ui-sans-serif, "Segoe UI", system-ui, Arial, sans-serif',
    ),
  },
  {
    label: "Serif",
    stack: withEmojiFallback('ui-serif, Georgia, "Times New Roman", serif'),
  },
  { label: "Georgia", stack: withEmojiFallback("Georgia, serif") },
  { label: "Verdana", stack: withEmojiFallback("Verdana, Geneva, sans-serif") },
  {
    label: "Trebuchet",
    stack: withEmojiFallback('"Trebuchet MS", sans-serif'),
  },
  {
    label: "Courier",
    stack: withEmojiFallback('"Courier New", Courier, monospace'),
  },
  {
    label: "Impact",
    stack: withEmojiFallback("Impact, Haettenschweiler, sans-serif"),
  },
  {
    label: "Comic",
    stack: withEmojiFallback('"Comic Sans MS", "Comic Neue", cursive'),
  },
  {
    label: "Handwriting",
    stack: withEmojiFallback('"Segoe Script", "Bradley Hand", cursive'),
  },
];

export const DEFAULT_FONT_STACK = FONT_OPTIONS[0].stack;

export function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createTextBox(
  point: Point,
  overrides: Partial<TextBox> = {},
): TextBox {
  return {
    id: createId("text"),
    text: "",
    x: point.x,
    y: point.y,
    width: 220,
    height: 64,
    rotation: 0,
    fontFamily: FONT_OPTIONS[1].stack,
    fontSize: 20,
    color: "#fafafa",
    bold: false,
    italic: false,
    align: "left",
    opacity: 1,
    ...overrides,
  };
}

export function createDrawObject(
  tool: DrawTool,
  points: Point[],
  overrides: Partial<DrawObject> = {},
): DrawObject {
  return {
    id: createId("draw"),
    tool,
    points,
    color: "#f472b6",
    brushSize: 4,
    fill: null,
    fillOpacity: 0.35,
    opacity: 1,
    ...overrides,
  };
}

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

const UNTITLED_TAB_TITLE = "Untitled";

/** First non-empty markdown line, stripped of leading `#`/list markers. */
export function deriveTabTitle(markdownContent: string): string {
  const line = markdownContent
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return UNTITLED_TAB_TITLE;
  const stripped = line.replace(/^#{1,6}\s*/, "").replace(/^[-*+]\s*/, "");
  const trimmed = stripped.trim();
  if (!trimmed) return UNTITLED_TAB_TITLE;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

/**
 * A brand-new blank tab. Mirrors the defaults every field would have if a
 * user started from nothing — used both for the very first tab and every
 * subsequent "+".
 */
export function createBlankDocument(): PadDocument {
  const markdownContent = [
    "# ShapePad",
    "",
    "Text reflows to fit the shape.",
    "",
    "- Hover the left edge for tools",
    "- Alt+drag to move the window",
    "- Paste an image with Ctrl+V",
  ].join("\n");

  return {
    id: createId("tab"),
    filePath: null,
    dirty: false,
    title: deriveTabTitle(markdownContent),

    shape: "square",
    backgroundColor: "#1e1b4b",
    markerColor: "#f472b6",
    markdownContent,
    drawings: [],

    customShapes: [],
    images: [],
    textBoxes: [],
    backgroundPattern: { ...DEFAULT_BACKGROUND_PATTERN },
    backgroundOpacity: 0.92,
    brushSize: 4,
    drawTool: "pen",
    drawFill: null,
    drawFillOpacity: 0.35,
    drawOpacity: 1,
    correctDrawings: true,
    mode: "markdown",
    fontFamily: DEFAULT_FONT_STACK,
    fontSize: 14,
    textColor: null,
    clickThrough: true,
    windowWidth: 620,
    windowHeight: 620,

    selectedImageId: null,
    selectedTextId: null,
    editingTextId: null,
    cropping: false,
    cropDraft: null,
  };
}

/** Upgrades a pre-v4 `{points,color,brushSize}` stroke into a `DrawObject`. */
export function upgradeLegacyStroke(raw: Stroke): DrawObject {
  return createDrawObject("pen", raw.points, {
    color: raw.color,
    brushSize: raw.brushSize,
  });
}

export function isShapeId(value: string): value is ShapeId {
  return (SHAPE_IDS as string[]).includes(value);
}
