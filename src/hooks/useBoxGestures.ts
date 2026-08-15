import { useCallback, useRef, useState } from "react";
import {
  resizeBox,
  rotatePoint,
  type Box,
  type HandleId,
} from "../lib/transform";
import type { Point } from "../types";

interface Options<T extends Box> {
  /** Element whose top-left is the origin for all stored coordinates. */
  containerRef: React.RefObject<HTMLElement | null>;
  onChange: (item: T, patch: Partial<Box>) => void;
  enabled: boolean;
  minSize?: number;
}

/**
 * Pointer gestures shared by every transformable layer.
 *
 * Listeners go on `window` rather than the element so a gesture keeps
 * tracking when the cursor leaves the (clipped) shape mid-drag, and each
 * gesture reads from a snapshot of the box taken at pointer-down — deriving
 * from live props would compound rounding on every move event.
 */
export function useBoxGestures<T extends Box>({
  containerRef,
  onChange,
  enabled,
  minSize = 24,
}: Options<T>) {
  const [dragging, setDragging] = useState(false);
  const activeRef = useRef(false);

  const toLocal = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef],
  );

  const run = useCallback(
    (
      event: React.PointerEvent,
      onMove: (pointer: Point, moveEvent: PointerEvent) => void,
    ) => {
      if (!enabled || event.button !== 0 || activeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      activeRef.current = true;
      setDragging(true);

      const move = (moveEvent: PointerEvent) => {
        onMove(toLocal(moveEvent.clientX, moveEvent.clientY), moveEvent);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        activeRef.current = false;
        setDragging(false);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [enabled, toLocal],
  );

  const startMove = useCallback(
    (event: React.PointerEvent, item: T) => {
      const origin = toLocal(event.clientX, event.clientY);
      const startX = item.x;
      const startY = item.y;
      run(event, (pointer) => {
        onChange(item, {
          x: startX + (pointer.x - origin.x),
          y: startY + (pointer.y - origin.y),
        });
      });
    },
    [onChange, run, toLocal],
  );

  const startResize = useCallback(
    (event: React.PointerEvent, item: T, handle: HandleId) => {
      const snapshot: Box = {
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
      };
      run(event, (pointer, moveEvent) => {
        onChange(
          item,
          resizeBox(snapshot, handle, pointer, {
            // Alt frees the aspect ratio on corner handles.
            keepAspect: !moveEvent.altKey,
            minSize,
          }),
        );
      });
    },
    [minSize, onChange, run],
  );

  const startRotate = useCallback(
    (event: React.PointerEvent, item: T) => {
      const centre = {
        x: item.x + item.width / 2,
        y: item.y + item.height / 2,
      };
      const origin = toLocal(event.clientX, event.clientY);
      const startAngle =
        (Math.atan2(origin.y - centre.y, origin.x - centre.x) * 180) / Math.PI;
      const startRotation = item.rotation;

      run(event, (pointer, moveEvent) => {
        const angle =
          (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) /
          Math.PI;
        let next = startRotation + (angle - startAngle);
        if (moveEvent.shiftKey) next = Math.round(next / 15) * 15;
        onChange(item, { rotation: Math.round(next * 10) / 10 });
      });
    },
    [onChange, run, toLocal],
  );

  return { startMove, startResize, startRotate, dragging, toLocal };
}

export { rotatePoint };
