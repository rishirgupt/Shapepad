/**
 * Thin wrapper over the Tauri window API.
 *
 * `getCurrentWindow()` throws when the bundle is loaded outside a Tauri
 * webview, which would take the whole app down. Resolving it lazily behind a
 * try/catch keeps every desktop-only feature optional, so the same build also
 * renders in a plain browser (useful for inspecting shape/layout work without
 * a native window).
 */

import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

let resolved: Window | null | undefined;

export function appWindow(): Window | null {
  if (resolved === undefined) {
    try {
      resolved =
        typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
          ? getCurrentWindow()
          : null;
    } catch {
      resolved = null;
    }
  }
  return resolved;
}

export const isDesktop = (): boolean => appWindow() !== null;

/** Fire-and-forget helper: desktop-only calls become no-ops in a browser. */
export function withWindow(action: (target: Window) => unknown): void {
  const target = appWindow();
  if (!target) return;
  try {
    const result = action(target);
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    /* window operations are never worth crashing the UI over */
  }
}
