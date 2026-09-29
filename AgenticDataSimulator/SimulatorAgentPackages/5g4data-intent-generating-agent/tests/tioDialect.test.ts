import test from "node:test";
import assert from "node:assert/strict";
import { Parser } from "n3";
import { applyPostprocessor } from "../tools/postprocess/tioDialect.js";

const PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
`;

function assertParsesAsTurtle(text: string): void {
  const parser = new Parser({ format: "text/turtle" });
  assert.doesNotThrow(() => {
    for (const _quad of parser.parse(text)) {
      // exhaust parser for syntax errors
    }
  });
}

test("tioDialect rewrites Condition, larger, managers, events, and RDF lists", () => {
  const input = `${PREFIXES}
data5g:I1 a icm:Intent ;
    imo:handler "inServ" ;
    imo:owner "inChat" ;
    log:allOf data5g:DE1, data5g:RE1 .

data5g:CO1 a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:metric_CO1 ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:Evt1 a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    imo:eventFor data5g:DE1 .
`;

  const result = applyPostprocessor({ text: input, context: {} });
  assert.ok(result.changes > 0);
  assert.match(result.text, /a log:Condition/);
  assert.doesNotMatch(result.text, /\bicm:Condition\b/);
  assert.match(result.text, /quan:greater/);
  assert.doesNotMatch(result.text, /quan:larger/);
  assert.match(result.text, /imo:handler data5g:inServ/);
  assert.match(result.text, /data5g:inServ a imo:IntentManager/);
  assert.match(result.text, /log:allOf \( data5g:DE1 data5g:RE1 \)/);
  assert.match(result.text, /set:forAll \(\s*\[/);
  assert.match(result.text, /icm:valuesOfTargetProperty \( data5g:metric_CO1 \)/);
  assert.match(result.text, /a quan:Quantity/);
  assert.match(result.text, /data5g:Evt1 a imo:Event ;/);
  assert.doesNotMatch(result.text, /rdfs:subClassOf imo:Event/);
  // Must keep quantifier predicates inside the set:forAll blank node (not truncate at `;`).
  assert.match(
    result.text,
    /set:forAll \(\s*\[\s*icm:valuesOfTargetProperty \( data5g:metric_CO1 \) \s*;\s*quan:greater/
  );
  assert.doesNotMatch(result.text, /valuesOfTargetProperty \( data5g:metric_CO1 \) \) \s*;/);
  assertParsesAsTurtle(result.text);
});

test("tioDialect wraps multi-property set:forAll blanks as RDF lists without truncation", () => {
  const input = `${PREFIXES}
data5g:I1 a icm:Intent ;
    imo:handler data5g:inServ ;
    log:allOf data5g:DE1 .

data5g:CO1 a log:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:any-stem_COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;
            quan:atLeast [ quan:unit "unit" ; rdf:value 250 ] ] .
`;
  const result = applyPostprocessor({ text: input, context: {} });
  assertParsesAsTurtle(result.text);
  assert.match(result.text, /set:forAll \(\s*\[/);
  assert.match(result.text, /quan:atLeast \( \[/);
  assert.match(
    result.text,
    /set:forAll \(\s*\[\s*icm:valuesOfTargetProperty \( data5g:any-stem_COaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \) \s*;\s*quan:atLeast/
  );
});
