import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FragmentGenerationEngine } from "../core/fragmentGenerationEngine.js";
import type { ChatSession } from "../models.js";
import type { LoadedDomainPackage } from "../core/packageLoader.js";

const packageDir = join(
  process.cwd(),
  "packages/5g4data-intent-mistral-small4-langgraph-generating-agent"
);

function minimalPackage(): LoadedDomainPackage {
  return {
    packageDir,
    manifest: { name: "5g4data-intent-mistral-small4-langgraph-generating-agent", version: "1.0.0" },
    workflow: {
      fragments: [],
      stages: [],
      generation: {
        mode: "fragmented",
        canonicalPrefixesFile: "templates/canonical-prefixes.ttl",
        assemblerModule: "tools/assembleIntent.ts",
        fragments: [
          {
            id: "deployment",
            whenIntentFlags: ["deployment"],
            promptModule: "fragment-deployment"
          }
        ]
      }
    },
    classificationRules: { intentFlags: {} },
    contextRules: {
      baseCapabilities: [],
      intentCapabilities: {},
      prompts: {
        runtimeContextHeader: "",
        deploymentDatacenterClarificationTag: "",
        selectedWorkloadTag: ""
      }
    },
    validatorRules: { forbiddenPhrases: [], requiredTokens: [], conditionalRequirements: [] },
    toolBindings: { capabilities: {} },
    postprocessors: [],
    systemPromptText: "system",
    promptModules: {
      defaults: "defaults",
      "reporting-storage": "reporting",
      "fragment-deployment": "emit deployment CO CX DE RE body only"
    }
  } as unknown as LoadedDomainPackage;
}

test("FragmentGenerationEngine invokes one fragment and assembles Turtle", async () => {
  const engine = new FragmentGenerationEngine();
  const session: ChatSession = {
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    messages: [
      { role: "user", text: "deploy llm", createdAt: new Date().toISOString() },
      { role: "assistant", text: "Type OK to confirm", createdAt: new Date().toISOString() }
    ]
  };
  let calls = 0;
  const result = await engine.generate({
    session,
    domainPackage: minimalPackage(),
    intentFlags: { deployment: true, locality: false, networkQos: false },
    effectiveUserText: "deploy llm near Tromso",
    runtimeContext: "objectives: p99-token-target",
    reportingIntervalHint: "interval 10 min",
    invokeModel: async () => {
      calls += 1;
      return {
        text: `data5g:CO__ID_CONDITION_1__ a icm:Condition ;
    dct:description "token" ;
    log:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO__ID_CONDITION_1__ ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:CX__ID_CONTEXT_1__ a icm:Context ;
    data5g:Application "rusty-llm" ;
    data5g:DataCenter "EC_31" .

data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation, icm:Expectation, icm:IntentElement ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO__ID_CONDITION_1__, data5g:CX__ID_CONTEXT_1__ .

data5g:RE__ID_REPORTING_DEPLOYMENT_1__ a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] .`,
        call: {
          stage: "fragment_deployment",
          provider: "openai",
          model: "gpt-4o-mini",
          temperature: 0,
          temperatureSent: true,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          latencyMs: 1,
          usageKnown: true
        }
      };
    },
    modelInvokeOptions: (stage) => ({ stage }),
    debug: []
  });

  assert.equal(calls, 1);
  assert.equal(result.fragmentIds.length, 1);
  assert.match(result.text, /@prefix\s+data5g:/);
  assert.match(result.text, /a icm:Intent/);
  assert.match(result.text, /DE__ID_DEPLOYMENT_1__/);
  assert.ok(session.intentDraft?.fragments.length === 1);
});
