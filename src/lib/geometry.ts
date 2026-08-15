/**
 * Shape geometry.
 *
 * Every pad shape is reduced to one of three primitives. Rendering uses CSS
 * `clip-path`, but hit-testing (click-through) and text layout need real
 * geometry, so each primitive can also be sampled into a pixel polygon.
 *
 * All authored coordinates are normalised to the unit square; pixel
 * conversion happens once we know the live container size.
 */

import type { CustomShape, Point } from "../types";

export type ShapeGeometry =
  | { kind: "roundedRect"; radius: number }
  | { kind: "circle" }
  | { kind: "polygon"; points: Point[]; holes?: Point[][] };

export type BuiltinShapeId =
  | "square"
  | "circle"
  | "triangle"
  | "star"
  | "polygon";

/** Regular n-gon inscribed in the unit square, first vertex pointing up. */
function regularPolygon(sides: number, radius = 0.5): Point[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
    return {
      x: 0.5 + radius * Math.cos(angle),
      y: 0.5 + radius * Math.sin(angle),
    };
  });
}

/** Alternating outer/inner vertices, first point up. */
function starPolygon(points: number, outer = 0.5, inner = 0.21): Point[] {
  return Array.from({ length: points * 2 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const radius = index % 2 === 0 ? outer : inner;
    return {
      x: 0.5 + radius * Math.cos(angle),
      y: 0.5 + radius * Math.sin(angle),
    };
  });
}

