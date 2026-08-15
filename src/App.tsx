import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import PadCanvas, { type PadCanvasHandle } from "./components/PadCanvas";
import ShapeCapture, { type CaptureResult } from "./components/ShapeCapture";
import SideToolbar from "./components/SideToolbar";
import TabBar from "./components/TabBar";
import { isLightBackground, readableInk } from "./lib/color";
import { withWindow } from "./lib/desktop";
import {
  applyWindowSize,
  enterCapture,
  exitCapture,
  type CaptureFrame,
} from "./lib/captureWindow";
import {
  CUSTOM_PREFIX,
  clipPathFor,
  outlineHoles,
  outlinePolygon,
  resolveGeometry,
  usableBand,
} from "./lib/geometry";
import { useClickThrough } from "./hooks/useClickThrough";
import { useElementSize } from "./hooks/useElementSize";
import { openBlankWindow, openWindowWithHandoff, waitForHandoff } from "./lib/windows";
import {
  createBlankDocument,
  createId,
  createTextBox,
  deriveTabTitle,
  FULL_CROP,
  SHAPEPAD_FORMAT_VERSION,
  upgradeLegacyStroke,
  type CustomShape,
  type DrawObject,
  type PadDocument,
  type PadImage,
  type PadMode,
  type PadState,
  type Point,
  type ShapePadFile,
  type Stroke,
  type TextBox,
} from "./types";

/** Mirrors the private `ResizeDirection` union in `@tauri-apps/api`. */
type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const RESIZE_HANDLES: Array<{
  direction: ResizeDirection;
  className: string;
  cursor: string;
}> = [
  { direction: "North", className: "top-0 left-3 right-3 h-1.5", cursor: "ns-resize" },
  { direction: "South", className: "bottom-0 left-3 right-3 h-1.5", cursor: "ns-resize" },
  { direction: "West", className: "left-0 top-3 bottom-3 w-1.5", cursor: "ew-resize" },
  { direction: "East", className: "right-0 top-3 bottom-3 w-1.5", cursor: "ew-resize" },
  { direction: "NorthWest", className: "top-0 left-0 h-3 w-3", cursor: "nwse-resize" },
  { direction: "NorthEast", className: "top-0 right-0 h-3 w-3", cursor: "nesw-resize" },
  { direction: "SouthWest", className: "bottom-0 left-0 h-3 w-3", cursor: "nesw-resize" },
  { direction: "SouthEast", className: "bottom-0 right-0 h-4 w-4", cursor: "nwse-resize" },
];

/** Breathing room between glyphs and the shape outline. */
const TEXT_PAD = 10;
/** Narrower than this and a line is not worth typing into. */
const MIN_TEXT_WIDTH = 90;

function isHandoffWindow(): boolean {
  return new URLSearchParams(window.location.search).get("handoff") === "1";
}

/** A freshly-created, never-touched tab — safe for "Open" to replace. */
function isReplaceableBlank(doc: PadDocument): boolean {
  return doc.filePath === null && !doc.dirty;
}

function toShapePadFile(doc: PadDocument): ShapePadFile {
  return {
    version: SHAPEPAD_FORMAT_VERSION,
    shape: doc.shape,
    customShapes: doc.customShapes,
    backgroundColor: doc.backgroundColor,
    backgroundPattern: doc.backgroundPattern,
    markerColor: doc.markerColor,
    markdownContent: doc.markdownContent,
    drawings: doc.drawings,
    images: doc.images,
    textBoxes: doc.textBoxes,
    windowWidth: doc.windowWidth,
    windowHeight: doc.windowHeight,
    backgroundOpacity: doc.backgroundOpacity,
    brushSize: doc.brushSize,
    drawTool: doc.drawTool,
    drawFill: doc.drawFill,
    drawFillOpacity: doc.drawFillOpacity,
    drawOpacity: doc.drawOpacity,
    correctDrawings: doc.correctDrawings,
    fontFamily: doc.fontFamily,
    fontSize: doc.fontSize,
    textColor: doc.textColor,
    clickThrough: doc.clickThrough,
    mode: doc.mode,
  };
}

