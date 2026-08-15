/**
 * Shape-aware text layout for CodeMirror.
 *
 * CodeMirror lays every line out in a rectangle, so inside a circle or a
 * triangle the text runs straight through the outline and gets sliced off by
 * the container's `clip-path`. CSS `shape-outside` cannot help here: it needs
 * in-flow floats, and `.cm-scroller` is a flex container, so floats never
 * reach the line boxes.
 *
 * Instead we measure where the shape actually is at each line's height and
 * push that line in with margins. The result reflows to the outline — short
 * lines at the top of a circle, full-width lines through the middle.
 */

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { narrowestSpanInBand } from "../lib/geometry";
import type { Point } from "../types";

export interface ShapeInsetConfig {
  /** Shape outline translated into editor-content coordinates. */
  polygon: Point[];
  /** Width of the editor content box, in px. */
  width: number;
  /** Breathing room between the glyphs and the outline. */
  pad: number;
}

export const setShapeInset = StateEffect.define<ShapeInsetConfig | null>();

const shapeInsetField = StateField.define<ShapeInsetConfig | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShapeInset)) return effect.value;
    }
    return value;
  },
});

/**
 * Margins are snapped to this grid. Without quantisation a one-pixel margin
 * change can re-wrap a line, which changes its height, which changes the
 * margin — a visible shimmer. Snapping absorbs those micro-oscillations.
 */
const MARGIN_STEP = 8;

/**
 * How much of a wrapped line's own height is allowed to feed back into its
 * margin. In the lower half of a shape the outline narrows as you descend, so
 * letting an arbitrarily tall block drive its own inset is a runaway: wrap →
 * taller → narrower → wrap again. Capping the sampled band breaks the loop.
 */
const MAX_FEEDBACK_LINES = 4;

function snap(value: number): number {
  return Math.max(0, Math.round(value / MARGIN_STEP) * MARGIN_STEP);
}

function buildDecorations(view: EditorView): DecorationSet {
  const config = view.state.field(shapeInsetField, false);
  if (!config || config.polygon.length < 3 || config.width <= 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const lineHeight = view.defaultLineHeight || 18;

  for (const block of view.viewportLineBlocks) {
    const top = block.top;
    const bottom = Math.min(
      block.bottom,
      top + lineHeight * MAX_FEEDBACK_LINES,
    );

    const span = narrowestSpanInBand(config.polygon, top, bottom);

    let marginLeft = 0;
    let marginRight = 0;

    if (span) {
      marginLeft = snap(span[0] + config.pad);
      marginRight = snap(config.width - span[1] + config.pad);
    }

    // Never squeeze a line below a usable measure — better to let one line
    // touch the outline than to collapse into a one-character column.
    const minimumWidth = 48;
    if (config.width - marginLeft - marginRight < minimumWidth) {
      const overflow =
        minimumWidth - (config.width - marginLeft - marginRight);
      const relief = Math.ceil(overflow / 2 / MARGIN_STEP) * MARGIN_STEP;
      marginLeft = Math.max(0, marginLeft - relief);
      marginRight = Math.max(0, marginRight - relief);
    }

    builder.add(
      block.from,
      block.from,
      Decoration.line({
        attributes: {
          style: `margin-left:${marginLeft}px;margin-right:${marginRight}px`,
        },
      }),
    );
  }

  return builder.finish();
}

const shapeInsetPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const shapeChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setShapeInset)),
      );
      if (
        shapeChanged ||
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function shapeInsetExtension() {
  return [shapeInsetField, shapeInsetPlugin];
}
