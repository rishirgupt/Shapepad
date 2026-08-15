import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle as CircleIcon,
  PenTool,
  Spline,
  Square as SquareIcon,
  Trash2,
  Undo2,
} from "lucide-react";
import { boundsOf, simplifyPath } from "../lib/transform";
import { CAPTURE_MIN_DIMENSION } from "../lib/captureWindow";
import type { Point } from "../types";

export type CaptureTool = "pen" | "polygon" | "rect" | "ellipse";
type CapturePhase = "outer" | "holes";

export interface CaptureResult {
  /** Outer outline in overlay pixels, already trimmed to its own bounding box. */
  points: Point[];
  /** Hole outlines, trimmed the same way (same origin as `points`). */
  holes: Point[][];
  /** Where that outline sat on the capture surface, in CSS px. */
  bounds: { x: number; y: number; width: number; height: number };
  name: string;
}

interface ShapeCaptureProps {
  initialName?: string;
  /** Existing outline to seed the surface with, normalised 0–1 plus its
   *  authored pixel size. Used when redrawing a saved shape. */
  initialShape?: {
    points: Point[];
    holes?: Point[][];
    width: number;
    height: number;
  } | null;
  onCancel: () => void;
  onConfirm: (result: CaptureResult) => void;
}

const TOOLS: Array<{ id: CaptureTool; label: string; icon: typeof PenTool }> = [
  { id: "pen", label: "Pen — draw freehand", icon: PenTool },
  { id: "polygon", label: "Polygon — click corners", icon: Spline },
  { id: "rect", label: "Rectangle — drag", icon: SquareIcon },
  { id: "ellipse", label: "Ellipse — drag", icon: CircleIcon },
];

const ELLIPSE_SAMPLES = 56;
/** Pen strokes are sampled densely; this thins them to a usable outline. */
const PEN_TOLERANCE = 2.4;
/** Click within this distance of the first vertex to close a polygon. */
const CLOSE_RADIUS = 14;
/** Below this the resulting pad has no room for its own toolbar. */
const MIN_DIMENSION = CAPTURE_MIN_DIMENSION;

function toPath(points: Point[]): string {
  if (points.length < 2) return "";
  return `${points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")} Z`;
}

function rectPoints(a: Point, b: Point): Point[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

function ellipsePoints(a: Point, b: Point): Point[] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  return Array.from({ length: ELLIPSE_SAMPLES }, (_, index) => {
    const angle = (index * 2 * Math.PI) / ELLIPSE_SAMPLES;
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  });
}

/**
 * Full-surface shape capture.
 *
 * The window is expanded to fill the monitor by the caller, so this overlay
 * *is* the screen: whatever outline you draw here is the literal size and
 * position the pad will take. The scrim is punched out by the live outline
 * via an SVG mask, so you are always looking at the actual resulting shape
 * rather than a scaled-down preview in a dialog.
 *
 * Drawing happens in two phases sharing the same four tools: `outer` draws
 * the pad's silhouette, and once that has three or more points, `holes` lets
 * you draw additional closed shapes that get subtracted from it (an evenodd
 * `clip-path: path()`, so content and the desktop behind the pad show
 * through). The mask preview composites outer + every hole live, so what
 * you see during holes phase is exactly the final result.
 */
