import type { ObservationStorageType } from "@/lib/observation-storage";

export type IntentListEntryLike = {
  intentId: string;
  storage: ObservationStorageType;
  grafanaUrl: string | null;
};

export function intentsEqual(left: IntentListEntryLike[], right: IntentListEntryLike[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (intent, index) =>
      intent.intentId === right[index]?.intentId &&
      intent.storage === right[index]?.storage &&
      intent.grafanaUrl === right[index]?.grafanaUrl,
  );
}
