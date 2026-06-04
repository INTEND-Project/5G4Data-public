"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  infraPollIntervalMs,
  infraStatusEquals,
} from "@/components/workspace/infra-connection-status";
import { useWorkspaceScriptSession } from "@/components/workspace/workspace-script-session-context";
import type { InfraConnectionStatus } from "@/lib/infra/connection-status";

export function useInfraConnectionStatus(
  initialStatus: InfraConnectionStatus,
  statusApiUrl: string,
): InfraConnectionStatus {
  const [status, setStatus] = useState(initialStatus);
  const statusRef = useRef(status);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const fetchStatus = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    try {
      const response = await fetch(statusApiUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as InfraConnectionStatus;

      if (!infraStatusEquals(statusRef.current, payload)) {
        setStatus(payload);
      }
    } catch {
      /* keep last known state; next tick retries */
    }
  }, [statusApiUrl]);

  const schedule = useCallback(() => {
    if (intervalIdRef.current !== undefined) {
      clearInterval(intervalIdRef.current);
    }

    intervalIdRef.current = setInterval(() => {
      void fetchStatus();
    }, infraPollIntervalMs(statusRef.current));
  }, [fetchStatus]);

  useEffect(() => {
    void fetchStatus();
    schedule();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void fetchStatus();
        schedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalIdRef.current !== undefined) {
        clearInterval(intervalIdRef.current);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchStatus, schedule]);

  useEffect(() => {
    schedule();
  }, [status, schedule]);

  return status;
}

/** Polls infra status using the workspace Prometheus base URL from session context. */
export function useWorkspaceInfraConnectionStatus(
  initialStatus: InfraConnectionStatus,
  statusApiUrl: string,
): InfraConnectionStatus {
  const { prometheusBaseUrl } = useWorkspaceScriptSession();
  const resolvedStatusApiUrl = useMemo(() => {
    const trimmed = prometheusBaseUrl.trim();
    if (!trimmed) {
      return statusApiUrl;
    }
    const params = new URLSearchParams({ prometheusBaseUrl: trimmed });
    const separator = statusApiUrl.includes("?") ? "&" : "?";
    return `${statusApiUrl}${separator}${params.toString()}`;
  }, [prometheusBaseUrl, statusApiUrl]);

  return useInfraConnectionStatus(initialStatus, resolvedStatusApiUrl);
}