export default function ShapeCapture({
  initialName = "My shape",
  initialShape = null,
  onCancel,
  onConfirm,
}: ShapeCaptureProps) {
  const [tool, setTool] = useState<CaptureTool>("pen");
  const [name, setName] = useState(initialName);
  const [phase, setPhase] = useState<CapturePhase>("outer");

  /** Committed outer outline. Empty until a gesture completes. */
  const [points, setPoints] = useState<Point[]>([]);
  /** Committed holes, each a closed loop in the same coordinate space. */
  const [holes, setHoles] = useState<Point[][]>([]);
  /** Polygon vertices placed so far (polygon tool only, either phase). */
  const [vertices, setVertices] = useState<Point[]>([]);
  /** In-progress freehand samples or drag rectangle (either phase). */
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const surfaceRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef(false);

  const toLocal = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
    };
  }, []);

  const resetGesture = useCallback(() => {
    setVertices([]);
    setDraft(null);
  }, []);

  const resetAll = useCallback(() => {
    setPoints([]);
    setHoles([]);
    setPhase("outer");
    resetGesture();
  }, [resetGesture]);

  /* Switching tools abandons anything half-drawn, but not committed work. */
  useEffect(() => {
    resetGesture();
  }, [tool, resetGesture]);

  /* Seed the surface with an existing outline, centred at its authored size.
     Declared after the reset effect so it wins on the initial mount. */
  useEffect(() => {
    if (!initialShape) return;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetX = (rect.width - initialShape.width) / 2;
    const offsetY = (rect.height - initialShape.height) / 2;
    const place = (p: Point) => ({
      x: Math.round(offsetX + p.x * initialShape.width),
      y: Math.round(offsetY + p.y * initialShape.height),
    });
    setPoints(initialShape.points.map(place));
    setHoles((initialShape.holes ?? []).map((hole) => hole.map(place)));
  }, [initialShape]);

  /** Routes a just-finished shape to the outer outline or the holes list. */
  const commitShape = useCallback(
    (finished: Point[]) => {
      if (phase === "outer") {
        setPoints(finished);
      } else {
        setHoles((current) => [...current, finished]);
      }
      resetGesture();
    },
    [phase, resetGesture],
  );

  /* ------------------------- pointer handling ------------------------- */

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const point = toLocal(event);

      if (tool === "polygon") {
        if (vertices.length >= 3) {
          const first = vertices[0];
          if (Math.hypot(point.x - first.x, point.y - first.y) <= CLOSE_RADIUS) {
            commitShape(vertices);
            return;
          }
        }
        setVertices((current) => [...current, point]);
        return;
      }

      drawingRef.current = true;
      setDraft([point]);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Capture is an enhancement; the gesture still tracks without it. */
      }
    },
    [commitShape, toLocal, tool, vertices],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const point = toLocal(event);
      if (tool === "polygon") {
        setHover(point);
        return;
      }
      if (!drawingRef.current) return;

      setDraft((current) => {
        if (!current) return current;
        if (tool === "pen") {
          const previous = current[current.length - 1];
          if (Math.hypot(point.x - previous.x, point.y - previous.y) < 2) {
            return current;
          }
          return [...current, point];
        }
        return [current[0], point];
      });
    },
    [toLocal, tool],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current || !draft) return;
      drawingRef.current = false;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* Already released. */
      }

      if (tool === "pen") {
        const simplified = simplifyPath(draft, PEN_TOLERANCE);
        if (simplified.length >= 3) commitShape(simplified);
        else setDraft(null);
      } else if (draft.length === 2) {
        const [a, b] = draft;
        commitShape(tool === "rect" ? rectPoints(a, b) : ellipsePoints(a, b));
      } else {
        setDraft(null);
      }
    },
    [commitShape, draft, tool],
  );

  /* --------------------------- derived view --------------------------- */

  /** In-progress gesture preview, shared by outer and hole drawing. */
  const activeDraftPreview = useMemo(() => {
    if (tool === "polygon") {
      const preview = hover && vertices.length > 0 ? [...vertices, hover] : vertices;
      return preview.length >= 3 ? preview : [];
    }
    if (draft) {
      if (tool === "pen") return draft.length >= 3 ? draft : [];
      if (draft.length === 2) {
        const [a, b] = draft;
        return tool === "rect" ? rectPoints(a, b) : ellipsePoints(a, b);
      }
    }
    return [];
  }, [draft, hover, tool, vertices]);

  const outerPreview = phase === "outer" && activeDraftPreview.length >= 3
    ? activeDraftPreview
    : points;
  const activeHolePreview = phase === "holes" ? activeDraftPreview : [];

  /** Every subpath the mask needs to punch: outer, committed holes, and the
   *  hole currently being drawn (if any) — evenodd makes overlaps cancel out
   *  correctly even mid-gesture. */
  const maskPath = useMemo(() => {
    const contours = [outerPreview, ...holes];
    if (activeHolePreview.length >= 3) contours.push(activeHolePreview);
    return contours.map(toPath).join(" ");
  }, [activeHolePreview, holes, outerPreview]);

  const outerStrokePath = useMemo(() => toPath(outerPreview), [outerPreview]);
  const activeHoleStrokePath = useMemo(
    () => toPath(activeHolePreview),
    [activeHolePreview],
  );

  const bounds = useMemo(() => {
    if (points.length < 3) return null;
    const b = boundsOf(points);
    return {
      x: b.minX,
      y: b.minY,
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
    };
  }, [points]);

  const usable =
    !!bounds &&
    bounds.width >= MIN_DIMENSION &&
    bounds.height >= MIN_DIMENSION &&
    name.trim().length > 0;

  const confirm = useCallback(() => {
    if (!bounds || !usable) return;
    const relative = (p: Point) => ({ x: p.x - bounds.x, y: p.y - bounds.y });
    onConfirm({
      // Trim to the outline's own box so the pad becomes exactly the drawn
      // shape; holes are trimmed against that same origin so they stay
      // aligned to the outer outline.
      points: points.map(relative),
      holes: holes.map((hole) => hole.map(relative)),
      bounds,
      name: name.trim(),
    });
  }, [bounds, holes, name, onConfirm, points, usable]);

  const canStartHole = phase === "outer" && points.length >= 3;
  const removeLastHole = useCallback(() => {
    setHoles((current) => current.slice(0, -1));
  }, []);

  /* ---------------------------- shortcuts ---------------------------- */
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        if (tool === "polygon" && vertices.length >= 3) {
          event.preventDefault();
          commitShape(vertices);
        } else if (usable) {
          event.preventDefault();
          confirm();
        }
      } else if (
        (event.key === "Backspace" || event.key === "z") &&
        tool === "polygon" &&
        vertices.length > 0 &&
        !(event.target as HTMLElement)?.closest("input")
      ) {
        event.preventDefault();
        setVertices((current) => current.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [commitShape, confirm, onCancel, tool, usable, vertices]);

  const hint =
    tool === "polygon"
      ? "Click to place corners · click the first point or press Enter to close · Backspace undoes"
      : tool === "pen"
        ? "Drag to draw the outline — it closes automatically"
        : "Drag to size the shape";

  return (
    <div data-sp-ui className="fixed inset-0 z-[100]">
      <svg
        ref={surfaceRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none", cursor: "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          <mask id="sp-capture-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {maskPath && (
              <path d={maskPath} fill="black" fillRule="evenodd" />
            )}
          </mask>
        </defs>

        {/* Everything outside the outer outline, plus every hole, is
            dimmed — so what shows through is exactly the pad you get. */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(9,9,11,0.72)"
          mask="url(#sp-capture-mask)"
        />

        {outerStrokePath && (
          <path
            d={outerStrokePath}
            fill="rgba(125,211,252,0.10)"
            stroke="#7dd3fc"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        )}

        {holes.map((hole, index) => (
          <path
            key={index}
            d={toPath(hole)}
            fill="rgba(9,9,11,0.55)"
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        ))}
        {activeHoleStrokePath && (
          <path
            d={activeHoleStrokePath}
            fill="rgba(9,9,11,0.4)"
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        )}

        {vertices.map((vertex, index) => (
          <circle
            key={index}
            cx={vertex.x}
            cy={vertex.y}
            r={index === 0 ? 6 : 4}
            fill={index === 0 ? "#fbbf24" : "#f4f4f5"}
            stroke="#18181b"
            strokeWidth="1.5"
          />
        ))}

        {bounds && (
          <g>
            <rect
              x={bounds.x}
              y={bounds.y}
              width={bounds.width}
              height={bounds.height}
              fill="none"
              stroke="rgba(125,211,252,0.35)"
              strokeDasharray="4 4"
            />
            <text
              x={bounds.x + bounds.width / 2}
              y={bounds.y - 10}
              textAnchor="middle"
              fill="#7dd3fc"
              fontSize="11"
              fontFamily="ui-monospace, monospace"
            >
              {Math.round(bounds.width)} × {Math.round(bounds.height)}
            </text>
          </g>
        )}
      </svg>

      {/* ------------------------------ chrome ------------------------------ */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/92 px-2 py-1.5 shadow-float backdrop-blur-xl">
          {TOOLS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                aria-pressed={tool === entry.id}
                onClick={() => setTool(entry.id)}
                className={[
                  "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                  tool === entry.id
                    ? "bg-white/90 text-neutral-900"
                    : "text-white/70 hover:bg-white/15 hover:text-white",
                ].join(" ")}
              >
                <Icon size={14} />
              </button>
            );
          })}

          <div className="mx-1 h-5 w-px bg-white/15" />

          <button
            type="button"
            title="Start over"
            aria-label="Start over"
            disabled={points.length === 0 && vertices.length === 0}
            onClick={resetAll}
            className="grid h-7 w-7 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-35"
          >
            <Undo2 size={14} />
          </button>

          <div className="mx-1 h-5 w-px bg-white/15" />

          {phase === "outer" ? (
            <button
              type="button"
              disabled={!canStartHole}
              onClick={() => setPhase("holes")}
              title="Draw a shape inside the outline to cut a hole through it"
              className="rounded-lg bg-amber-400/90 px-2 py-1 text-[11px] font-semibold text-neutral-900 transition-colors hover:bg-amber-300 disabled:bg-white/5 disabled:font-normal disabled:text-white/35"
            >
              Add hole
            </button>
          ) : (
            <>
              <span className="rounded-md bg-amber-400/20 px-2 py-1 text-[11px] font-medium text-amber-300">
                Drawing hole {holes.length + 1}
              </span>
              <button
                type="button"
                title="Remove last hole"
                aria-label="Remove last hole"
                disabled={holes.length === 0}
                onClick={removeLastHole}
                className="grid h-7 w-7 place-items-center rounded-lg text-white/70 transition-colors hover:bg-rose-500/25 hover:text-rose-200 disabled:opacity-35"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}

          <div className="mx-1 h-5 w-px bg-white/15" />

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Shape name"
            aria-label="Shape name"
            className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30"
          />

          <button
            type="button"
            onClick={onCancel}
            className="ml-1 rounded-lg px-2 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!usable}
            onClick={confirm}
            className="flex items-center gap-1 rounded-lg bg-sky-400 px-2.5 py-1 text-[11px] font-semibold text-neutral-900 transition-colors hover:bg-sky-300 disabled:opacity-40"
          >
            <Check size={12} />
            Use shape
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
        <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/70 backdrop-blur-sm">
          {phase === "holes"
            ? `${hint} — this shape will be cut out of the pad`
            : hint}
        </span>
      </div>

      {phase === "outer" &&
        tool !== "polygon" &&
        points.length === 0 &&
        !draft && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-2 rounded-xl bg-black/55 px-4 py-2 text-sm text-white/60 backdrop-blur-sm">
              <PenTool size={16} />
              Draw the shape you want, at the size you want it
            </span>
          </div>
        )}
    </div>
  );
}
