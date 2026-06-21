"use client";

import { invalidateLiteListCache } from "@/lib/intents/list-intents-cache";
import {
  clearScriptObservationMetrics,
  readScriptObservationMetrics,
  writeScriptObservationMetrics,
} from "@/lib/intents/script-observation-scope-storage";
import type { ObservationProgressSnapshot } from "@/lib/observation-agent/progress-types";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ServerScript = {
  id: string;
  name: string;
  content: string;
  userId: string;
  shared: boolean;
  createdAt?: string;
  ownerUsername?: string;
};

export const DRAFT_TAB_KEY = "draft";

export function tabKeyForScript(id: string) {
  return `script:${id}`;
}

/** Stable key for when the server script id set changes (not array reference). */
export function scriptListRevision(scripts: ServerScript[]): string {
  return scripts
    .map((script) => script.id)
    .sort()
    .join(",");
}

export function defaultScriptName(domain: string) {
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.workspace.control.dsl`;
}

/** Visible label for run history: "<script name>: dd/mm hh.mm" (local time). */
export function formatScriptRunListLabel(scriptName: string, startedAtMs: number): string {
  const d = new Date(startedAtMs);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${scriptName}: ${day}/${month} ${hour}.${minute}`;
}

export type ScriptRunLogRecord = {
  id: string;
  scriptName: string;
  startedAt: number;
  lines: string[];
};

type ActiveRunState = {
  id: string;
  scriptName: string;
  startedAt: number;
  mode: "dry-run" | "execute";
  scriptId: string | null;
  lines: string[];
};

type PersistRunLogInput = {
  mode: "dry-run" | "execute";
  scriptId?: string | null;
};

type OpenTab = {
  tabKey: string;
  scriptId: string | null;
  name: string;
};

type Bundle = {
  openTabs: OpenTab[];
  documents: Record<string, string>;
  activeTabKey: string;
};

export type WorkspaceScriptSessionContextValue = {
  selectedDomain: string;
  scriptsFromServer: ServerScript[];
  draftContentTemplate: string;
  openTabs: OpenTab[];
  activeTabKey: string;
  activeContent: string;
  activeScriptId: string | null;
  activeScriptName: string;
  setActiveContent: (content: string) => void;
  openScriptTab: (script: ServerScript) => void;
  /** Remove a script from the sidebar list after a successful DELETE. */
  removeScriptFromList: (scriptId: string) => void;
  /** Replace the sidebar script list (e.g. after refetching GET /api/scripts). */
  replaceServerScripts: (scripts: ServerScript[]) => void;
  selectTab: (tabKey: string) => void;
  closeTab: (tabKey: string) => void;
  migrateDraftTabToSavedScript: (scriptId: string, name: string) => void;
  clearDirtyForKeys: (keys: string[]) => void;
  /** Pin editor content after a successful save before server props refresh. */
  commitSavedTabContent: (tabKey: string, content: string) => void;
  /** Last 10 runs, newest first. */
  scriptRunLogs: ScriptRunLogRecord[];
  selectedScriptRunId: string | null;
  setSelectedScriptRunId: (id: string | null) => void;
  beginScriptRun: (scriptName: string, input?: { mode?: "dry-run" | "execute"; scriptId?: string | null }) => void;
  appendRunnerLog: (entry: string) => void;
  endActiveScriptRun: (input: PersistRunLogInput) => Promise<void>;
  openRunLogDialog: () => void;
  closeRunLogDialog: () => void;
  deleteSelectedScriptRunLog: () => Promise<void>;
  deleteAllScriptRunLogs: () => Promise<void>;
  /** Non-empty after a Run Script executes `extract metric-catalog` (flattened metric names); drives Agent assistant chips. */
  scriptExtractedMetricNames: string[];
  setScriptExtractedMetricNames: (names: string[]) => void;
  /** Non-empty after Show metrics previews catalogue stems for a create-intent prompt. */
  workloadPreviewMetricStems: string[];
  setWorkloadPreviewMetricStems: (stems: string[]) => void;
  /** Bumps when GraphDB/Prometheus storage changes (e.g. KG emptied) so panels can refresh. */
  storageRefreshNonce: number;
  notifyStorageChanged: () => void;
  /** True while KG or Prometheus data is being deleted or emptied. */
  storageDeletionInProgress: boolean;
  beginStorageDeletion: () => void;
  endStorageDeletion: () => void;
  /** True while Run Script is executing. */
  scriptRunInProgress: boolean;
  setScriptRunInProgress: (busy: boolean) => void;
  /** True while the observation-report A2A dialog is open. */
  observationGenerationActive: boolean;
  setObservationGenerationActive: (active: boolean) => void;
  /** Intent ids registered during the current session that may still be receiving observations. */
  markIntentAwaitingObservation: (intentId: string) => void;
  clearIntentAwaitingObservation: (intentId: string) => void;
  intentIdsAwaitingObservation: ReadonlySet<string>;
  /** Intent ids with historic synthetic observation in flight (tick progress UI). */
  historicObservationIntentIds: ReadonlySet<string>;
  historicObservationMetricsByIntentId: Readonly<Record<string, readonly string[]>>;
  /** Epoch ms when the Controller started waiting for historic observation progress per intent. */
  historicObservationAwaitingSinceByIntentId: Readonly<Record<string, number>>;
  markHistoricObservationIntent: (intentId: string, compoundMetrics?: readonly string[]) => void;
  clearHistoricObservationIntent: (intentId: string) => void;
  observationProgressByIntentId: Readonly<Record<string, ObservationProgressSnapshot>>;
  setObservationProgressForIntent: (
    intentId: string,
    progress: ObservationProgressSnapshot | null,
  ) => void;
  /** Server default from PROMETHEUS_URL (read-only hint in UI). */
  defaultPrometheusBaseUrl: string;
  /** User override for Prometheus API base URL (localStorage + used in metadata inserts). */
  prometheusBaseUrl: string;
  setPrometheusBaseUrl: (url: string) => void;
  /** Server default from GRAPHDB_BASE_URL (read-only hint in UI). */
  defaultGraphDbBaseUrl: string;
  /** User override for GraphDB API base URL (localStorage + used in KG operations). */
  graphDbBaseUrl: string;
  setGraphDbBaseUrl: (url: string) => void;
  /** Server default from WORKLOAD_CATALOG_BASE_URL (read-only hint in UI). */
  defaultWorkloadCatalogBaseUrl: string;
  /** User override for workload catalogue base URL (localStorage). */
  workloadCatalogBaseUrl: string;
  setWorkloadCatalogBaseUrl: (url: string) => void;
};

