import { useCallback, useEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Tracks an element's box.
 *
 * Shape geometry, click-through hit-testing and text reflow all depend on the
 * live container size, and a frameless window is resized by dragging its
 * edges — so this has to be right or the shape desyncs from the window.
 *
 * Two signals feed it:
 *  - a ResizeObserver, which catches layout-driven changes; and
 *  - the window `resize` event, because this container always spans the whole
 *    window and ResizeObserver delivery is tied to the rendering lifecycle —
 *    it goes quiet whenever the window is occluded or not compositing.
 *
 * The ref is a callback ref so the observer follows the element across
 * remounts instead of silently watching a detached node.
 */
export function useElementSize<T extends HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const apply = useCallback((width: number, height: number) => {
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const measure = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    apply(element.clientWidth, element.clientHeight);
  }, [apply]);

  const ref = useCallback(
    (element: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elementRef.current = element;
      if (!element) return;

      apply(element.clientWidth, element.clientHeight);

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        apply(
          Math.round(entry.contentRect.width),
          Math.round(entry.contentRect.height),
        );
      });
      observer.observe(element);
      observerRef.current = observer;
    },
    [apply],
  );

  useEffect(() => {
    window.addEventListener("resize", measure);
    // One deferred pass catches fonts/scrollbars settling after first paint.
    const initial = window.setTimeout(measure, 0);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(initial);
    };
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, size };
}
