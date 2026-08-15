import { useCallback, useRef, useState } from "react";
import { AppWindow, ExternalLink, Plus, X } from "lucide-react";
import { clipPathFor, resolveGeometry } from "../lib/geometry";
import type { PadDocument } from "../types";

interface TabBarProps {
  tabs: PadDocument[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onNewWindow: () => void;
  onMoveToNewWindow: (id: string) => void;
  busy?: boolean;
}

const SWATCH_SIZE = 15;

/** Tiny clipped swatch previewing a tab's actual shape and colour. */
function ShapeSwatch({ doc }: { doc: PadDocument }) {
  const geometry = resolveGeometry(doc.shape, doc.customShapes);
  const clipPath = clipPathFor(geometry, SWATCH_SIZE, SWATCH_SIZE);
  return (
    <span
      className="shrink-0 ring-1 ring-white/25"
      style={{
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
        clipPath,
        backgroundColor: doc.backgroundColor,
      }}
      aria-hidden="true"
    />
  );
}

/**
 * A Chrome-like tab strip.
 *
 * Deliberately lives outside the clipped shape, in the same unclipped
 * overlay as the side toolbar — a literal rectangular strip is the one
 * layout that reads cleanly no matter which tab's shape (circle, star, a
 * custom outline with holes) happens to be active. Each tab instead carries
 * a small clipped swatch of its *own* shape and colour, so you can tell
 * tabs apart by what they'll look like without the strip itself having to
 * contort into any of them.
 */
export default function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
  onNewWindow,
  onMoveToNewWindow,
  busy = false,
}: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback(
    (event: React.PointerEvent, index: number) => {
      if (event.button !== 0) return;
      setDragIndex(index);
      // Tracks where the dragged tab actually is right now. `index` is only
      // the starting position — after the first swap it's stale, so every
      // subsequent comparison in this same gesture has to go through this
      // ref rather than the closed-over parameter.
      const currentIndexRef = { current: index };
      const rail = railRef.current;

      const move = (moveEvent: PointerEvent) => {
        if (!rail) return;
        const current = currentIndexRef.current;
        const tabEls = Array.from(
          rail.querySelectorAll<HTMLElement>("[data-tab-index]"),
        );
        for (const el of tabEls) {
          const overIndex = Number(el.dataset.tabIndex);
          if (overIndex === current) continue;
          const rect = el.getBoundingClientRect();
          const midpoint = rect.left + rect.width / 2;
          // Standard drag-reorder rule: swap only once the cursor has
          // crossed the neighbouring tab's midpoint in the direction of
          // travel, so the order doesn't flip back and forth right at a
          // boundary.
          const crossed =
            overIndex < current
              ? moveEvent.clientX < midpoint
              : moveEvent.clientX > midpoint;
          if (crossed) {
            onReorder(current, overIndex);
            currentIndexRef.current = overIndex;
            setDragIndex(overIndex);
            return;
          }
        }
      };

      const end = () => {
        setDragIndex(null);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    },
    [onReorder],
  );

  return (
    <div
      data-sp-ui
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-1.5"
    >
      <div
        ref={railRef}
        className="pointer-events-auto flex max-w-[calc(100vw-14px)] items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/85 p-1 shadow-float backdrop-blur-xl"
        role="tablist"
        aria-label="Open pads"
      >
        <div className="flex max-w-[70vw] items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                data-tab-index={index}
                role="tab"
                aria-selected={isActive}
                onPointerDown={(event) => {
                  // Only the drag handle area (the tab body, not its
                  // buttons) should initiate a reorder.
                  if ((event.target as HTMLElement).closest("button")) return;
                  startDrag(event, index);
                }}
                onClick={() => onSelect(tab.id)}
                className={[
                  "group flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 transition-colors",
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:bg-white/8 hover:text-white/90",
                  dragIndex === index ? "opacity-60" : "",
                ].join(" ")}
                style={{ maxWidth: 168, cursor: "default" }}
                title={tab.filePath ?? tab.title}
              >
                <ShapeSwatch doc={tab} />
                <span className="truncate text-[11px] leading-none">
                  {tab.title}
                </span>
                {tab.dirty && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300"
                    aria-label="Unsaved changes"
                    title="Unsaved changes"
                  />
                )}

                <button
                  type="button"
                  aria-label={`Move "${tab.title}" to a new window`}
                  title="Move to new window"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMoveToNewWindow(tab.id);
                  }}
                  className="ml-0.5 hidden shrink-0 rounded p-0.5 text-white/50 hover:bg-white/15 hover:text-white group-hover:block disabled:opacity-40"
                >
                  <ExternalLink size={11} />
                </button>
                <button
                  type="button"
                  aria-label={`Close "${tab.title}"`}
                  title="Close tab"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  className={[
                    "shrink-0 rounded p-0.5 text-white/50 hover:bg-white/15 hover:text-white",
                    isActive ? "block" : "hidden group-hover:block",
                  ].join(" ")}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="New tab"
          title="New tab (Ctrl+T)"
          onClick={onNewTab}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Plus size={14} />
        </button>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-white/15" />

        <button
          type="button"
          aria-label="New window"
          title="New window (Ctrl+Shift+N)"
          disabled={busy}
          onClick={onNewWindow}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40"
        >
          <AppWindow size={14} />
        </button>
      </div>
    </div>
  );
}
