import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleIntent } from "../tools/assembleIntent.ts";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

test("assembleIntent builds Intent log:allOf from fragment locals", () => {
  const result = assembleIntent({
    packageDir,
    userPrompt: "deploy llm",
    draft: {
      intentDescription: "deploy llm",
      fragments: [
        {
          id: "deployment",
          turtle: `data5g:DEabc a data5g:DeploymentExpectation, icm:Expectation ;
    icm:target data5g:deployment .

data5g:REdef a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment .`,
          locals: ["DEabc", "REdef"]
        }
      ]
    }
  });

  assert.match(result.text, /log:allOf data5g:DEabc,\s*data5g:REdef/);
  assert.match(result.text, /@prefix\s+icm:/);
  assert.equal(result.members.length, 2);
});
