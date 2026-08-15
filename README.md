# ShapePad

A frameless, transparent, always-on-top desktop scratchpad that morphs into
geometric shapes — including shapes with holes cut into them. Markdown text
**reflows to the outline**, clicks outside the shape **pass through to the
apps behind**, and you can sketch (with optional Whiteboard-style ink
correction), paste images, run multiple pads as **tabs or separate windows**,
and author your own shapes.

Built with **Tauri v2 + React + Vite + TypeScript + Tailwind CSS**.

---

## Download

Grab the latest installer from the [Releases page](../../releases) — no
prior setup needed, see [PREREQUISITES.md](PREREQUISITES.md) for what it
requires (short version: 64-bit Windows 10/11, nothing else).

The rest of this file is for building from source.

---

## Setup from scratch

```bash
npx create-tauri-app@latest shapepad --template react-ts --manager npm --identifier com.shapepad.app --yes
```

```bash
cd shapepad && npm install
```

Frontend dependencies:

```bash
npm install @tauri-apps/plugin-fs @tauri-apps/plugin-dialog @uiw/react-codemirror @codemirror/lang-markdown @codemirror/language-data @codemirror/view @codemirror/state react-colorful lucide-react
```

Tailwind:

```bash
npm install -D tailwindcss@3 postcss autoprefixer
```

Rust plugin crates:

```bash
cd src-tauri && cargo add tauri-plugin-fs tauri-plugin-dialog && cd ..
```

Run / build:

```bash
npm run tauri dev
```

```bash
npm run tauri build
```

---

## How the hard parts work

### Click-through outside the shape

The window rect is a rectangle; the shape is not. Everything outside the
outline should belong to whatever is behind the pad.

`setIgnoreCursorEvents(true)` does that — but it creates a trap: once the
webview stops receiving mouse events it can never notice the cursor coming
*back*. So `useClickThrough` does not listen for mouse events at all. It polls
the OS cursor position (`cursorPosition()`), maps it into window space using
the cached window origin and scale factor, and hit-tests it against the real
shape polygon. Window origin/scale are refreshed from `onMoved`/`onResized`, so
steady state is one IPC call per 60 ms tick.

Controls that deliberately live *outside* the shape — the toolbar, its panels,
the image bar, all eight resize grips — are tagged `data-sp-ui` and treated as
interactive by the same hit-test. Without that tag they would go dead the
moment they extended past the outline.

Toggle it from the rail (the cursor icon) if you want the window solid again.

### The circle was being cut off

`circle(50%)` does not mean "half the width". The percentage resolves against
`sqrt(w² + h²) / √2`, so on any non-square window the radius exceeds half the
short side and the circle gets sliced by the window edges. At 920×440 that is a
361px radius where the true inscribed circle is 220px — a 141px overflow.

`clipPathFor` emits a **pixel** radius of `min(w, h) / 2` instead, recomputed
from a live `ResizeObserver`, so the circle stays a true inscribed circle at
every size.

### Text that fits the shape

CodeMirror lays every line out in a rectangle, so inside a circle the text ran
straight through the outline and got clipped. CSS `shape-outside` cannot fix
this — it needs in-flow floats, and `.cm-scroller` is a flex container, so
floats never reach the line boxes.

`editor/shapeInset.ts` is a CodeMirror `ViewPlugin` that measures where the
shape actually is at each line's height and applies matching left/right
margins. In a circle the margins step down as the outline widens.

Two details keep it stable:

- **Margins snap to an 8px grid.** A one-pixel change can re-wrap a line, which
  changes its height, which changes the margin — a visible shimmer.
- **A line's own height only feeds back four lines deep.** In the lower half of
  a shape the outline narrows as you descend, so an uncapped block is a runaway:
  wrap → taller → narrower → wrap again.

The editor is also positioned over the shape's *usable band* — the vertical
range wide enough to hold text — so a triangle's apex and a star's points are
skipped instead of holding one-character lines.

---

## Features

