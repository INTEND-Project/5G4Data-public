"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "openclaw-workspace-sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;

type WorkspaceLeftSidebarResizableProps = {
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

export function WorkspaceLeftSidebarResizable({ children }: WorkspaceLeftSidebarResizableProps) {
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
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + delta));
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
        className="workspace-sidebar-column"
        style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
      >
        {children}
      </div>
      <div
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className="workspace-sidebar-resizer"
        onMouseDown={onMouseDownResize}
        role="separator"
      />
    </>
  );
}