export const BUILTIN_GEOMETRY: Record<BuiltinShapeId, ShapeGeometry> = {
  square: { kind: "roundedRect", radius: 18 },
  circle: { kind: "circle" },
  triangle: {
    kind: "polygon",
    points: [
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  },
  star: { kind: "polygon", points: starPolygon(5) },
  polygon: { kind: "polygon", points: regularPolygon(6) },
};

/** `custom:<id>` selects a user-authored shape; anything else is builtin. */
export const CUSTOM_PREFIX = "custom:";

export function resolveGeometry(
  shapeRef: string,
  customShapes: CustomShape[],
): ShapeGeometry {
  if (shapeRef.startsWith(CUSTOM_PREFIX)) {
    const id = shapeRef.slice(CUSTOM_PREFIX.length);
    const found = customShapes.find((shape) => shape.id === id);
    if (found && found.points.length >= 3) {
      return {
        kind: "polygon",
        points: found.points,
        holes: found.holes && found.holes.length > 0 ? found.holes : undefined,
      };
    }
    return BUILTIN_GEOMETRY.square;
  }
  return BUILTIN_GEOMETRY[shapeRef as BuiltinShapeId] ?? BUILTIN_GEOMETRY.square;
}

function toPixels(points: Point[], width: number, height: number): Point[] {
  return points.map((p) => ({ x: p.x * width, y: p.y * height }));
}

function contourToPathData(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const segments = rest.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${segments.join(" ")} Z`;
}

/**
 * CSS `clip-path` for the live container size.
 *
 * The circle is expressed in **pixels** rather than `circle(50%)`: the
 * percentage form resolves against sqrt(w² + h²)/√2, so on any non-square
 * window the radius exceeds half the short side and the circle gets sliced
 * off by the window edges. A pixel radius of `min(w, h) / 2` stays a true
 * inscribed circle at every size.
 *
 * A polygon with holes can't be expressed as `clip-path: polygon()` at all —
 * that function only ever fills its single contour. `clip-path: path()`
 * accepts a full SVG path string with an `evenodd` fill rule instead, which
 * *does* support holes (each hole is just another closed subpath); unlike
 * `polygon()` it only accepts raw numbers, not percentages, so holed shapes
 * are emitted in pixels like the circle.
 */
export function clipPathFor(
  geometry: ShapeGeometry,
  width: number,
  height: number,
): string {
  switch (geometry.kind) {
    case "roundedRect":
      return `inset(0px round ${geometry.radius}px)`;
    case "circle": {
      const radius = Math.max(0, Math.min(width, height) / 2);
      return `circle(${radius}px at 50% 50%)`;
    }
    case "polygon": {
      if (!geometry.holes || geometry.holes.length === 0) {
        return `polygon(${geometry.points
          .map((p) => `${(p.x * 100).toFixed(3)}% ${(p.y * 100).toFixed(3)}%`)
          .join(", ")})`;
      }
      const contours = [
        toPixels(geometry.points, width, height),
        ...geometry.holes.map((hole) => toPixels(hole, width, height)),
      ].map(contourToPathData);
      return `path(evenodd, "${contours.join(" ")}")`;
    }
  }
}

/** Sampled outer outline in container pixels. Drives hit-tests and text layout. */
export function outlinePolygon(
  geometry: ShapeGeometry,
  width: number,
  height: number,
  circleSamples = 96,
): Point[] {
  switch (geometry.kind) {
    case "roundedRect":
      return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ];
    case "circle": {
      const radius = Math.min(width, height) / 2;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: circleSamples }, (_, index) => {
        const angle = (index * 2 * Math.PI) / circleSamples;
        return {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        };
      });
    }
    case "polygon":
      return toPixels(geometry.points, width, height);
  }
}

/**
 * Sampled holes in container pixels, or an empty array if the shape has
 * none. Only polygons (custom shapes) can have holes.
 */
export function outlineHoles(
  geometry: ShapeGeometry,
  width: number,
  height: number,
): Point[][] {
  if (geometry.kind !== "polygon" || !geometry.holes) return [];
  return geometry.holes.map((hole) => toPixels(hole, width, height));
}

/** Even-odd ray cast. */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Hole-aware hit test: inside the outer contour and outside every hole.
 * Used for click-through, where a hole should behave like the outside —
 * the desktop shows through it visually, so clicks should pass through too.
 */
export function pointInShape(
  point: Point,
  outer: Point[],
  holes: Point[][],
): boolean {
  if (!pointInPolygon(point, outer)) return false;
  return !holes.some((hole) => pointInPolygon(point, hole));
}

/**
 * Horizontal slices of the polygon at height `y`, as sorted `[x0, x1]` pairs.
 * A concave shape (star) yields several disjoint runs at the same height.
 */
export function spansAtY(polygon: Point[], y: number): Array<[number, number]> {
  const crossings: number[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      crossings.push(a.x + t * (b.x - a.x));
    }
  }
  crossings.sort((p, q) => p - q);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    spans.push([crossings[i], crossings[i + 1]]);
  }
  return spans;
}

/** The widest run at `y`, or null if the shape is absent at that height. */
export function widestSpanAtY(
  polygon: Point[],
  y: number,
): [number, number] | null {
  const spans = spansAtY(polygon, y);
  if (spans.length === 0) return null;
  return spans.reduce((best, span) =>
    span[1] - span[0] > best[1] - best[0] ? span : best,
  );
}

/**
 * The narrowest run across a vertical band — what a line of text spanning
 * `[top, bottom]` must fit inside.
 */
export function narrowestSpanInBand(
  polygon: Point[],
  top: number,
  bottom: number,
  samples = 5,
): [number, number] | null {
  let left = -Infinity;
  let right = Infinity;
  let found = false;

  for (let i = 0; i <= samples; i += 1) {
    const y = top + ((bottom - top) * i) / samples;
    const span = widestSpanAtY(polygon, y);
    if (!span) continue;
    found = true;
    left = Math.max(left, span[0]);
    right = Math.min(right, span[1]);
  }

  if (!found || right <= left) return null;
  return [left, right];
}

/**
 * The vertical range where the shape is wide enough to hold text.
 *
 * A triangle's apex and a star's points are geometrically inside the shape
 * but useless for typing, so the editor is positioned to start below them.
 *
 * Holes are not accounted for here — the notepad still reflows only to the
 * outer contour and may run across a hole. Making it flow *around* a hole
 * too is a further step this doesn't attempt.
 */
export function usableBand(
  polygon: Point[],
  height: number,
  minWidth: number,
  pad: number,
): { top: number; bottom: number } {
  let top: number | null = null;
  let bottom: number | null = null;

  for (let y = 0; y <= height; y += 2) {
    const span = widestSpanAtY(polygon, y);
    const usable = span ? span[1] - span[0] - pad * 2 : 0;
    if (usable >= minWidth) {
      if (top === null) top = y;
      bottom = y;
    }
  }

  if (top === null || bottom === null) return { top: 0, bottom: height };
  return { top, bottom };
}

/** Axis-aligned bounds of a polygon. */
export function polygonBounds(polygon: Point[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
