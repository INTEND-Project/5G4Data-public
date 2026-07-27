import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPostprocessor,
  dedupeCollection,
  dedupePredicateCollection,
  dedupeTimeDelayTuples,
  dedupeTurtleCollections,
  splitCollectionMembers,
  stripMisplacedEventPredicates
} from "../tools/postprocess/turtleCollectionDedupe.ts";

test("splitCollectionMembers splits top-level ], [ while preserving nested brackets", () => {
  const inner = `icm:valuesOfTargetProperty data5g:metric_CO1 ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ], [
        icm:valuesOfTargetProperty data5g:metric_CO1 ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ]`;
  const members = splitCollectionMembers(inner);
  assert.equal(members.length, 2);
});

test("dedupeCollection collapses duplicate set:forAll members by valuesOfTargetProperty", () => {
  const inner = `icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ], [
    icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ]`;
  const result = dedupeCollection(inner);
  assert.ok(result.changes > 0);
  assert.equal(splitCollectionMembers(result.text).length, 1);
});

test("dedupeCollection preserves distinct metric members", () => {
  const inner = `icm:valuesOfTargetProperty data5g:p99-token-target_CO1 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ], [
    icm:valuesOfTargetProperty data5g:energy-consumption_CO2 ;
        quan:smaller [ quan:unit "J" ; rdf:value 50 ] ]`;
  const result = dedupeCollection(inner);
  assert.equal(result.changes, 0);
  assert.equal(splitCollectionMembers(result.text).length, 2);
});

test("dedupePredicateCollection removes duplicate condition set:forAll members", () => {
  const block = `data5g:CO903c65898f9a4639a525d649c699e6a0 a icm:Condition ;
    dct:description "p99-token-target condition quan:larger: 400 token/s" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [
            quan:unit "token/s" ;
            rdf:value 400
            ]
        ], [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [
            quan:unit "token/s" ;
            rdf:value 400
            ]
        ] .`;
  const result = dedupePredicateCollection(block, "set:forAll");
  assert.ok(result.changes > 0);
  const matches = [...result.text.matchAll(/valuesOfTargetProperty/gi)];
  assert.equal(matches.length, 1);
});

test("dedupeTurtleCollections removes duplicate reportDestinations and reportTriggers", () => {
  const input = `data5g:RE802d9bce6b50463c837617cc6cdd66a6 a icm:ObservationReportingExpectation ;
    dct:description "Deployment observation reports on the configured interval." ;
    icm:target data5g:deployment ;
    icm:reportDestinations [
        a rdfs:Container ;
        rdfs:member data5g:prometheus
        ], [
        a rdfs:Container ;
        rdfs:member data5g:prometheus
        ]  ;
    icm:reportTriggers [
        a rdfs:Container ;
        rdfs:member data5g:TenMinuteReportEventDeployment_CO903
        ], [
        a rdfs:Container ;
        rdfs:member data5g:TenMinuteReportEventDeployment_CO903
        ]  .`;
  const result = dedupeTurtleCollections(input);
  assert.ok(result.changes > 0);
  assert.equal([...result.text.matchAll(/icm:reportDestinations/gi)].length, 1);
  assert.equal([...result.text.matchAll(/rdfs:member data5g:prometheus/gi)].length, 1);
  assert.equal([...result.text.matchAll(/icm:reportTriggers/gi)].length, 1);
});

test("dedupeTimeDelayTuples collapses duplicate delay tuples", () => {
  const block = `data5g:DEa7854befcf7a4bff8a8e31180a1de71e a data5g:DeploymentExpectation ;
    time:delay ( data5g:lastReportInstant data5g:durationDeployment_CO903 ), ( data5g:lastReportInstant data5g:durationDeployment_CO903 ) ;`;
  const result = dedupeTimeDelayTuples(block);
  assert.ok(result.changes > 0);
  assert.equal([...result.text.matchAll(/time:delay/gi)].length, 1);
  assert.doesNotMatch(result.text, /time:delay[^;]*,[^;]*\(/);
});

test("stripMisplacedEventPredicates removes event fields from DeploymentExpectation", () => {
  const block = `data5g:DEa7854befcf7a4bff8a8e31180a1de71e a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    imo:eventFor data5g:DEa7854befcf7a4bff8a8e31180a1de71e ;
    time:delay ( data5g:lastReportInstant data5g:durationDeployment_CO903 ) ;
    rdfs:subClassOf imo:Event .`;
  const result = stripMisplacedEventPredicates(block);
  assert.ok(result.changes > 0);
  assert.doesNotMatch(result.text, /imo:eventFor/);
  assert.doesNotMatch(result.text, /rdfs:subClassOf imo:Event/);
  assert.doesNotMatch(result.text, /time:delay/);
});

test("applyPostprocessor dedupes full intent turtle with duplicate condition", () => {
  const input = `data5g:CO903c65898f9a4639a525d649c699e6a0 a icm:Condition ;
    dct:description "p99-token-target condition quan:larger: 400 token/s" ;
    set:forAll [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
        ], [
        icm:valuesOfTargetProperty data5g:p99-token-target_CO903c65898f9a4639a525d649c699e6a0 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ]
        ] .`;
  const result = applyPostprocessor({ text: input });
  assert.ok(result.changes > 0);
  assert.equal([...result.text.matchAll(/valuesOfTargetProperty/gi)].length, 1);
});
