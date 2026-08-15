import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Crop,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { PadImage } from "../types";

interface ImageControlsProps {
  image: PadImage;
  cropping: boolean;
  hasCropDraft: boolean;
  onPatch: (patch: Partial<PadImage>) => void;
  onStartCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onResetCrop: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}

function Btn({
  label,
  onClick,
  disabled,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  children: React.ReactNode;
}) {
  const tones = {
    default: "text-white/75 hover:bg-white/15 hover:text-white",
    primary: "bg-sky-400 text-neutral-900 hover:bg-sky-300",
    danger: "text-white/75 hover:bg-rose-500/25 hover:text-rose-200",
  };
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-lg transition-colors disabled:opacity-35 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/**
 * Transform controls for the selected image.
 *
 * Lives at the bottom of the window rather than in the side rail — it is
 * contextual to a selection, and the rail is already dense. Like the rail it
 * sits outside the clipped container and is tagged `data-sp-ui` so
 * click-through treats it as interactive.
 */
export default function ImageControls({
  image,
  cropping,
  hasCropDraft,
  onPatch,
  onStartCrop,
  onApplyCrop,
  onCancelCrop,
  onResetCrop,
  onBringToFront,
  onSendToBack,
  onDelete,
}: ImageControlsProps) {
  const cropped =
    image.crop.x !== 0 ||
    image.crop.y !== 0 ||
    image.crop.width !== 1 ||
    image.crop.height !== 1;

  return (
    <div
      data-sp-ui
      className="pointer-events-auto absolute bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-neutral-900/90 px-2 py-1.5 shadow-float backdrop-blur-xl"
      role="toolbar"
      aria-label="Image controls"
    >
      {cropping ? (
        <>
          <span className="px-1 text-[10px] uppercase tracking-wider text-white/50">
            Drag to crop
          </span>
          <Btn
            label="Apply crop"
            tone="primary"
            disabled={!hasCropDraft}
            onClick={onApplyCrop}
          >
            <Check size={14} />
          </Btn>
          <Btn label="Cancel crop" onClick={onCancelCrop}>
            <X size={14} />
          </Btn>
        </>
      ) : (
        <>
          <Btn label="Crop" onClick={onStartCrop}>
            <Crop size={14} />
          </Btn>
          <Btn label="Reset crop" disabled={!cropped} onClick={onResetCrop}>
            <Undo2 size={14} />
          </Btn>
          <Btn
            label="Rotate 90°"
            onClick={() => onPatch({ rotation: (image.rotation + 90) % 360 })}
          >
            <RotateCw size={14} />
          </Btn>
          <Btn
            label="Flip horizontal"
            onClick={() => onPatch({ flipH: !image.flipH })}
          >
            <FlipHorizontal size={14} />
          </Btn>
          <Btn
            label="Flip vertical"
            onClick={() => onPatch({ flipV: !image.flipV })}
          >
            <FlipVertical size={14} />
          </Btn>

          <div className="mx-1 h-5 w-px bg-white/15" />

          <Btn label="Bring to front" onClick={onBringToFront}>
            <ArrowUpToLine size={14} />
          </Btn>
          <Btn label="Send to back" onClick={onSendToBack}>
            <ArrowDownToLine size={14} />
          </Btn>

          <div className="mx-1 h-5 w-px bg-white/15" />

          <label className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] uppercase tracking-wider text-white/50">
              Opacity
            </span>
            <input
              type="range"
              className="sp-range w-16"
              aria-label="Image opacity"
              min={0.05}
              max={1}
              step={0.01}
              value={image.opacity}
              onChange={(event) =>
                onPatch({ opacity: Number(event.target.value) })
              }
            />
          </label>

          <div className="mx-1 h-5 w-px bg-white/15" />

          <Btn label="Delete image" tone="danger" onClick={onDelete}>
            <Trash2 size={14} />
          </Btn>
        </>
      )}
    </div>
  );
}
