import {
  HANDLE_CURSORS,
  HANDLE_IDS,
  HANDLE_SIGNS,
  type HandleId,
} from "../lib/transform";

interface SelectionBoxProps {
  onResize: (event: React.PointerEvent, handle: HandleId) => void;
  onRotate: (event: React.PointerEvent) => void;
  /** Hidden while another interaction owns the object (e.g. cropping). */
  showHandles?: boolean;
  accent?: string;
}

/**
 * Selection chrome: outline, eight resize handles, one rotation handle.
 *
 * Rendered inside the object's rotated frame so the handles rotate with it
 * and stay under the corner they actually control.
 */
export default function SelectionBox({
  onResize,
  onRotate,
  showHandles = true,
  accent = "#7dd3fc",
}: SelectionBoxProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 0 1px ${accent}` }}
      />

      {showHandles && (
        <>
          {HANDLE_IDS.map((handle) => {
            const { sx, sy } = HANDLE_SIGNS[handle];
            return (
              <div
                key={handle}
                role="presentation"
                onPointerDown={(event) => onResize(event, handle)}
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-neutral-800"
                style={{
                  left: `${(sx + 1) * 50}%`,
                  top: `${(sy + 1) * 50}%`,
                  cursor: HANDLE_CURSORS[handle],
                  backgroundColor: accent,
                }}
              />
            );
          })}

          <div
            className="pointer-events-none absolute left-1/2 w-px"
            style={{ top: -20, height: 20, backgroundColor: accent }}
          />
          <div
            role="presentation"
            title="Rotate (hold Shift to snap to 15°)"
            onPointerDown={onRotate}
            className="absolute left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-neutral-800 bg-amber-300"
            style={{ top: -26 }}
          />
        </>
      )}
    </>
  );
}
