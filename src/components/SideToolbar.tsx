import { useEffect, useRef, useState } from "react";
import { HexColorPicker, HexColorInput } from "react-colorful";
import {
  Baseline,
  Circle,
  Droplet,
  Eraser,
  FolderOpen,
  Hexagon,
  Highlighter,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  MoveUpRight,
  Palette,
  Pencil,
  PenTool,
  Pilcrow,
  Pin,
  PinOff,
  Plus,
  RectangleHorizontal,
  Save,
  SaveAll,
  Shapes,
  Slash,
  Square,
  Star,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import EmojiPicker from "./EmojiPicker";
import {
  DEFAULT_BACKGROUND_PATTERN,
  FONT_OPTIONS,
  SHAPE_IDS,
  SHAPE_LABELS,
  type BackgroundPattern,
  type BackgroundPatternType,
  type CustomShape,
  type DrawTool,
  type PadMode,
  type ShapeId,
} from "../types";
import { CUSTOM_PREFIX } from "../lib/geometry";

interface SideToolbarProps {
  shape: string;
  onShapeChange: (shape: string) => void;

  customShapes: CustomShape[];
  onCreateCustomShape: () => void;
  onEditCustomShape: (shape: CustomShape) => void;
  onDeleteCustomShape: (id: string) => void;

  mode: PadMode;
  onModeChange: (mode: PadMode) => void;

  backgroundColor: string;
  onBackgroundColorChange: (hex: string) => void;
  backgroundOpacity: number;
  onBackgroundOpacityChange: (opacity: number) => void;
  backgroundPattern: BackgroundPattern;
  onBackgroundPatternChange: (pattern: BackgroundPattern) => void;

  markerColor: string;
  onMarkerColorChange: (hex: string) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  drawTool: DrawTool;
  onDrawToolChange: (tool: DrawTool) => void;
  drawFill: string | null;
  onDrawFillChange: (fill: string | null) => void;
  drawFillOpacity: number;
  onDrawFillOpacityChange: (opacity: number) => void;
  drawOpacity: number;
  onDrawOpacityChange: (opacity: number) => void;
  correctDrawings: boolean;
  onCorrectDrawingsChange: (value: boolean) => void;

  fontFamily: string;
  onFontFamilyChange: (stack: string) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  textColor: string | null;
  onTextColorChange: (hex: string | null) => void;
  autoTextColor: string;
  onInsertEmoji: (emoji: string) => void;

  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onUndoStroke: () => void;
  onClearStrokes: () => void;
  strokeCount: number;

  onInsertImage: () => void;

  clickThrough: boolean;
  onToggleClickThrough: () => void;

  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onMinimize: () => void;
  onClose: () => void;

  busy?: boolean;
}

type PanelId = "background" | "draw" | "type" | "shapes";

const SHAPE_ICONS: Record<ShapeId, typeof Square> = {
  square: Square,
  circle: Circle,
  triangle: Triangle,
  star: Star,
  polygon: Hexagon,
};

const DRAW_TOOLS: Array<{ id: DrawTool; label: string; icon: typeof PenTool }> = [
  { id: "pen", label: "Pen", icon: PenTool },
  { id: "line", label: "Line", icon: Slash },
  { id: "rect", label: "Rectangle", icon: RectangleHorizontal },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
];

const PATTERN_TYPES: Array<{ id: BackgroundPatternType; label: string }> = [
  { id: "none", label: "None" },
  { id: "lines", label: "Lines" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dots" },
];

const SWATCHES = [
  "#1e1b4b",
  "#0f172a",
  "#134e4a",
  "#7c2d12",
  "#4c1d95",
  "#111111",
  "#fef3c7",
  "#fafafa",
  "#f472b6",
  "#38bdf8",
  "#4ade80",
  "#facc15",
];

/* ------------------------------------------------------------------ */

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-white/90 text-neutral-900"
          : "text-white/70 hover:bg-white/15 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SwatchButton({
  label,
  color,
  open,
  onToggle,
  children,
}: {
  label: string;
  color: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className={[
        "relative grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
        open ? "ring-2 ring-white/70" : "hover:bg-white/15",
      ].join(" ")}
    >
      <span
        className="absolute inset-1 rounded-md ring-1 ring-white/40"
        style={{ backgroundColor: color }}
      />
      <span className="relative text-white mix-blend-difference">
        {children}
      </span>
    </button>
  );
}

