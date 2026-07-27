import Image from "next/image";

import { withAppBasePath } from "@/lib/app-paths";
import type { ObservationStorageType } from "@/lib/observation-storage";

type IconSizeProps = {
  size?: number;
};

function DeleteIcon({ size = 18 }: IconSizeProps) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9z"
        fill="currentColor"
      />
    </svg>
  );
}

function StorageBadgeIcon({
  storage,
  size = 10,
}: IconSizeProps & { storage: ObservationStorageType }) {
  const src =
    storage === "prometheus"
      ? withAppBasePath("/icons/prometheus.svg")
      : withAppBasePath("/icons/graphdb.svg");

  return (
    <Image
      alt=""
      aria-hidden="true"
      className="workspace-icon-badge-image"
      height={size}
      src={src}
      width={size}
    />
  );
}

export function GrafanaIcon({ size = 18 }: IconSizeProps) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className="workspace-storage-brand-icon"
      height={size}
      src={withAppBasePath("/icons/grafana.svg")}
      width={size}
    />
  );
}

type DeleteStorageIconProps = {
  storage: ObservationStorageType;
  size?: number;
};

export function DeleteStorageIcon({ storage, size = 18 }: DeleteStorageIconProps) {
  return (
    <span className="workspace-icon-badge-button">
      <span className="workspace-icon-badge" aria-hidden="true">
        <StorageBadgeIcon size={10} storage={storage} />
      </span>
      <DeleteIcon size={size} />
    </span>
  );
}

export function deleteInStorageLabel(storage: ObservationStorageType): string {
  return storage === "prometheus" ? "Delete in Prometheus" : "Delete in GraphDB";
}

export function deleteInStorageConfirmMessage(intentId: string, storage: ObservationStorageType): string {
  if (storage === "prometheus") {
    return (
      `Delete in Prometheus for intent ${intentId}? Pushgateway samples and TSDB series for this intent will be removed. ` +
      "On the local Prometheus stack, historic out-of-order samples require a brief TSDB rewrite: Prometheus stops for a short time and restarts automatically when the delete finishes."
    );
  }

  return `Delete in GraphDB for intent ${intentId}? Observation triples and report metadata for this intent will be removed. The intent definition stays in the knowledge graph.`;
}