| Area | What you get |
| --- | --- |
| Tabs & windows | Chrome-like tab strip (shape/colour swatch per tab, drag to reorder), each tab a fully independent pad; **New Window** and **move a tab to its own window** |
| Shapes | Square, Circle, Triangle, Star, Hexagon + **full-screen shape capture** (pen / polygon / rect / ellipse) with **holes** |
| Backgrounds | Colour, opacity, and ruled/grid/dot **guide-line patterns** (spacing, colour, opacity, width) |
| Notepad | Markdown/CodeMirror, shape-aware reflow, document-wide font, size, colour, **emoji picker** |
| Text boxes | Free-floating text anywhere; move, resize, rotate; **per-box** font, size, colour, bold, italic, align, opacity, emoji |
| Drawing | Pen, line, rectangle, ellipse, arrow — stroke colour/width, fill colour/opacity, overall opacity, Shift-constrain; **Whiteboard-style ink correction** |
| Images | Paste, drop, or insert from file; move, resize, rotate, crop, flip, opacity, z-order |
| Window | Frameless, transparent, always-on-top, click-through (hole-aware), 8-way resize |
| Files | `.shapepad` JSON via native dialogs, Save vs Save As, **including the pad's size** |

### Tabs and windows

The tab strip sits at the top, outside the clipped shape — deliberately a
plain rectangle regardless of which tab is active, since trying to warp a tab
bar into a star or a holed shape would look worse than just staying out of
the way. Each tab instead carries a small clipped **swatch** of its own shape
and background colour, so you can tell tabs apart at a glance.

**Shape is per-tab; window size is per-window.** Switching tabs swaps the
active shape's `clip-path` immediately — that's just geometry recomputed
against whatever the window's current pixel size is. What does *not* happen
on tab switch is the OS window resizing itself; that would fight with normal
multi-tab use (imagine every tab click resizing your window). A tab's
`windowWidth`/`windowHeight` are only actually applied when that document is
*opened from a file*, restored via a moved-tab handoff, or freshly produced by
shape capture — all one-time, deliberate actions, never a side effect of
clicking a tab.

