"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentLlmPreferences } from "@/components/workspace/agent-llm-preferences-context";
import { ObservationProgressBar } from "@/components/workspace/observation-progress-bar";
import type { ObservationSetupError } from "@/lib/observation-agent/metric-progress-display";
import { preferenceForOpenClawMetadata } from "@/lib/agents/agent-llm-preferences";
import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import type { ObservationProgressSnapshot } from "@/lib/observation-agent/progress-types";
import {
  extractIntentLocalIdFromTurtle,
  extractIntentTurtle,
  normalizedIntentIdFromStoreResponse,
} from "@/lib/intent/extract-intent-turtle";
import type { GraphTargetBinding } from "@/lib/kg/graph-target-binding";

type TranscriptTurn = {
  id: string;
  role: "user" | "agent";
  text: string;
};

const SIZE_STORAGE_KEY = "openclaw-workspace-a2a-session-dialog-size";
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 640;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 960;

type DialogSize = {
  width: number;
  height: number;
};

function clampDialogSize(size: DialogSize): DialogSize {
  const maxWidth =
    typeof window === "undefined"
      ? MAX_WIDTH
      : Math.min(MAX_WIDTH, window.innerWidth - 48);
  const maxHeight =
    typeof window === "undefined"
      ? MAX_HEIGHT
      : Math.min(MAX_HEIGHT, window.innerHeight - 48);

  return {
    width: Math.min(maxWidth, Math.max(MIN_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, size.height)),
  };
}

