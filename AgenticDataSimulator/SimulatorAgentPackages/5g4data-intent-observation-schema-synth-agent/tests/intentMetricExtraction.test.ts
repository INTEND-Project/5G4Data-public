import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCompoundMetricNamesFromIntentTurtle,
  extractConditionMetricsFromIntentTurtle,
} from "../tools/intentMetricExtraction.js";

const PRETTY_ALLOF_CONDITION = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

data5g:COce1e3ee76f224ea6a18f4609aecc2646 a icm:Condition ;
    log:allOf [
        icm:valuesOfTargetProperty data5g:p99-token-target_COce1e3ee76f224ea6a18f4609aecc2646 ;
        quan:larger [
            quan:unit "token/s" ;
            rdf:value 400
        ]
    ] .

data5g:CO99ece4f710eb41eabcc5695e3f5a869d a icm:Condition ;
    log:allOf [
        icm:valuesOfTargetProperty data5g:energy-consumption_CO99ece4f710eb41eabcc5695e3f5a869d ;
        quan:smaller [
            quan:unit "J" ;
            rdf:value 50
        ]
    ] .
`.trim();

const CANONICAL_FORALL = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

data5g:COe8af1c5b33734c109cf68d0025998898 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COe8af1c5b33734c109cf68d0025998898 ;
        quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .
`.trim();

/** Post-tioDialect form: RDF list wrappers around forAll blank + valuesOfTargetProperty. */
const TIO_DIALECT_RDF_LISTS = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

data5g:CO3113b91d60f149078778f43e1036d0ee a log:Condition ;
    set:forAll ( [ icm:valuesOfTargetProperty ( data5g:p99-token-target_CO3113b91d60f149078778f43e1036d0ee ) ;
            quan:atLeast ( [ a quan:Quantity ; quan:unit "token/s" ;
                    rdf:value 250 ] ) ] ) .

data5g:CO502c8ff2338d41c4b2611c478d92c9df a log:Condition ;
    set:forAll ( [ icm:valuesOfTargetProperty ( data5g:power-consumption_CO502c8ff2338d41c4b2611c478d92c9df ) ;
            quan:smaller ( [ a quan:Quantity ; quan:unit "W" ;
                    rdf:value 70 ] ) ] ) .
`.trim();

test("extracts metrics from pretty-printed log:allOf condition blocks", () => {
  const names = extractCompoundMetricNamesFromIntentTurtle(PRETTY_ALLOF_CONDITION);
  assert.deepEqual(names.sort(), [
    "energy-consumption_CO99ece4f710eb41eabcc5695e3f5a869d",
    "p99-token-target_COce1e3ee76f224ea6a18f4609aecc2646",
  ]);
});

test("extracts metrics from canonical set:forAll inline blocks", () => {
  const metrics = extractConditionMetricsFromIntentTurtle(CANONICAL_FORALL);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0]?.compoundMetric, "p99-token-target_COe8af1c5b33734c109cf68d0025998898");
  assert.equal(metrics[0]?.unit, "token/s");
});

test("extracts metrics from inlined set:forAll blocks", () => {
  const turtle = `
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

data5g:CO1 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:lat_CO1 ;
        quan:smaller [ quan:unit "ms" ; rdf:value 20.0 ] ] .
`.trim();
  const names = extractCompoundMetricNamesFromIntentTurtle(turtle);
  assert.deepEqual(names, ["lat_CO1"]);
});

test("extracts metrics from TIO dialect RDF-list wrappers", () => {
  const metrics = extractConditionMetricsFromIntentTurtle(TIO_DIALECT_RDF_LISTS);
  const names = metrics.map((m) => m.compoundMetric).sort();
  assert.deepEqual(names, [
    "p99-token-target_CO3113b91d60f149078778f43e1036d0ee",
    "power-consumption_CO502c8ff2338d41c4b2611c478d92c9df",
  ]);
  const p99 = metrics.find((m) => m.compoundMetric.startsWith("p99-"));
  assert.equal(p99?.unit, "token/s");
});
