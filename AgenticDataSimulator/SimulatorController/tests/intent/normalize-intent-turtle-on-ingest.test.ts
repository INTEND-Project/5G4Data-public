import { describe, expect, it } from "vitest";

import { normalizeIntentTurtleOnIngest } from "@/lib/intent/normalize-intent-turtle-on-ingest";

const CE_SNIPPET = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix ut: <http://tio.models.tmforum.org/tio/v3.6.0/Utility/> .
@prefix fun: <http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/> .

data5g:CE1 a data5g:CoordinationExpectation ;
    log:allOf data5g:COtps, data5g:COenergy .

data5g:COtps a log:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_COtps ;
        quan:atLeast [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:COenergy a log:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_COenergy ;
        quan:smaller [ quan:unit "J" ; rdf:value 10000 ] ] .
`;

const MALFORMED_UTILITY = `
data5g:U_coord a ut:UtilityInformation ;
    ut:function data5g:utilityFn_symmetric ;
    ut:withArguments ( data5g:U_arg_p99-token-target data5g:U_arg_energy-consumption ) .
data5g:utilityFn_symmetric a fun:function ;
    rdf:value [ quan:sum ( [
        data5g:standardK 12.0;
        data5g:x0Fraction 0.85;
        mf:logistic ( data5g:U_arg_p99-token-target "340token/s"^^quan:quantity )
      ] ) ] .
`;

describe("normalizeIntentTurtleOnIngest", () => {
  it("rewrites incomplete mf:logistic utility blocks before GraphDB ingest", () => {
    const normalized = normalizeIntentTurtleOnIngest(CE_SNIPPET + MALFORMED_UTILITY);
    expect(normalized).toMatch(/"0\.03"\^\^xsd:decimal/);
    expect(normalized).not.toMatch(
      /mf:logistic \( data5g:U_arg_p99-token-target "340token\/s"\^\^quan:quantity \)/,
    );
  });
});
