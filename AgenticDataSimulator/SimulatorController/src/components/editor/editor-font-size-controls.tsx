"use client";

export const EDITOR_FONT_SIZE_STORAGE_KEY = "openclaw-workspace-editor-font-size-px";
export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 24;

export function readStoredEditorFontSize(): number {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  const raw = window.localStorage.getItem(EDITOR_FONT_SIZE_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, parsed));
}

export function persistEditorFontSize(fontSizePx: number): void {
  try {
    window.localStorage.setItem(EDITOR_FONT_SIZE_STORAGE_KEY, String(fontSizePx));
  } catch {
    /* ignore */
  }
}

type EditorFontSizeControlsProps = {
  fontSizePx: number;
  onDecrease: () => void;
  onIncrease: () => void;
};

export function EditorFontSizeControls({
  fontSizePx,
  onDecrease,
  onIncrease,
}: EditorFontSizeControlsProps) {
  return (
    <div
      aria-label="Editor font size"
      className="workspace-editor-font-size-controls"
      role="group"
    >
      <button
        aria-label="Decrease editor font size"
        className="workspace-editor-font-size-control workspace-editor-font-size-control-decrease"
        disabled={fontSizePx <= MIN_EDITOR_FONT_SIZE}
        onClick={onDecrease}
        title={`Decrease editor font size (${fontSizePx}px)`}
        type="button"
      >
        A
      </button>
      <button
        aria-label="Increase editor font size"
        className="workspace-editor-font-size-control workspace-editor-font-size-control-increase"
        disabled={fontSizePx >= MAX_EDITOR_FONT_SIZE}
        onClick={onIncrease}
        title={`Increase editor font size (${fontSizePx}px)`}
        type="button"
      >
        A
      </button>
    </div>
  );
}
