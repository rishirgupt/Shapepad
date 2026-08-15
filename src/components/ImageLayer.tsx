import { useCallback, useEffect, useRef } from "react";
import SelectionBox from "./SelectionBox";
import { useBoxGestures } from "../hooks/useBoxGestures";
import type { Box } from "../lib/transform";
import type { CropRect, PadImage } from "../types";

interface ImageLayerProps {
  images: PadImage[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<PadImage>) => void;
  active: boolean;
  cropping: boolean;
  onCropChange: (rect: CropRect | null) => void;
  cropDraft: CropRect | null;
}

/** Rendered geometry for one image, including its crop window. */
function ImageBody({ image }: { image: PadImage }) {
  const { crop } = image;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <img
        src={image.src}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${(-crop.x * 100) / crop.width}%`,
          top: `${(-crop.y * 100) / crop.height}%`,
        }}
      />
    </div>
  );
}

/**
 * Interactive image layer: paste, move, resize, rotate, crop.
 *
 * Transform gestures come from `useBoxGestures`, shared with the text layer,
 * so a rotated image and a rotated text box resize identically.
 */
export default function ImageLayer({
  images,
  selectedId,
  onSelect,
  onChange,
  active,
  cropping,
  onCropChange,
  cropDraft,
}: ImageLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const applyPatch = useCallback(
    (item: PadImage, patch: Partial<Box>) => onChange(item.id, patch),
    [onChange],
  );

  const { startMove, startResize, startRotate } = useBoxGestures<PadImage>({
    containerRef: rootRef,
    onChange: applyPatch,
    enabled: active && !cropping,
  });

  useEffect(() => {
    // Deliberately keyed on `active` alone: `onSelect` is a fresh closure
    // from the parent on every render (it isn't a `useState` setter), so
    // including it here would re-fire this effect every render — which
    // calls a state update, forcing another render, forever.
    if (!active) onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Drag a fresh crop window over the (temporarily uncropped) source. */
  const startCropDraw = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const startX = (event.clientX - box.left) / box.width;
      const startY = (event.clientY - box.top) / box.height;

      const move = (moveEvent: PointerEvent) => {
        const currentX = (moveEvent.clientX - box.left) / box.width;
        const currentY = (moveEvent.clientY - box.top) / box.height;
        const x = Math.max(0, Math.min(startX, currentX));
        const y = Math.max(0, Math.min(startY, currentY));
        onCropChange({
          x,
          y,
          width: Math.min(1 - x, Math.abs(currentX - startX)),
          height: Math.min(1 - y, Math.abs(currentY - startY)),
        });
      };

      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    },
    [onCropChange],
  );

  return (
    <div
      ref={rootRef}
      className={[
        "absolute inset-0",
        active ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      onPointerDown={(event) => {
        if (active && !cropping && event.target === event.currentTarget) {
          onSelect(null);
        }
      }}
    >
      {images.map((image) => {
        const isSelected = image.id === selectedId;
        const showCropUi = isSelected && cropping;

        return (
          <div
            key={image.id}
            className="absolute"
            style={{
              left: image.x,
              top: image.y,
              width: image.width,
              height: image.height,
              transform: `rotate(${image.rotation}deg) scale(${
                image.flipH ? -1 : 1
              }, ${image.flipV ? -1 : 1})`,
              opacity: image.opacity,
              cursor: active && !cropping ? "move" : "default",
            }}
            onPointerDown={(event) => {
              if (!active || showCropUi) return;
              onSelect(image.id);
              startMove(event, image);
            }}
          >
            {showCropUi ? (
              /* Show the whole source dimmed so the crop window can be pulled
                 back out to areas the current crop excludes. */
              <div
                className="absolute inset-0 overflow-hidden"
                onPointerDown={startCropDraw}
              >
                <img
                  src={image.src}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none opacity-45"
                />
                {cropDraft && (
                  <div
                    className="absolute border-2 border-sky-300"
                    style={{
                      left: `${cropDraft.x * 100}%`,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.width * 100}%`,
                      height: `${cropDraft.height * 100}%`,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                    }}
                  >
                    <img
                      src={image.src}
                      alt=""
                      draggable={false}
                      className="absolute max-w-none select-none"
                      style={{
                        width: `${100 / Math.max(cropDraft.width, 0.001)}%`,
                        height: `${100 / Math.max(cropDraft.height, 0.001)}%`,
                        left: `${(-cropDraft.x * 100) / Math.max(cropDraft.width, 0.001)}%`,
                        top: `${(-cropDraft.y * 100) / Math.max(cropDraft.height, 0.001)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <ImageBody image={image} />
            )}

            {isSelected && active && (
              <SelectionBox
                showHandles={!cropping}
                onResize={(event, handle) => startResize(event, image, handle)}
                onRotate={(event) => startRotate(event, image)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
