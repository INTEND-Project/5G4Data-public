import test from "node:test";
import assert from "node:assert/strict";
import { buildCoordinationFragment } from "../tools/buildCoordinationFragment.ts";

const deploymentTurtle = `data5g:CO__ID_CONDITION_1__ a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:p99-token-target_CO__ID_CONDITION_1__ ;
            quan:larger [ quan:unit "token/s" ; rdf:value 400 ] ] .

data5g:CX__ID_CONTEXT_1__ a icm:Context ;
    data5g:Application "rusty-llm" .

data5g:DE__ID_DEPLOYMENT_1__ a data5g:DeploymentExpectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO__ID_CONDITION_1__, data5g:CX__ID_CONTEXT_1__ ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:RE__ID_REPORTING_DEPLOYMENT_1__ a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] .`;

const sustainabilityTurtle = `data5g:CO__ID_CONDITION_SUST_1__ a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:power-consumption_CO__ID_CONDITION_SUST_1__ ;
            quan:smaller [ quan:unit "W" ; rdf:value 50 ] ] .

data5g:CO__ID_CONDITION_SUST_2__ a icm:Condition ;
    set:forAll [ icm:valuesOfTargetProperty data5g:energy-consumption_CO__ID_CONDITION_SUST_2__ ;
            quan:smaller [ quan:unit "MJ" ; rdf:value 100 ] ] .

data5g:SE__ID_SUSTAINABILITY_1__ a data5g:SustainabilityExpectation ;
    icm:target data5g:sustainability ;
    log:allOf data5g:CO__ID_CONDITION_SUST_1__, data5g:CO__ID_CONDITION_SUST_2__ ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:RE__ID_REPORTING_SUSTAINABILITY_1__ a icm:ObservationReportingExpectation ;
    icm:target data5g:sustainability ;
    icm:reportDestinations [ a rdfs:Container ; rdfs:member data5g:prometheus ] .`;

test("buildCoordinationFragment wires CE log:allOf and coordinates from prior fragments", () => {
  const body = buildCoordinationFragment({
    draft: {
      intentDescription: "symmetric coordination on token throughput and energy consumption",
      fragments: [
        {
          id: "deployment",
          turtle: deploymentTurtle,
          locals: ["CO__ID_CONDITION_1__", "DE__ID_DEPLOYMENT_1__"]
        },
        {
          id: "sustainability",
          turtle: sustainabilityTurtle,
          locals: ["CO__ID_CONDITION_SUST_2__", "SE__ID_SUSTAINABILITY_1__"]
        }
      ]
    },
    userPrompt:
      "Deploy a small llm with symmetric coordination on token throughput and energy consumption"
  });

  assert.match(body, /data5g:CE__ID_COORDINATION_1__ a data5g:CoordinationExpectation/);
  assert.match(body, /log:allOf data5g:CO__ID_CONDITION_1__, data5g:CO__ID_CONDITION_SUST_2__/);
  assert.match(
    body,
    /data5g:coordinates data5g:DE__ID_DEPLOYMENT_1__,\s+data5g:SE__ID_SUSTAINABILITY_1__/
  );
  assert.match(body, /data5g:RE__ID_REPORTING_COORDINATION_1__ a icm:ObservationReportingExpectation/);
  assert.match(body, /icm:target data5g:coordination-service/);
});
