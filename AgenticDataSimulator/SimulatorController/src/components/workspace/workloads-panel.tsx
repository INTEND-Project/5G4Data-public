"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import { WorkspaceCollapsibleSection } from "@/components/workspace/workspace-collapsible-section";
import { withAppBasePath } from "@/lib/app-paths";
import type { WorkloadCatalogEntry } from "@/lib/workload-catalogue/list-charts";
import { parseWorkloadCatalogBaseUrlInput } from "@/lib/workload-catalogue/resolve-base-url";

type WorkloadsPanelProps = {
  workloadCatalogConnected: boolean;
};

export function WorkloadsPanel({ workloadCatalogConnected }: WorkloadsPanelProps) {
  const {
    defaultWorkloadCatalogBaseUrl,
    workloadCatalogBaseUrl,
    setWorkloadCatalogBaseUrl,
  } = useWorkspaceScriptSession();
  const [draftUrl, setDraftUrl] = useState(workloadCatalogBaseUrl);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [customReachable, setCustomReachable] = useState<boolean | null>(null);
  const [workloads, setWorkloads] = useState<WorkloadCatalogEntry[]>([]);
  const [isLoadingWorkloads, setIsLoadingWorkloads] = useState(false);
  const [workloadsError, setWorkloadsError] = useState<string | null>(null);

  useEffect(() => {
    setDraftUrl(workloadCatalogBaseUrl);
  }, [workloadCatalogBaseUrl]);

  const applyUrl = useCallback(() => {
    const parsed = parseWorkloadCatalogBaseUrlInput(draftUrl);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    setWorkloadCatalogBaseUrl(parsed.url.replace(/\/$/, "") || parsed.url);
  }, [draftUrl, setWorkloadCatalogBaseUrl]);

  const resetToDefault = useCallback(() => {
    setDraftUrl(defaultWorkloadCatalogBaseUrl.replace(/\/$/, ""));
    setValidationError(null);
    setWorkloadCatalogBaseUrl(defaultWorkloadCatalogBaseUrl);
    setCustomReachable(null);
  }, [defaultWorkloadCatalogBaseUrl, setWorkloadCatalogBaseUrl]);

  useEffect(() => {
    const trimmed = workloadCatalogBaseUrl.trim();
    const isCustomUrl =
      trimmed.length > 0 &&
      trimmed.replace(/\/$/, "") !== defaultWorkloadCatalogBaseUrl.replace(/\/$/, "");

    if (!isCustomUrl) {
      setCustomReachable(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const base = parseWorkloadCatalogBaseUrlInput(trimmed);
          if (!base.ok || cancelled) {
            if (!cancelled) {
              setCustomReachable(false);
            }
            return;
          }
          const params = new URLSearchParams({ workloadCatalogBaseUrl: base.url });
          const response = await fetch(
            `${withAppBasePath("/api/workload-catalogue/status")}?${params.toString()}`,
            {
              cache: "no-store",
              credentials: "same-origin",
            },
          );
          if (!cancelled) {
            if (!response.ok) {
              setCustomReachable(false);
              return;
            }
            const payload = (await response.json()) as { connected?: boolean };
            setCustomReachable(payload.connected === true);
          }
        } catch {
          if (!cancelled) {
            setCustomReachable(false);
          }
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [defaultWorkloadCatalogBaseUrl, workloadCatalogBaseUrl]);

  const showCustomChip =
    workloadCatalogBaseUrl.trim().length > 0 &&
    workloadCatalogBaseUrl.replace(/\/$/, "") !==
      defaultWorkloadCatalogBaseUrl.replace(/\/$/, "");

  const isReachable = showCustomChip ? customReachable === true : workloadCatalogConnected;
  const isCheckingReachable = showCustomChip && customReachable === null;

  useEffect(() => {
    if (isCheckingReachable || !isReachable) {
      setWorkloads([]);
      setWorkloadsError(null);
      setIsLoadingWorkloads(false);
      return;
    }

    let cancelled = false;
    setIsLoadingWorkloads(true);
    setWorkloadsError(null);

    void (async () => {
      try {
        const params = new URLSearchParams();
        const trimmed = workloadCatalogBaseUrl.trim();
        if (trimmed) {
          params.set("workloadCatalogBaseUrl", trimmed);
        }
        const query = params.toString();
        const response = await fetch(
          `${withAppBasePath("/api/workload-catalogue/charts")}${query ? `?${query}` : ""}`,
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Failed to load workloads (${response.status}).`);
        }

        const payload = (await response.json()) as { workloads?: WorkloadCatalogEntry[] };
        if (!cancelled) {
          setWorkloads(payload.workloads ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setWorkloads([]);
          setWorkloadsError(
            error instanceof Error ? error.message : "Unable to load workloads right now.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWorkloads(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isCheckingReachable, isReachable, workloadCatalogBaseUrl]);

  const reachabilityChip = (
    <span
      className={`workspace-chip ${
        isCheckingReachable
          ? "workspace-chip-down"
          : isReachable
            ? "workspace-chip-live"
            : "workspace-chip-down"
      }`}
    >
      {isCheckingReachable ? "Checking…" : isReachable ? "Reachable" : "Unreachable"}
    </span>
  );

  return (
    <WorkspaceCollapsibleSection
      headerEnd={reachabilityChip}
      sectionId="workloads"
      title="Workloads"
    >
      <div className="workspace-stack">
        <article className="workspace-card">
          <div className="workspace-runner-field workspace-prometheus-url-field">
            <input
              aria-label="Workload catalogue base URL"
              className="workspace-input workspace-prometheus-url-input"
              id="workload-catalog-base-url"
              onChange={(event) => {
                setDraftUrl(event.target.value);
                setValidationError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyUrl();
                }
              }}
              placeholder={defaultWorkloadCatalogBaseUrl}
              spellCheck={false}
              type="url"
              value={draftUrl}
            />
          </div>
          {validationError ? (
            <p className="workspace-form-error" role="alert">
              {validationError}
            </p>
          ) : null}
          <div className="workspace-prometheus-url-actions">
            <button
              className="workspace-button workspace-button-secondary workspace-prometheus-url-action-button"
              onClick={applyUrl}
              type="button"
            >
              Apply
            </button>
            <button
              className="workspace-button workspace-button-secondary workspace-prometheus-url-action-button"
              onClick={resetToDefault}
              type="button"
            >
              Use server default
            </button>
          </div>
        </article>
        {isReachable ? (
          <>
            {isLoadingWorkloads ? (
              <p className="workspace-hint">Loading workloads…</p>
            ) : workloadsError ? (
              <p className="workspace-form-error" role="alert">
                {workloadsError}
              </p>
            ) : workloads.length === 0 ? (
              <p className="workspace-hint">No workloads found in the catalogue.</p>
            ) : (
              workloads.map((workload) => (
                <article className="workspace-card" key={workload.name}>
                  <strong>{workload.name}</strong>
                  {workload.version ? (
                    <p className="workspace-hint">Version {workload.version}</p>
                  ) : null}
                  {workload.description ? (
                    <p className="workspace-hint">{workload.description}</p>
                  ) : null}
                </article>
              ))
            )}
          </>
        ) : (
          <p className="workspace-hint">Workload catalogue is unreachable.</p>
        )}
      </div>
    </WorkspaceCollapsibleSection>
  );
}
