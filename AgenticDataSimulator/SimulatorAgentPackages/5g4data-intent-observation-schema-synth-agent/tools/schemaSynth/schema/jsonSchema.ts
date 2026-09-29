import { zodToJsonSchema } from "zod-to-json-schema";
import { ConstraintDocumentSchema } from "./types.js";

/** JSON Schema for LLM structured output prompts. */
export function constraintJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(ConstraintDocumentSchema, {
    name: "ConstraintDocument",
    $refStrategy: "none"
  }) as Record<string, unknown>;
}

export function constraintJsonSchemaText(): string {
  return JSON.stringify(constraintJsonSchema(), null, 2);
}
