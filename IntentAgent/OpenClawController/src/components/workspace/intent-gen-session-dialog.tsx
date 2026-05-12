"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TranscriptTurn = {
  id: string;
  role: "user" | "agent";
  text: string;
};

export type IntentGenSessionDialogProps = {
  open: boolean;
  a2aMessageSendUrl: string;
  agentCardWellKnownURI: string;
  intentArtifactLabel: string;
  seedPrompt?: string | null;
  /** Called once the user chooses to dismiss after the handshake is ready to continue outside the modal. */
  onFinished: () => void;
};

export function IntentGenSessionDialog({
  open,
  a2aMessageSendUrl,
  agentCardWellKnownURI,
  intentArtifactLabel,
  seedPrompt,
  onFinished,
}: IntentGenSessionDialogProps) {
  const taskBindingsRef = useRef<{ taskId?: string; contextId?: string }>({});
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const seedStartedRef = useRef(false);

  const sessionKey = useMemo(
    () => `${agentCardWellKnownURI}::${intentArtifactLabel}`,
    [agentCardWellKnownURI, intentArtifactLabel],
  );

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

        const reply =
          typeof body.visibleText === "string"
            ? body.visibleText.trim()
            : "(Agent returned empty text.)";
        setTranscript((parts) => [
          ...parts,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: reply || "(Agent returned empty text.)",
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [a2aMessageSendUrl, agentCardWellKnownURI],
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
        aria-labelledby="workspace-intent-dialog-title"
        aria-modal="true"
        aria-busy={sending}
        className="workspace-intent-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="workspace-intent-dialog-title">Intent generation (A2A)</h3>
        <p className="workspace-intent-dialog-meta">
          Storing conversational output alias <strong>{intentArtifactLabel}</strong>. Task and context identifiers are
          reused for every round trip so follow-up prompts stay grounded in the same working session.
        </p>

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

        {bannerError ? (
          <p className="workspace-intent-dialog-error" role="alert">
            {bannerError}
          </p>
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
            placeholder="Respond to the agent or steer the negotiation…"
            rows={4}
            value={draft}
          />
        </div>

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
      </div>
    </div>
  );
}
