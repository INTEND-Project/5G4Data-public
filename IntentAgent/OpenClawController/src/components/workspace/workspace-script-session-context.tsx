"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ServerScript = {
  id: string;
  name: string;
  content: string;
};

export const DRAFT_TAB_KEY = "draft";

export function tabKeyForScript(id: string) {
  return `script:${id}`;
}

export function defaultScriptName(domain: string) {
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.workspace.control.dsl`;
}

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
  selectTab: (tabKey: string) => void;
  closeTab: (tabKey: string) => void;
  migrateDraftTabToSavedScript: (scriptId: string, name: string) => void;
  clearDirtyForKeys: (keys: string[]) => void;
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
}: {
  children: ReactNode;
  selectedDomain: string;
  scripts: ServerScript[];
  draftContent: string;
}) {
  const [bundle, setBundle] = useState<Bundle>(() =>
    buildInitialTabs(draftContent, selectedDomain),
  );
  const dirtyKeysRef = useRef<Set<string>>(new Set());

  const prevDomainRef = useRef(selectedDomain);
  useEffect(() => {
    if (prevDomainRef.current !== selectedDomain) {
      prevDomainRef.current = selectedDomain;
      dirtyKeysRef.current = new Set();
      setBundle(buildInitialTabs(draftContent, selectedDomain));
    }
  }, [selectedDomain, draftContent]);

  const serverById = useMemo(() => new Map(scripts.map((s) => [s.id, s])), [scripts]);

  useEffect(() => {
    setBundle((prev) => {
      const serverIds = new Set(scripts.map((s) => s.id));

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
        if (!dirtyKeysRef.current.has(tk)) {
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
  }, [scripts, draftContent, selectedDomain, serverById]);

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

  const value = useMemo(
    (): WorkspaceScriptSessionContextValue => ({
      selectedDomain,
      scriptsFromServer: scripts,
      draftContentTemplate: draftContent,
      openTabs,
      activeTabKey,
      activeContent,
      activeScriptId,
      activeScriptName,
      setActiveContent,
      openScriptTab,
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
    }),
    [
      selectedDomain,
      scripts,
      draftContent,
      openTabs,
      activeTabKey,
      activeContent,
      activeScriptId,
      activeScriptName,
      setActiveContent,
      openScriptTab,
      selectTab,
      closeTab,
      migrateDraftTabToSavedScript,
      clearDirtyForKeys,
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