function Divider() {
  return <div className="my-0.5 h-px w-5 shrink-0 bg-white/15" />;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <span className="font-mono text-white/70">{format(value)}</span>
      </div>
      <input
        type="range"
        className="sp-range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** A labelled on/off switch, used for the ink-correction toggle. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-white/5"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-white/80">{label}</span>
        {hint && (
          <span className="block text-[10px] leading-snug text-white/40">
            {hint}
          </span>
        )}
      </span>
      <span
        className={[
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-sky-400" : "bg-white/15",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

/**
 * Popover shell. Rendered as a sibling of the scrolling rail so it is clipped
 * by neither the pad's `clip-path` nor the rail's own overflow.
 */
function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-sp-ui
      role="dialog"
      aria-label={title}
      className="pointer-events-auto absolute left-12 top-1/2 z-50 max-h-[96vh] w-56 -translate-y-1/2 animate-fade-in overflow-y-auto rounded-xl border border-white/10 bg-neutral-900/95 p-3 shadow-float backdrop-blur-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
          {title}
        </span>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <X size={12} />
        </button>
      </div>
      {children}
    </div>
  );
}

function ColorWheel({
  color,
  onChange,
}: {
  color: string;
  onChange: (hex: string) => void;
}) {
  return (
    <>
      <div className="sp-picker">
        <HexColorPicker color={color} onChange={onChange} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-white/50">#</span>
        <HexColorInput
          color={color}
          onChange={onChange}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] uppercase text-white outline-none focus:border-white/30"
        />
      </div>
      <div className="mt-3 grid grid-cols-6 gap-1">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            title={swatch}
            aria-label={`Use ${swatch}`}
            onClick={() => onChange(swatch)}
            className="h-5 rounded ring-1 ring-white/20 transition-transform hover:scale-110"
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

export default function SideToolbar(props: SideToolbarProps) {
  const {
    shape,
    onShapeChange,
    customShapes,
    onCreateCustomShape,
    onEditCustomShape,
    onDeleteCustomShape,
    mode,
    onModeChange,
    backgroundColor,
    onBackgroundColorChange,
    backgroundOpacity,
    onBackgroundOpacityChange,
    backgroundPattern,
    onBackgroundPatternChange,
    markerColor,
    onMarkerColorChange,
    brushSize,
    onBrushSizeChange,
    drawTool,
    onDrawToolChange,
    drawFill,
    onDrawFillChange,
    drawFillOpacity,
    onDrawFillOpacityChange,
    drawOpacity,
    onDrawOpacityChange,
    correctDrawings,
    onCorrectDrawingsChange,
    fontFamily,
    onFontFamilyChange,
    fontSize,
    onFontSizeChange,
    textColor,
    onTextColorChange,
    autoTextColor,
    onInsertEmoji,
    onSave,
    onSaveAs,
    onOpen,
    onUndoStroke,
    onClearStrokes,
    strokeCount,
    onInsertImage,
    clickThrough,
    onToggleClickThrough,
    alwaysOnTop,
    onToggleAlwaysOnTop,
    onMinimize,
    onClose,
    busy = false,
  } = props;

  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const visible = hovered || pinned || panel !== null;

  useEffect(() => {
    if (!panel) return;
    const handle = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setPanel(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [panel]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const toggle = (id: PanelId) =>
    setPanel((current) => (current === id ? null : id));

  return (
    <div
      ref={containerRef}
      data-sp-ui
      className="pointer-events-none fixed inset-y-0 left-0 z-50 flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Hover trigger hugging the window edge. Carries `data-sp-ui` so the
          click-through hit-test keeps this strip interactive even though it
          sits outside the shape. */}
      <div
        data-sp-ui
        className="pointer-events-auto absolute inset-y-0 left-0 w-4"
        aria-hidden="true"
      />

      <div
        className={[
          "pointer-events-none absolute left-0 h-16 w-1 rounded-r-full bg-white/35 transition-opacity duration-200",
          visible ? "opacity-0" : "opacity-100",
        ].join(" ")}
        aria-hidden="true"
      />

      <div
        data-sp-ui
        className={[
          "pointer-events-auto ml-1.5 flex max-h-[98vh] flex-col items-center gap-1 overflow-y-auto",
          "rounded-2xl border border-white/10 bg-neutral-900/85 p-1.5 shadow-float backdrop-blur-xl",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "transition-all duration-200 ease-out",
          visible ? "translate-x-0 opacity-100" : "-translate-x-[130%] opacity-0",
        ].join(" ")}
        role="toolbar"
        aria-label="ShapePad controls"
        aria-hidden={!visible}
      >
        <ToolButton label="Save (Ctrl+S)" disabled={busy} onClick={onSave}>
          <Save size={14} />
        </ToolButton>
        <ToolButton label="Save as… (Ctrl+Shift+S)" disabled={busy} onClick={onSaveAs}>
          <SaveAll size={14} />
        </ToolButton>
        <ToolButton label="Open workspace (Ctrl+O)" disabled={busy} onClick={onOpen}>
          <FolderOpen size={14} />
        </ToolButton>

        <Divider />

        {SHAPE_IDS.map((id) => {
          const Icon = SHAPE_ICONS[id];
          return (
            <ToolButton
              key={id}
              label={SHAPE_LABELS[id]}
              active={shape === id}
              onClick={() => onShapeChange(id)}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
        <ToolButton
          label="Custom shapes"
          active={panel === "shapes" || shape.startsWith(CUSTOM_PREFIX)}
          onClick={() => toggle("shapes")}
        >
          <Shapes size={14} />
        </ToolButton>

        <Divider />

        <ToolButton
          label="Markdown / code mode (Ctrl+M)"
          active={mode === "markdown"}
          onClick={() => onModeChange("markdown")}
        >
          <Pilcrow size={14} />
        </ToolButton>
        <ToolButton
          label="Drawing mode (Ctrl+M)"
          active={mode === "draw"}
          onClick={() => onModeChange("draw")}
        >
          <PenTool size={14} />
        </ToolButton>
        <ToolButton
          label="Image mode (Ctrl+M)"
          active={mode === "image"}
          onClick={() => onModeChange("image")}
        >
          <ImageIcon size={14} />
        </ToolButton>
        <ToolButton
          label="Text box mode (Ctrl+M) — click the pad to place text"
          active={mode === "text"}
          onClick={() => onModeChange("text")}
        >
          <Type size={14} />
        </ToolButton>
        <ToolButton label="Insert image from file" onClick={onInsertImage}>
          <Plus size={14} />
        </ToolButton>

        <Divider />

        <SwatchButton
          label="Background colour, opacity & pattern"
          color={backgroundColor}
          open={panel === "background"}
          onToggle={() => toggle("background")}
        >
          <Palette size={12} />
        </SwatchButton>
        <ToolButton
          label="Draw tools — colour, fill, ink correction"
          active={panel === "draw"}
          onClick={() => toggle("draw")}
        >
          <Highlighter size={14} />
        </ToolButton>
        <ToolButton
          label="Note typography (styles the whole notepad)"
          active={panel === "type"}
          onClick={() => toggle("type")}
        >
          <Baseline size={14} />
        </ToolButton>

        <Divider />

        <ToolButton
          label="Undo last drawing (Ctrl+Z)"
          disabled={strokeCount === 0}
          onClick={onUndoStroke}
        >
          <Undo2 size={14} />
        </ToolButton>
        <ToolButton
          label="Clear all drawings"
          disabled={strokeCount === 0}
          onClick={onClearStrokes}
        >
          <Eraser size={14} />
        </ToolButton>

        <Divider />

        <ToolButton
          label={
            clickThrough
              ? "Click-through: on (clicks outside the shape reach apps behind)"
              : "Click-through: off"
          }
          active={clickThrough}
          onClick={onToggleClickThrough}
        >
          <MousePointerClick size={14} />
        </ToolButton>
        <ToolButton
          label={alwaysOnTop ? "Always on top: on" : "Always on top: off"}
          active={alwaysOnTop}
          onClick={onToggleAlwaysOnTop}
        >
          {alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
        </ToolButton>
        <ToolButton
          label={pinned ? "Unpin toolbar" : "Keep toolbar open"}
          active={pinned}
          onClick={() => setPinned((value) => !value)}
        >
          <span className="text-[10px] font-bold leading-none">
            {pinned ? "«" : "»"}
          </span>
        </ToolButton>
        <ToolButton label="Minimize" onClick={onMinimize}>
          <Minus size={14} />
        </ToolButton>
        <ToolButton label="Close tab" onClick={onClose}>
          <X size={14} />
        </ToolButton>
      </div>

      {/* ----------------------------- panels ----------------------------- */}

      {panel === "background" && (
        <Panel title="Background" onClose={() => setPanel(null)}>
          <ColorWheel
            color={backgroundColor}
            onChange={onBackgroundColorChange}
          />
          <div className="mt-3">
            <Slider
              label="Opacity"
              value={backgroundOpacity}
              min={0.05}
              max={1}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={onBackgroundOpacityChange}
            />
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <span className="mb-1.5 block text-[11px] text-white/50">
              Guide lines
            </span>
            <div className="grid grid-cols-4 gap-1">
              {PATTERN_TYPES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() =>
                    onBackgroundPatternChange({
                      ...backgroundPattern,
                      type: entry.id,
                    })
                  }
                  className={[
                    "rounded-md px-1 py-1 text-[10px] transition-colors",
                    backgroundPattern.type === entry.id
                      ? "bg-white/90 text-neutral-900"
                      : "bg-white/5 text-white/70 hover:bg-white/15",
                  ].join(" ")}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {backgroundPattern.type !== "none" && (
              <div className="mt-3 space-y-3">
                <Slider
                  label="Spacing"
                  value={backgroundPattern.spacing}
                  min={8}
                  max={80}
                  step={1}
                  format={(value) => `${value}px`}
                  onChange={(value) =>
                    onBackgroundPatternChange({ ...backgroundPattern, spacing: value })
                  }
                />
                <Slider
                  label={backgroundPattern.type === "dots" ? "Dot size" : "Line width"}
                  value={backgroundPattern.lineWidth}
                  min={0.5}
                  max={6}
                  step={0.5}
                  format={(value) => `${value}px`}
                  onChange={(value) =>
                    onBackgroundPatternChange({ ...backgroundPattern, lineWidth: value })
                  }
                />
                <Slider
                  label="Opacity"
                  value={backgroundPattern.opacity}
                  min={0.02}
                  max={1}
                  step={0.01}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onChange={(value) =>
                    onBackgroundPatternChange({ ...backgroundPattern, opacity: value })
                  }
                />
                <div>
                  <span className="mb-1.5 block text-[11px] text-white/50">
                    Line colour
                  </span>
                  <div className="grid grid-cols-6 gap-1">
                    {["#ffffff", "#000000", ...SWATCHES.slice(0, 4)].map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        title={swatch}
                        aria-label={`Use ${swatch}`}
                        onClick={() =>
                          onBackgroundPatternChange({ ...backgroundPattern, color: swatch })
                        }
                        className={[
                          "h-5 rounded ring-1 transition-transform hover:scale-110",
                          backgroundPattern.color === swatch
                            ? "ring-2 ring-sky-300"
                            : "ring-white/20",
                        ].join(" ")}
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onBackgroundPatternChange({ ...DEFAULT_BACKGROUND_PATTERN })
                  }
                  className="w-full rounded-md bg-white/5 py-1 text-[10px] text-white/60 hover:bg-white/15 hover:text-white"
                >
                  Reset to default
                </button>
              </div>
            )}
          </div>
        </Panel>
      )}

      {panel === "draw" && (
        <Panel title="Draw" onClose={() => setPanel(null)}>
          <div className="grid grid-cols-5 gap-1">
            {DRAW_TOOLS.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.label}
                  aria-label={entry.label}
                  aria-pressed={drawTool === entry.id}
                  onClick={() => onDrawToolChange(entry.id)}
                  className={[
                    "grid h-8 place-items-center rounded-md transition-colors",
                    drawTool === entry.id
                      ? "bg-white/90 text-neutral-900"
                      : "bg-white/5 text-white/70 hover:bg-white/15",
                  ].join(" ")}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] text-white/50">
              Stroke colour
            </span>
            <ColorWheel color={markerColor} onChange={onMarkerColorChange} />
          </div>

          <div className="mt-3 space-y-3">
            <Slider
              label="Stroke width"
              value={brushSize}
              min={1}
              max={24}
              step={1}
              format={(value) => `${value}px`}
              onChange={onBrushSizeChange}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[11px] text-white/50">
                  <Droplet size={11} /> Fill
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onDrawFillChange(drawFill === null ? markerColor : null)
                  }
                  className={[
                    "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                    drawFill === null
                      ? "bg-white/10 text-white/70 hover:bg-white/20"
                      : "bg-white/90 text-neutral-900",
                  ].join(" ")}
                >
                  {drawFill === null ? "Off" : "On"}
                </button>
              </div>
              {drawFill !== null && (
                <>
                  <div className="grid grid-cols-6 gap-1">
                    {SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        title={swatch}
                        aria-label={`Use ${swatch}`}
                        onClick={() => onDrawFillChange(swatch)}
                        className="h-5 rounded ring-1 ring-white/20 transition-transform hover:scale-110"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                  <div className="mt-2">
                    <Slider
                      label="Fill opacity"
                      value={drawFillOpacity}
                      min={0.05}
                      max={1}
                      step={0.01}
                      format={(value) => `${Math.round(value * 100)}%`}
                      onChange={onDrawFillOpacityChange}
                    />
                  </div>
                </>
              )}
            </div>

            <Slider
              label="Overall opacity"
              value={drawOpacity}
              min={0.05}
              max={1}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={onDrawOpacityChange}
            />

            <div className="grid h-9 place-items-center rounded-lg bg-white/5">
              <svg width="150" height="24" viewBox="0 0 150 24">
                <path
                  d="M 6 18 Q 40 2 74 12 T 144 8"
                  fill="none"
                  stroke={markerColor}
                  strokeWidth={brushSize}
                  strokeLinecap="round"
                  opacity={drawOpacity}
                />
              </svg>
            </div>

            <div className="border-t border-white/10 pt-3">
              <Toggle
                label="Straighten & fit shapes"
                hint="Closed pen strokes snap to a rectangle, ellipse, triangle or line where they clearly match one."
                checked={correctDrawings}
                onChange={onCorrectDrawingsChange}
                icon={<Wand2 size={14} className="shrink-0 text-white/50" />}
              />
            </div>
          </div>
        </Panel>
      )}

      {panel === "type" && (
        <Panel title="Typography" onClose={() => setPanel(null)}>
          <div className="grid grid-cols-2 gap-1">
            {FONT_OPTIONS.map((font) => (
              <button
                key={font.label}
                type="button"
                onClick={() => onFontFamilyChange(font.stack)}
                style={{ fontFamily: font.stack }}
                className={[
                  "truncate rounded-md px-2 py-1.5 text-[11px] transition-colors",
                  fontFamily === font.stack
                    ? "bg-white/90 text-neutral-900"
                    : "bg-white/5 text-white/75 hover:bg-white/15",
                ].join(" ")}
              >
                {font.label}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <Slider
              label="Text size"
              value={fontSize}
              min={10}
              max={32}
              step={1}
              format={(value) => `${value}px`}
              onChange={onFontSizeChange}
            />
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] text-white/50">Text colour</span>
              <button
                type="button"
                onClick={() =>
                  onTextColorChange(textColor === null ? autoTextColor : null)
                }
                className={[
                  "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  textColor === null
                    ? "bg-white/90 text-neutral-900"
                    : "bg-white/10 text-white/70 hover:bg-white/20",
                ].join(" ")}
              >
                Auto
              </button>
            </div>
            {textColor !== null && (
              <ColorWheel color={textColor} onChange={onTextColorChange} />
            )}
            {textColor === null && (
              <p className="text-[10px] leading-relaxed text-white/40">
                Contrast is derived from the background colour so text stays
                readable.
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
            <span className="text-[11px] text-white/50">
              Insert emoji at cursor
            </span>
            <EmojiPicker label="Insert emoji" onInsert={onInsertEmoji} />
          </div>
        </Panel>
      )}

      {panel === "shapes" && (
        <Panel title="Custom shapes" onClose={() => setPanel(null)}>
          <button
            type="button"
            onClick={() => {
              setPanel(null);
              onCreateCustomShape();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-400 py-1.5 text-[11px] font-semibold text-neutral-900 hover:bg-sky-300"
          >
            <Plus size={12} />
            Draw a shape
          </button>
          <p className="mt-1.5 text-center text-[10px] leading-relaxed text-white/40">
            Takes over the screen so you draw the pad at its real size — you
            can cut holes into it too.
          </p>

          <div className="mt-2 space-y-1">
            {customShapes.length === 0 && (
              <p className="py-2 text-center text-[10px] text-white/40">
                No custom shapes yet.
              </p>
            )}
            {customShapes.map((custom) => {
              const ref = `${CUSTOM_PREFIX}${custom.id}`;
              const isActive = shape === ref;
              return (
                <div
                  key={custom.id}
                  className={[
                    "flex items-center gap-1 rounded-lg px-1.5 py-1",
                    isActive ? "bg-white/15" : "hover:bg-white/8",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onShapeChange(ref)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 1 1"
                      className="shrink-0"
                    >
                      {custom.holes && custom.holes.length > 0 ? (
                        <path
                          fillRule="evenodd"
                          fill={isActive ? "#7dd3fc" : "rgba(255,255,255,0.55)"}
                          d={[
                            `M ${custom.points.map((p) => `${p.x},${p.y}`).join(" L ")} Z`,
                            ...custom.holes.map(
                              (hole) => `M ${hole.map((p) => `${p.x},${p.y}`).join(" L ")} Z`,
                            ),
                          ].join(" ")}
                        />
                      ) : (
                        <polygon
                          points={custom.points
                            .map((point) => `${point.x},${point.y}`)
                            .join(" ")}
                          fill={isActive ? "#7dd3fc" : "rgba(255,255,255,0.55)"}
                        />
                      )}
                    </svg>
                    <span className="truncate text-[11px] text-white/80">
                      {custom.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${custom.name}`}
                    onClick={() => {
                      setPanel(null);
                      onEditCustomShape(custom);
                    }}
                    className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${custom.name}`}
                    onClick={() => onDeleteCustomShape(custom.id)}
                    className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-rose-300"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
