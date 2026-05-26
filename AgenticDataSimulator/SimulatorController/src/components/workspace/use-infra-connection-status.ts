"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  infraPollIntervalMs,
  infraStatusEquals,
} from "@/components/workspace/infra-connection-status";
import type { InfraConnectionStatus } from "@/lib/infra/connection-status";

export function useInfraConnectionStatus(
  initialStatus: InfraConnectionStatus,
  statusApiUrl: string,
): InfraConnectionStatus {
  const [status, setStatus] = useState(initialStatus);
  const statusRef = useRef(status);

  useEffect(() => {
    setStatus(initialStatus);
    statusRef.current = initialStatus;
  }, [initialStatus]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const fetchStatus = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    try {
      const response = await fetch(statusApiUrl, { cache: "no-store" });

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

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const schedule = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }

      intervalId = setInterval(() => {
        void fetchStatus();
      }, infraPollIntervalMs(statusRef.current));
    };

    schedule();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void fetchStatus();
        schedule();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchStatus, status]);

  return status;
}
