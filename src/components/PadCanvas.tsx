import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorView } from "@codemirror/view";

import BackgroundPattern from "./BackgroundPattern";
import DrawLayer from "./DrawLayer";
import ImageControls from "./ImageControls";
import ImageLayer from "./ImageLayer";
import TextControls from "./TextControls";
import TextLayer from "./TextLayer";
import { setShapeInset, shapeInsetExtension } from "../editor/shapeInset";
import { rgbaString } from "../lib/color";
import { FULL_CROP } from "../types";
import type {
  CropRect,
  DrawObject,
  PadDocument,
  PadImage,
  Point,
  TextBox,
} from "../types";

/** Breathing room between glyphs and the shape outline. */
const TEXT_PAD = 10;

export interface PadCanvasHandle {
  /** Inserts text at the notepad's current cursor/selection and refocuses it. */
  insertAtCursor: (text: string) => void;
}

interface PadCanvasProps {
  document: PadDocument;
  containerRef: (element: HTMLDivElement | null) => void;
  clipPath: string;
  band: { top: number; bottom: number };
  outline: Point[];
  width: number;
  ink: string;
  light: boolean;
  inkVars: React.CSSProperties;

  onMarkdownChange: (value: string) => void;
  onObjectComplete: (object: DrawObject) => void;

  onImagePatch: (id: string, patch: Partial<PadImage>) => void;
  onImageSelect: (id: string | null) => void;
  onCropDraftChange: (rect: CropRect | null) => void;
  onStartCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onBringImageToFront: () => void;
  onSendImageToBack: () => void;
  onDeleteImage: () => void;

  onTextPatch: (id: string, patch: Partial<TextBox>) => void;
  onTextSelect: (id: string | null) => void;
  onTextEdit: (id: string | null) => void;
  onCreateTextAt: (point: Point) => void;
  onDeleteText: () => void;
}

/**
 * Renders one document's shape, notepad, drawings, images and text boxes.
 *
 * Purely presentational — every mutation goes back up through the callback
 * props so `App.tsx` stays the single place that knows how to update a tab
 * and mark it dirty. Mounted with `key={document.id}` by the caller, so
 * switching tabs remounts this fresh rather than trying to reconcile one
 * CodeMirror/DrawLayer instance across two unrelated documents.
 */
