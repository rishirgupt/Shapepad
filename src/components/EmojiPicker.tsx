import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { EMOJI_CATEGORIES } from "../lib/emoji";

interface EmojiPickerProps {
  onInsert: (emoji: string) => void;
  label?: string;
}

/**
 * A small button that pops open a curated emoji grid and hands the picked
 * character back via `onInsert` — how it gets inserted (CodeMirror
 * selection vs a textarea's cursor position) is the caller's problem, this
 * component only knows "the user picked this glyph."
 */
export default function EmojiPicker({
  onInsert,
  label = "Insert emoji",
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  return (
    <div ref={rootRef} data-sp-ui className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={[
          "grid h-7 w-7 place-items-center rounded-lg transition-colors",
          open
            ? "bg-white/90 text-neutral-900"
            : "text-white/75 hover:bg-white/15 hover:text-white",
        ].join(" ")}
      >
        <Smile size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          className="absolute bottom-full left-0 z-50 mb-2 w-60 animate-fade-in rounded-xl border border-white/10 bg-neutral-900/95 p-2 shadow-float backdrop-blur-xl"
        >
          <div className="mb-1.5 flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {EMOJI_CATEGORIES.map((cat, index) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => setCategory(index)}
                className={[
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[10px] transition-colors",
                  category === index
                    ? "bg-white/90 text-neutral-900"
                    : "bg-white/5 text-white/60 hover:bg-white/15 hover:text-white",
                ].join(" ")}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_CATEGORIES[category].emoji.map((glyph) => (
              <button
                key={glyph}
                type="button"
                title={glyph}
                onClick={() => {
                  onInsert(glyph);
                  setOpen(false);
                }}
                className="grid h-7 w-7 place-items-center rounded-md text-base hover:bg-white/15"
              >
                {glyph}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
