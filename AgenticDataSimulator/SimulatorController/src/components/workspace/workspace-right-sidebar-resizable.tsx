"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "simulator-workspace-right-sidebar-width";
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;

type WorkspaceRightSidebarResizableProps = {
  children: ReactNode;
};

function readStoredWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_WIDTH;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_WIDTH;
  }
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

export function WorkspaceRightSidebarResizable({ children }: WorkspaceRightSidebarResizableProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(width);

  useEffect(() => {
    setWidth(readStoredWidth());
  }, []);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onMouseDownResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = widthRef.current;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      // Invert delta: this handle sits on the right panel's left edge, so dragging
      // right should shrink the right sidebar and give space to the editor on the left.
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW - delta));
      setWidth(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(widthRef.current));
      } catch {
        /* ignore quota / private mode */
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <>
      <div
        aria-label="Resize script editor versus right sidebar panels"
        aria-orientation="vertical"
        className="workspace-sidebar-resizer"
        onMouseDown={onMouseDownResize}
        role="separator"
      />
      <div
        className="workspace-sidebar-column"
        style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
      >
        <aside className="workspace-panel">{children}</aside>
      </div>
    </>
  );
}
