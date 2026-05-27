import test from "node:test";
import assert from "node:assert/strict";
import { formatMetricSummaryLine } from "../tools/objectiveSummaryFormat.js";

test("formatMetricSummaryLine emits all tmf hint fields", () => {
  const line = formatMetricSummaryLine({
    name: "p99-token-target",
    value: 0.0,
    "tmf-value-hint": "400",
    "tmf-quantifier-hint": "quan:larger",
    "tmf-unit-hint": "token/s",
    measuredBy: "intend/p99token"
  });
  assert.equal(
    line,
    "- p99-token-target: threshold=400 (source=tmf-value-hint), quantifier=quan:larger (source=tmf-quantifier-hint), unit=token/s (source=tmf-unit-hint), measuredBy=intend/p99token"
  );
});

test("formatMetricSummaryLine falls back to value and omits absent hints", () => {
  const line = formatMetricSummaryLine({
    name: "latency-target",
    value: "25"
  });
  assert.equal(line, "- latency-target: threshold=25 (source=value)");
});

test("formatMetricSummaryLine includes sustainability hints", () => {
  const line = formatMetricSummaryLine({
    name: "container-cpu-watts",
    value: "5000.0",
    "tmf-value-hint": "5000",
    "tmf-quantifier-hint": "quan:smaller",
    "tmf-unit-hint": "W",
    measuredBy: "intend/container-cpu-watts"
  });
  assert.match(line, /threshold=5000 \(source=tmf-value-hint\)/);
  assert.match(line, /quantifier=quan:smaller \(source=tmf-quantifier-hint\)/);
  assert.match(line, /unit=W \(source=tmf-unit-hint\)/);
  assert.match(line, /measuredBy=intend\/container-cpu-watts/);
});