/** Parses a saved/incoming file into a fresh tab, defaulting anything missing. */
function fromShapePadFile(
  incoming: Partial<ShapePadFile>,
  filePath: string | null,
): PadDocument {
  const blank = createBlankDocument();

  // A file from before v4 has `drawings: Stroke[]`, not `DrawObject[]` — the
  // declared `ShapePadFile` type is only honest for files this version
  // wrote, so anything read back off disk is treated as unknown first.
  const rawDrawings: unknown[] = Array.isArray(incoming.drawings)
    ? (incoming.drawings as unknown[])
    : [];
  const drawings: DrawObject[] = rawDrawings
    .filter(
      (d): d is DrawObject | Stroke =>
        !!d && typeof d === "object" && Array.isArray((d as { points?: unknown }).points),
    )
    .map((d) => ("id" in d && "tool" in d ? (d as DrawObject) : upgradeLegacyStroke(d as Stroke)));

  return {
    ...blank,
    id: createId("tab"),
    filePath,
    dirty: false,
    title: deriveTabTitle(
      typeof incoming.markdownContent === "string"
        ? incoming.markdownContent
        : blank.markdownContent,
    ),

    shape: typeof incoming.shape === "string" ? incoming.shape : blank.shape,
    customShapes: Array.isArray(incoming.customShapes)
      ? incoming.customShapes.filter(
          (s): s is CustomShape => !!s && Array.isArray(s.points) && s.points.length >= 3,
        )
      : blank.customShapes,
    backgroundColor:
      typeof incoming.backgroundColor === "string"
        ? incoming.backgroundColor
        : blank.backgroundColor,
    backgroundPattern: incoming.backgroundPattern ?? blank.backgroundPattern,
    markerColor:
      typeof incoming.markerColor === "string" ? incoming.markerColor : blank.markerColor,
    markdownContent:
      typeof incoming.markdownContent === "string"
        ? incoming.markdownContent
        : blank.markdownContent,
    drawings,
    images: Array.isArray(incoming.images)
      ? incoming.images.filter(
          (i): i is PadImage =>
            !!i && typeof i.src === "string" && typeof i.width === "number",
        )
      : blank.images,
    textBoxes: Array.isArray(incoming.textBoxes)
      ? incoming.textBoxes.filter(
          (t): t is TextBox => !!t && typeof t.text === "string" && typeof t.x === "number",
        )
      : blank.textBoxes,
    backgroundOpacity:
      typeof incoming.backgroundOpacity === "number"
        ? Math.min(1, Math.max(0.05, incoming.backgroundOpacity))
        : blank.backgroundOpacity,
    brushSize:
      typeof incoming.brushSize === "number"
        ? Math.min(24, Math.max(1, incoming.brushSize))
        : blank.brushSize,
    drawTool: incoming.drawTool ?? blank.drawTool,
    drawFill: incoming.drawFill !== undefined ? incoming.drawFill : blank.drawFill,
    drawFillOpacity:
      typeof incoming.drawFillOpacity === "number"
        ? incoming.drawFillOpacity
        : blank.drawFillOpacity,
    drawOpacity:
      typeof incoming.drawOpacity === "number" ? incoming.drawOpacity : blank.drawOpacity,
    correctDrawings:
      typeof incoming.correctDrawings === "boolean"
        ? incoming.correctDrawings
        : blank.correctDrawings,
    mode:
      incoming.mode === "markdown" ||
      incoming.mode === "draw" ||
      incoming.mode === "image" ||
      incoming.mode === "text"
        ? incoming.mode
        : blank.mode,
    fontFamily: typeof incoming.fontFamily === "string" ? incoming.fontFamily : blank.fontFamily,
    fontSize:
      typeof incoming.fontSize === "number"
        ? Math.min(32, Math.max(10, incoming.fontSize))
        : blank.fontSize,
    textColor:
      incoming.textColor === null || typeof incoming.textColor === "string"
        ? incoming.textColor
        : blank.textColor,
    clickThrough:
      typeof incoming.clickThrough === "boolean" ? incoming.clickThrough : blank.clickThrough,
    windowWidth:
      typeof incoming.windowWidth === "number" && incoming.windowWidth > 0
        ? incoming.windowWidth
        : blank.windowWidth,
    windowHeight:
      typeof incoming.windowHeight === "number" && incoming.windowHeight > 0
        ? incoming.windowHeight
        : blank.windowHeight,
  };
}

