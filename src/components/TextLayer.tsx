import { useCallback, useEffect, useRef } from "react";
import SelectionBox from "./SelectionBox";
import { useBoxGestures } from "../hooks/useBoxGestures";
import type { Box } from "../lib/transform";
import type { TextBox } from "../types";

interface TextLayerProps {
  boxes: TextBox[];
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  onChange: (id: string, patch: Partial<TextBox>) => void;
  /** Click on empty canvas creates a box there. */
  onCreateAt: (point: { x: number; y: number }) => void;
  active: boolean;
}

/**
 * Free-floating text boxes.
 *
 * Each box owns its own font, size and colour — unlike the notepad layer,
 * where typography applies to the whole document. Boxes move, resize and
 * rotate using the same gesture maths as images (`useBoxGestures`).
 *
 * A box renders as static text until double-clicked, at which point a
 * transparent textarea takes over in place. Swapping rather than always
 * rendering a textarea keeps wrapping identical between the two states and
 * avoids a permanently focusable element under every drag gesture.
 */
export default function TextLayer({
  boxes,
  selectedId,
  editingId,
  onSelect,
  onEdit,
  onChange,
  onCreateAt,
  active,
}: TextLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyPatch = useCallback(
    (item: TextBox, patch: Partial<Box>) => onChange(item.id, patch),
    [onChange],
  );

  const { startMove, startResize, startRotate, toLocal } =
    useBoxGestures<TextBox>({
      containerRef: rootRef,
      onChange: applyPatch,
      enabled: active,
      minSize: 32,
    });

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    // Deliberately keyed on `active` alone — see the matching comment in
    // ImageLayer.tsx. `onSelect`/`onEdit` are fresh closures every render,
    // so listing them here would loop: effect fires → state update →
    // re-render → new closures → effect fires again, forever.
    if (!active) {
      onSelect(null);
      onEdit(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleBackgroundDown = useCallback(
    (event: React.PointerEvent) => {
      if (!active || event.button !== 0) return;
      if (event.target !== event.currentTarget) return;
      if (editingId) {
        onEdit(null);
        return;
      }
      if (selectedId) {
        onSelect(null);
        return;
      }
      onCreateAt(toLocal(event.clientX, event.clientY));
    },
    [active, editingId, onCreateAt, onEdit, onSelect, selectedId, toLocal],
  );

  return (
    <div
      ref={rootRef}
      className={[
        "absolute inset-0",
        active ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      onPointerDown={handleBackgroundDown}
    >
      {boxes.map((box) => {
        const isSelected = box.id === selectedId;
        const isEditing = box.id === editingId;

        const typography: React.CSSProperties = {
          fontFamily: box.fontFamily,
          fontSize: box.fontSize,
          lineHeight: 1.3,
          color: box.color,
          fontWeight: box.bold ? 700 : 400,
          fontStyle: box.italic ? "italic" : "normal",
          textAlign: box.align,
        };

        return (
          <div
            key={box.id}
            className="absolute"
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              transform: `rotate(${box.rotation}deg)`,
              opacity: box.opacity,
              cursor: active && !isEditing ? "move" : "text",
            }}
            onPointerDown={(event) => {
              if (!active || isEditing) return;
              onSelect(box.id);
              startMove(event, box);
            }}
            onDoubleClick={(event) => {
              if (!active) return;
              event.stopPropagation();
              onSelect(box.id);
              onEdit(box.id);
            }}
          >
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={box.text}
                onChange={(event) =>
                  onChange(box.id, { text: event.target.value })
                }
                onBlur={() => onEdit(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onEdit(null);
                  }
                  event.stopPropagation();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                spellCheck={false}
                className="h-full w-full resize-none border-none bg-transparent p-0 outline-none"
                style={typography}
              />
            ) : (
              <div
                className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
                style={typography}
              >
                {box.text || (
                  <span style={{ opacity: 0.4 }}>Double-click to edit</span>
                )}
              </div>
            )}

            {isSelected && active && (
              <SelectionBox
                showHandles={!isEditing}
                onResize={(event, handle) => startResize(event, box, handle)}
                onRotate={(event) => startRotate(event, box)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
