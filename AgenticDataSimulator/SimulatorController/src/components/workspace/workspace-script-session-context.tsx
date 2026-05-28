"use client";

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
  ownerUsername?: string;
};

export const DRAFT_TAB_KEY = "draft";

export function tabKeyForScript(id: string) {
  return `script:${id}`;
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
  /** Lines for the currently selected run (for the log dialog). */
  selectedRunLogLines: string[];
  beginScriptRun: (scriptName: string, input?: { mode?: "dry-run" | "execute"; scriptId?: string | null }) => void;
  appendRunnerLog: (entry: string) => void;
  endActiveScriptRun: (input: PersistRunLogInput) => Promise<void>;
  runLogDialogOpen: boolean;
  openRunLogDialog: () => void;
  closeRunLogDialog: () => void;
  /** Non-empty after a Run Script executes `extract metric-catalog` (flattened metric names); drives Agent assistant chips. */
  scriptExtractedMetricNames: string[];
  setScriptExtractedMetricNames: (names: string[]) => void;
};

const WorkspaceScriptSessionContext = createContext<WorkspaceScriptSessionContextValue | null>(
  null,
);

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
}: {
  children: ReactNode;
  selectedDomain: string;
  scripts: ServerScript[];
  draftContent: string;
  runLogsApiUrl: string;
}) {
  const [bundle, setBundle] = useState<Bundle>(() =>
    buildInitialTabs(draftContent, selectedDomain),
  );
  const [serverScripts, setServerScripts] = useState(scripts);
  const dirtyKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setServerScripts(scripts);
  }, [scripts]);

  const [scriptRunLogs, setScriptRunLogs] = useState<ScriptRunLogRecord[]>([]);
  const [selectedScriptRunId, setSelectedScriptRunId] = useState<string | null>(null);
  const [runLogDialogOpen, setRunLogDialogOpen] = useState(false);
  const [scriptExtractedMetricNames, setScriptExtractedMetricNames] = useState<string[]>([]);
  const activeRunRef = useRef<ActiveRunState | null>(null);

  const beginScriptRun = useCallback(
    (scriptName: string, input?: { mode?: "dry-run" | "execute"; scriptId?: string | null }) => {
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
    [],
  );

  const appendRunnerLog = useCallback((entry: string) => {
    const activeRun = activeRunRef.current;
    if (!activeRun) {
      return;
    }
    activeRun.lines = [...activeRun.lines, entry];
    setScriptRunLogs((prev) =>
      prev.map((r) =>
        r.id === activeRun.id ? { ...r, lines: activeRun.lines } : r,
      ),
    );
  }, []);

  const endActiveScriptRun = useCallback(
    async (input: PersistRunLogInput) => {
      const activeRun = activeRunRef.current;
      if (!activeRun || !runLogsApiUrl.trim()) {
        activeRunRef.current = null;
        return;
      }

      const lines = activeRun.lines;

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
        activeRunRef.current = null;
      }
    },
    [runLogsApiUrl, selectedDomain],
  );

  const openRunLogDialog = useCallback(() => {
    setRunLogDialogOpen(true);
  }, []);

  const closeRunLogDialog = useCallback(() => {
    setRunLogDialogOpen(false);
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
      dirtyKeysRef.current = new Set();
      setBundle(buildInitialTabs(draftContent, selectedDomain));
      setScriptExtractedMetricNames([]);
    }
  }, [selectedDomain, draftContent]);

  const serverById = useMemo(
    () => new Map(serverScripts.map((s) => [s.id, s])),
    [serverScripts],
  );

  const removeScriptFromList = useCallback((scriptId: string) => {
    setServerScripts((prev) => prev.filter((script) => script.id !== scriptId));
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
    if (!selectedScriptRunId) {
      return [];
    }
    return scriptRunLogs.find((r) => r.id === selectedScriptRunId)?.lines ?? [];
  }, [scriptRunLogs, selectedScriptRunId]);

  const value = useMemo(
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
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
      commitSavedTabContent,
      scriptRunLogs,
      selectedScriptRunId,
      setSelectedScriptRunId,
      selectedRunLogLines,
      beginScriptRun,
      appendRunnerLog,
      endActiveScriptRun,
      runLogDialogOpen,
      openRunLogDialog,
      closeRunLogDialog,
      scriptExtractedMetricNames,
      setScriptExtractedMetricNames,
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
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
      commitSavedTabContent,
      scriptRunLogs,
      selectedScriptRunId,
      selectedRunLogLines,
      beginScriptRun,
      appendRunnerLog,
      endActiveScriptRun,
      runLogDialogOpen,
      openRunLogDialog,
      closeRunLogDialog,
      scriptExtractedMetricNames,
      setScriptExtractedMetricNames,
    ],
  );

  return (
    <WorkspaceScriptSessionContext.Provider value={value}>
      {children}
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