export default function App() {
  /* ---------------- bootstrap ---------------- */
  const [tabs, setTabs] = useState<PadDocument[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = isHandoffWindow() ? await waitForHandoff() : null;
      if (cancelled) return;
      const first = initial ?? createBlankDocument();
      setTabs([first]);
      setActiveTabId(first.id);
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );

  /* ---------------- window-level (not per-tab) state ---------------- */
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimer = useRef<number | null>(null);
  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  /* ---------------- tab update helpers ---------------- */
  const updateTab = useCallback(
    (id: string, updater: (doc: PadDocument) => PadDocument) => {
      setTabs((current) => current.map((t) => (t.id === id ? updater(t) : t)));
    },
    [],
  );

  /** For content changes — marks the tab dirty. */
  const patchTab = useCallback(
    (id: string, patch: Partial<PadDocument>) => {
      updateTab(id, (doc) => ({ ...doc, ...patch, dirty: true }));
    },
    [updateTab],
  );

  /** For session-only UI state (selection, cropping) — never marks dirty. */
  const patchTabSession = useCallback(
    (id: string, patch: Partial<PadDocument>) => {
      updateTab(id, (doc) => ({ ...doc, ...patch }));
    },
    [updateTab],
  );

  const patchActive = useCallback(
    (patch: Partial<PadDocument>) => {
      if (activeTab) patchTab(activeTab.id, patch);
    },
    [activeTab, patchTab],
  );
  const patchActiveSession = useCallback(
    (patch: Partial<PadDocument>) => {
      if (activeTab) patchTabSession(activeTab.id, patch);
    },
    [activeTab, patchTabSession],
  );

  /* ---------------- live geometry (active tab) ---------------- */
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();

  const geometry = useMemo(
    () =>
      activeTab
        ? resolveGeometry(activeTab.shape, activeTab.customShapes)
        : resolveGeometry("square", []),
    [activeTab],
  );

  const clipPath = useMemo(
    () => clipPathFor(geometry, size.width, size.height),
    [geometry, size.width, size.height],
  );

  const outline = useMemo(
    () => outlinePolygon(geometry, size.width, size.height),
    [geometry, size.width, size.height],
  );
  const holes = useMemo(
    () => outlineHoles(geometry, size.width, size.height),
    [geometry, size.width, size.height],
  );

  const band = useMemo(
    () =>
      size.height > 0
        ? usableBand(outline, size.height, MIN_TEXT_WIDTH, TEXT_PAD)
        : { top: 0, bottom: 0 },
    [outline, size.height],
  );

  /* ---------------- click-through ---------------- */
  const [captureOpen, setCaptureOpen] = useState(false);
  useClickThrough({
    polygon: outline,
    holes,
    enabled: activeTab?.clickThrough ?? true,
    suspended: captureOpen,
  });

  /* ---------------- derived styling (active tab) ---------------- */
  const light = activeTab
    ? isLightBackground(activeTab.backgroundColor, activeTab.backgroundOpacity)
    : true;
  const autoInk = activeTab
    ? readableInk(activeTab.backgroundColor, activeTab.backgroundOpacity)
    : "#101014";
  const ink = activeTab?.textColor ?? autoInk;

  const inkVars = useMemo(
    () =>
      ({
        "--sp-ink": ink,
        "--sp-ink-dim": light ? "rgba(16,16,20,0.45)" : "rgba(250,250,250,0.45)",
        "--sp-ink-wash": light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)",
        "--sp-ink-sel": light
          ? "rgba(59,130,246,0.28)"
          : "rgba(125,211,252,0.32)",
        "--sp-font": activeTab?.fontFamily,
        "--sp-font-size": activeTab ? `${activeTab.fontSize}px` : undefined,
      }) as React.CSSProperties,
    [activeTab, ink, light],
  );

  const canvasRef = useRef<PadCanvasHandle | null>(null);

  /* ---------------- drawing ---------------- */
  const handleObjectComplete = useCallback(
    (object: DrawObject) => {
      if (!activeTab) return;
      patchTab(activeTab.id, { drawings: [...activeTab.drawings, object] });
    },
    [activeTab, patchTab],
  );
  const undoDrawing = useCallback(() => {
    if (!activeTab) return;
    patchTab(activeTab.id, { drawings: activeTab.drawings.slice(0, -1) });
  }, [activeTab, patchTab]);
  const clearDrawings = useCallback(() => {
    if (!activeTab) return;
    patchTab(activeTab.id, { drawings: [] });
    flash("Cleared all drawings");
  }, [activeTab, flash, patchTab]);

  /* ---------------- images ---------------- */
  const patchImage = useCallback(
    (id: string, patch: Partial<PadImage>) => {
      if (!activeTab) return;
      patchTab(activeTab.id, {
        images: activeTab.images.map((image) =>
          image.id === id ? { ...image, ...patch } : image,
        ),
      });
    },
    [activeTab, patchTab],
  );

  const addImageFromDataUrl = useCallback(
    (src: string) => {
      if (!activeTab) return;
      const probe = new Image();
      probe.onload = () => {
        const containerWidth = size.width || 600;
        const containerHeight = size.height || 600;
        const maxWidth = containerWidth * 0.55;
        const maxHeight = Math.max(80, (band.bottom - band.top) * 0.8);
        const scale = Math.min(
          1,
          maxWidth / probe.naturalWidth,
          maxHeight / probe.naturalHeight,
        );
        const width = Math.max(48, probe.naturalWidth * scale);
        const height = Math.max(48, probe.naturalHeight * scale);

        const image: PadImage = {
          id: createId("img"),
          src,
          x: (containerWidth - width) / 2,
          y: (containerHeight - height) / 2,
          width,
          height,
          rotation: 0,
          opacity: 1,
          flipH: false,
          flipV: false,
          crop: { ...FULL_CROP },
          naturalWidth: probe.naturalWidth,
          naturalHeight: probe.naturalHeight,
        };

        patchTab(activeTab.id, {
          images: [...activeTab.images, image],
          mode: "image",
        });
        patchTabSession(activeTab.id, { selectedImageId: image.id });
        flash("Image added");
      };
      probe.onerror = () => flash("Could not decode that image");
      probe.src = src;
    },
    [activeTab, band.bottom, band.top, flash, patchTab, patchTabSession, size.height, size.width],
  );

  const readAsDataUrl = useCallback(
    (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      }),
    [],
  );

  useEffect(() => {
    const handle = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          event.preventDefault();
          try {
            addImageFromDataUrl(await readAsDataUrl(file));
          } catch {
            flash("Could not read pasted image");
          }
          return;
        }
      }
    };
    window.addEventListener("paste", handle);
    return () => window.removeEventListener("paste", handle);
  }, [addImageFromDataUrl, flash, readAsDataUrl]);

  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = async (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      event.preventDefault();
      try {
        addImageFromDataUrl(await readAsDataUrl(file));
      } catch {
        flash("Could not read dropped image");
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addImageFromDataUrl, flash, readAsDataUrl]);

  const insertImageFromFile = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const selected = await openDialog({
        title: "Insert image",
        multiple: false,
        directory: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
        ],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;

      const bytes = await readFile(path);
      const extension = path.split(".").pop()?.toLowerCase() ?? "png";
      const mime =
        extension === "svg"
          ? "image/svg+xml"
          : extension === "jpg"
            ? "image/jpeg"
            : `image/${extension}`;

      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
      }
      addImageFromDataUrl(`data:${mime};base64,${btoa(binary)}`);
    } catch (error) {
      flash(`Insert failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [addImageFromDataUrl, busy, flash]);

  const applyCrop = useCallback(() => {
    if (!activeTab) return;
    const selectedImage = activeTab.images.find(
      (image) => image.id === activeTab.selectedImageId,
    );
    if (!selectedImage || !activeTab.cropDraft) return;
    const cropDraft = activeTab.cropDraft;
    const sourceAspect =
      (cropDraft.width * selectedImage.naturalWidth) /
      Math.max(1, cropDraft.height * selectedImage.naturalHeight);
    patchImage(selectedImage.id, {
      crop: cropDraft,
      height: selectedImage.width / Math.max(0.01, sourceAspect),
    });
    patchTabSession(activeTab.id, { cropDraft: null, cropping: false });
    flash("Crop applied");
  }, [activeTab, flash, patchImage, patchTabSession]);

  const deleteSelectedImage = useCallback(() => {
    if (!activeTab?.selectedImageId) return;
    patchTab(activeTab.id, {
      images: activeTab.images.filter((image) => image.id !== activeTab.selectedImageId),
    });
    patchTabSession(activeTab.id, {
      selectedImageId: null,
      cropping: false,
      cropDraft: null,
    });
  }, [activeTab, patchTab, patchTabSession]);

  const reorderImage = useCallback(
    (toFront: boolean) => {
      if (!activeTab?.selectedImageId) return;
      const target = activeTab.images.find(
        (image) => image.id === activeTab.selectedImageId,
      );
      if (!target) return;
      const rest = activeTab.images.filter((image) => image.id !== activeTab.selectedImageId);
      patchTab(activeTab.id, { images: toFront ? [...rest, target] : [target, ...rest] });
    },
    [activeTab, patchTab],
  );

  /* ---------------- text boxes ---------------- */
  const patchTextBox = useCallback(
    (id: string, patch: Partial<TextBox>) => {
      if (!activeTab) return;
      patchTab(activeTab.id, {
        textBoxes: activeTab.textBoxes.map((box) =>
          box.id === id ? { ...box, ...patch } : box,
        ),
      });
    },
    [activeTab, patchTab],
  );

  const createTextBoxAt = useCallback(
    (point: Point) => {
      if (!activeTab) return;
      const box = createTextBox(
        { x: Math.max(0, point.x - 8), y: Math.max(0, point.y - 12) },
        { color: autoInk },
      );
      patchTab(activeTab.id, { textBoxes: [...activeTab.textBoxes, box] });
      patchTabSession(activeTab.id, { selectedTextId: box.id, editingTextId: box.id });
    },
    [activeTab, autoInk, patchTab, patchTabSession],
  );

  const deleteSelectedText = useCallback(() => {
    if (!activeTab?.selectedTextId) return;
    patchTab(activeTab.id, {
      textBoxes: activeTab.textBoxes.filter((box) => box.id !== activeTab.selectedTextId),
    });
    patchTabSession(activeTab.id, { selectedTextId: null, editingTextId: null });
  }, [activeTab, patchTab, patchTabSession]);

  /* ---------------- custom shapes / capture ---------------- */
  const [capture, setCapture] = useState<{ open: boolean; editing: CustomShape | null }>({
    open: false,
    editing: null,
  });
  const captureFrameRef = useRef<CaptureFrame | null>(null);

  useEffect(() => setCaptureOpen(capture.open), [capture.open]);

  const openCapture = useCallback(async (editing: CustomShape | null) => {
    captureFrameRef.current = await enterCapture();
    setCapture({ open: true, editing });
  }, []);

  const cancelCapture = useCallback(async () => {
    setCapture({ open: false, editing: null });
    if (captureFrameRef.current) {
      await exitCapture(captureFrameRef.current, null);
      captureFrameRef.current = null;
    }
  }, []);

  const confirmCapture = useCallback(
    async (result: CaptureResult) => {
      if (!activeTab) return;
      const editing = capture.editing;
      const custom: CustomShape = {
        id: editing?.id ?? createId("shape"),
        name: result.name,
        points: result.points.map((point) => ({
          x: point.x / result.bounds.width,
          y: point.y / result.bounds.height,
        })),
        holes: result.holes.map((hole) =>
          hole.map((point) => ({
            x: point.x / result.bounds.width,
            y: point.y / result.bounds.height,
          })),
        ),
        authoredWidth: Math.round(result.bounds.width),
        authoredHeight: Math.round(result.bounds.height),
      };

      const nextShapes = activeTab.customShapes.some((s) => s.id === custom.id)
        ? activeTab.customShapes.map((s) => (s.id === custom.id ? custom : s))
        : [...activeTab.customShapes, custom];

      patchTab(activeTab.id, {
        customShapes: nextShapes,
        shape: `${CUSTOM_PREFIX}${custom.id}`,
        windowWidth: Math.round(result.bounds.width),
        windowHeight: Math.round(result.bounds.height),
      });
      setCapture({ open: false, editing: null });

      if (captureFrameRef.current) {
        await exitCapture(captureFrameRef.current, result.bounds);
        captureFrameRef.current = null;
      }
      flash(`Shape "${custom.name}" applied`);
    },
    [activeTab, capture.editing, flash, patchTab],
  );

  const deleteCustomShape = useCallback(
    (id: string) => {
      if (!activeTab) return;
      patchTab(activeTab.id, {
        customShapes: activeTab.customShapes.filter((s) => s.id !== id),
        shape: activeTab.shape === `${CUSTOM_PREFIX}${id}` ? "square" : activeTab.shape,
      });
    },
    [activeTab, patchTab],
  );

  /* ---------------- window ---------------- */
  const toggleAlwaysOnTop = useCallback(() => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    withWindow((target) => target.setAlwaysOnTop(next));
  }, [alwaysOnTop]);

  const startResize = useCallback(
    (direction: ResizeDirection) => (event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      withWindow((target) => target.startResizeDragging(direction));
    },
    [],
  );

  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (!event.altKey || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-sp-ui]")) return;
      event.preventDefault();
      withWindow((appTarget) => appTarget.startDragging());
    };
    window.addEventListener("mousedown", handle, true);
    return () => window.removeEventListener("mousedown", handle, true);
  }, []);

  /* ---------------- tabs ---------------- */
  const newTab = useCallback(() => {
    const doc = createBlankDocument();
    setTabs((current) => [...current, doc]);
    setActiveTabId(doc.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((current) => {
        const next = current.filter((t) => t.id !== id);
        if (next.length === 0) {
          // Closing the last tab in a window closes the window itself,
          // matching how every mainstream tabbed app behaves.
          withWindow((target) => target.close());
          return current;
        }
        if (id === activeTabId) {
          const closedIndex = current.findIndex((t) => t.id === id);
          const fallback = next[Math.min(closedIndex, next.length - 1)];
          setActiveTabId(fallback.id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const cycleTab = useCallback(
    (delta: number) => {
      if (tabs.length < 2) return;
      const index = tabs.findIndex((t) => t.id === activeTabId);
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      setActiveTabId(next.id);
    },
    [activeTabId, tabs],
  );

  /* ---------------- multi-window ---------------- */
  const handleNewWindow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const result = await openBlankWindow();
    setBusy(false);
    if (!result.ok) flash(result.error ?? "Could not open a new window");
  }, [busy, flash]);

  const handleMoveToNewWindow = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || busy) return;
      setBusy(true);
      const result = await openWindowWithHandoff(tab);
      setBusy(false);
      if (!result.ok) {
        flash(result.error ?? "Could not open a new window");
        return;
      }
      closeTab(tabId);
    },
    [busy, closeTab, flash, tabs],
  );

  /* ---------------- persistence ---------------- */
  const handleSaveAs = useCallback(async () => {
    if (!activeTab || busy) return;
    setBusy(true);
    try {
      const path = await saveDialog({
        title: "Save ShapePad workspace",
        defaultPath: `${activeTab.title || "workspace"}.shapepad`,
        filters: [{ name: "ShapePad workspace", extensions: ["shapepad"] }],
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(toShapePadFile(activeTab), null, 2));
      updateTab(activeTab.id, (doc) => ({ ...doc, filePath: path, dirty: false }));
      flash("Workspace saved");
    } catch (error) {
      flash(`Save failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTab, busy, flash, updateTab]);

  const handleSave = useCallback(async () => {
    if (!activeTab || busy) return;
    if (!activeTab.filePath) {
      await handleSaveAs();
      return;
    }
    setBusy(true);
    try {
      await writeTextFile(
        activeTab.filePath,
        JSON.stringify(toShapePadFile(activeTab), null, 2),
      );
      updateTab(activeTab.id, (doc) => ({ ...doc, dirty: false }));
      flash("Workspace saved");
    } catch (error) {
      flash(`Save failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTab, busy, flash, handleSaveAs, updateTab]);

  const handleOpen = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const selected = await openDialog({
        title: "Open ShapePad workspace",
        multiple: false,
        directory: false,
        filters: [{ name: "ShapePad workspace", extensions: ["shapepad"] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;

      const parsed = JSON.parse(await readTextFile(path)) as Partial<ShapePadFile>;
      const doc = fromShapePadFile(parsed, path);

      setTabs((current) => {
        const replaceIndex = activeTab && isReplaceableBlank(activeTab)
          ? current.findIndex((t) => t.id === activeTab.id)
          : -1;
        if (replaceIndex >= 0) {
          const next = [...current];
          next[replaceIndex] = doc;
          return next;
        }
        return [...current, doc];
      });
      setActiveTabId(doc.id);

      if (doc.windowWidth > 0 && doc.windowHeight > 0) {
        void applyWindowSize(doc.windowWidth, doc.windowHeight);
      }
      flash("Workspace loaded");
    } catch (error) {
      flash(`Open failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTab, busy, flash]);

  /* ---------------- shortcuts ---------------- */
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeTab?.cropping) {
        patchTabSession(activeTab.id, { cropping: false, cropDraft: null });
        return;
      }

      const inTextField = !!(event.target as HTMLElement)?.closest(
        ".cm-editor, input, textarea",
      );

      if (activeTab && (event.key === "Delete" || event.key === "Backspace") && !inTextField) {
        if (activeTab.mode === "image" && activeTab.selectedImageId) {
          event.preventDefault();
          deleteSelectedImage();
          return;
        }
        if (activeTab.mode === "text" && activeTab.selectedTextId) {
          event.preventDefault();
          deleteSelectedText();
          return;
        }
      }

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === "s" && event.shiftKey) {
        event.preventDefault();
        void handleSaveAs();
      } else if (key === "s") {
        event.preventDefault();
        void handleSave();
      } else if (key === "o") {
        event.preventDefault();
        void handleOpen();
      } else if (key === "t") {
        event.preventDefault();
        newTab();
      } else if (key === "w") {
        event.preventDefault();
        if (activeTab) closeTab(activeTab.id);
      } else if (key === "tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      } else if (key === "n" && event.shiftKey) {
        event.preventDefault();
        void handleNewWindow();
      } else if (key === "m") {
        event.preventDefault();
        const order: PadMode[] = ["markdown", "draw", "image", "text"];
        patchActiveSession({
          mode: order[(order.indexOf(activeTab?.mode ?? "markdown") + 1) % order.length],
        });
      } else if (key === "z" && activeTab?.mode === "draw") {
        event.preventDefault();
        undoDrawing();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    activeTab,
    closeTab,
    cycleTab,
    deleteSelectedImage,
    deleteSelectedText,
    handleNewWindow,
    handleOpen,
    handleSave,
    handleSaveAs,
    newTab,
    patchActiveSession,
    patchTabSession,
    undoDrawing,
  ]);

  /* ---------------- render ---------------- */
  if (booting || !activeTab) {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <PadCanvas
        key={activeTab.id}
        ref={canvasRef}
        document={activeTab}
        containerRef={containerRef}
        clipPath={clipPath}
        band={band}
        outline={outline}
        width={size.width}
        ink={ink}
        light={light}
        inkVars={inkVars}
        onMarkdownChange={(value) =>
          patchActive({ markdownContent: value, title: deriveTabTitle(value) })
        }
        onObjectComplete={handleObjectComplete}
        onImagePatch={patchImage}
        onImageSelect={(id) => patchActiveSession({ selectedImageId: id })}
        onCropDraftChange={(rect) => patchActiveSession({ cropDraft: rect })}
        onStartCrop={() => patchActiveSession({ cropping: true })}
        onApplyCrop={applyCrop}
        onCancelCrop={() => patchActiveSession({ cropping: false, cropDraft: null })}
        onBringImageToFront={() => reorderImage(true)}
        onSendImageToBack={() => reorderImage(false)}
        onDeleteImage={deleteSelectedImage}
        onTextPatch={patchTextBox}
        onTextSelect={(id) => patchActiveSession({ selectedTextId: id })}
        onTextEdit={(id) => patchActiveSession({ editingTextId: id })}
        onCreateTextAt={createTextBoxAt}
        onDeleteText={deleteSelectedText}
      />

      <TabBar
        tabs={tabs}
        activeTabId={activeTab.id}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNewTab={newTab}
        onReorder={reorderTabs}
        onNewWindow={() => void handleNewWindow()}
        onMoveToNewWindow={(id) => void handleMoveToNewWindow(id)}
        busy={busy}
      />

      <SideToolbar
        shape={activeTab.shape}
        onShapeChange={(shape) => patchActive({ shape })}
        customShapes={activeTab.customShapes}
        onCreateCustomShape={() => void openCapture(null)}
        onEditCustomShape={(custom) => void openCapture(custom)}
        onDeleteCustomShape={deleteCustomShape}
        mode={activeTab.mode}
        onModeChange={(mode) => patchActiveSession({ mode })}
        backgroundColor={activeTab.backgroundColor}
        onBackgroundColorChange={(hex) => patchActive({ backgroundColor: hex })}
        backgroundOpacity={activeTab.backgroundOpacity}
        onBackgroundOpacityChange={(value) => patchActive({ backgroundOpacity: value })}
        backgroundPattern={activeTab.backgroundPattern}
        onBackgroundPatternChange={(pattern) => patchActive({ backgroundPattern: pattern })}
        markerColor={activeTab.markerColor}
        onMarkerColorChange={(hex) => patchActive({ markerColor: hex })}
        brushSize={activeTab.brushSize}
        onBrushSizeChange={(value) => patchActive({ brushSize: value })}
        drawTool={activeTab.drawTool}
        onDrawToolChange={(tool) => patchActive({ drawTool: tool })}
        drawFill={activeTab.drawFill}
        onDrawFillChange={(fill) => patchActive({ drawFill: fill })}
        drawFillOpacity={activeTab.drawFillOpacity}
        onDrawFillOpacityChange={(value) => patchActive({ drawFillOpacity: value })}
        drawOpacity={activeTab.drawOpacity}
        onDrawOpacityChange={(value) => patchActive({ drawOpacity: value })}
        correctDrawings={activeTab.correctDrawings}
        onCorrectDrawingsChange={(value) => patchActive({ correctDrawings: value })}
        fontFamily={activeTab.fontFamily}
        onFontFamilyChange={(stack) => patchActive({ fontFamily: stack })}
        fontSize={activeTab.fontSize}
        onFontSizeChange={(size2) => patchActive({ fontSize: size2 })}
        textColor={activeTab.textColor}
        onTextColorChange={(hex) => patchActive({ textColor: hex })}
        autoTextColor={autoInk}
        onInsertEmoji={(emoji) => canvasRef.current?.insertAtCursor(emoji)}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onOpen={handleOpen}
        onUndoStroke={undoDrawing}
        onClearStrokes={clearDrawings}
        strokeCount={activeTab.drawings.length}
        onInsertImage={insertImageFromFile}
        clickThrough={activeTab.clickThrough}
        onToggleClickThrough={() => patchActive({ clickThrough: !activeTab.clickThrough })}
        alwaysOnTop={alwaysOnTop}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onMinimize={() => withWindow((target) => target.minimize())}
        onClose={() => closeTab(activeTab.id)}
        busy={busy}
      />

      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle.direction}
          data-sp-ui
          role="presentation"
          onMouseDown={startResize(handle.direction)}
          className={`absolute z-40 ${handle.className}`}
          style={{ cursor: handle.cursor }}
        />
      ))}

      <div
        className="pointer-events-none absolute right-2 top-9 z-30 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/80 backdrop-blur-sm"
        aria-live="polite"
      >
        {activeTab.mode}
      </div>

      {toast && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 z-50 -translate-x-1/2 animate-fade-in whitespace-nowrap rounded-full bg-black/75 px-3 py-1 text-[11px] text-white shadow-float backdrop-blur-sm"
          role="status"
        >
          {toast}
        </div>
      )}

      {capture.open && (
        <ShapeCapture
          initialName={capture.editing?.name ?? "My shape"}
          initialShape={
            capture.editing
              ? {
                  points: capture.editing.points,
                  holes: capture.editing.holes,
                  width: capture.editing.authoredWidth ?? 320,
                  height: capture.editing.authoredHeight ?? 320,
                }
              : null
          }
          onCancel={() => void cancelCapture()}
          onConfirm={(result) => void confirmCapture(result)}
        />
      )}
    </div>
  );
}

export type { PadState };
