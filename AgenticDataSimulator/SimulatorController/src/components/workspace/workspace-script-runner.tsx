"use client";

import { useCallback, useEffect, useRef, useState, memo } from "react";
import { useRouter } from "next/navigation";

import { ScriptEditor } from "@/components/editor/script-editor";
import { IntentGenSessionDialog } from "@/components/workspace/intent-gen-session-dialog";
import { ShowMetricsDialog } from "@/components/workspace/show-metrics-dialog";
import {
  defaultScriptName,
  tabKeyForScript,
  useWorkspaceScriptSession,
} from "@/components/workspace/workspace-script-session-context";
import { WorkspaceRunIdChip } from "@/components/workspace/workspace-run-id-chip";
import { WorkspaceRunLogDialog } from "@/components/workspace/workspace-run-log-dialog";
import { analyzeScript } from "@/lib/dsl/analysis/analyze-script";
import { findCreateIntentStatements } from "@/lib/dsl/analysis/find-create-intent-statements";
import type { CreateIntentCandidate } from "@/lib/dsl/analysis/find-create-intent-statements";
import type {
  CreateIntentStatement,
  ExtractMetricCatalogStatement,
  RequestObservationReportStatement,
} from "@/lib/dsl/types";
import { resolveMetricStemsInObservationInstructions, mergeMetricCatalog } from "@/lib/dsl/analysis/extract-metric-catalog";
import { buildObservationReportSeed } from "@/lib/dsl/observation-report-seed";
import type { ObservationStorageType } from "@/lib/dsl/types";
import { buildIntentGenerationStorageHint } from "@/lib/observation-storage";
import { parseCanonicalIntentLocalId } from "@/lib/intent/extract-intent-turtle";
import { resolveIntentIdForObservation } from "@/lib/intent/resolve-intent-ref";
import {
  buildSharedScriptName,
  defaultSharedNameSuffix,
  SHARED_PREFIX,
} from "@/lib/scripts/shared-name";
import { fetchIntentMetricCatalog } from "@/lib/kg/fetch-intent-metric-catalog-client";
import {
  buildGraphTargetBinding,
  type GraphTargetBinding,
} from "@/lib/kg/graph-target-binding";
import {
  fetchWorkloadPreviewMetrics,
  type WorkloadPreviewMetrics,
} from "@/lib/workload-catalogue/preview-metrics-client";

type WorkspaceScriptRunnerProps = {
  metricNames: string[];
  scriptsApiUrl: string;
  currentUserId: string;
  intentsRegisterUrl: string;
  kgTargetsApiBaseUrl: string;
  kgTargets: Array<{
    id: string;
    displayName: string;
    repositoryId: string;
    graphIri: string;
  }>;
  selectedKgTargetId: string;
  onSelectedKgTargetIdChange: (targetId: string) => void;
  graphDbBaseUrl: string;
  discoverIntentAgentApiUrl: string;
  discoverObservationAgentApiUrl: string;
  a2aMessageSendUrl: string;
  previewMetricsApiUrl: string;
};

const EDITOR_HEIGHT_STORAGE_KEY = "openclaw-workspace-editor-height-px";
const DEFAULT_EDITOR_HEIGHT = 360;
const MIN_EDITOR_HEIGHT = 140;
const MAX_EDITOR_HEIGHT = 960;

type RunMode = "dry-run" | "execute";

const RUN_MODE_TOOLTIPS: Record<RunMode, string> = {
  "dry-run":
    "Validate script syntax and DSL rules without calling agents or modifying the knowledge graph.",
  execute:
    "Run the script end-to-end: discover agents, create intents, extract metric catalogs, and request reports.",
};

type RunModeSelectorProps = {
  disabled: boolean;
  runModeRef: React.MutableRefObject<RunMode>;
};

function RunModeSelector({ disabled, runModeRef }: RunModeSelectorProps) {
  const [runMode, setRunMode] = useState<RunMode>("execute");
  runModeRef.current = runMode;

  return (
    <div className="workspace-runner-field">
      <label className="workspace-label">Run mode</label>
      <div aria-label="Run mode" className="workspace-runner-modes" role="group">
        <button
          aria-pressed={runMode === "dry-run"}
          className={`workspace-runner-mode${runMode === "dry-run" ? " workspace-runner-mode-active" : ""}`}
          disabled={disabled}
          onClick={() => setRunMode("dry-run")}
          title={RUN_MODE_TOOLTIPS["dry-run"]}
          type="button"
        >
          dry-run
        </button>
        <button
          aria-pressed={runMode === "execute"}
          className={`workspace-runner-mode${runMode === "execute" ? " workspace-runner-mode-active" : ""}`}
          disabled={disabled}
          onClick={() => setRunMode("execute")}
          title={RUN_MODE_TOOLTIPS.execute}
          type="button"
        >
          execute
        </button>
      </div>
    </div>
  );
}

function readStoredEditorHeight(): number {
  if (typeof window === "undefined") {
    return DEFAULT_EDITOR_HEIGHT;
  }
  const raw = window.localStorage.getItem(EDITOR_HEIGHT_STORAGE_KEY);
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_EDITOR_HEIGHT;
  }
  return Math.min(MAX_EDITOR_HEIGHT, Math.max(MIN_EDITOR_HEIGHT, n));
}