function readStoredDialogSize(): DialogSize {
  if (typeof window === "undefined") {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
  if (!raw) {
    return clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DialogSize>;
    const width =
      typeof parsed.width === "number" && Number.isFinite(parsed.width)
        ? parsed.width
        : DEFAULT_WIDTH;
    const height =
      typeof parsed.height === "number" && Number.isFinite(parsed.height)
        ? parsed.height
        : DEFAULT_HEIGHT;
    return clampDialogSize({ width, height });
  } catch {
    return clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  }
}

export type IntentGenSessionDialogVariant = "intent-generation" | "observation-report";

export type IntentGenSessionDialogProps = {
  open: boolean;
  a2aMessageSendUrl: string;
  agentName: string;
  agentCardWellKnownURI: string;
  intentArtifactLabel: string;
  /** UI copy; observation sessions do not store intent Turtle via this modal. Defaults to intent generation. */
  variant?: IntentGenSessionDialogVariant;
  seedPrompt?: string | null;
  /** When set, Turtle extracted from agent replies is POSTed here (selected KG target ingest endpoint). */
  persistIntentStoreUrl?: string | null;
  /** When set, canonical intent ids from agent Turtle are registered for the current user. */
  intentsRegisterUrl?: string | null;
  registerIntentDomain?: string;
  /** Optional hook for correlating ingest with script run logs. */
  onIntentPersistLog?: (line: string) => void;
  /** Mirror each user/agent transcript turn to the run script log (e.g. workspace Log dialog). */
  onTranscriptTurn?: (turn: { role: "user" | "agent"; text: string }) => void;
  /** Optional external error (e.g. async Prometheus write failure from observation agent polling). */
  externalBannerError?: string | null;
  /** When Turtle is stored successfully, canonical intent id (`I…`) for DSL follow-up bindings. */
  onKgIntentStored?: (
    dslAlias: string,
    canonicalIntentId: string,
    createIntentStorage?: "graphdb" | "prometheus",
  ) => void;
  /** Per-run GraphDB target from Controller runner (A2A metadata.openclaw.graphTarget). */
  graphTargetBinding?: GraphTargetBinding | null;
  observationStorage?: "graphdb" | "prometheus" | null;
  createIntentStorage?: "graphdb" | "prometheus" | null;
  /** From script preparse: observation-report frequency=… (seconds); overrides agent reporting interval. */
  scriptReportingIntervalSeconds?: number;
  /** Live tick progress from observation agent (observation-report variant). */
  observationProgress?: ObservationProgressSnapshot | null;
  observationProgressIntentId?: string | null;
  observationExpectedCompoundMetrics?: readonly string[];
  observationSetupErrors?: readonly ObservationSetupError[];
  observationAwaitingSinceMs?: number;
  observationRawAgentProgress?: ObservationProgressSnapshot | null;
  /** Called once the user chooses to dismiss after the handshake is ready to continue outside the modal. */
  onFinished: () => void;
};

export function IntentGenSessionDialog({
  open,
  a2aMessageSendUrl,
  agentName,
  agentCardWellKnownURI,
  intentArtifactLabel,
  variant = "intent-generation",
  seedPrompt,
  persistIntentStoreUrl,
  intentsRegisterUrl,
  registerIntentDomain,
  onIntentPersistLog,
  onTranscriptTurn,
  externalBannerError = null,
  onKgIntentStored,
  graphTargetBinding = null,
  observationStorage = null,
  createIntentStorage = null,
  scriptReportingIntervalSeconds,
  observationProgress = null,
  observationProgressIntentId = null,
  observationExpectedCompoundMetrics = [],
  observationSetupErrors = [],
  observationAwaitingSinceMs,
  observationRawAgentProgress = null,
  onFinished,
}: IntentGenSessionDialogProps) {
  const { prometheusBaseUrl, graphDbBaseUrl } = useWorkspaceScriptSession();
  const { preference: llmPreference, hasStored: hasLlmPreference } = useAgentLlmPreferences(agentName);
  const taskBindingsRef = useRef<{ taskId?: string; contextId?: string }>({});
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [dialogSize, setDialogSize] = useState<DialogSize>(() =>
    clampDialogSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }),
  );
  const dialogSizeRef = useRef(dialogSize);
  const seedStartedRef = useRef(false);

  const sessionKey = useMemo(
    () => `${variant}::${agentCardWellKnownURI}::${intentArtifactLabel}`,
    [variant, agentCardWellKnownURI, intentArtifactLabel],
  );

  const titleId =
    variant === "observation-report"
      ? "workspace-observation-dialog-title"
      : "workspace-intent-dialog-title";

  const title =
    variant === "observation-report"
      ? "Observation reporting (A2A)"
      : "Intent generation (A2A)";

  const meta =
    variant === "observation-report" ? (
      <p className="workspace-intent-dialog-meta">
        Scripted session alias <strong>{intentArtifactLabel}</strong>. Task and context identifiers are reused for each
        message so follow-ups stay in the same observation-reporting dialogue.
      </p>
    ) : (
      <p className="workspace-intent-dialog-meta">
        Storing conversational output alias <strong>{intentArtifactLabel}</strong>. Task and context identifiers are
        reused for every round trip so follow-up prompts stay grounded in the same working session.
      </p>
    );

  const composePlaceholder =
    variant === "observation-report"
      ? "Refine observation instructions or constraints…"
      : "Respond to the agent or steer the negotiation…";

  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const node = transcriptScrollRef.current;
    if (!node) {
      return;
    }
    const smooth = typeof window.matchMedia !== "function" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const runScroll = () => {
      node.scrollTo({
        behavior: smooth ? "smooth" : "auto",
        top: node.scrollHeight,
      });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(runScroll);
    });
  }, [open, transcript, sending]);

  const resetSession = useCallback(() => {
    taskBindingsRef.current = {};
    setTranscript([]);
    setDraft("");
    setSending(false);
    setBannerError(null);
    seedStartedRef.current = false;
  }, []);

  useEffect(() => {
    if (!open) {
      resetSession();
    }
  }, [open, resetSession]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setDialogSize(readStoredDialogSize());
  }, [open]);

  useEffect(() => {
    dialogSizeRef.current = dialogSize;
  }, [dialogSize]);

  const onDialogResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = dialogSizeRef.current;

    const onMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      setDialogSize(
        clampDialogSize({
          width: startSize.width + deltaX,
          height: startSize.height + deltaY,
        }),
      );
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(
          SIZE_STORAGE_KEY,
          JSON.stringify(dialogSizeRef.current),
        );
      } catch {
        /* ignore quota / private mode */
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    seedStartedRef.current = false;
  }, [sessionKey]);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed.length) {
        return;
      }

      setSending(true);
      setBannerError(null);
      setTranscript((parts) => [
        ...parts,
        { id: crypto.randomUUID(), role: "user", text: trimmed },
      ]);
      onTranscriptTurn?.({ role: "user", text: trimmed });

      try {
        const payload: Record<string, unknown> = {
          wellKnownURI: agentCardWellKnownURI,
          text: trimmed,
        };
        const bindings = taskBindingsRef.current;
        if (bindings.taskId) {
          payload.taskId = bindings.taskId;
        }
        if (bindings.contextId) {
          payload.contextId = bindings.contextId;
        }
        if (graphTargetBinding) {
          payload.graphTarget = graphTargetBinding;
        }
        if (observationStorage) {
          payload.observationStorage = observationStorage;
        }
        if (createIntentStorage) {
          payload.createIntentStorage = createIntentStorage;
        }
        const llmFields = preferenceForOpenClawMetadata(llmPreference, hasLlmPreference);
        if (llmFields.llmModel) {
          payload.llmModel = llmFields.llmModel;
        }
        if (llmFields.temperature !== undefined) {
          payload.temperature = llmFields.temperature;
        }
        if (scriptReportingIntervalSeconds !== undefined) {
          payload.reportingIntervalSeconds = scriptReportingIntervalSeconds;
        } else if (llmFields.reportingIntervalMinutes !== undefined) {
          payload.reportingIntervalMinutes = llmFields.reportingIntervalMinutes;
        }
        const trimmedPrometheusBase = prometheusBaseUrl.trim();
        if (trimmedPrometheusBase) {
          payload.prometheusBaseUrl = trimmedPrometheusBase;
        }

        const response = await fetch(a2aMessageSendUrl, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          visibleText?: string;
          taskId?: string;
          contextId?: string;
          needsInput?: boolean;
        };

        if (!response.ok) {
          const message =
            typeof body.error === "string" ? body.error : `Request failed (${response.status}).`;
          setBannerError(message);
          return;
        }

        const nextTask = typeof body.taskId === "string" ? body.taskId : undefined;
        const nextCtx = typeof body.contextId === "string" ? body.contextId : undefined;

        if (nextTask) {
          taskBindingsRef.current.taskId = nextTask;
        }

        if (nextCtx) {
          taskBindingsRef.current.contextId = nextCtx;
        }

        const replyRaw =
          typeof body.visibleText === "string" ? body.visibleText.trim() : "";
        const reply = replyRaw.length > 0 ? replyRaw : "(Agent returned empty text.)";

        setTranscript((parts) => [
          ...parts,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: reply,
          },
        ]);
        onTranscriptTurn?.({ role: "agent", text: reply });

        const ingestUrl = persistIntentStoreUrl?.trim();
        const turtleFromReply = extractIntentTurtle(replyRaw);
        const turtlePayload = ingestUrl ? turtleFromReply : null;

        const registerCanonicalIntent = async (
          canonical: string,
          storage?: "graphdb" | "prometheus",
        ) => {
          const registerUrl = intentsRegisterUrl?.trim();
          const domain = registerIntentDomain?.trim();
          if (!registerUrl || !domain) {
            return;
          }
          try {
            await fetch(registerUrl, {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                domain,
                intentId: canonical,
                storage,
                prometheusBaseUrl: prometheusBaseUrl.trim() || undefined,
              }),
            });
          } catch {
            // Registration is best-effort; store-intent also registers graphdb path.
          }
        };

        if (ingestUrl && turtlePayload) {
          try {
            const ingestResponse = await fetch(ingestUrl, {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                turtle: turtlePayload,
                storage: createIntentStorage ?? undefined,
                prometheusBaseUrl: prometheusBaseUrl.trim() || undefined,
                graphDbBaseUrl: graphDbBaseUrl.trim() || undefined,
              }),
            });
            const ingestBody = (await ingestResponse.json().catch(() => ({}))) as {
              intentId?: string | null;
              error?: string;
              prometheusMetadata?: { stored: number; failed: number };
            };
            if (ingestResponse.ok) {
              const canonical =
                normalizedIntentIdFromStoreResponse(ingestBody.intentId) ??
                extractIntentLocalIdFromTurtle(turtlePayload);
              const idNote = canonical ?? "unknown-id";
              const metaNote =
                ingestBody.prometheusMetadata &&
                createIntentStorage === "prometheus"
                  ? `; Prometheus query metadata: ${ingestBody.prometheusMetadata.stored} stored${
                      ingestBody.prometheusMetadata.failed > 0
                        ? `, ${ingestBody.prometheusMetadata.failed} failed`
                        : ""
                    }`
                  : "";
              onIntentPersistLog?.(
                `[${idNote}] Stored intent in knowledge graph (${idNote})${metaNote}.`,
              );
              if (canonical && variant === "intent-generation") {
                onKgIntentStored?.(
                  intentArtifactLabel,
                  canonical,
                  createIntentStorage ?? undefined,
                );
                await registerCanonicalIntent(canonical, createIntentStorage ?? undefined);
              }
            } else if (typeof ingestBody.error === "string" && ingestBody.error.length > 0) {
              onIntentPersistLog?.(
                `[${intentArtifactLabel}] Knowledge graph ingest failed: ${ingestBody.error}`,
              );
            } else {
              onIntentPersistLog?.(
                `[${intentArtifactLabel}] Knowledge graph ingest failed with HTTP ${ingestResponse.status}.`,
              );
            }
          } catch (err) {
            onIntentPersistLog?.(
              `[${intentArtifactLabel}] Knowledge graph ingest error: ${String(err)}`,
            );
          }
        } else if (
          variant === "intent-generation" &&
          turtleFromReply &&
          !ingestUrl
        ) {
          const canonical = extractIntentLocalIdFromTurtle(turtleFromReply);
          if (canonical) {
            onKgIntentStored?.(
              intentArtifactLabel,
              canonical,
              createIntentStorage ?? undefined,
            );
            await registerCanonicalIntent(canonical, createIntentStorage ?? undefined);
          }
        }
      } finally {
        setSending(false);
      }
    },
    [
      a2aMessageSendUrl,
      agentCardWellKnownURI,
      persistIntentStoreUrl,
      intentsRegisterUrl,
      registerIntentDomain,
      intentArtifactLabel,
      variant,
      onIntentPersistLog,
      onTranscriptTurn,
      onKgIntentStored,
      graphTargetBinding,
      createIntentStorage,
      prometheusBaseUrl,
      graphDbBaseUrl,
      observationStorage,
      llmPreference,
      hasLlmPreference,
    ],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const seed = (seedPrompt ?? "").trim();

    if (seedStartedRef.current) {
      return;
    }

    seedStartedRef.current = true;

    if (seed.length > 0) {
      void sendText(seed);
    }
  }, [open, seedPrompt, sendText]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || sending) {
        return;
      }
      event.preventDefault();
      onFinished();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onFinished, sending]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workspace-intent-dialog-backdrop"
      onClick={() => {
        if (!sending) {
          onFinished();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        aria-busy={sending}
        className="workspace-intent-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={{
          width: dialogSize.width,
          height: dialogSize.height,
        }}
      >
        <h3 id={titleId}>{title}</h3>
        {meta}

        <div
          aria-live="polite"
          className="workspace-intent-transcript"
          ref={transcriptScrollRef}
          role="log"
        >
          {transcript.length === 0 && !sending ? (
            <span className="workspace-intent-transcript-quiet">Conversation will appear here.</span>
          ) : null}

          {transcript.map((turn) => (
            <div className={`workspace-intent-turn workspace-intent-turn-${turn.role}`} key={turn.id}>
              <span>{turn.role === "user" ? "You" : "Agent"}</span>
              <pre>{turn.text}</pre>
            </div>
          ))}
        </div>

        {bannerError || externalBannerError ? (
          <p className="workspace-intent-dialog-error" role="alert">
            {bannerError ?? externalBannerError}
          </p>
        ) : null}

        {variant === "observation-report" &&
        observationProgress &&
        observationProgress.mode === "historic" ? (
          <ObservationProgressBar
            awaitingSinceMs={observationAwaitingSinceMs}
            expectedCompoundMetrics={observationExpectedCompoundMetrics}
            intentId={observationProgressIntentId}
            progress={observationProgress}
            rawAgentProgress={observationRawAgentProgress}
            setupErrors={observationSetupErrors}
          />
        ) : null}

        <div className="workspace-intent-compose">
          <label className="workspace-label" htmlFor="workspace-intent-message">
            Your message
          </label>
          {sending ? (
            <p
              aria-live="polite"
              className="workspace-intent-compose-waiting workspace-intent-wait-under-you"
              role="status"
            >
              <span aria-hidden="true" className="workspace-intent-hourglass">
                ⌛
              </span>
              <span>
                Waiting for the agent—please wait before typing or sending another message.
              </span>
            </p>
          ) : null}
          <textarea
            className="workspace-intent-dialog-textarea"
            disabled={sending}
            id="workspace-intent-message"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={composePlaceholder}
            rows={4}
            value={draft}
          />
        </div>

        <div className="workspace-intent-dialog-footer">
          <div className="workspace-intent-dialog-actions">
            <button
              className="workspace-button"
              disabled={sending || !draft.trim().length}
              onClick={() => {
                void sendText(draft);
                setDraft("");
              }}
              type="button"
            >
              Send
            </button>
            <button
              className="workspace-button workspace-button-secondary"
              disabled={sending}
              onClick={onFinished}
              type="button"
            >
              Close
            </button>
          </div>
          <div
            aria-label="Resize dialog"
            className="workspace-intent-dialog-resizer"
            onMouseDown={onDialogResizeMouseDown}
            role="separator"
            title="Drag to resize"
          />
        </div>
      </div>
    </div>
  );
}
