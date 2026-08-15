import { useCallback, useRef, useState } from "react";
import { correctStroke } from "../lib/shapeFit";
import { createDrawObject, type DrawObject, type DrawTool, type Point } from "../types";

interface DrawLayerProps {
  /** Committed objects. Owned by the parent so save/load round-trips work. */
  objects: DrawObject[];
  /** Called once per completed gesture (on pointer up / cancel). */
  onObjectComplete: (object: DrawObject) => void;
  tool: DrawTool;
  color: string;
  brushSize: number;
  fill: string | null;
  fillOpacity: number;
  opacity: number;
  /** Whiteboard-style: straighten pen strokes into lines/rects/ellipses on completion. */
  correctDrawings: boolean;
  /** When false the layer is inert and clicks fall through to the editor. */
  active: boolean;
}

/**
 * Converts a point list into a smooth SVG path using quadratic segments
 * through the midpoints of consecutive samples. This removes the visible
 * corners a naive polyline produces without needing a spline library.
 */
export function strokeToPath(points: Point[], closed = false): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
  }
  if (points.length === 2) {
    const d = `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    return closed ? `${d} Z` : d;
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return closed ? `${d} Z` : d;
}

function isNearlyClosed(points: Point[]): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) < 6;
}

function polygonPointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Two drag corners → the four corners of the axis-aligned box between them. */
function dragRectCorners(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

/** Two drag corners → a ring of points describing the ellipse inscribed between them. */
function dragEllipseRing(a: Point, b: Point, samples = 48): Point[] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  return Array.from({ length: samples }, (_, i) => {
    const angle = (i / samples) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

/** Constrains a rect/ellipse drag to a square/circle, holding the start corner fixed. */
function squareUp(a: Point, b: Point): Point {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return {
    x: a.x + Math.sign(b.x - a.x || 1) * side,
    y: a.y + Math.sign(b.y - a.y || 1) * side,
  };
}

/** Snaps a line/arrow drag to the nearest 45° increment from the start point. */
function snapAngle(a: Point, b: Point): Point {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: a.x + Math.cos(snapped) * distance,
    y: a.y + Math.sin(snapped) * distance,
  };
}

/** Small filled triangle at `tip`, pointing away from `from`. */
function arrowheadPoints(from: Point, tip: Point, size: number): Point[] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = 0.45;
  const length = Math.max(8, size * 3);
  const left = angle + Math.PI - spread;
  const right = angle + Math.PI + spread;
  return [
    tip,
    { x: tip.x + Math.cos(left) * length, y: tip.y + Math.sin(left) * length },
    { x: tip.x + Math.cos(right) * length, y: tip.y + Math.sin(right) * length },
  ];
}

function ObjectShape({ object }: { object: DrawObject }) {
  const fillColor = object.fill ?? "none";
  const fillOpacity = object.fill ? object.fillOpacity : undefined;
  const commonProps = {
    stroke: object.color,
    strokeWidth: object.brushSize,
    opacity: object.opacity,
  };

  switch (object.tool) {
    case "pen": {
      const closed = isNearlyClosed(object.points);
      return (
        <path
          d={strokeToPath(object.points, closed)}
          fill={closed ? fillColor : "none"}
          fillOpacity={closed ? fillOpacity : undefined}
          fillRule="evenodd"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...commonProps}
        />
      );
    }
    case "line":
      return (
        <path
          d={strokeToPath(object.points)}
          fill="none"
          strokeLinecap="round"
          {...commonProps}
        />
      );
    case "arrow": {
      const [start, end] = object.points;
      if (!start || !end) return null;
      const head = arrowheadPoints(start, end, object.brushSize);
      return (
        <g opacity={object.opacity}>
          <path
            d={strokeToPath([start, end])}
            fill="none"
            stroke={object.color}
            strokeWidth={object.brushSize}
            strokeLinecap="round"
          />
          <polygon
            points={polygonPointsAttr(head)}
            fill={object.color}
            stroke={object.color}
            strokeWidth={object.brushSize}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    case "rect":
    case "ellipse":
      return (
        <polygon
          points={polygonPointsAttr(object.points)}
          fill={fillColor}
          fillOpacity={fillOpacity}
          strokeLinejoin="round"
          {...commonProps}
        />
      );
    default:
      return null;
  }
}

/** Drops samples closer than `minDistance` px so pen paths stay compact. */
const MIN_SAMPLE_DISTANCE = 1.6;

/**
 * SVG ink layer: freehand pen plus line/rect/ellipse/arrow shape tools, all
 * sharing one gesture pipeline and one `DrawObject` data shape.
 *
 * Coordinates are stored in the SVG's own pixel space (element-relative),
 * which keeps drawings stable while the window is dragged. Resizing the
 * window does not rescale existing objects — that is deliberate, it keeps a
 * sketch pinned to the content it annotates.
 */
export default function DrawLayer({
  objects,
  onObjectComplete,
  tool,
  color,
  brushSize,
  fill,
  fillOpacity,
  opacity,
  correctDrawings,
  active,
}: DrawLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const draftRef = useRef<Point[] | null>(null);

  const toLocalPoint = useCallback((event: React.PointerEvent): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round((event.clientX - rect.left) * 100) / 100,
      y: Math.round((event.clientY - rect.top) * 100) / 100,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!active || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is an enhancement; the gesture still tracks without it. */
      }
      const start = [toLocalPoint(event)];
      draftRef.current = start;
      setDraft(start);
    },
    [active, toLocalPoint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!active || !draftRef.current) return;
      event.preventDefault();
      const point = toLocalPoint(event);
      const points = draftRef.current;
      const start = points[0];

      if (tool === "pen") {
        const previous = points[points.length - 1];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        if (dx * dx + dy * dy < MIN_SAMPLE_DISTANCE * MIN_SAMPLE_DISTANCE) return;
        const next = [...points, point];
        draftRef.current = next;
        setDraft(next);
        return;
      }

      const end =
        event.shiftKey && (tool === "rect" || tool === "ellipse")
          ? squareUp(start, point)
          : event.shiftKey && (tool === "line" || tool === "arrow")
            ? snapAngle(start, point)
            : point;
      const next = [start, end];
      draftRef.current = next;
      setDraft(next);
    },
    [active, toLocalPoint, tool],
  );

  const finishObject = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!draftRef.current) return;
      const points = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* Already released. */
      }
      if (points.length === 0) return;

      const style = { color, brushSize, fill, fillOpacity, opacity };

      if (tool === "pen") {
        if (correctDrawings) {
          onObjectComplete(correctStroke(points, style));
        } else {
          onObjectComplete(createDrawObject("pen", points, style));
        }
        return;
      }

      if (points.length < 2) return;
      const [start, end] = points;
      const shapePoints =
        tool === "rect"
          ? dragRectCorners(start, end)
          : tool === "ellipse"
            ? dragEllipseRing(start, end)
            : [start, end];
      // A degenerate drag (click without moving) produces no visible shape.
      if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return;
      onObjectComplete(createDrawObject(tool, shapePoints, style));
    },
    [brushSize, color, correctDrawings, fill, fillOpacity, onObjectComplete, opacity, tool],
  );

  const draftPreview: DrawObject | null = (() => {
    if (!draft || draft.length === 0) return null;
    const style = { color, brushSize, fill, fillOpacity, opacity };
    if (tool === "pen") return createDrawObject("pen", draft, style);
    if (draft.length < 2) return null;
    const [start, end] = draft;
    if (tool === "rect") return createDrawObject("rect", dragRectCorners(start, end), style);
    if (tool === "ellipse")
      return createDrawObject("ellipse", dragEllipseRing(start, end), style);
    return createDrawObject(tool, [start, end], style);
  })();

  return (
    <svg
      ref={svgRef}
      className={[
        "absolute inset-0 h-full w-full",
        active ? "pointer-events-auto cursor-crosshair" : "pointer-events-none",
      ].join(" ")}
      // Stop the browser from turning a drag gesture into a scroll/pan.
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishObject}
      onPointerCancel={finishObject}
    >
      {objects.map((object) => (
        <ObjectShape key={object.id} object={object} />
      ))}
      {draftPreview && <ObjectShape object={draftPreview} />}
    </svg>
  );
}
