/**
 * Whiteboard-style ink correction.
 *
 * Turns a hand-drawn pen stroke into either a smoothed freehand path or, when
 * the stroke looks intentional, a fitted straight line / rectangle / ellipse
 * / triangle — the same idea as Microsoft Whiteboard's "ink to shape".
 *
 * This is a heuristic classifier, not true shape recognition: it looks at a
 * handful of measurements (closedness, simplified vertex count, how much of
 * its own oriented bounding box the stroke fills) and picks whichever
 * primitive those measurements best match. It's tuned to be conservative —
 * an ambiguous scribble is left as smoothed ink rather than forced into a
 * shape it doesn't really resemble.
 */

import { simplifyPath } from "./transform";
import type { DrawObject, DrawTool, Point } from "../types";
import { createDrawObject } from "../types";

const ELLIPSE_SAMPLES = 48;

interface OrientedBox {
  center: Point;
  /** Unit vector along the box's long axis. */
  axisA: Point;
  /** Unit vector along the box's short axis, perpendicular to `axisA`. */
  axisB: Point;
  halfA: number;
  halfB: number;
}

function centroidOf(points: Point[]): Point {
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Shoelace formula. Assumes `points` is already a closed loop's vertices. */
function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/**
 * Fits an oriented bounding box via PCA: the covariance matrix's dominant
 * eigenvector gives the box's long axis, and projecting every point onto
 * that axis (and its perpendicular) gives the extents. Closed-form for a 2×2
 * symmetric matrix — no iterative solver needed.
 */
function orientedBoundingBox(rawPoints: Point[]): OrientedBox {
  // A closed stroke's last sample sits right on top of its first (that's
  // literally how "closed" was detected) — left in, that point gets counted
  // twice, which drags the centroid and covariance both toward that one
  // corner and inflates the fitted box. Drop it before fitting.
  const first = rawPoints[0];
  const last = rawPoints[rawPoints.length - 1];
  const points =
    rawPoints.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) < 12
      ? rawPoints.slice(0, -1)
      : rawPoints;

  const centroid = centroidOf(points);
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= points.length;
  cyy /= points.length;
  cxy /= points.length;

  let axisA: Point;
  if (Math.abs(cxy) < 1e-9) {
    // Already axis-aligned: covariance matrix is diagonal.
    axisA = cxx >= cyy ? { x: 1, y: 0 } : { x: 0, y: 1 };
  } else {
    const trace = cxx + cyy;
    const diff = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy);
    const lambda1 = (trace + diff) / 2;
    const vx = cxy;
    const vy = lambda1 - cxx;
    const length = Math.hypot(vx, vy) || 1;
    axisA = { x: vx / length, y: vy / length };
  }
  const axisB: Point = { x: -axisA.y, y: axisA.x };

  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const p of points) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const a = dx * axisA.x + dy * axisA.y;
    const b = dx * axisB.x + dy * axisB.y;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }

  const midA = (minA + maxA) / 2;
  const midB = (minB + maxB) / 2;
  return {
    center: {
      x: centroid.x + midA * axisA.x + midB * axisB.x,
      y: centroid.y + midA * axisA.y + midB * axisB.y,
    },
    axisA,
    axisB,
    halfA: Math.max(4, (maxA - minA) / 2),
    halfB: Math.max(4, (maxB - minB) / 2),
  };
}

