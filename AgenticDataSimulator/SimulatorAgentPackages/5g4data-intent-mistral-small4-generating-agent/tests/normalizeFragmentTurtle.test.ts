import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFragmentTurtle } from "../tools/normalizeFragmentTurtle.ts";

test("normalizeFragmentTurtle inserts semicolon before following predicate", () => {
  const input = `data5g:SE1 a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:CO1, data5g:CX1
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "sustainability" });
  assert.ok(result.changes > 0);
  assert.match(result.text, /data5g:CX1\s*;/);
});

test("normalizeFragmentTurtle fixes coordination reportDestinations before reportTriggers", () => {
  const input = `data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ]
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventCoordination_CE1 ] .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "coordination" });
  assert.ok(result.changes > 0);
  assert.match(result.text, /rdfs:member data5g:prometheus \]\s*;/);
});

test("normalizeFragmentTurtle fixes deployment RE containers and orphan semicolons", () => {
  const input = `data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ]
    ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventDeployment_CO1 ] .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "deployment" });
  assert.ok(result.changes > 0);
  assert.doesNotMatch(result.text, /^\s*;\s*$/m);
  assert.match(result.text, /rdfs:member data5g:prometheus \]\s*;/);
});

test("normalizeFragmentTurtle appends terminal period for truncated deployment fragment", () => {
  const input = `data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO1, data5g:CX1 ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute `;
  const result = normalizeFragmentTurtle(input, { fragmentId: "deployment" });
  assert.ok(result.changes > 0);
  assert.match(result.text, /time:unitMinute\s*\./);
});

test("normalizeFragmentTurtle does not duplicate semicolon on already-terminated RE block", () => {
  const input = `data5g:RE1 a icm:ObservationReportingExpectation ;
    icm:target data5g:coordination-service ;
    icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:prometheus ] ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventCoordination_CE1 ] .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "coordination" });
  assert.doesNotMatch(result.text, /prometheus \]\s*;\s*;/);
});

test("normalizeFragmentTurtle preserves comma continuation in multiline log:allOf", () => {
  const input = `data5g:DE1 a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO1__,
        data5g:CX1__ ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "deployment" });
  assert.doesNotMatch(result.text, /data5g:CO1__,\s*;/);
  assert.match(result.text, /log:allOf data5g:CO1__,\s*\n\s*data5g:CX1__/);
});

test("normalizeFragmentTurtle removes duplicate semicolons after set:forAll block", () => {
  const input = `data5g:CO1 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO1 ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] ;
    ;
    dct:description "token" .`;
  const result = normalizeFragmentTurtle(input, { fragmentId: "deployment" });
  assert.ok(result.changes > 0);
  assert.doesNotMatch(result.text, /\]\s*;\s*\n\s*;\s*\n/);
});