**New Window** (rail → window icon, `Ctrl+Shift+N`) opens a second,
independent ShapePad window with its own blank tab set. **Move to new
window** (the tab's hover-revealed external-link icon) hands an existing
tab's entire document to a freshly created window over a Tauri event — the
source window never touches the filesystem or serializes through a URL, so
there's no size limit from embedded images. Closing a window's last tab
closes the window itself, matching ordinary tabbed-app behaviour.

### Backgrounds: colour, opacity, and guide lines

Rail → **Palette** icon. Beyond fill colour/opacity, a background can carry
ruled, grid, or dot guide lines — each independently spaced, coloured, sized,
and made translucent. The pattern renders as a tiled SVG `<pattern>` inside
the clipped shape, above the fill but below every content layer, so it reads
as paper texture rather than a UI element and gets clipped (holes included)
for free.

### Drawing: real tools, not just a pen

Rail → **Draw** panel (highlighter icon). Five tools — pen, line, rectangle,
ellipse, arrow — sharing one data shape (`DrawObject`): every tool is
fundamentally "a list of points," rendered differently (an open smoothed
curve for pen/line, an arrowhead triangle computed for arrow, a closed
polygon for rect/ellipse). That uniformity is also why rect/ellipse support a
fill colour and opacity independent of stroke. Hold **Shift** while dragging
rect/ellipse to constrain to a square/circle, or line/arrow to snap to 45°
increments.

**Ink correction** ("Straighten & fit shapes" toggle in the Draw panel,
default on): a closed pen stroke gets classified as a rectangle, ellipse,
triangle, or left as smoothed ink, and an open stroke that's nearly straight
snaps to a clean line. It's a heuristic, not true recognition — see
`lib/shapeFit.ts` for exactly what it measures (closedness, coarse-corner
count, and how much of its own bounding box the stroke fills) and why: a
naive PCA-fitted bounding box turns out to be numerically unstable for
near-square rectangles (the two principal axes are too close together to
resolve reliably under hand jitter), so genuine corner detection — reusing
the same coarse simplification used for triangles — does the rectangle case
instead, and PCA is used only for fitting ellipses, where axis precision
barely matters.

### Emoji

Typing or pasting an emoji directly into the notepad or a text box already
works — every font in the app appends emoji-capable fallback fonts
(`Segoe UI Emoji`, `Noto Color Emoji`, `Segoe UI Symbol`) so they render as
colour glyphs regardless of which typeface is selected. On top of that, a
picker (Typography panel for the notepad, text-box toolbar for boxes) inserts
a curated set without leaving the app. The notepad insert lands exactly at
the cursor; a text box insert appends to the end, since a box is a plain
`<textarea>` with no cursor position exposed to the toolbar that triggers it.

### Text boxes vs the notepad

Two different things, deliberately:

- The **notepad** is one CodeMirror document that reflows to the shape. The
  rail's *Note typography* panel styles the whole document.
- **Text boxes** (Text mode, or `Ctrl+M` to it) are independent objects you
  place anywhere. Click empty space to create one, double-click to edit,
  `Esc` to stop editing. Each carries its own font, size, colour and weight —
  set from the bar at the bottom, which appears when a box is selected.

A box renders as static text until double-clicked, at which point a transparent
textarea takes over in place. Swapping rather than always rendering a textarea
keeps wrapping identical between the two states and avoids a permanently
focusable element sitting under every drag gesture.

### Custom shapes — drawn at real size

Rail → **Shapes** icon → *Draw a shape*.

The pad expands to fill the monitor and dims it, and the outline you draw
punches a hole through that dim via an SVG mask — so you are always looking at
the actual pad you are about to get, at the actual size, not a scaled preview
in a dialog. Confirming collapses the window onto the outline's bounding box.

Four tools: **pen** (freehand, closes automatically), **polygon** (click
corners; click the first point or press Enter to close, Backspace undoes),
**rectangle** and **ellipse** (drag). A live `W × H` readout tracks the result.
`Esc` cancels and restores the previous window rect.

Pen strokes run through Ramer–Douglas–Peucker before becoming a shape: a raw
stroke is hundreds of samples, which is slow to rasterise as a `clip-path` and
bloats the saved file. In practice ~40 samples reduce to ~26 vertices.

Editing a saved shape re-opens capture with that outline seeded at its authored
size, so you can see it before redrawing.

**Holes.** Once the outer outline has three or more points, an **Add hole**
button appears — draw another closed shape with any of the same four tools
and it's subtracted from the pad. Add as many as you like; the live preview
composites outer + every hole with an SVG evenodd mask, so what you see is
exactly the final result. A holed shape can't be expressed as
`clip-path: polygon()` (that function only ever fills its one contour) — it's
emitted as `clip-path: path(evenodd, "...")` instead, each hole its own
subpath. Holes behave like the outside area everywhere: the desktop shows
through them, and clicks over them pass through. One thing they *don't* do is
affect notepad reflow — text still wraps to the outer contour only and may
run across a hole.

### Images

`Ctrl+V` to paste, drag a file onto the window, or use the `+` button in the
rail. Select an image in Image mode to get corner/edge handles, a rotation
handle, and the bottom control bar.

Geometry is stored as an unrotated box plus a rotation about its centre.
Resizing counter-rotates the pointer delta into the image's own frame and pins
the opposite corner, so the anchor does not drift on a rotated image. Corner
handles preserve aspect ratio (hold **Alt** to distort, **Shift** snaps rotation
to 15°).

Crop shows the full source dimmed so you can pull the window back out to areas
the current crop excludes; applying it adjusts the height to keep the source
aspect ratio rather than stretching.

---

## Controls

| Action | How |
| --- | --- |
| Show toolbar | Hover the left window edge |
| Move window | Drag the shape's margin ring, or **Alt+drag anywhere** |
| Resize | Drag any window edge or corner |
| Save / Save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Open | `Ctrl+O` |
| New tab / Close tab | `Ctrl+T` / `Ctrl+W` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| New window | `Ctrl+Shift+N` |
| Cycle Note → Draw → Image → Text | `Ctrl+M` |
| Undo drawing | `Ctrl+Z` *(draw mode only)* |
| Constrain drag | `Shift` — square/circle for rect/ellipse, 45° snap for line/arrow, 15° for rotation |
| Free aspect ratio | `Alt` *(image/text resize)* |
| Create text box | Click empty space *(text mode)* |
| Edit / stop editing text | Double-click / `Esc` |
| Delete selected object | `Delete` *(image or text mode)* |
| Cancel crop or shape capture | `Esc` |

**Alt+drag** matters: for shapes whose interior is fully covered by the editor
there would otherwise be no grab area at all.

---

## The `.shapepad` format

`PadState` (`shape`, `backgroundColor`, `markerColor`, `markdownContent`,
`drawings`) is the stable core. Everything else is optional so older files still
load. Loading applies straight to React state — no reload.

**The pad's size is part of the document.** Strokes, images and text boxes are
all stored in container pixels, so reopening at a different size would scatter
them. `windowWidth`/`windowHeight` are written on save and the window is
resized to match *before* the content is applied, so a document always reopens
on the canvas it was composed against.

Custom shapes additionally record `authoredWidth`/`authoredHeight` — the pixel
size they were actually drawn at — and an optional `holes: Point[][]`.

Each open **tab** is one in-memory `PadDocument` — a superset of this file
format plus a few session-only fields (current selection, whether a crop is
in progress) that never round-trip through save/load. Moving a tab to a new
window sends that same document, minus the session-only fields, over a Tauri
event rather than through the filesystem.

Version history:

- **v2** moved stroke and image coordinates from the inset content box to the
  full shape container. A v1 file's sketches land offset.
- **v3** adds text boxes and the authoring window size.
- **v4** broadens strokes into general draw objects (`DrawObject`, with a
  `tool`, optional fill, and overall opacity — `Stroke` still loads and
  upgrades automatically), adds `holes` on custom shapes, and adds
  `backgroundPattern`.

---

## Notes and limitations

- **fs scope is broad by design.** The user picks arbitrary paths through the
  native dialog, and Tauri v2's dialog plugin does *not* implicitly extend the
  fs scope to the chosen file. Narrow the globs in
  `src-tauri/capabilities/default.json` if you'd rather confine it.
- **Images are embedded as base64 data URLs**, so a workspace with several large
  images produces a large `.shapepad` file.
- **Click-through polls at ~60 ms.** A very fast click landing in the first
  frame after the cursor re-enters the shape can be missed.
- **`clip-path` does not animate between `inset()` and `polygon()`**, so
  square ⇄ other-shape snaps rather than morphs.
- **Shape reflow assumes the editor does not scroll.** Insets are tied to
  document position, so if content overflows the shape, scrolled lines keep the
  inset of their document position. Reflow also only considers the outer
  contour — it doesn't wrap around holes.
- **Switching tabs remounts the canvas** (`key={document.id}` on
  `PadCanvas`), so CodeMirror's own undo history and cursor position don't
  survive a round trip through another tab. Content itself is unaffected —
  it lives in the tab's `PadDocument`, not in CodeMirror's local state.
- **No drag-a-tab-out-of-the-strip gesture.** Moving a tab to its own window
  is a button (the tab's hover-revealed external-link icon), not a drag —
  Tauri doesn't give a reliable way to detect "dragged past the window
  edge" across OS/webview boundaries without extra native code.
- **Ink correction is a heuristic**, not shape recognition — see
  `lib/shapeFit.ts` for exactly what it checks. An ambiguous scribble is left
  as smoothed ink rather than forced into a shape it doesn't resemble.
- The app also runs in a plain browser (`npm run dev`) with desktop-only calls
  no-oped, which is useful for inspecting shape and layout work — though tabs,
  drawing, and shape holes are all fully testable there too; only real
  multi-window creation and click-through need the native shell.

---

## License

[MIT](LICENSE).