function boxCorners(box: OrientedBox): Point[] {
  const { center, axisA, axisB, halfA, halfB } = box;
  const at = (sa: number, sb: number) => ({
    x: center.x + sa * halfA * axisA.x + sb * halfB * axisB.x,
    y: center.y + sa * halfA * axisA.y + sb * halfB * axisB.y,
  });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

function boxEllipse(box: OrientedBox, samples = ELLIPSE_SAMPLES): Point[] {
  const { center, axisA, axisB, halfA, halfB } = box;
  return Array.from({ length: samples }, (_, i) => {
    const t = (i / samples) * 2 * Math.PI;
    const a = Math.cos(t) * halfA;
    const b = Math.sin(t) * halfB;
    return {
      x: center.x + a * axisA.x + b * axisB.x,
      y: center.y + a * axisA.y + b * axisB.y,
    };
  });
}

export interface CorrectionOptions {
  color: string;
  brushSize: number;
  fill: string | null;
  fillOpacity: number;
  opacity: number;
}

/**
 * Classifies and refits one raw pen stroke. Always returns a usable
 * `DrawObject` — worst case, a lightly-smoothed copy of the original path.
 */
export function correctStroke(
  rawPoints: Point[],
  options: CorrectionOptions,
): DrawObject {
  const base = (tool: DrawTool, points: Point[], corrected: boolean) =>
    createDrawObject(tool, points, {
      color: options.color,
      brushSize: options.brushSize,
      fill: options.fill,
      fillOpacity: options.fillOpacity,
      opacity: options.opacity,
      corrected,
    });

  if (rawPoints.length < 3) return base("pen", rawPoints, false);

  const start = rawPoints[0];
  const end = rawPoints[rawPoints.length - 1];
  const span = pathLength(rawPoints);
  const closeGap = Math.hypot(end.x - start.x, end.y - start.y);
  // A stroke is "closed" if its ends met relative to how far the pen
  // travelled — an absolute pixel threshold alone would misjudge tiny or
  // huge strokes.
  const closed = span > 0 && closeGap < Math.max(18, span * 0.12);

  if (!closed) {
    const tolerance = Math.max(2, span * 0.02);
    const simplified = simplifyPath(rawPoints, tolerance);
    if (simplified.length <= 2) {
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      // A near-zero-length open "stroke" is a tap or a dot, not a line.
      if (distance > 6) return base("line", [start, end], true);
    }
    // Not straight enough to be a line: keep it as pen ink, lightly smoothed.
    return base("pen", simplifyPath(rawPoints, 1.5), false);
  }

  // Closed stroke: work out how well it matches a triangle, rectangle, or
  // ellipse, and fall back to smoothed closed ink if none fit confidently.
  const box = orientedBoundingBox(rawPoints);
  const bboxArea = 4 * box.halfA * box.halfB;

  const coarse = simplifyPath(rawPoints, Math.max(6, span * 0.08));
  // simplifyPath doesn't know the path is closed, so its last point is
  // effectively a duplicate of the first for our purposes.
  const corners =
    coarse.length > 1 &&
    Math.hypot(
      coarse[0].x - coarse[coarse.length - 1].x,
      coarse[0].y - coarse[coarse.length - 1].y,
    ) < 12
      ? coarse.slice(0, -1)
      : coarse;

  // A stroke that simplifies down to a handful of straight corners *and*
  // whose corners still account for essentially all of the stroke's actual
  // enclosed area is fundamentally polygonal (a triangle or quadrilateral)
  // — use those corners directly rather than the PCA-fitted box. This
  // matters more than it sounds: for a near-square rectangle the box's two
  // eigenvalues sit close together, which makes the fitted axis (and so the
  // box itself) numerically unstable under ordinary hand jitter. Corner
  // detection has no such instability, so it's the more reliable signal
  // whenever the shape actually has corners to find.
  //
  // The area check is what keeps this from misfiring on circles: a large
  // circle can *also* coarse-simplify down to 4–5 points (RDP doesn't know
  // it's supposed to preserve roundness), but connecting those few points
  // cuts off a large chunk of the circle's real area — an inscribed square
  // covers only ~64% of its circle — whereas a genuine rectangle's corners
  // lose essentially none of it.
  if (corners.length >= 3 && corners.length <= 5) {
    const cornerArea = polygonArea(corners);
    const rawArea = polygonArea(rawPoints);
    if (cornerArea > bboxArea * 0.12 && (rawArea === 0 || cornerArea / rawArea > 0.92)) {
      // There's no separate "triangle" tool: the `rect` renderer just draws
      // whatever closed point list it's given as an SVG polygon, so a
      // 3-point fit renders as a triangle and a 4- or 5-point fit as a
      // quadrilateral — the tool tag only distinguishes "closed filled
      // polygon" from pen/line/etc.
      return base("rect", corners, true);
    }
  }

  // Shoelace directly on the raw samples, deliberately unsimplified: small
  // zigzags from hand jitter roughly cancel out in the signed-area sum, but
  // picking *any* simplification tolerance here tended to shave off area
  // unevenly depending on how the jitter happened to align with it, which
  // was making otherwise-clean rectangles register as noticeably less than
  // their true area.
  const strokeArea = polygonArea(rawPoints);
  const fillRatio = bboxArea > 0 ? strokeArea / bboxArea : 0;

  // A rectangle fills essentially all of its own oriented bounding box
  // (ratio → 1); a circle or ellipse fills π/4 ≈ 0.785 of *its* bounding
  // box. Those numbers sit close enough together that the rect threshold
  // has to stay above ~0.785, or genuine circles get misread as rectangles.
  if (fillRatio > 0.86) {
    return base("rect", boxCorners(box), true);
  }
  if (fillRatio > 0.55) {
    return base("ellipse", boxEllipse(box), true);
  }

  // Didn't confidently match a primitive — keep the hand-drawn shape, just
  // denoised, and make sure it's visibly closed.
  const smoothed = simplifyPath(rawPoints, 1.5);
  return base("pen", [...smoothed, smoothed[0]], false);
}
