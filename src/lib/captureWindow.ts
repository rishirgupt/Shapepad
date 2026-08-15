/**
 * Window choreography for full-screen shape capture.
 *
 * Drawing a shape "at the size you actually want it" means the drawing
 * surface has to *be* the screen. So the pad temporarily expands to fill the
 * monitor, and on confirm it collapses onto the bounding box of whatever was
 * drawn — the outline you saw is literally the window you get.
 */

import {
  currentMonitor,
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { appWindow } from "./desktop";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureFrame {
  /** Logical window rect before capture, restored on cancel. */
  previous: Rect | null;
  /** Logical origin of the monitor we expanded across. */
  monitorOrigin: { x: number; y: number };
}

export const CAPTURE_MIN_DIMENSION = 180;

/** Expands the window to fill its monitor. Returns what to restore. */
export async function enterCapture(): Promise<CaptureFrame> {
  const target = appWindow();
  if (!target) return { previous: null, monitorOrigin: { x: 0, y: 0 } };

  const frame: CaptureFrame = {
    previous: null,
    monitorOrigin: { x: 0, y: 0 },
  };

  try {
    const [position, size, scale] = await Promise.all([
      target.outerPosition(),
      target.outerSize(),
      target.scaleFactor(),
    ]);
    const factor = scale || 1;
    frame.previous = {
      x: position.x / factor,
      y: position.y / factor,
      width: size.width / factor,
      height: size.height / factor,
    };

    const monitor = await currentMonitor();
    if (monitor) {
      const monitorScale = monitor.scaleFactor || factor;
      frame.monitorOrigin = {
        x: monitor.position.x / monitorScale,
        y: monitor.position.y / monitorScale,
      };
      // Physical units here so we land exactly on the monitor bounds
      // regardless of how the two scale factors compare.
      await target.setPosition(
        new PhysicalPosition(monitor.position.x, monitor.position.y),
      );
      await target.setSize(
        new PhysicalSize(monitor.size.width, monitor.size.height),
      );
    }
  } catch {
    /* Capture still works within the current window bounds. */
  }

  return frame;
}

/**
 * Collapses the window onto `target` (a rect in capture-surface CSS pixels),
 * or restores the pre-capture rect when `target` is null.
 */
export async function exitCapture(
  frame: CaptureFrame,
  target: Rect | null,
): Promise<void> {
  const win = appWindow();
  if (!win) return;

  try {
    if (target) {
      await win.setSize(
        new LogicalSize(
          Math.max(CAPTURE_MIN_DIMENSION, Math.round(target.width)),
          Math.max(CAPTURE_MIN_DIMENSION, Math.round(target.height)),
        ),
      );
      await win.setPosition(
        new LogicalPosition(
          Math.round(frame.monitorOrigin.x + target.x),
          Math.round(frame.monitorOrigin.y + target.y),
        ),
      );
    } else if (frame.previous) {
      await win.setSize(
        new LogicalSize(frame.previous.width, frame.previous.height),
      );
      await win.setPosition(
        new LogicalPosition(frame.previous.x, frame.previous.y),
      );
    }
  } catch {
    /* Leave the window where it is rather than crash the UI. */
  }
}

/** Restores a saved document's authoring size. */
export async function applyWindowSize(
  width: number,
  height: number,
): Promise<void> {
  const win = appWindow();
  if (!win) return;
  try {
    await win.setSize(new LogicalSize(Math.round(width), Math.round(height)));
  } catch {
    /* Non-fatal: content coordinates simply will not line up. */
  }
}