const WorkspaceScriptSessionContext = createContext<WorkspaceScriptSessionContextValue | null>(
  null,
);

type WorkspaceRunLogUiContextValue = {
  selectedRunLogLines: string[];
  runLogDialogOpen: boolean;
};

const WorkspaceRunLogUiContext = createContext<WorkspaceRunLogUiContextValue | null>(null);

function buildInitialTabs(draftBody: string, domain: string): Bundle {
  const defaultName = defaultScriptName(domain);
  return {
    openTabs: [{ tabKey: DRAFT_TAB_KEY, scriptId: null, name: defaultName }],
    documents: { [DRAFT_TAB_KEY]: draftBody },
    activeTabKey: DRAFT_TAB_KEY,
  };
}

export function WorkspaceScriptSessionProvider({
  children,
  selectedDomain,
  scripts,
  draftContent,
  runLogsApiUrl,
  currentUserId,
  defaultPrometheusBaseUrl,
  defaultGraphDbBaseUrl,
  defaultWorkloadCatalogBaseUrl,
}: {
  children: ReactNode;
  selectedDomain: string;
  scripts: ServerScript[];
  draftContent: string;
  runLogsApiUrl: string;
  currentUserId: string;
  defaultPrometheusBaseUrl: string;
  defaultGraphDbBaseUrl: string;
  defaultWorkloadCatalogBaseUrl: string;
}) {
  const [bundle, setBundle] = useState<Bundle>(() =>
    buildInitialTabs(draftContent, selectedDomain),
  );
  const [serverScripts, setServerScripts] = useState(scripts);
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const removedScriptIdsRef = useRef<Set<string>>(new Set());
  const scriptsRevision = useMemo(() => scriptListRevision(scripts), [scripts]);
  const prevScriptsRevisionRef = useRef(scriptsRevision);

  const applyScriptsFromProps = useCallback((incoming: ServerScript[]) => {
    const filtered = incoming.filter((script) => !removedScriptIdsRef.current.has(script.id));
    prevScriptsRevisionRef.current = scriptListRevision(filtered);
    setServerScripts(filtered);
  }, []);

  useEffect(() => {
    if (prevScriptsRevisionRef.current === scriptsRevision) {
      return;
    }
    applyScriptsFromProps(scripts);
  }, [scripts, scriptsRevision, applyScriptsFromProps]);

  const [scriptRunLogs, setScriptRunLogs] = useState<ScriptRunLogRecord[]>([]);
  const [selectedScriptRunId, setSelectedScriptRunId] = useState<string | null>(null);
  const [runLogDialogOpen, setRunLogDialogOpen] = useState(false);
  const [scriptExtractedMetricNames, setScriptExtractedMetricNames] = useState<string[]>([]);
  const [workloadPreviewMetricStems, setWorkloadPreviewMetricStems] = useState<string[]>([]);
  const [storageRefreshNonce, setStorageRefreshNonce] = useState(0);
  const storageDeletionCountRef = useRef(0);
  const [storageDeletionInProgress, setStorageDeletionInProgress] = useState(false);
  const [scriptRunInProgress, setScriptRunInProgress] = useState(false);
  const [observationGenerationActive, setObservationGenerationActive] = useState(false);
  const [intentIdsAwaitingObservation, setIntentIdsAwaitingObservation] = useState<Set<string>>(
    () => new Set(),
  );
  const [historicObservationIntentIds, setHistoricObservationIntentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [historicObservationMetricsByIntentId, setHistoricObservationMetricsByIntentId] =
    useState<Record<string, string[]>>(() => readScriptObservationMetrics(selectedDomain));
  const [historicObservationAwaitingSinceByIntentId, setHistoricObservationAwaitingSinceByIntentId] =
    useState<Record<string, number>>({});
  const [observationProgressByIntentId, setObservationProgressByIntentId] = useState<
    Record<string, ObservationProgressSnapshot>
  >({});
  const prometheusStorageKey = useMemo(
    () => `simulator-controller:prometheus-base-url:${currentUserId}`,
    [currentUserId],
  );
  const [prometheusBaseUrl, setPrometheusBaseUrlState] = useState(defaultPrometheusBaseUrl);
  const graphDbStorageKey = useMemo(
    () => `simulator-controller:graphdb-base-url:${currentUserId}`,
    [currentUserId],
  );
  const [graphDbBaseUrl, setGraphDbBaseUrlState] = useState(defaultGraphDbBaseUrl);
  const workloadCatalogStorageKey = useMemo(
    () => `simulator-controller:workload-catalog-base-url:${currentUserId}`,
    [currentUserId],
  );
  const [workloadCatalogBaseUrl, setWorkloadCatalogBaseUrlState] = useState(
    defaultWorkloadCatalogBaseUrl,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(prometheusStorageKey)?.trim();
    if (stored) {
      setPrometheusBaseUrlState(stored);
    } else {
      setPrometheusBaseUrlState(defaultPrometheusBaseUrl);
    }
  }, [defaultPrometheusBaseUrl, prometheusStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(graphDbStorageKey)?.trim();
    if (stored) {
      setGraphDbBaseUrlState(stored);
    } else {
      setGraphDbBaseUrlState(defaultGraphDbBaseUrl);
    }
  }, [defaultGraphDbBaseUrl, graphDbStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(workloadCatalogStorageKey)?.trim();
    if (stored) {
      setWorkloadCatalogBaseUrlState(stored);
    } else {
      setWorkloadCatalogBaseUrlState(defaultWorkloadCatalogBaseUrl);
    }
  }, [defaultWorkloadCatalogBaseUrl, workloadCatalogStorageKey]);

  const setPrometheusBaseUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      setPrometheusBaseUrlState(trimmed);
      if (typeof window !== "undefined") {
        if (trimmed) {
          window.localStorage.setItem(prometheusStorageKey, trimmed);
        } else {
          window.localStorage.removeItem(prometheusStorageKey);
        }
      }
    },
    [prometheusStorageKey],
  );

  const setGraphDbBaseUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      setGraphDbBaseUrlState(trimmed);
      if (typeof window !== "undefined") {
        if (trimmed) {
          window.localStorage.setItem(graphDbStorageKey, trimmed);
        } else {
          window.localStorage.removeItem(graphDbStorageKey);
        }
      }
    },
    [graphDbStorageKey],
  );

  const setWorkloadCatalogBaseUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      setWorkloadCatalogBaseUrlState(trimmed);
      if (typeof window !== "undefined") {
        if (trimmed) {
          window.localStorage.setItem(workloadCatalogStorageKey, trimmed);
        } else {
          window.localStorage.removeItem(workloadCatalogStorageKey);
        }
      }
    },
    [workloadCatalogStorageKey],
  );

  /** Bumps when the active run log buffer changes and the log dialog should repaint. */
  const [liveRunLogRevision, setLiveRunLogRevision] = useState(0);
  const activeRunRef = useRef<ActiveRunState | null>(null);
  const runLogDialogOpenRef = useRef(false);
  const liveRunLogFlushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    runLogDialogOpenRef.current = runLogDialogOpen;
  }, [runLogDialogOpen]);

  useEffect(() => {
    return () => {
      if (liveRunLogFlushTimerRef.current !== undefined) {
        clearTimeout(liveRunLogFlushTimerRef.current);
      }
    };
  }, []);

  const bumpLiveRunLogRevision = useCallback(() => {
    setLiveRunLogRevision((revision) => revision + 1);
  }, []);

  const scheduleLiveRunLogRevision = useCallback(() => {
    if (liveRunLogFlushTimerRef.current !== undefined) {
      return;
    }
    liveRunLogFlushTimerRef.current = setTimeout(() => {
      liveRunLogFlushTimerRef.current = undefined;
      bumpLiveRunLogRevision();
    }, 200);
  }, [bumpLiveRunLogRevision]);

  const syncActiveRunLinesToList = useCallback(() => {
    const activeRun = activeRunRef.current;
    if (!activeRun) {
      return;
    }
    setScriptRunLogs((prev) =>
      prev.map((run) =>
        run.id === activeRun.id ? { ...run, lines: activeRun.lines } : run,
      ),
    );
  }, []);

  const resetScriptObservationScope = useCallback(() => {
    setHistoricObservationMetricsByIntentId({});
    setHistoricObservationIntentIds(new Set());
    setHistoricObservationAwaitingSinceByIntentId({});
    setObservationProgressByIntentId({});
    setIntentIdsAwaitingObservation(new Set());
    clearScriptObservationMetrics(selectedDomain);
  }, [selectedDomain]);

  const beginScriptRun = useCallback(
    (scriptName: string, input?: { mode?: "dry-run" | "execute"; scriptId?: string | null }) => {
      resetScriptObservationScope();
      const id =
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const startedAt = Date.now();
      activeRunRef.current = {
        id,
        scriptName,
        startedAt,
        mode: input?.mode ?? "execute",
        scriptId: input?.scriptId ?? null,
        lines: [],
      };
      setScriptRunLogs((prev) =>
        [{ id, scriptName, startedAt, lines: [] }, ...prev].slice(0, 10),
      );
      setSelectedScriptRunId(id);
    },
    [resetScriptObservationScope],
  );

  const appendRunnerLog = useCallback(
    (entry: string) => {
      const activeRun = activeRunRef.current;
      if (!activeRun) {
        return;
      }
      activeRun.lines = [...activeRun.lines, entry];
      syncActiveRunLinesToList();
      if (runLogDialogOpenRef.current) {
        scheduleLiveRunLogRevision();
      }
    },
    [scheduleLiveRunLogRevision, syncActiveRunLinesToList],
  );

  const endActiveScriptRun = useCallback(
    async (input: PersistRunLogInput) => {
      const activeRun = activeRunRef.current;
      if (!activeRun || !runLogsApiUrl.trim()) {
        activeRunRef.current = null;
        return;
      }

      const lines = activeRun.lines;
      let persistedToServer = false;

      try {
        const response = await fetch(runLogsApiUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain: selectedDomain,
            scriptName: activeRun.scriptName,
            scriptId: input.scriptId ?? activeRun.scriptId ?? undefined,
            mode: input.mode,
            lines,
            startedAt: new Date(activeRun.startedAt).toISOString(),
          }),
        });

        if (response.ok) {
          const body = (await response.json()) as {
            runLog?: {
              id: string;
              scriptName: string;
              lines: string[];
              startedAt: string;
            };
          };
          const persisted = body.runLog;
          if (persisted) {
            persistedToServer = true;
            setScriptRunLogs((prev) => {
              const withoutActive = prev.filter((run) => run.id !== activeRun.id);
              return [
                {
                  id: persisted.id,
                  scriptName: persisted.scriptName,
                  startedAt: new Date(persisted.startedAt).getTime(),
                  lines: persisted.lines,
                },
                ...withoutActive,
              ].slice(0, 10);
            });
            setSelectedScriptRunId(persisted.id);
          }
        }
      } catch {
        // Keep in-memory log if persistence fails.
      } finally {
        if (!persistedToServer) {
          syncActiveRunLinesToList();
        }
        activeRunRef.current = null;
        bumpLiveRunLogRevision();
      }
    },
    [bumpLiveRunLogRevision, runLogsApiUrl, selectedDomain, syncActiveRunLinesToList],
  );

  const openRunLogDialog = useCallback(() => {
    runLogDialogOpenRef.current = true;
    syncActiveRunLinesToList();
    bumpLiveRunLogRevision();
    setRunLogDialogOpen(true);
  }, [bumpLiveRunLogRevision, syncActiveRunLinesToList]);

  const closeRunLogDialog = useCallback(() => {
    runLogDialogOpenRef.current = false;
    setRunLogDialogOpen(false);
  }, []);

  const deleteSelectedScriptRunLog = useCallback(async () => {
    const runId = selectedScriptRunId;
    if (!runId) {
      return;
    }

    const run = scriptRunLogs.find((entry) => entry.id === runId);
    if (!run) {
      return;
    }

    const label = formatScriptRunListLabel(run.scriptName, run.startedAt);
    if (
      !window.confirm(
        `Delete the selected run script log "${label}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    if (runLogsApiUrl.trim()) {
      try {
        const params = new URLSearchParams({ domain: selectedDomain });
        const response = await fetch(
          `${runLogsApiUrl}/${encodeURIComponent(runId)}?${params.toString()}`,
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        );
        if (!response.ok && response.status !== 404) {
          const body = await response.json().catch(() => ({}));
          const message =
            typeof body?.error === "string"
              ? body.error
              : `Delete failed (${response.status})`;
          window.alert(message);
          return;
        }
      } catch {
        window.alert("Delete failed.");
        return;
      }
    }

    if (activeRunRef.current?.id === runId) {
      activeRunRef.current = null;
    }
    setScriptRunLogs((prev) => prev.filter((entry) => entry.id !== runId));
    if (runLogDialogOpenRef.current) {
      setRunLogDialogOpen(false);
    }
    bumpLiveRunLogRevision();
  }, [
    bumpLiveRunLogRevision,
    runLogsApiUrl,
    scriptRunLogs,
    selectedDomain,
    selectedScriptRunId,
  ]);

  const deleteAllScriptRunLogs = useCallback(async () => {
    if (scriptRunLogs.length === 0) {
      return;
    }

    if (
      !window.confirm(
        `Delete all run script logs (${scriptRunLogs.length})? This cannot be undone.`,
      )
    ) {
      return;
    }

    if (runLogsApiUrl.trim()) {
      try {
        const params = new URLSearchParams({ domain: selectedDomain });
        const response = await fetch(`${runLogsApiUrl}?${params.toString()}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const message =
            typeof body?.error === "string"
              ? body.error
              : `Delete failed (${response.status})`;
          window.alert(message);
          return;
        }
      } catch {
        window.alert("Delete failed.");
        return;
      }
    }

    activeRunRef.current = null;
    setScriptRunLogs([]);
    setRunLogDialogOpen(false);
    bumpLiveRunLogRevision();
  }, [bumpLiveRunLogRevision, runLogsApiUrl, scriptRunLogs.length, selectedDomain]);

  const notifyStorageChanged = useCallback(() => {
    invalidateLiteListCache();
    setStorageRefreshNonce((nonce) => nonce + 1);
  }, []);

  const markIntentAwaitingObservation = useCallback((intentId: string) => {
    const trimmed = intentId.trim();
    if (!trimmed) {
      return;
    }
    setIntentIdsAwaitingObservation((current) => {
      if (current.has(trimmed)) {
        return current;
      }
      const next = new Set(current);
      next.add(trimmed);
      return next;
    });
  }, []);

  const markHistoricObservationIntent = useCallback(
    (intentId: string, compoundMetrics?: readonly string[]) => {
      const trimmed = intentId.trim();
      if (!trimmed) {
        return;
      }
      const now = Date.now();
      setHistoricObservationIntentIds((current) => {
        if (current.has(trimmed)) {
          return current;
        }
        const next = new Set(current);
        next.add(trimmed);
        return next;
      });
      setHistoricObservationAwaitingSinceByIntentId((current) => {
        if (current[trimmed] !== undefined) {
          return current;
        }
        return { ...current, [trimmed]: now };
      });
      if (!compoundMetrics?.length) {
        return;
      }
      setHistoricObservationMetricsByIntentId((current) => {
        const prev = current[trimmed] ?? [];
        const merged = [...new Set([...prev, ...compoundMetrics.map((m) => m.trim()).filter(Boolean)])];
        if (
          merged.length === prev.length &&
          merged.every((metric, index) => metric === prev[index])
        ) {
          return current;
        }
        const next = { ...current, [trimmed]: merged };
        writeScriptObservationMetrics(selectedDomain, next);
        return next;
      });
    },
    [selectedDomain],
  );

  const clearHistoricObservationIntent = useCallback((intentId: string) => {
    const trimmed = intentId.trim();
    if (!trimmed) {
      return;
    }
    setHistoricObservationIntentIds((current) => {
      if (!current.has(trimmed)) {
        return current;
      }
      const next = new Set(current);
      next.delete(trimmed);
      return next;
    });
    setObservationProgressByIntentId((current) => {
      if (!(trimmed in current)) {
        return current;
      }
      const next = { ...current };
      delete next[trimmed];
      return next;
    });
    setHistoricObservationAwaitingSinceByIntentId((current) => {
      if (!(trimmed in current)) {
        return current;
      }
      const next = { ...current };
      delete next[trimmed];
      return next;
    });
  }, []);

  const clearIntentAwaitingObservation = useCallback((intentId: string) => {
    const trimmed = intentId.trim();
    if (!trimmed) {
      return;
    }
    setIntentIdsAwaitingObservation((current) => {
      if (!current.has(trimmed)) {
        return current;
      }
      const next = new Set(current);
      next.delete(trimmed);
      return next;
    });
    clearHistoricObservationIntent(trimmed);
  }, [clearHistoricObservationIntent]);

  const setObservationProgressForIntent = useCallback(
    (intentId: string, progress: ObservationProgressSnapshot | null) => {
      const trimmed = intentId.trim();
      if (!trimmed) {
        return;
      }
      if (progress && progress.mode !== "historic") {
        return;
      }
      setObservationProgressByIntentId((current) => {
        if (!progress) {
          if (!(trimmed in current)) {
            return current;
          }
          const next = { ...current };
          delete next[trimmed];
          return next;
        }
        return { ...current, [trimmed]: progress };
      });
    },
    [],
  );

  const beginStorageDeletion = useCallback(() => {
    storageDeletionCountRef.current += 1;
    setStorageDeletionInProgress(true);
  }, []);

  const endStorageDeletion = useCallback(() => {
    storageDeletionCountRef.current = Math.max(0, storageDeletionCountRef.current - 1);
    setStorageDeletionInProgress(storageDeletionCountRef.current > 0);
  }, []);

  useLayoutEffect(() => {
    activeRunRef.current = null;
    if (!runLogsApiUrl.trim()) {
      setScriptRunLogs([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const params = new URLSearchParams({ domain: selectedDomain });
        const response = await fetch(`${runLogsApiUrl}?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as {
          runLogs?: Array<{
            id: string;
            scriptName: string;
            lines: string[];
            startedAt: string;
          }>;
        };
        if (cancelled) {
          return;
        }
        setScriptRunLogs(
          (body.runLogs ?? []).map((run) => ({
            id: run.id,
            scriptName: run.scriptName,
            startedAt: new Date(run.startedAt).getTime(),
            lines: run.lines,
          })),
        );
      } catch {
        if (!cancelled) {
          setScriptRunLogs([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runLogsApiUrl, selectedDomain]);

  useEffect(() => {
    if (scriptRunLogs.length === 0) {
      setSelectedScriptRunId(null);
      return;
    }
    setSelectedScriptRunId((prev) => {
      if (prev && scriptRunLogs.some((r) => r.id === prev)) {
        return prev;
      }
      return scriptRunLogs[0]?.id ?? null;
    });
  }, [scriptRunLogs]);

  const prevDomainRef = useRef(selectedDomain);
  useEffect(() => {
    if (prevDomainRef.current !== selectedDomain) {
      prevDomainRef.current = selectedDomain;
      removedScriptIdsRef.current = new Set();
      dirtyKeysRef.current = new Set();
      applyScriptsFromProps(scripts);
      setBundle(buildInitialTabs(draftContent, selectedDomain));
      setScriptExtractedMetricNames([]);
      setWorkloadPreviewMetricStems([]);
      setHistoricObservationMetricsByIntentId(readScriptObservationMetrics(selectedDomain));
    }
  }, [selectedDomain, draftContent, scripts, applyScriptsFromProps]);

  const serverById = useMemo(
    () => new Map(serverScripts.map((s) => [s.id, s])),
    [serverScripts],
  );

  const removeScriptFromList = useCallback((scriptId: string) => {
    removedScriptIdsRef.current.add(scriptId);
    setServerScripts((prev) => {
      const next = prev.filter((script) => script.id !== scriptId);
      prevScriptsRevisionRef.current = scriptListRevision(next);
      return next;
    });
  }, []);

  const replaceServerScripts = useCallback((next: ServerScript[]) => {
    const removed = removedScriptIdsRef.current;
    for (const script of next) {
      removed.delete(script.id);
    }
    prevScriptsRevisionRef.current = scriptListRevision(next);
    setServerScripts(next);
  }, []);

  useEffect(() => {
    setBundle((prev) => {
      const serverIds = new Set(serverScripts.map((s) => s.id));

      let nextTabs = prev.openTabs.filter(
        (t) => t.scriptId === null || serverIds.has(t.scriptId),
      );

      if (nextTabs.length === 0) {
        dirtyKeysRef.current = new Set();
        return buildInitialTabs(draftContent, selectedDomain);
      }

      nextTabs = nextTabs.map((tab) => {
        if (tab.scriptId && serverById.has(tab.scriptId)) {
          const s = serverById.get(tab.scriptId)!;
          return { ...tab, name: s.name };
        }
        return tab;
      });

      let nextActive = prev.activeTabKey;
      if (!nextTabs.some((t) => t.tabKey === nextActive)) {
        nextActive = nextTabs[0]?.tabKey ?? DRAFT_TAB_KEY;
      }

      let nextDocs = { ...prev.documents };
      for (const tab of nextTabs) {
        if (!tab.scriptId) {
          continue;
        }
        const tk = tabKeyForScript(tab.scriptId);
        const serverScript = serverById.get(tab.scriptId);
        if (!serverScript) {
          continue;
        }
        // Keep in-memory editor content once a tab has been opened or edited.
        // After save, router.refresh() may briefly supply stale server props; overwriting
        // a non-dirty tab here would revert the editor even though disk was updated.
        if (!dirtyKeysRef.current.has(tk) && nextDocs[tk] === undefined) {
          nextDocs = { ...nextDocs, [tk]: serverScript.content };
        }
      }

      const allowedKeys = new Set(nextTabs.map((t) => t.tabKey));
      nextDocs = Object.fromEntries(
        Object.entries(nextDocs).filter(([k]) => allowedKeys.has(k)),
      );

      return {
        openTabs: nextTabs,
        documents: nextDocs,
        activeTabKey: nextActive,
      };
    });
  }, [serverScripts, draftContent, selectedDomain, serverById]);

  const { openTabs, documents, activeTabKey } = bundle;

  const activeTab = openTabs.find((t) => t.tabKey === activeTabKey) ?? openTabs[0];

  const activeScriptId = activeTab?.scriptId ?? null;
  const activeScriptName = activeTab?.name ?? defaultScriptName(selectedDomain);

  const activeContent = useMemo(() => {
    if (!activeTab) {
      return "";
    }
    const key = activeTab.tabKey;
    const stored = documents[key];
    if (stored !== undefined) {
      return stored;
    }
    if (key === DRAFT_TAB_KEY) {
      return draftContent;
    }
    if (activeTab.scriptId && serverById.has(activeTab.scriptId)) {
      return serverById.get(activeTab.scriptId)!.content;
    }
    return "";
  }, [activeTab, documents, draftContent, serverById]);

  const setActiveContent = useCallback((content: string) => {
    setBundle((prev) => {
      const tabKey = prev.activeTabKey;
      dirtyKeysRef.current.add(tabKey);
      return {
        ...prev,
        documents: { ...prev.documents, [tabKey]: content },
      };
    });
  }, []);

  const openScriptTab = useCallback((script: ServerScript) => {
    const tk = tabKeyForScript(script.id);
    dirtyKeysRef.current.delete(tk);
    setBundle((prev) => {
      const exists = prev.openTabs.some((t) => t.tabKey === tk);
      const nextTabs = exists
        ? prev.openTabs
        : [...prev.openTabs, { tabKey: tk, scriptId: script.id, name: script.name }];
      const nextDocs = {
        ...prev.documents,
        [tk]: prev.documents[tk] ?? script.content,
      };
      return {
        openTabs: nextTabs,
        documents: nextDocs,
        activeTabKey: tk,
      };
    });
  }, []);

  const selectTab = useCallback((tabKey: string) => {
    setBundle((prev) => {
      if (!prev.openTabs.some((t) => t.tabKey === tabKey)) {
        return prev;
      }
      return { ...prev, activeTabKey: tabKey };
    });
  }, []);

  const closeTab = useCallback((tabKey: string) => {
    setBundle((prev) => {
      if (prev.openTabs.length <= 1) {
        return prev;
      }
      const idx = prev.openTabs.findIndex((t) => t.tabKey === tabKey);
      if (idx === -1) {
        return prev;
      }
      dirtyKeysRef.current.delete(tabKey);
      const nextTabs = prev.openTabs.filter((t) => t.tabKey !== tabKey);
      const nextDocs = { ...prev.documents };
      delete nextDocs[tabKey];

      let nextActive = prev.activeTabKey;
      if (nextActive === tabKey) {
        const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
        nextActive = fallback.tabKey;
      }

      return {
        openTabs: nextTabs,
        documents: nextDocs,
        activeTabKey: nextActive,
      };
    });
  }, []);

  const migrateDraftTabToSavedScript = useCallback((scriptId: string, name: string) => {
    const tk = tabKeyForScript(scriptId);
    dirtyKeysRef.current.delete(DRAFT_TAB_KEY);
    dirtyKeysRef.current.delete(tk);
    setBundle((prev) => {
      const draftBody = prev.documents[DRAFT_TAB_KEY] ?? "";
      const nextTabs = prev.openTabs.map((t) =>
        t.tabKey === DRAFT_TAB_KEY ? { tabKey: tk, scriptId, name } : t,
      );
      const nextDocs = { ...prev.documents };
      delete nextDocs[DRAFT_TAB_KEY];
      nextDocs[tk] = draftBody;
      return {
        openTabs: nextTabs,
        documents: nextDocs,
        activeTabKey: tk,
      };
    });
  }, []);

  const clearDirtyForKeys = useCallback((keys: string[]) => {
    for (const k of keys) {
      dirtyKeysRef.current.delete(k);
    }
  }, []);

  const commitSavedTabContent = useCallback((tabKey: string, content: string) => {
    dirtyKeysRef.current.delete(tabKey);
    setBundle((prev) => ({
      ...prev,
      documents: { ...prev.documents, [tabKey]: content },
    }));
  }, []);

  const selectedRunLogLines = useMemo(() => {
    void liveRunLogRevision;
    if (!selectedScriptRunId) {
      return [];
    }
    const activeRun = activeRunRef.current;
    if (activeRun?.id === selectedScriptRunId) {
      return activeRun.lines;
    }
    return scriptRunLogs.find((r) => r.id === selectedScriptRunId)?.lines ?? [];
  }, [liveRunLogRevision, scriptRunLogs, selectedScriptRunId]);

  const sessionValue = useMemo(
    (): WorkspaceScriptSessionContextValue => ({
      selectedDomain,
      scriptsFromServer: serverScripts,
      draftContentTemplate: draftContent,
      openTabs,
      activeTabKey,
      activeContent,
      activeScriptId,
      activeScriptName,
      setActiveContent,
      openScriptTab,
      removeScriptFromList,
      replaceServerScripts,
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
      commitSavedTabContent,
      scriptRunLogs,
      selectedScriptRunId,
      setSelectedScriptRunId,
      beginScriptRun,
      appendRunnerLog,
      endActiveScriptRun,
      openRunLogDialog,
      closeRunLogDialog,
      deleteSelectedScriptRunLog,
      deleteAllScriptRunLogs,
      scriptExtractedMetricNames,
      setScriptExtractedMetricNames,
      workloadPreviewMetricStems,
      setWorkloadPreviewMetricStems,
      storageRefreshNonce,
      notifyStorageChanged,
      storageDeletionInProgress,
      beginStorageDeletion,
      endStorageDeletion,
      scriptRunInProgress,
      setScriptRunInProgress,
      observationGenerationActive,
      setObservationGenerationActive,
      markIntentAwaitingObservation,
      clearIntentAwaitingObservation,
      intentIdsAwaitingObservation,
      historicObservationIntentIds,
      historicObservationMetricsByIntentId,
      historicObservationAwaitingSinceByIntentId,
      markHistoricObservationIntent,
      clearHistoricObservationIntent,
      observationProgressByIntentId,
      setObservationProgressForIntent,
      defaultPrometheusBaseUrl,
      prometheusBaseUrl,
      setPrometheusBaseUrl,
      defaultGraphDbBaseUrl,
      graphDbBaseUrl,
      setGraphDbBaseUrl,
      defaultWorkloadCatalogBaseUrl,
      workloadCatalogBaseUrl,
      setWorkloadCatalogBaseUrl,
    }),
    [
      selectedDomain,
      serverScripts,
      draftContent,
      openTabs,
      activeTabKey,
      activeContent,
      activeScriptId,
      activeScriptName,
      setActiveContent,
      openScriptTab,
      removeScriptFromList,
      replaceServerScripts,
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
      commitSavedTabContent,
      scriptRunLogs,
      selectedScriptRunId,
      beginScriptRun,
      appendRunnerLog,
      endActiveScriptRun,
      openRunLogDialog,
      closeRunLogDialog,
      deleteSelectedScriptRunLog,
      deleteAllScriptRunLogs,
      scriptExtractedMetricNames,
      setScriptExtractedMetricNames,
      workloadPreviewMetricStems,
      setWorkloadPreviewMetricStems,
      storageRefreshNonce,
      notifyStorageChanged,
      storageDeletionInProgress,
      beginStorageDeletion,
      endStorageDeletion,
      scriptRunInProgress,
      observationGenerationActive,
      markIntentAwaitingObservation,
      clearIntentAwaitingObservation,
      intentIdsAwaitingObservation,
      historicObservationIntentIds,
      historicObservationMetricsByIntentId,
      historicObservationAwaitingSinceByIntentId,
      markHistoricObservationIntent,
      clearHistoricObservationIntent,
      observationProgressByIntentId,
      setObservationProgressForIntent,
      defaultPrometheusBaseUrl,
      prometheusBaseUrl,
      setPrometheusBaseUrl,
      defaultGraphDbBaseUrl,
      graphDbBaseUrl,
      setGraphDbBaseUrl,
      defaultWorkloadCatalogBaseUrl,
      workloadCatalogBaseUrl,
      setWorkloadCatalogBaseUrl,
    ],
  );

  const runLogUiValue = useMemo(
    (): WorkspaceRunLogUiContextValue => ({
      selectedRunLogLines,
      runLogDialogOpen,
    }),
    [runLogDialogOpen, selectedRunLogLines],
  );

  return (
    <WorkspaceScriptSessionContext.Provider value={sessionValue}>
      <WorkspaceRunLogUiContext.Provider value={runLogUiValue}>
        {children}
      </WorkspaceRunLogUiContext.Provider>
    </WorkspaceScriptSessionContext.Provider>
  );
}

export function useWorkspaceScriptSession(): WorkspaceScriptSessionContextValue {
  const ctx = useContext(WorkspaceScriptSessionContext);
  if (!ctx) {
    throw new Error("useWorkspaceScriptSession must be used within WorkspaceScriptSessionProvider");
  }
  return ctx;
}

export function useWorkspaceRunLogUi(): WorkspaceRunLogUiContextValue {
  const ctx = useContext(WorkspaceRunLogUiContext);
  if (!ctx) {
    throw new Error("useWorkspaceRunLogUi must be used within WorkspaceScriptSessionProvider");
  }
  return ctx;
}
