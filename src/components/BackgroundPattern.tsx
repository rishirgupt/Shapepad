import type { BackgroundPattern as BackgroundPatternConfig } from "../types";

interface BackgroundPatternProps {
  pattern: BackgroundPatternConfig;
}

/**
 * Ruled-paper / graph-paper / dot-grid guide lines.
 *
 * Rendered as a tiled SVG `<pattern>` sitting inside the clipped shape
 * container, above the background fill but below every content layer — so
 * it reads as paper texture behind the notepad, drawings and images rather
 * than a UI element, and the shape's `clip-path` (holes included) trims it
 * for free since it lives in the same clipped box as everything else.
 */
export default function BackgroundPattern({ pattern }: BackgroundPatternProps) {
  if (pattern.type === "none") return null;

  const { spacing, color, opacity, lineWidth } = pattern;
  const patternId = "sp-bg-pattern";

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width={spacing}
          height={spacing}
          patternUnits="userSpaceOnUse"
        >
          {pattern.type === "lines" && (
            <line
              x1={0}
              y1={spacing}
              x2={spacing}
              y2={spacing}
              stroke={color}
              strokeWidth={lineWidth}
            />
          )}
          {pattern.type === "grid" && (
            <>
              <line
                x1={0}
                y1={spacing}
                x2={spacing}
                y2={spacing}
                stroke={color}
                strokeWidth={lineWidth}
              />
              <line
                x1={spacing}
                y1={0}
                x2={spacing}
                y2={spacing}
                stroke={color}
                strokeWidth={lineWidth}
              />
            </>
          )}
          {pattern.type === "dots" && (
            <circle
              cx={spacing / 2}
              cy={spacing / 2}
              r={Math.max(0.5, lineWidth)}
              fill={color}
            />
          )}
        </pattern>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill={`url(#${patternId})`}
        opacity={opacity}
      />
    </svg>
  );
}
