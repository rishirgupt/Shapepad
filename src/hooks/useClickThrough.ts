import { useEffect, useRef } from "react";
import { cursorPosition } from "@tauri-apps/api/window";
import { appWindow } from "../lib/desktop";
import { pointInShape } from "../lib/geometry";
import type { Point } from "../types";

interface ClickThroughOptions {
  /** Shape outline in CSS pixels, relative to the window's top-left. */
  polygon: Point[];
  /** Holes cut into `polygon` — treated like the outside area: pass-through. */
  holes?: Point[][];
  enabled: boolean;
  /** Suspends pass-through entirely (e.g. while a modal is open). */
  suspended?: boolean;
}

/**
 * Makes the transparent area outside the shape click-through, so the desktop
 * and other apps behind the pad stay usable.
 *
 * The catch: once `setIgnoreCursorEvents(true)` is active the webview stops
 * receiving mouse events, so it cannot notice the cursor coming back. The
 * only way out is to ask the OS where the cursor is. We therefore poll the
 * global cursor position and map it into window space ourselves.
 *
 * Window position/size are cached and refreshed from move/resize events, so
 * steady state costs exactly one IPC round-trip per tick.
 */
export function useClickThrough({
  polygon,
  holes = [],
  enabled,
  suspended = false,
}: ClickThroughOptions) {
  const polygonRef = useRef(polygon);
  polygonRef.current = polygon;

  const holesRef = useRef(holes);
  holesRef.current = holes;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  /** True while a mouse button is held — never go transparent mid-gesture. */
  const pointerDownRef = useRef(false);

  useEffect(() => {
    const down = () => {
      pointerDownRef.current = true;
    };
    const up = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  useEffect(() => {
    const target = appWindow();
    if (!target) return;

    let cancelled = false;
    let timer: number | undefined;
    /** Last value pushed to the OS; avoids redundant IPC every tick. */
    let ignoring = false;

    let originX = 0;
    let originY = 0;
    let scale = 1;

    const refreshFrame = async () => {
      try {
        const [position, factor] = await Promise.all([
          target.outerPosition(),
          target.scaleFactor(),
        ]);
        originX = position.x;
        originY = position.y;
        scale = factor || 1;
      } catch {
        /* keep the previous frame */
      }
    };

    const setIgnoring = async (next: boolean) => {
      if (next === ignoring) return;
      ignoring = next;
      try {
        await target.setIgnoreCursorEvents(next);
      } catch {
        ignoring = !next;
      }
    };

    /**
     * Interactive when the cursor is over the painted shape, or over a
     * control that deliberately lives outside it — the toolbar, its panels
     * and the resize grips all carry `data-sp-ui`.
     */
    const isInteractive = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return false;
      }
      const element = document.elementFromPoint(x, y);
      if (element?.closest("[data-sp-ui]")) return true;
      return pointInShape({ x, y }, polygonRef.current, holesRef.current);
    };

    const tick = async () => {
      if (cancelled) return;

      if (!enabledRef.current || suspendedRef.current || pointerDownRef.current) {
        await setIgnoring(false);
      } else {
        try {
          const cursor = await cursorPosition();
          const x = (cursor.x - originX) / scale;
          const y = (cursor.y - originY) / scale;
          await setIgnoring(!isInteractive(x, y));
        } catch {
          await setIgnoring(false);
        }
      }

      if (!cancelled) timer = window.setTimeout(tick, 60);
    };

    const unlistenPromises = [
      target.onMoved(refreshFrame),
      target.onResized(refreshFrame),
    ];

    void refreshFrame().then(tick);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      // Always hand the window back in an interactive state.
      void target.setIgnoreCursorEvents(false).catch(() => undefined);
      unlistenPromises.forEach((promise) =>
        promise.then((unlisten) => unlisten()).catch(() => undefined),
      );
    };
  }, []);
}
