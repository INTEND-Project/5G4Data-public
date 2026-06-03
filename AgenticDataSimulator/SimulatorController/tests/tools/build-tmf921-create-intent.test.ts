import { describe, expect, it } from "vitest";

import {
  buildTmf921CreateIntentPayload,
  rewriteHandlerInTurtle,
} from "../../src/lib/tools/build-tmf921-create-intent";

const SAMPLE_TURTLE = `
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa a icm:Intent ;
    imo:handler "inServ" ;
    dct:description "Edge LLM" .
`.trim();

describe("build-tmf921-create-intent", () => {
  it("rewrites imo:handler to the target tool", () => {
    const rewritten = rewriteHandlerInTurtle(SAMPLE_TURTLE, "inCoord");
    expect(rewritten).toContain('imo:handler "inCoord"');
    expect(rewritten).not.toContain('imo:handler "inServ"');
  });

  it("builds TMF921 payload with turtle expression and metadata", () => {
    const payload = buildTmf921CreateIntentPayload({
      turtle: SAMPLE_TURTLE,
      toolId: "inSustain",
      intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      description: "Edge LLM deployment",
    });

    expect(payload["@type"]).toBe("Intent");
    expect(payload.name).toBe("Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(payload.description).toBe("Edge LLM deployment");
    expect(payload.expression["@type"]).toBe("TurtleExpression");
    expect(payload.expression.expressionValue).toContain('imo:handler "inSustain"');
  });

  it("falls back description when missing", () => {
    const payload = buildTmf921CreateIntentPayload({
      turtle: SAMPLE_TURTLE,
      toolId: "inExplain",
      intentId: "Ibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      description: null,
    });

    expect(payload.description).toContain("inExplain");
    expect(payload.description).toContain("Ibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });
});
