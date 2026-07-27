import type { ExtraFunctionalToolId } from "@/lib/tools/extra-functional-tools";

export type Tmf921TurtleExpression = {
  "@type": "TurtleExpression";
  iri: string;
  expressionValue: string;
};

export type Tmf921CreateIntentBody = {
  "@type": "Intent";
  name: string;
  description: string;
  expression: Tmf921TurtleExpression;
};

const HANDLER_PATTERN = /imo:handler\s+"[^"]*"/g;

export function rewriteHandlerInTurtle(turtle: string, toolId: ExtraFunctionalToolId): string {
  if (HANDLER_PATTERN.test(turtle)) {
    HANDLER_PATTERN.lastIndex = 0;
    return turtle.replace(HANDLER_PATTERN, `imo:handler "${toolId}"`);
  }
  return turtle;
}

export function buildTmf921CreateIntentPayload(input: {
  turtle: string;
  toolId: ExtraFunctionalToolId;
  intentId: string;
  description?: string | null;
}): Tmf921CreateIntentBody {
  const expressionValue = rewriteHandlerInTurtle(input.turtle.trim(), input.toolId);
  const description =
    input.description?.trim() ||
    `Intent ${input.intentId} forwarded to ${input.toolId}`;
  const name = input.intentId;

  return {
    "@type": "Intent",
    name,
    description,
    expression: {
      "@type": "TurtleExpression",
      iri: `https://5g4data.eu/intent/${input.intentId}`,
      expressionValue,
    },
  };
}
