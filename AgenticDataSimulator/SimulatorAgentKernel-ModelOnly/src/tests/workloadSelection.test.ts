import test from "node:test";
import assert from "node:assert/strict";
import { selectChartFromCatalogue } from "../core/workloadSelection.js";

test("selectChartFromCatalogue matches chart name substring", () => {
  const charts = [
    { name: "rusty-llm", description: "Small LLM inference workload" },
    { name: "other-chart", description: "Something else" },
  ];
  const selected = selectChartFromCatalogue("Deploy rusty-llm near Tromsø", charts);
  assert.equal(selected, "rusty-llm");
});

test("selectChartFromCatalogue scores generic llm wording", () => {
  const charts = [
    { name: "rusty-llm", description: "Small LLM inference workload" },
    { name: "avalanche-detection", description: "Object detection at the edge" },
  ];
  const prompt =
    "I want to experiment with a small llm in a datacenter near Tromsø/Norway in a sustainable manner";
  const selected = selectChartFromCatalogue(prompt, charts);
  assert.equal(selected, "rusty-llm");
});

test("selectChartFromCatalogue returns null when no chart matches", () => {
  const charts = [{ name: "only-one", description: "Unrelated workload" }];
  const selected = selectChartFromCatalogue("Need bandwidth for video streaming", charts);
  assert.equal(selected, null);
});
