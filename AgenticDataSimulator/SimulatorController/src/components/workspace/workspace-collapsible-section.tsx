"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "simulator-workspace-section-";

function storageKey(sectionId: string): string {
  return `${STORAGE_PREFIX}${sectionId}-expanded`;
}

function readStoredExpanded(sectionId: string, defaultExpanded: boolean): boolean {
  if (typeof window === "undefined") {
    return defaultExpanded;
  }
  const raw = window.localStorage.getItem(storageKey(sectionId));
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return defaultExpanded;
}

function CollapseChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      className={`workspace-collapsible-chevron ${expanded ? "workspace-collapsible-chevron-expanded" : ""}`}
      fill="none"
      height={16}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={16}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export type WorkspaceCollapsibleSectionProps = {
  sectionId: string;
  title: string;
  headerEnd?: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  children: ReactNode;
};

export function WorkspaceCollapsibleSection({
  sectionId,
  title,
  headerEnd,
  defaultExpanded = true,
  className,
  children,
}: WorkspaceCollapsibleSectionProps) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(readStoredExpanded(sectionId, defaultExpanded));
  }, [sectionId, defaultExpanded]);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey(sectionId), String(next));
      }
      return next;
    });
  }, [sectionId]);

  const sectionClassName = [
    "workspace-section",
    "workspace-collapsible-section",
    expanded ? "" : "is-collapsed",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={sectionClassName}>
      <div className="workspace-heading-row workspace-collapsible-heading">
        <h2>
          <button
            aria-controls={bodyId}
            aria-expanded={expanded}
            className="workspace-collapsible-trigger"
            onClick={toggle}
            type="button"
          >
            <CollapseChevronIcon expanded={expanded} />
            {title}
          </button>
        </h2>
        {headerEnd ? (
          <div className="workspace-heading-row-end">{headerEnd}</div>
        ) : null}
      </div>
      {expanded ? (
        <div className="workspace-collapsible-body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