function PadCanvas(
  {
    document,
    containerRef,
    clipPath,
    band,
    outline,
    width,
    ink,
    light,
    inkVars,
    onMarkdownChange,
    onObjectComplete,
    onImagePatch,
    onImageSelect,
    onCropDraftChange,
    onStartCrop,
    onApplyCrop,
    onCancelCrop,
    onBringImageToFront,
    onSendImageToBack,
    onDeleteImage,
    onTextPatch,
    onTextSelect,
    onTextEdit,
    onCreateTextAt,
    onDeleteText,
  }: PadCanvasProps,
  ref: React.ForwardedRef<PadCanvasHandle>,
) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        const view = cmRef.current?.view;
        if (!view) return;
        const selection = view.state.selection.main;
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
        });
        view.focus();
      },
    }),
    [],
  );

  const editorExtensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      shapeInsetExtension(),
    ],
    [],
  );

  /* Push the outline into CodeMirror, translated into editor-content space
     (the editor starts at `band.top`, so shift the polygon up by that much). */
  useEffect(() => {
    const view = cmRef.current?.view;
    if (!view || width <= 0) return;
    view.dispatch({
      effects: setShapeInset.of({
        polygon: outline.map((point) => ({ x: point.x, y: point.y - band.top })),
        width,
        pad: TEXT_PAD,
      }),
    });
  }, [band.top, outline, width]);

  const editorInteractive = document.mode === "markdown";
  const drawingActive = document.mode === "draw";
  const imageActive = document.mode === "image";
  const textActive = document.mode === "text";

  const selectedImage =
    document.images.find((image) => image.id === document.selectedImageId) ??
    null;
  const selectedText =
    document.textBoxes.find((box) => box.id === document.selectedTextId) ??
    null;

  return (
    <div style={inkVars} className="absolute inset-0">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ clipPath }}
      >
        {/* Fill + drag surface, behind everything else. */}
        <div
          data-tauri-drag-region
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{
            backgroundColor: rgbaString(
              document.backgroundColor,
              document.backgroundOpacity,
            ),
          }}
        />

        <BackgroundPattern pattern={document.backgroundPattern} />

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: light
              ? "inset 0 0 0 1px rgba(0,0,0,0.12)"
              : "inset 0 0 0 1px rgba(255,255,255,0.14)",
            clipPath,
          }}
        />

        {/* Images sit under the text so annotations read on top. */}
        <ImageLayer
          images={document.images}
          selectedId={document.selectedImageId}
          onSelect={onImageSelect}
          onChange={onImagePatch}
          active={imageActive}
          cropping={document.cropping}
          cropDraft={document.cropDraft}
          onCropChange={onCropDraftChange}
        />

        {/* Editor spans the shape's usable band; per-line margins do the
            horizontal shaping (see editor/shapeInset.ts). */}
        <div
          className={[
            "sp-editor absolute left-0 right-0 overflow-hidden",
            editorInteractive ? "pointer-events-auto" : "pointer-events-none",
          ].join(" ")}
          style={{
            top: band.top,
            height: Math.max(0, band.bottom - band.top),
            textShadow:
              document.backgroundOpacity < 0.45
                ? "0 1px 3px rgba(0,0,0,0.85)"
                : "none",
          }}
        >
          <CodeMirror
            ref={cmRef}
            value={document.markdownContent}
            onChange={onMarkdownChange}
            theme={light ? "light" : "dark"}
            extensions={editorExtensions}
            editable={editorInteractive}
            placeholder="# Notes…"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              autocompletion: false,
              searchKeymap: false,
              bracketMatching: true,
              closeBrackets: true,
              history: true,
            }}
          />
        </div>

        <TextLayer
          boxes={document.textBoxes}
          selectedId={document.selectedTextId}
          editingId={document.editingTextId}
          onSelect={onTextSelect}
          onEdit={onTextEdit}
          onChange={onTextPatch}
          onCreateAt={onCreateTextAt}
          active={textActive}
        />

        <DrawLayer
          objects={document.drawings}
          onObjectComplete={onObjectComplete}
          tool={document.drawTool}
          color={document.markerColor}
          brushSize={document.brushSize}
          fill={document.drawFill}
          fillOpacity={document.drawFillOpacity}
          opacity={document.drawOpacity}
          correctDrawings={document.correctDrawings}
          active={drawingActive}
        />
      </div>

      {/* ---- unclipped, contextual to the active tool ---- */}
      {imageActive && selectedImage && (
        <ImageControls
          image={selectedImage}
          cropping={document.cropping}
          hasCropDraft={!!document.cropDraft}
          onPatch={(patch) => onImagePatch(selectedImage.id, patch)}
          onStartCrop={() => {
            onStartCrop();
            onCropDraftChange(selectedImage.crop);
          }}
          onApplyCrop={onApplyCrop}
          onCancelCrop={onCancelCrop}
          onResetCrop={() =>
            onImagePatch(selectedImage.id, { crop: { ...FULL_CROP } })
          }
          onBringToFront={onBringImageToFront}
          onSendToBack={onSendImageToBack}
          onDelete={onDeleteImage}
        />
      )}

      {textActive && selectedText && (
        <TextControls
          box={selectedText}
          onPatch={(patch) => onTextPatch(selectedText.id, patch)}
          onDelete={onDeleteText}
        />
      )}

      <div
        className="pointer-events-none absolute bottom-1 right-1 z-30 opacity-40"
        aria-hidden="true"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            d="M9 1 L1 9 M9 5 L5 9"
            stroke={ink}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

export default forwardRef(PadCanvas);
