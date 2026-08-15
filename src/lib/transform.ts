/**
 * Shared geometry for transformable objects (images, text boxes).
 *
 * Every object is stored as an unrotated box plus a rotation about its
 * centre. Keeping the box axis-aligned means text can wrap and images can
 * crop in a simple local frame; the rotation is applied only at render time.
 */

import type { Point } from "../types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Which axes each handle drives, in the object's own unrotated frame. */
export const HANDLE_SIGNS: Record<HandleId, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> =
  {
    nw: { sx: -1, sy: -1 },
    n: { sx: 0, sy: -1 },
    ne: { sx: 1, sy: -1 },
    e: { sx: 1, sy: 0 },
    se: { sx: 1, sy: 1 },
    s: { sx: 0, sy: 1 },
    sw: { sx: -1, sy: 1 },
    w: { sx: -1, sy: 0 },
  };

export const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

export const HANDLE_IDS = Object.keys(HANDLE_SIGNS) as HandleId[];

export function rotatePoint(point: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/**
 * Resize `start` by dragging `handle` to `pointer`.
 *
 * The corner opposite the handle is pinned in world space: the pointer delta
 * is counter-rotated into the object's own frame to get the new size, then
 * the centre is recomputed from the pinned anchor. Without that the anchor
 * drifts as soon as the object is rotated.
 */
export function resizeBox(
  start: Box,
  handle: HandleId,
  pointer: Point,
  options: { keepAspect: boolean; minSize: number },
): Pick<Box, "x" | "y" | "width" | "height"> {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const radians = (start.rotation * Math.PI) / 180;

  const centre = {
    x: start.x + start.width / 2,
    y: start.y + start.height / 2,
  };
  const anchorLocal = {
    x: (-sx * start.width) / 2,
    y: (-sy * start.height) / 2,
  };
  const rotatedAnchor = rotatePoint(anchorLocal, radians);
  const anchorWorld = {
    x: centre.x + rotatedAnchor.x,
    y: centre.y + rotatedAnchor.y,
  };

  const delta = rotatePoint(
    { x: pointer.x - anchorWorld.x, y: pointer.y - anchorWorld.y },
    -radians,
  );

  let width = sx === 0 ? start.width : Math.abs(delta.x);
  let height = sy === 0 ? start.height : Math.abs(delta.y);

  if (options.keepAspect && sx !== 0 && sy !== 0) {
    const aspect = start.width / Math.max(1, start.height);
    if (width / aspect > height) height = width / aspect;
    else width = height * aspect;
  }

  width = Math.max(options.minSize, width);
  height = Math.max(options.minSize, height);

  const nextAnchorLocal = { x: (-sx * width) / 2, y: (-sy * height) / 2 };
  const nextRotated = rotatePoint(nextAnchorLocal, radians);
  const nextCentre = {
    x: anchorWorld.x - nextRotated.x,
    y: anchorWorld.y - nextRotated.y,
  };

  return {
    width,
    height,
    x: nextCentre.x - width / 2,
    y: nextCentre.y - height / 2,
  };
}

/** Axis-aligned bounds of a point cloud. */
export function boundsOf(points: Point[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Ramer–Douglas–Peucker.
 *
 * A freehand pen stroke arrives as hundreds of samples. Feeding that straight
 * into a `clip-path: polygon()` is both slow to rasterise and bloats the saved
 * document, so pen-drawn outlines are simplified before they become a shape.
 */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;

  const first = 0;
  const last = points.length - 1;
  let index = -1;
  let maxDistance = 0;

  const a = points[first];
  const b = points[last];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  for (let i = first + 1; i < last; i += 1) {
    const p = points[i];
    let distance: number;
    if (lengthSquared === 0) {
      distance = Math.hypot(p.x - a.x, p.y - a.y);
    } else {
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, t));
      distance = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > tolerance && index !== -1) {
    const left = simplifyPath(points.slice(first, index + 1), tolerance);
    const right = simplifyPath(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [a, b];
}
