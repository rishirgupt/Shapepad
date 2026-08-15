/**
 * Multi-window support.
 *
 * "New window" and "move tab to new window" both work the same way: create
 * an independent Tauri window pointed at the app's own root, styled like the
 * main window (frameless/transparent/always-on-top), and — when there's a
 * document to carry over — hand it off once the new window is ready.
 *
 * Each Tauri window is its own separate webview with its own fresh JS
 * runtime, so a brand-new window needs nothing more than being created: it
 * boots the same `index.html`/React app and starts with one blank tab on its
 * own. Only the "move an existing tab over" case needs to transfer state,
 * and it can't just be stuffed in the URL — a document can carry embedded
 * (base64) images well past any sane URL length. Instead the new window
 * announces itself over a Tauri event once mounted, and the source window
 * replies with the actual document over a second, targeted event.
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { appWindow } from "./desktop";
import type { PadDocument, TabHandoffPayload } from "../types";

/** Every window this app creates beyond the initial `main` carries this prefix — see `capabilities/default.json`'s `pad-*` glob. */
const WINDOW_LABEL_PREFIX = "pad-";

const HANDOFF_READY_EVENT = "shapepad://handoff-ready";
const HANDOFF_EVENT = "shapepad://handoff";

function randomLabelSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** True for any window this app itself opened (not the original `main`). */
export function isSpawnedWindowLabel(label: string): boolean {
  return label.startsWith(WINDOW_LABEL_PREFIX);
}

async function nextWindowGeometry(): Promise<{
  x?: number;
  y?: number;
  width: number;
  height: number;
}> {
  const source = appWindow();
  if (!source) return { width: 620, height: 620 };
  try {
    const [position, size, scale] = await Promise.all([
      source.outerPosition(),
      source.outerSize(),
      source.scaleFactor(),
    ]);
    const factor = scale || 1;
    // Cascade slightly so a new window isn't a perfect duplicate stacked on
    // top of its source — a small, familiar affordance from every desktop
    // "new window" action.
    return {
      x: position.x / factor + 36,
      y: position.y / factor + 36,
      width: size.width / factor,
      height: size.height / factor,
    };
  } catch {
    return { width: 620, height: 620 };
  }
}

interface SpawnResult {
  ok: boolean;
  error?: string;
}

async function spawnWindow(url: string): Promise<{
  window: WebviewWindow | null;
  result: SpawnResult;
}> {
  if (!appWindow()) {
    return {
      window: null,
      result: { ok: false, error: "Multiple windows need the desktop app." },
    };
  }

  const label = `${WINDOW_LABEL_PREFIX}${randomLabelSuffix()}`;
  const geometry = await nextWindowGeometry();

  try {
    const created = new WebviewWindow(label, {
      url,
      title: "ShapePad",
      width: geometry.width,
      height: geometry.height,
      x: geometry.x,
      y: geometry.y,
      minWidth: 180,
      minHeight: 180,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      shadow: false,
      focus: true,
    });

    const outcome = await new Promise<SpawnResult>((resolve) => {
      let settled = false;
      void created.once("tauri://created", () => {
        if (settled) return;
        settled = true;
        resolve({ ok: true });
      });
      void created.once("tauri://error", (event) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: String(event.payload) });
      });
      // Window creation is local IPC; if neither event lands quickly
      // something is genuinely wrong rather than just slow.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: "Timed out waiting for the new window." });
      }, 8000);
    });

    return { window: created, result: outcome };
  } catch (error) {
    return { window: null, result: { ok: false, error: String(error) } };
  }
}

/** Opens a brand-new, blank ShapePad window. */
export async function openBlankWindow(): Promise<SpawnResult> {
  const { result } = await spawnWindow("/");
  return result;
}

/**
 * Opens a new window and transfers `document` into it once it signals it's
 * mounted and listening. The source window's own copy is untouched — the
 * caller decides whether to remove the tab locally after this resolves.
 */
export async function openWindowWithHandoff(
  document: PadDocument,
): Promise<SpawnResult> {
  const { window: created, result } = await spawnWindow("/?handoff=1");
  if (!created || !result.ok) return result;

  // The new window gets its own selection/crop state; carrying the source
  // window's over would be meaningless there.
  const {
    selectedImageId: _selectedImageId,
    selectedTextId: _selectedTextId,
    editingTextId: _editingTextId,
    cropping: _cropping,
    cropDraft: _cropDraft,
    ...transferable
  } = document;
  const payload: TabHandoffPayload = { document: transferable };

  return new Promise<SpawnResult>((resolve) => {
    let settled = false;
    const finish = (outcome: SpawnResult) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    void created.once(HANDOFF_READY_EVENT, () => {
      void emitTo(created.label, HANDOFF_EVENT, payload).then(
        () => finish({ ok: true }),
        (error) => finish({ ok: false, error: String(error) }),
      );
    });

    setTimeout(
      () => finish({ ok: false, error: "The new window never became ready." }),
      8000,
    );
  });
}

/**
 * Called by a freshly-created window that was opened with `?handoff=1` in
 * its URL. Announces readiness and waits for the source window's payload.
 */
export async function waitForHandoff(): Promise<PadDocument | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PadDocument | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    void listen<TabHandoffPayload>(HANDOFF_EVENT, (event) => {
      finish({
        ...event.payload.document,
        selectedImageId: null,
        selectedTextId: null,
        editingTextId: null,
        cropping: false,
        cropDraft: null,
      });
    });

    void emit(HANDOFF_READY_EVENT).catch(() => finish(null));

    setTimeout(() => finish(null), 8000);
  });
}
