import { applyPostprocessor } from "@intent-gen-package/tools/postprocess/coordinationUtility";

/**
 * Last-chance normalization before GraphDB ingest when the agent returned a
 * coordination utility draft with incomplete mf:logistic calls.
 */
export function normalizeIntentTurtleOnIngest(turtle: string): string {
  return applyPostprocessor({
    text: turtle,
    context: { intentFlags: {}, runtimeContext: "", userPrompt: "" },
  }).text;
}
