import type { DslDiagnostic } from "@/lib/dsl/types";
import {
  formatHistoricTickCapExceededMessage,
  parseHistoricObservationWindow,
  readSynthObsHistoricMaxPoints,
} from "@/lib/dsl/historic-observation-ticks";

export function validateHistoricObservationTickCap(
  line: number,
  instructions: string,
  maxPoints = readSynthObsHistoricMaxPoints(),
): DslDiagnostic | null {
  const window = parseHistoricObservationWindow(instructions);
  if (!window) {
    return null;
  }

  if (window.tickCount <= maxPoints) {
    return null;
  }

  return {
    line,
    severity: "error",
    code: "HISTORIC_TICK_CAP_EXCEEDED",
    message: formatHistoricTickCapExceededMessage(window, maxPoints),
  };
}
