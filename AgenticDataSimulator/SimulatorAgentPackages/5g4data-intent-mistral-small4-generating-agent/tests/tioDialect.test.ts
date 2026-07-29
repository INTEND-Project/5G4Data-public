import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/tioDialect.js";

const PREFIXES = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
`;

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
});