export const WorkspaceScriptRunner = memo(function WorkspaceScriptRunner({
  metricNames,
  scriptsApiUrl,
  currentUserId,
  intentsRegisterUrl,
  kgTargetsApiBaseUrl,
  kgTargets,
  selectedKgTargetId,
  onSelectedKgTargetIdChange,
  graphDbBaseUrl,
  discoverIntentAgentApiUrl,
  discoverObservationAgentApiUrl,
  a2aMessageSendUrl,
  previewMetricsApiUrl,
}: WorkspaceScriptRunnerProps) {
  const router = useRouter();
  const {
    selectedDomain,
    scriptsFromServer,
    activeContent,
    activeScriptId,
    activeScriptName,
    activeTabKey,
    openTabs,
    setActiveContent,
    selectTab,
    closeTab,
    openScriptTab,
    migrateDraftTabToSavedScript,
    commitSavedTabContent,
    appendRunnerLog,
    beginScriptRun,
    endActiveScriptRun,
    openRunLogDialog,
    closeRunLogDialog,
    setScriptExtractedMetricNames,
    setWorkloadPreviewMetricStems,
  } = useWorkspaceScriptSession();

  const appendA2ATranscriptTurn = useCallback(
    (turn: { role: "user" | "agent"; text: string }) => {
      if (turn.role === "agent") {
        appendRunnerLog("Agent");
      }
      for (const line of turn.text.split("\n")) {
        appendRunnerLog(line);
      }
      appendRunnerLog("");
    },
    [appendRunnerLog],
  );

  const [editorHeightPx, setEditorHeightPx] = useState(DEFAULT_EDITOR_HEIGHT);
  const editorHeightPxRef = useRef(editorHeightPx);

  useEffect(() => {
    setEditorHeightPx(readStoredEditorHeight());
  }, []);

  useEffect(() => {
    editorHeightPxRef.current = editorHeightPx;
  }, [editorHeightPx]);

  const onEditorHeightResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startH = editorHeightPxRef.current;
      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const next = Math.min(
          MAX_EDITOR_HEIGHT,
          Math.max(MIN_EDITOR_HEIGHT, startH + delta),
        );
        setEditorHeightPx(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        try {
          window.localStorage.setItem(
            EDITOR_HEIGHT_STORAGE_KEY,
            String(editorHeightPxRef.current),
          );
        } catch {
          /* ignore */
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [],
  );

  const scriptNameRef = useRef(activeScriptName);
  scriptNameRef.current = activeScriptName;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [saveAsScriptName, setSaveAsScriptName] = useState("");
  const [saveAsError, setSaveAsError] = useState<string | null>(null);
  const [shareAsDialogOpen, setShareAsDialogOpen] = useState(false);
  const [shareAsNameSuffix, setShareAsNameSuffix] = useState("");
  const [shareAsError, setShareAsError] = useState<string | null>(null);
  const [showMetricsBusy, setShowMetricsBusy] = useState(false);
  const [showMetricsError, setShowMetricsError] = useState<string | null>(null);
  const [createIntentPickerOpen, setCreateIntentPickerOpen] = useState(false);
  const [createIntentCandidates, setCreateIntentCandidates] = useState<CreateIntentCandidate[]>(
    [],
  );
  const [selectedCreateIntentIndex, setSelectedCreateIntentIndex] = useState(0);
  const [showMetricsDialogOpen, setShowMetricsDialogOpen] = useState(false);
  const [showMetricsPreview, setShowMetricsPreview] = useState<WorkloadPreviewMetrics | null>(
    null,
  );
  const [showMetricsPromptPreview, setShowMetricsPromptPreview] = useState("");

  const saveAsInputRef = useRef<HTMLInputElement>(null);
  const shareAsInputRef = useRef<HTMLInputElement>(null);
  const saveAsDialogOpenRef = useRef(false);
  const shareAsDialogOpenRef = useRef(false);

  const activeScriptMeta = activeScriptId
    ? scriptsFromServer.find((script) => script.id === activeScriptId)
    : undefined;
  const isReadOnlyScript = Boolean(
    activeScriptMeta && activeScriptMeta.userId !== currentUserId,
  );

  useEffect(() => {
    saveAsDialogOpenRef.current = saveAsDialogOpen;
  }, [saveAsDialogOpen]);

  useEffect(() => {
    shareAsDialogOpenRef.current = shareAsDialogOpen;
  }, [shareAsDialogOpen]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      setSaveAsScriptName(activeScriptName);
    }
  }, [activeScriptName, activeTabKey, saveAsDialogOpen]);

  useEffect(() => {
    if (!shareAsDialogOpen) {
      setShareAsNameSuffix(defaultSharedNameSuffix(activeScriptName));
    }
  }, [activeScriptName, activeTabKey, shareAsDialogOpen]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || saving) {
        return;
      }
      event.preventDefault();
      setSaveAsDialogOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [saveAsDialogOpen, saving]);

  useEffect(() => {
    if (!shareAsDialogOpen) {
      return;
    }
    shareAsInputRef.current?.focus();
    shareAsInputRef.current?.select();
  }, [shareAsDialogOpen]);

  useEffect(() => {
    if (!saveAsDialogOpen) {
      return;
    }
    saveAsInputRef.current?.focus();
    saveAsInputRef.current?.select();
  }, [saveAsDialogOpen]);

  const savingLockRef = useRef(false);

  const submitSave = useCallback(
    async (nameInput: string) => {
      if (isReadOnlyScript) {
        setSaveError("This shared script is read-only. Use Save As to create your own copy.");
        return false;
      }

      const trimmedName = nameInput.trim();
      if (!trimmedName) {
        setSaveError("Script name is required.");
        if (saveAsDialogOpenRef.current) {
          setSaveAsError("Enter a script name.");
        }
        return false;
      }

      if (savingLockRef.current) {
        return false;
      }
      savingLockRef.current = true;
      setSaveError(null);
      setSaveAsError(null);
      setSaving(true);

      const fail = async (response: Response, fallback: string) => {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === "string"
            ? body.error
            : `${fallback} (${response.status})`;
        setSaveError(message);
        if (saveAsDialogOpenRef.current) {
          setSaveAsError(message);
        }
      };

      try {
        if (!activeScriptId) {
          const response = await fetch(scriptsApiUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              domain: selectedDomain,
              name: trimmedName,
              content: activeContent,
            }),
          });
          if (!response.ok) {
            await fail(response, "Save failed");
            return false;
          }
          const data = (await response.json()) as {
            script?: { id: string; name: string };
          };
          const newId = data.script?.id;
          const newName = data.script?.name ?? trimmedName;
          if (newId) {
            migrateDraftTabToSavedScript(newId, newName);
            commitSavedTabContent(tabKeyForScript(newId), activeContent);
          }
          scriptNameRef.current = trimmedName;
          router.refresh();
          return true;
        }

        if (trimmedName === activeScriptName.trim()) {
          const response = await fetch(
            `${scriptsApiUrl}/${encodeURIComponent(activeScriptId)}`,
            {
              method: "PATCH",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                content: activeContent,
                name: trimmedName,
              }),
            },
          );
          if (!response.ok) {
            await fail(response, "Save failed");
            return false;
          }
          scriptNameRef.current = trimmedName;
          commitSavedTabContent(activeTabKey, activeContent);
          router.refresh();
          return true;
        }

        const response = await fetch(scriptsApiUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            domain: selectedDomain,
            name: trimmedName,
            content: activeContent,
          }),
        });
        if (!response.ok) {
          await fail(response, "Save failed");
          return false;
        }
        const data = (await response.json()) as {
          script?: { id: string; name: string };
        };
        const created = data.script;
        if (!created?.id) {
          const message = "Save failed: server did not return a script id.";
          setSaveError(message);
          if (saveAsDialogOpenRef.current) {
            setSaveAsError(message);
          }
          return false;
        }
        openScriptTab({
          id: created.id,
          name: created.name ?? trimmedName,
          content: activeContent,
          userId: currentUserId,
          shared: false,
        });
        router.refresh();
        return true;
      } finally {
        savingLockRef.current = false;
        setSaving(false);
      }
    },
    [
      activeScriptId,
      activeScriptName,
      activeContent,
      activeTabKey,
      scriptsApiUrl,
      selectedDomain,
      router,
      migrateDraftTabToSavedScript,
      commitSavedTabContent,
      openScriptTab,
      currentUserId,
      isReadOnlyScript,
    ],
  );

  const submitShareAs = useCallback(async () => {
    const suffix = shareAsNameSuffix.trim();
    if (!suffix) {
      setShareAsError("Enter a name after the shared- prefix.");
      return false;
    }

    if (savingLockRef.current) {
      return false;
    }

    savingLockRef.current = true;
    setShareAsError(null);
    setSaving(true);

    try {
      const response = await fetch(scriptsApiUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: selectedDomain,
          nameSuffix: suffix,
          content: activeContent,
          shared: true,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === "string"
            ? body.error
            : `Share As failed (${response.status})`;
        setShareAsError(message);
        return false;
      }

      const data = (await response.json()) as {
        script?: { id: string; name: string };
      };
      const created = data.script;
      if (!created?.id) {
        setShareAsError("Share As failed: server did not return a script id.");
        return false;
      }

      openScriptTab({
        id: created.id,
        name: created.name ?? buildSharedScriptName(suffix),
        content: activeContent,
        userId: currentUserId,
        shared: true,
      });
      router.refresh();
      return true;
    } finally {
      savingLockRef.current = false;
      setSaving(false);
    }
  }, [
    activeContent,
    currentUserId,
    openScriptTab,
    router,
    scriptsApiUrl,
    selectedDomain,
    shareAsNameSuffix,
  ]);

  const openSaveAsDialog = useCallback(() => {
    setSaveAsError(null);
    setSaveAsScriptName(activeScriptName);
    setSaveAsDialogOpen(true);
  }, [activeScriptName]);

  const confirmSaveAsFromDialog = useCallback(async () => {
    setSaveAsError(null);
    const ok = await submitSave(saveAsScriptName);
    if (ok) {
      setSaveAsDialogOpen(false);
    }
  }, [saveAsScriptName, submitSave]);

  const openShareAsDialog = useCallback(() => {
    setShareAsError(null);
    setShareAsNameSuffix(defaultSharedNameSuffix(activeScriptName));
    setShareAsDialogOpen(true);
  }, [activeScriptName]);

  const confirmShareAsFromDialog = useCallback(async () => {
    setShareAsError(null);
    const ok = await submitShareAs();
    if (ok) {
      setShareAsDialogOpen(false);
    }
  }, [submitShareAs]);

  const runShowMetricsPreview = useCallback(
    async (prompt: string) => {
      setShowMetricsBusy(true);
      setShowMetricsError(null);
      try {
        const result = await fetchWorkloadPreviewMetrics({
          previewMetricsApiUrl,
          prompt,
          domain: selectedDomain,
        });
        if (!result.ok) {
          setShowMetricsError(result.error);
          return;
        }
        setShowMetricsPromptPreview(prompt);
        setShowMetricsPreview(result.preview);
        setWorkloadPreviewMetricStems(result.preview.metricStems);
        setShowMetricsDialogOpen(true);
      } finally {
        setShowMetricsBusy(false);
      }
    },
    [previewMetricsApiUrl, selectedDomain, setWorkloadPreviewMetricStems],
  );

  const handleShowMetrics = useCallback(() => {
    setShowMetricsError(null);
    const { diagnostics } = analyzeScript(activeContent);
    for (const diagnostic of diagnostics.filter((diag) => diag.severity === "error")) {
      setShowMetricsError(`[line ${diagnostic.line}, ${diagnostic.code}] ${diagnostic.message}`);
      return;
    }

    const candidates = findCreateIntentStatements(activeContent);
    if (candidates.length === 0) {
      setShowMetricsError("Script has no create intent statement.");
      return;
    }

    if (candidates.length === 1) {
      void runShowMetricsPreview(candidates[0]!.prompt);
      return;
    }

    setCreateIntentCandidates(candidates);
    setSelectedCreateIntentIndex(0);
    setCreateIntentPickerOpen(true);
  }, [activeContent, runShowMetricsPreview]);

  const confirmCreateIntentPicker = useCallback(() => {
    const candidate = createIntentCandidates[selectedCreateIntentIndex];
    if (!candidate) {
      setShowMetricsError("Select a create intent statement.");
      return;
    }
    setCreateIntentPickerOpen(false);
    void runShowMetricsPreview(candidate.prompt);
  }, [createIntentCandidates, runShowMetricsPreview, selectedCreateIntentIndex]);

  const quickSave = useCallback(() => {
    if (isReadOnlyScript) {
      return;
    }
    const fallback = defaultScriptName(selectedDomain);
    const name = scriptNameRef.current.trim() || fallback;
    void submitSave(name);
  }, [submitSave, selectedDomain, isReadOnlyScript]);

  const quickSaveRef = useRef(quickSave);
  quickSaveRef.current = quickSave;

  const handleEditorSave = useCallback(() => {
    void quickSaveRef.current();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "s") {
        return;
      }
      event.preventDefault();
      void quickSaveRef.current();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  const hasKgTarget =
    kgTargets.length > 0 && selectedKgTargetId.trim().length > 0;

  const persistIntentStoreUrl =
    selectedKgTargetId.length > 0 && kgTargetsApiBaseUrl.trim().length > 0
      ? `${kgTargetsApiBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(selectedKgTargetId)}/store-intent`
      : null;

  const intentFinishRef = useRef<(() => void) | null>(null);
  const observationFinishRef = useRef<(() => void) | null>(null);
  /** Maps DSL intent alias (`as` from create-intent) → canonical kg intent id (`I…`) after successful ingest. */
  const intentIdByAliasRef = useRef(new Map<string, string>());
  /** Maps DSL intent alias → observation storage from `create intent … storage`. */
  const intentStorageByAliasRef = useRef(new Map<string, ObservationStorageType>());
  const [runBusy, setRunBusy] = useState(false);
  const [kgRequiredDialogOpen, setKgRequiredDialogOpen] = useState(false);
  const runModeRef = useRef<RunMode>("execute");
  const [intentSession, setIntentSession] = useState<{
    wellKnownURI: string;
    prompt: string;
    intentArtifactLabel: string;
    storage: ObservationStorageType;
  } | null>(null);
  const [observationSession, setObservationSession] = useState<{
    wellKnownURI: string;
    sessionAlias: string;
    seedPrompt: string;
    graphTargetBinding: GraphTargetBinding;
    observationStorage?: ObservationStorageType;
    createIntentStorage?: ObservationStorageType;
  } | null>(null);

  const resolveSelectedGraphTargetBinding = useCallback((): GraphTargetBinding | null => {
    if (!selectedKgTargetId.trim()) {
      return null;
    }
    const target = kgTargets.find((t) => t.id === selectedKgTargetId);
    if (!target?.repositoryId?.trim() || !target.graphIri?.trim()) {
      return null;
    }
    return buildGraphTargetBinding(target, graphDbBaseUrl);
  }, [graphDbBaseUrl, kgTargets, selectedKgTargetId]);

  const handleKgIntentStored = useCallback(
    (
      _dslAlias: string,
      canonicalIntentId: string,
      storage?: ObservationStorageType,
    ) => {
      intentIdByAliasRef.current.set(_dslAlias, canonicalIntentId);
      if (storage) {
        intentStorageByAliasRef.current.set(_dslAlias, storage);
      }

      const registerUrl = intentsRegisterUrl.trim();
      if (!registerUrl) {
        return;
      }

      void fetch(registerUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: selectedDomain,
          intentId: canonicalIntentId,
          storage,
          graphTargetId: selectedKgTargetId || undefined,
        }),
      }).catch(() => {
        // Best-effort; store-intent and intent dialog also register.
      });
    },
    [intentsRegisterUrl, selectedDomain, selectedKgTargetId],
  );

  const handleRunScript = useCallback(async () => {
    const runMode = runModeRef.current;
    beginScriptRun(activeScriptName, {
      mode: runMode,
      scriptId: activeScriptId,
    });
    openRunLogDialog();
    try {
      if (kgTargets.length === 0 || !selectedKgTargetId.trim()) {
        appendRunnerLog(
          "Create a knowledge graph target in the KG target panel before running scripts.",
        );
        return;
      }

      const modeLabel = runModeRef.current === "dry-run" ? "Dry-run" : "Run Script";
      appendRunnerLog(`${modeLabel}: analysing DSL…`);

      const { statements, diagnostics } = analyzeScript(activeContent);

      for (const diagnostic of diagnostics.filter(
        (diag) => diag.severity === "error",
      )) {
        appendRunnerLog(
          `[line ${diagnostic.line}, ${diagnostic.code}] ${diagnostic.message}`,
        );
      }

      for (const diagnostic of diagnostics.filter(
        (diag) => diag.severity === "warning",
      )) {
        appendRunnerLog(
          `[line ${diagnostic.line}, ${diagnostic.code}] ${diagnostic.message}`,
        );
      }

      if (diagnostics.some((diag) => diag.severity === "error")) {
        appendRunnerLog(
          runModeRef.current === "dry-run"
            ? "Dry-run: resolve validation errors first."
            : "Stopping: resolve validation errors first.",
        );
        return;
      }

      if (runModeRef.current === "dry-run") {
        const kindSummary =
          statements.map((statement) => statement.kind).join(", ") || "(none)";
        appendRunnerLog(
          `Dry-run: script is valid (${statements.length} statement${statements.length === 1 ? "" : "s"}): ${kindSummary}.`,
        );
        return;
      }

      const orderedStatements = [...statements].sort((a, b) => a.line - b.line);

      appendRunnerLog("Run Script: executing supported statements in order.");

      intentIdByAliasRef.current.clear();
      intentStorageByAliasRef.current.clear();
      setScriptExtractedMetricNames([]);
      const catalogBindings = new Map<string, string[]>();
      const catalogByIntentId = new Map<string, string[]>();

      const bindings = new Map<string, string>();
      let lastWorkspaceIntentWellKnownUri: string | null = null;
      const discoverCache = new Map<string, string>();

      const fetchAgentWellKnownUri = async (
        apiUrl: string,
        domain: string,
      ): Promise<string | null> => {
        const response = await fetch(apiUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain }),
        });

        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          agent?: { wellKnownURI?: string };
        };

        const uriCandidate =
          response.ok &&
          typeof body.agent?.wellKnownURI === "string" &&
          body.agent.wellKnownURI.length > 0
            ? body.agent.wellKnownURI
            : null;

        if (!uriCandidate) {
          appendRunnerLog(
            typeof body.error === "string" && body.error.length > 0
              ? body.error
              : `Discovery request failed (${response.status}).`,
          );
          return null;
        }

        return uriCandidate;
      };

      const resolveDiscoverUri = async (
        cacheKey: string,
        apiUrl: string,
        domain: string,
      ): Promise<string | null> => {
        const cached = discoverCache.get(cacheKey);
        if (cached) {
          return cached;
        }

        const uri = await fetchAgentWellKnownUri(apiUrl, domain);
        if (uri) {
          discoverCache.set(cacheKey, uri);
        }
        return uri;
      };

      const lookupIntentGeneratingAgentUri = async (): Promise<string | null> => {
        return resolveDiscoverUri(
          `intent-agent:${selectedDomain}`,
          discoverIntentAgentApiUrl,
          selectedDomain,
        );
      };

      const formatMetricCatalogPreview = (metricNames: string[]): string => {
        if (metricNames.length === 0) {
          return "(none)";
        }
        if (metricNames.length <= 24) {
          return metricNames.join(", ");
        }
        return `${metricNames.slice(0, 24).join(", ")} … (+${metricNames.length - 24} more)`;
      };

      const loadMetricCatalogForIntent = async (
        intentRef: string,
        line: number,
        purpose: "extract" | "observation",
      ): Promise<{ catalog: string[]; canonicalId: string } | null> => {
        if (!selectedKgTargetId || !kgTargetsApiBaseUrl.trim()) {
          appendRunnerLog(
            `Line ${line}: ${purpose === "extract" ? "extract metric-catalog" : "request observation-report"} requires a knowledge graph target in the runner (same as intent storage).`,
          );
          return null;
        }

        const canonicalId = resolveIntentIdForObservation(
          intentRef,
          intentIdByAliasRef.current,
        );
        if (!canonicalId) {
          appendRunnerLog(
            `Line ${line}: No intent id for "${intentRef}". Use a canonical id (I + 32 hex) in \`for\`, or store intent Turtle to the selected knowledge graph target after \`create intent … as ${intentRef}\`.`,
          );
          return null;
        }

        if (catalogByIntentId.has(canonicalId)) {
          return { catalog: catalogByIntentId.get(canonicalId)!, canonicalId };
        }

        const result = await fetchIntentMetricCatalog({
          kgTargetsApiBaseUrl,
          kgTargetId: selectedKgTargetId,
          intentLocalId: canonicalId,
        });

        if (!result.ok) {
          appendRunnerLog(
            result.status > 0
              ? `Line ${line}: metric-catalog request failed: ${result.error}`
              : `Line ${line}: metric-catalog request failed (${result.error}).`,
          );
          return null;
        }

        const catalog = mergeMetricCatalog(catalogByIntentId, canonicalId, result.metricNames);

        if (purpose === "observation") {
          appendRunnerLog(
            `Line ${line}: Loaded metric catalog from GraphDB for intent ${canonicalId} (${catalog.length} names) for stem resolution: ${formatMetricCatalogPreview(catalog)}`,
          );
        }

        return { catalog, canonicalId };
      };

      for (const statement of orderedStatements) {
        if (statement.kind === "discover-intent-workspace-domain") {
          appendRunnerLog(`Line ${statement.line}: Searching registry…`);
          const uri = await lookupIntentGeneratingAgentUri();
          if (!uri) {
            appendRunnerLog(
              "Could not locate an intent-generating agent card for this domain.",
            );
            return;
          }

          bindings.set(statement.alias, uri);
          lastWorkspaceIntentWellKnownUri = uri;

          appendRunnerLog(
            `Line ${statement.line}: ${statement.alias} → ${uri}`,
          );
          continue;
        }

        if (statement.kind === "discover") {
          if (statement.agentKind === "status-agent") {
            appendRunnerLog(
              `Line ${statement.line}: status-agent discovery is not implemented yet.`,
            );
            return;
          }

          if (statement.domain !== selectedDomain) {
            appendRunnerLog(
              `Line ${statement.line}: note — script domain "${statement.domain}" differs from workspace domain "${selectedDomain}".`,
            );
          }

          const cacheKey = `${statement.agentKind}:${statement.domain}`;
          const apiUrl =
            statement.agentKind === "intent-agent"
              ? discoverIntentAgentApiUrl
              : discoverObservationAgentApiUrl;

          appendRunnerLog(`Line ${statement.line}: Searching registry…`);
          const uri = await resolveDiscoverUri(cacheKey, apiUrl, statement.domain);
          if (!uri) {
            appendRunnerLog(
              statement.agentKind === "intent-agent"
                ? "Could not locate an intent-generating agent card for this domain."
                : "Could not locate an observation-control agent card for this domain.",
            );
            return;
          }

          bindings.set(statement.alias, uri);

          appendRunnerLog(`Line ${statement.line}: ${statement.alias} → ${uri}`);
          continue;
        }

        if (statement.kind === "create-intent") {
          const stmt: CreateIntentStatement = statement;

          let resolved =
            bindings.get(stmt.agentAlias) ??
            (stmt.agentAlias === "intentGen"
              ? lastWorkspaceIntentWellKnownUri
              : null);

          if (!resolved && stmt.agentAlias === "intentGen") {
            resolved = await lookupIntentGeneratingAgentUri();
            if (!resolved) {
              appendRunnerLog(
                `Line ${statement.line}: intentGen shortcut needs a reachable intent-generating agent for ${selectedDomain}.`,
              );
              return;
            }
          }

          if (!resolved) {
            appendRunnerLog(
              `Line ${statement.line}: Unable to bind agent card URI for "${stmt.agentAlias}".`,
            );
            return;
          }

          appendRunnerLog(
            `Run Script: create intent as "${stmt.intentAlias}" (observation storage: ${stmt.storage}).`,
          );
          appendRunnerLog(
            `Line ${statement.line}: Opening A2A session for intent alias "${stmt.intentAlias}".`,
          );
          appendRunnerLog(
            `Conversation uses a single persistent task/context pair; reuse them as you iterate with Send.`,
          );
          if (!persistIntentStoreUrl) {
            appendRunnerLog(
              "Intent Turtle will not be stored: choose or create a knowledge graph target in the sidebar.",
            );
          }

          await new Promise<void>((finish) => {
            intentFinishRef.current = finish;
            setIntentSession({
              intentArtifactLabel: stmt.intentAlias,
              prompt: [buildIntentGenerationStorageHint(stmt.storage), "", stmt.prompt].join(
                "\n",
              ),
              wellKnownURI: resolved,
              storage: stmt.storage,
            });
          });
          continue;
        }

        if (statement.kind === "request-observation-report") {
          const stmt: RequestObservationReportStatement = statement;

          const graphTargetBinding = resolveSelectedGraphTargetBinding();
          if (!graphTargetBinding) {
            appendRunnerLog(
              `Line ${statement.line}: request observation-report requires a knowledge graph target in the runner (same as intent storage).`,
            );
            return;
          }

          const resolved = bindings.get(stmt.agentAlias);
          if (!resolved) {
            appendRunnerLog(
              `Line ${statement.line}: Unable to bind agent card URI for "${stmt.agentAlias}".`,
            );
            return;
          }

          const loadedCatalog = await loadMetricCatalogForIntent(
            stmt.intentAlias,
            stmt.line,
            "observation",
          );
          if (!loadedCatalog) {
            return;
          }

          const { catalog: metricCatalog, canonicalId } = loadedCatalog;
          const stemResolution = resolveMetricStemsInObservationInstructions(
            stmt.instructions,
            metricCatalog,
          );
          for (const { stem, compound } of stemResolution.resolved) {
            appendRunnerLog(
              `Line ${statement.line}: Resolved metric stem "${stem}" → "${compound}".`,
            );
          }
          for (const stem of stemResolution.ambiguous) {
            appendRunnerLog(
              `Line ${statement.line}: Ambiguous metric stem "${stem}" (multiple compounds in catalog); left unchanged.`,
            );
          }
          for (const stem of stemResolution.unmatched) {
            appendRunnerLog(
              `Line ${statement.line}: Unknown metric stem "${stem}" (not in catalog); left unchanged.`,
            );
          }

          const createIntentStorage = intentStorageByAliasRef.current.get(stmt.intentAlias);
          const seedPrompt = buildObservationReportSeed(
            canonicalId,
            stemResolution.instructions,
            stmt.storage,
          );

          const storageNote = stmt.storage
            ? `override ${stmt.storage}`
            : createIntentStorage
              ? `from create-intent: ${createIntentStorage}`
              : "from intent Turtle / default graphdb";
          appendRunnerLog(
            `Line ${statement.line}: Observation storage for session: ${storageNote}.`,
          );

          const intentRefNote = parseCanonicalIntentLocalId(stmt.intentAlias)
            ? `canonical id ${canonicalId} from script \`for\` clause`
            : `DSL intent "${stmt.intentAlias}" (stored id ${canonicalId})`;
          const kgTarget = kgTargets.find((t) => t.id === selectedKgTargetId);
          appendRunnerLog(
            `Run Script: observation-report session "${stmt.sessionAlias}" for ${intentRefNote}.`,
          );
          appendRunnerLog(
            `Line ${statement.line}: Graph target "${kgTarget?.displayName ?? selectedKgTargetId}" (${graphTargetBinding.repositoryId}, ${graphTargetBinding.graphIri}).`,
          );
          appendRunnerLog(
            `Line ${statement.line}: Opening A2A session for observation reporting; task/context are reused until you Close.`,
          );

          await new Promise<void>((finish) => {
            observationFinishRef.current = finish;
            setObservationSession({
              wellKnownURI: resolved,
              sessionAlias: stmt.sessionAlias,
              seedPrompt,
              graphTargetBinding,
              observationStorage: stmt.storage,
              createIntentStorage,
            });
          });
          continue;
        }

        if (statement.kind === "extract-metric-catalog") {
          const stmt: ExtractMetricCatalogStatement = statement;

          const loadedCatalog = await loadMetricCatalogForIntent(
            stmt.intentAlias,
            stmt.line,
            "extract",
          );
          if (!loadedCatalog) {
            return;
          }

          const { catalog: metricNames, canonicalId } = loadedCatalog;
          catalogBindings.set(stmt.metricCatalogAlias, metricNames);

          appendRunnerLog(
            `Run Script: extract metric-catalog as "${stmt.metricCatalogAlias}" for intent ${canonicalId} (${metricNames.length} names): ${formatMetricCatalogPreview(metricNames)}`,
          );
          continue;
        }
      }

      const mergedMetricNames = [
        ...new Set([
          ...Array.from(catalogBindings.values()).flat(),
          ...Array.from(catalogByIntentId.values()).flat(),
        ]),
      ].sort((a, b) => a.localeCompare(b));

      if (mergedMetricNames.length > 0) {
        setScriptExtractedMetricNames(mergedMetricNames);
        if (catalogBindings.size > 0) {
          appendRunnerLog(
            `Run Script: metric-catalog list aliases bound: ${Array.from(catalogBindings.keys()).join(", ")}.`,
          );
        } else {
          appendRunnerLog(
            `Run Script: metric names loaded from GraphDB for stem resolution (${mergedMetricNames.length} unique).`,
          );
        }
      }

      appendRunnerLog("Run Script: finished scripted steps.");
    } finally {
      await endActiveScriptRun({
        mode: runModeRef.current,
        scriptId: activeScriptId,
      });
    }
  }, [
    activeContent,
    activeScriptId,
    activeScriptName,
    appendRunnerLog,
    beginScriptRun,
    endActiveScriptRun,
    openRunLogDialog,
    discoverIntentAgentApiUrl,
    discoverObservationAgentApiUrl,
    kgTargetsApiBaseUrl,
    persistIntentStoreUrl,
    selectedDomain,
    selectedKgTargetId,
    kgTargets,
    graphDbBaseUrl,
    resolveSelectedGraphTargetBinding,
    setScriptExtractedMetricNames,
  ]);

  const handleIntentDialogFinish = useCallback(() => {
    intentFinishRef.current?.();
    intentFinishRef.current = null;
    setIntentSession(null);
  }, []);

  const handleObservationDialogFinish = useCallback(() => {
    observationFinishRef.current?.();
    observationFinishRef.current = null;
    setObservationSession(null);
  }, []);

  const kickOffRunScript = useCallback(() => {
    if (runBusy) {
      return;
    }

    if (!hasKgTarget) {
      setKgRequiredDialogOpen(true);
      return;
    }

    void (async () => {
      setRunBusy(true);
      try {
        await handleRunScript();
      } finally {
        setRunBusy(false);
      }
    })();
  }, [handleRunScript, hasKgTarget, runBusy]);

  return (
    <>
      <div className="workspace-editor-header">
        <div className="workspace-heading-row">
          <h2>Script editor</h2>
          <div className="workspace-editor-toolbar">
            <WorkspaceRunIdChip />
            <RunModeSelector disabled={runBusy} runModeRef={runModeRef} />
            <div className="workspace-runner-field">
              <label className="workspace-label" htmlFor="runner-kg-target">
                Knowledge graph target
              </label>
              <select
                className="workspace-select workspace-runner-select"
                disabled={kgTargets.length === 0}
                id="runner-kg-target"
                onChange={(event) => onSelectedKgTargetIdChange(event.target.value)}
                value={
                  kgTargets.some((t) => t.id === selectedKgTargetId)
                    ? selectedKgTargetId
                    : ""
                }
              >
                {kgTargets.length === 0 ? (
                  <option value="">Create a KG first</option>
                ) : null}
                {kgTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      {openTabs.length >= 2 ? (
        <div
          aria-label="Open scripts"
          className="workspace-editor-tabs"
          role="tablist"
        >
          {openTabs.map((tab) => {
            const selected = tab.tabKey === activeTabKey;
            return (
              <div
                className={`workspace-editor-tab ${selected ? "workspace-editor-tab-active" : ""}`}
                key={tab.tabKey}
              >
                <button
                  aria-selected={selected}
                  className="workspace-editor-tab-label"
                  onClick={() => selectTab(tab.tabKey)}
                  role="tab"
                  title={tab.name}
                  type="button"
                >
                  <span className="workspace-editor-tab-text">{tab.name}</span>
                </button>
                <button
                  aria-label={`Close ${tab.name}`}
                  className="workspace-editor-tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.tabKey);
                  }}
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="workspace-editor-resize-block">
        <ScriptEditor
          heightPx={editorHeightPx}
          key={activeTabKey}
          metricNames={metricNames}
          onChange={setActiveContent}
          onSave={isReadOnlyScript ? undefined : handleEditorSave}
          readOnly={isReadOnlyScript}
          value={activeContent}
        />
        <div
          aria-label="Resize editor height"
          aria-orientation="horizontal"
          className="workspace-editor-height-resizer"
          onMouseDown={onEditorHeightResizeMouseDown}
          role="separator"
        />
      </div>
      <div className="workspace-runner">
        <div className="workspace-runner-actions">
          <button
            className="workspace-button workspace-runner-button"
            disabled={runBusy}
            onClick={kickOffRunScript}
            type="button"
          >
            {runBusy ? "Running…" : "Run Script"}
          </button>
          <button
            className="workspace-button workspace-runner-button"
            disabled={saving}
            onClick={openSaveAsDialog}
            type="button"
          >
            {saving ? "Saving…" : "Save As"}
          </button>
          <button
            className="workspace-button workspace-runner-button"
            disabled={saving}
            onClick={openShareAsDialog}
            title="Publish a copy of this script for all users. The shared copy will be named with a shared- prefix (shown before you confirm)."
            type="button"
          >
            {saving ? "Sharing…" : "Share As"}
          </button>
          <button
            className="workspace-button workspace-runner-button"
            disabled={showMetricsBusy || runBusy}
            onClick={handleShowMetrics}
            title="Preview workload catalogue metrics for the create intent prompt without generating an intent."
            type="button"
          >
            {showMetricsBusy ? "Loading…" : "Show metrics"}
          </button>
        </div>
      </div>
      {showMetricsError ? (
        <p className="workspace-save-error" role="alert">
          {showMetricsError}
        </p>
      ) : null}
      {saveError ? (
        <p className="workspace-save-error" role="alert">
          {saveError}
        </p>
      ) : null}

      {kgRequiredDialogOpen ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => setKgRequiredDialogOpen(false)}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-kg-required-dialog-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <h3 id="workspace-kg-required-dialog-title">Knowledge graph required</h3>
            <p className="workspace-save-as-dialog-hint">
              Create a knowledge graph target in the KG target panel (right
              sidebar) before running scripts. Enter a name under &quot;Create
              new KG with name&quot; and click Create.
            </p>
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                onClick={() => setKgRequiredDialogOpen(false)}
                type="button"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveAsDialogOpen ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => {
            if (!saving) {
              setSaveAsDialogOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-save-as-dialog-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="workspace-save-as-dialog-title">Save script</h3>
            <p className="workspace-save-as-dialog-hint">
              Keep the current file name to update this script. Change the name
              to create a new script and open it in a new tab.
            </p>
            <div>
              <label
                className="workspace-label"
                htmlFor="workspace-save-as-script-name"
              >
                Script file name
              </label>
              <input
                ref={saveAsInputRef}
                autoComplete="off"
                className="workspace-input workspace-save-name-input"
                id="workspace-save-as-script-name"
                onChange={(event) => setSaveAsScriptName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void confirmSaveAsFromDialog();
                  }
                }}
                type="text"
                value={saveAsScriptName}
              />
            </div>
            {saveAsError ? (
              <p className="workspace-save-name-dialog-error" role="alert">
                {saveAsError}
              </p>
            ) : null}
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                disabled={saving}
                onClick={() => setSaveAsDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="workspace-button"
                disabled={saving}
                onClick={() => void confirmSaveAsFromDialog()}
                type="button"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shareAsDialogOpen ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => {
            if (!saving) {
              setShareAsDialogOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-share-as-dialog-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="workspace-share-as-dialog-title">Share As</h3>
            <p className="workspace-save-as-dialog-hint">
              Shared scripts are visible to all users as read-only. Choose a name
              after the {SHARED_PREFIX} prefix.
            </p>
            <div>
              <label
                className="workspace-label"
                htmlFor="workspace-share-as-script-name"
              >
                Shared script name
              </label>
              <div className="workspace-share-as-name-row">
                <span className="workspace-share-as-prefix">{SHARED_PREFIX}</span>
                <input
                  ref={shareAsInputRef}
                  autoComplete="off"
                  className="workspace-input workspace-share-as-name-input"
                  id="workspace-share-as-script-name"
                  onChange={(event) => setShareAsNameSuffix(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmShareAsFromDialog();
                    }
                  }}
                  type="text"
                  value={shareAsNameSuffix}
                />
              </div>
              <p className="workspace-share-as-preview">
                Full name: {buildSharedScriptName(shareAsNameSuffix || "…")}
              </p>
            </div>
            {shareAsError ? (
              <p className="workspace-save-name-dialog-error" role="alert">
                {shareAsError}
              </p>
            ) : null}
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                disabled={saving}
                onClick={() => setShareAsDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="workspace-button"
                disabled={saving || !shareAsNameSuffix.trim()}
                onClick={() => void confirmShareAsFromDialog()}
                type="button"
              >
                {saving ? "Sharing…" : "Share"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <WorkspaceRunLogDialog />

      <IntentGenSessionDialog
        a2aMessageSendUrl={a2aMessageSendUrl}
        agentCardWellKnownURI={intentSession?.wellKnownURI ?? ""}
        createIntentStorage={intentSession?.storage ?? null}
        intentArtifactLabel={intentSession?.intentArtifactLabel ?? ""}
        intentsRegisterUrl={intentsRegisterUrl}
        onFinished={handleIntentDialogFinish}
        onIntentPersistLog={appendRunnerLog}
        onKgIntentStored={handleKgIntentStored}
        onTranscriptTurn={appendA2ATranscriptTurn}
        open={intentSession !== null}
        persistIntentStoreUrl={persistIntentStoreUrl}
        registerIntentDomain={selectedDomain}
        seedPrompt={intentSession?.prompt ?? null}
      />
      <IntentGenSessionDialog
        a2aMessageSendUrl={a2aMessageSendUrl}
        agentCardWellKnownURI={observationSession?.wellKnownURI ?? ""}
        createIntentStorage={observationSession?.createIntentStorage ?? null}
        graphTargetBinding={observationSession?.graphTargetBinding ?? null}
        observationStorage={observationSession?.observationStorage ?? null}
        intentArtifactLabel={observationSession?.sessionAlias ?? ""}
        onFinished={handleObservationDialogFinish}
        onTranscriptTurn={appendA2ATranscriptTurn}
        open={observationSession !== null}
        persistIntentStoreUrl={null}
        seedPrompt={observationSession?.seedPrompt ?? null}
        variant="observation-report"
      />

      {createIntentPickerOpen ? (
        <div
          className="workspace-save-name-dialog-backdrop"
          onClick={() => setCreateIntentPickerOpen(false)}
          role="presentation"
        >
          <div
            aria-labelledby="workspace-create-intent-picker-title"
            aria-modal="true"
            className="workspace-save-name-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h3 id="workspace-create-intent-picker-title">Choose create intent</h3>
            <p className="workspace-save-as-dialog-hint">
              This script has multiple create intent statements. Select which prompt to preview.
            </p>
            <label className="workspace-label" htmlFor="workspace-create-intent-picker-select">
              Create intent statement
            </label>
            <select
              className="workspace-input workspace-create-intent-picker-select"
              id="workspace-create-intent-picker-select"
              onChange={(event) => setSelectedCreateIntentIndex(Number(event.target.value))}
              value={selectedCreateIntentIndex}
            >
              {createIntentCandidates.map((candidate, index) => (
                <option key={`${candidate.line}-${candidate.intentAlias}`} value={index}>
                  Line {candidate.line}: as {candidate.intentAlias}
                </option>
              ))}
            </select>
            {createIntentCandidates[selectedCreateIntentIndex] ? (
              <p className="workspace-show-metrics-prompt">
                <span className="workspace-label">Prompt</span>
                <em>{createIntentCandidates[selectedCreateIntentIndex]!.prompt}</em>
              </p>
            ) : null}
            <div className="workspace-save-name-dialog-actions">
              <button
                className="workspace-button"
                onClick={() => setCreateIntentPickerOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="workspace-button"
                disabled={showMetricsBusy}
                onClick={confirmCreateIntentPicker}
                type="button"
              >
                {showMetricsBusy ? "Loading…" : "Show metrics"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ShowMetricsDialog
        onClose={() => setShowMetricsDialogOpen(false)}
        open={showMetricsDialogOpen}
        preview={showMetricsPreview}
        promptPreview={showMetricsPromptPreview}
      />
    </>
  );
});
