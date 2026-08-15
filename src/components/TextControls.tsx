import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Palette,
  Trash2,
  Type,
} from "lucide-react";
import EmojiPicker from "./EmojiPicker";
import { FONT_OPTIONS, type TextBox } from "../types";

interface TextControlsProps {
  box: TextBox;
  onPatch: (patch: Partial<TextBox>) => void;
  onDelete: () => void;
}

function Btn({
  label,
  active,
  onClick,
  tone = "default",
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const base =
    tone === "danger"
      ? "text-white/75 hover:bg-rose-500/25 hover:text-rose-200"
      : active
        ? "bg-white/90 text-neutral-900"
        : "text-white/75 hover:bg-white/15 hover:text-white";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${base}`}
    >
      {children}
    </button>
  );
}

/**
 * Per-box typography and transform controls.
 *
 * Deliberately separate from the rail's Typography panel: that one styles the
 * whole notepad document, this one styles just the selected text box.
 */
export default function TextControls({
  box,
  onPatch,
  onDelete,
}: TextControlsProps) {
  const [showColor, setShowColor] = useState(false);

  return (
    <div
      data-sp-ui
      className="pointer-events-auto absolute bottom-2 left-1/2 z-50 -translate-x-1/2"
      role="toolbar"
      aria-label="Text controls"
    >
      {showColor && (
        <div className="sp-picker mb-2 rounded-xl border border-white/10 bg-neutral-900/95 p-2 shadow-float backdrop-blur-xl">
          <HexColorPicker
            color={box.color}
            onChange={(hex) => onPatch({ color: hex })}
          />
        </div>
      )}

      <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/90 px-2 py-1.5 shadow-float backdrop-blur-xl">
        <select
          aria-label="Font family"
          value={box.fontFamily}
          onChange={(event) => onPatch({ fontFamily: event.target.value })}
          className="max-w-[104px] rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white outline-none focus:border-white/30"
        >
          {FONT_OPTIONS.map((font) => (
            <option key={font.label} value={font.stack} className="bg-neutral-900">
              {font.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 px-1">
          <Type size={12} className="text-white/45" />
          <input
            type="number"
            aria-label="Font size"
            min={8}
            max={200}
            value={Math.round(box.fontSize)}
            onChange={(event) =>
              onPatch({
                fontSize: Math.min(200, Math.max(8, Number(event.target.value))),
              })
            }
            className="w-11 rounded-md border border-white/10 bg-white/5 px-1 py-1 text-[11px] text-white outline-none focus:border-white/30"
          />
        </label>

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        <Btn
          label="Bold"
          active={box.bold}
          onClick={() => onPatch({ bold: !box.bold })}
        >
          <Bold size={14} />
        </Btn>
        <Btn
          label="Italic"
          active={box.italic}
          onClick={() => onPatch({ italic: !box.italic })}
        >
          <Italic size={14} />
        </Btn>

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        <Btn
          label="Align left"
          active={box.align === "left"}
          onClick={() => onPatch({ align: "left" })}
        >
          <AlignLeft size={14} />
        </Btn>
        <Btn
          label="Align centre"
          active={box.align === "center"}
          onClick={() => onPatch({ align: "center" })}
        >
          <AlignCenter size={14} />
        </Btn>
        <Btn
          label="Align right"
          active={box.align === "right"}
          onClick={() => onPatch({ align: "right" })}
        >
          <AlignRight size={14} />
        </Btn>

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        <button
          type="button"
          title="Text colour"
          aria-label="Text colour"
          aria-expanded={showColor}
          onClick={() => setShowColor((value) => !value)}
          className={[
            "relative grid h-7 w-7 place-items-center rounded-lg transition-colors",
            showColor ? "ring-2 ring-white/70" : "hover:bg-white/15",
          ].join(" ")}
        >
          <span
            className="absolute inset-1 rounded-md ring-1 ring-white/40"
            style={{ backgroundColor: box.color }}
          />
          <span className="relative text-white mix-blend-difference">
            <Palette size={12} />
          </span>
        </button>

        <label className="flex items-center gap-1.5 px-1">
          <span className="text-[10px] uppercase tracking-wider text-white/50">
            Opacity
          </span>
          <input
            type="range"
            className="sp-range w-14"
            aria-label="Text opacity"
            min={0.05}
            max={1}
            step={0.01}
            value={box.opacity}
            onChange={(event) =>
              onPatch({ opacity: Number(event.target.value) })
            }
          />
        </label>

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        {/* Text boxes are a plain textarea, not a rich editor, so there's no
            live cursor position to insert into from here — this appends to
            the end rather than at the caret. Typing an emoji directly (the
            OS picker, Win+.) still inserts at the caret as usual. */}
        <EmojiPicker
          label="Insert emoji at end"
          onInsert={(emoji) => onPatch({ text: box.text + emoji })}
        />

        <div className="mx-0.5 h-5 w-px bg-white/15" />

        <Btn label="Delete text box" tone="danger" onClick={onDelete}>
          <Trash2 size={14} />
        </Btn>
      </div>
    </div>
  );
}
