import test from "node:test";
import assert from "node:assert/strict";
import { applyPostprocessor } from "../tools/postprocess/reportingTriggers.js";
import { formatIntervalLabel } from "../tools/postprocess/reportingIntervalLabel.js";

const SAMPLE = `@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix time: <http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:DE0d1ce26a35b94f358117d671456b01e7 a data5g:DeploymentExpectation,
        icm:Expectation ;
    icm:target data5g:deployment ;
    log:allOf data5g:COc5f7b82460cf4207a5a93ca4183ccbdf,
        data5g:CX8c9a8c0dee4b41d8a02a6f64f2f37594 .

data5g:tenMinutesDeployment a time:DurationDescription ;
    time:numericDuration "10"^^xsd:decimal ;
    time:unitType time:unitMinute .

data5g:TenMinuteReportEventDeployment a rdfs:Class ;
    rdfs:subClassOf imo:Event ;
    time:delay ( data5g:lastReportInstant data5g:tenMinutesDeployment ) ;
    imo:eventFor data5g:DE0d1ce26a35b94f358117d671456b01e7 .

data5g:RE97978a1a7e50424ebebfbed023838ba1 a icm:ObservationReportingExpectation ;
    icm:target data5g:deployment ;
    icm:reportTriggers [ a rdfs:Container ;
            rdfs:member data5g:TenMinuteReportEventDeployment ] .
`;

test("formatIntervalLabel maps common intervals", () => {
  assert.equal(formatIntervalLabel(10), "TenMinute");
  assert.equal(formatIntervalLabel(5), "FiveMinute");
  assert.equal(formatIntervalLabel(7), "7Minute");
});

test("applyPostprocessor scopes deployment reporting to condition anchor (minutes)", () => {
  const result = applyPostprocessor({
    text: SAMPLE,
    context: { reportingIntervalMinutes: 5 }
  });
  assert.ok(result.changes > 0);
  assert.match(
    result.text,
    /data5g:FiveMinuteReportEventDeployment_COc5f7b82460cf4207a5a93ca4183ccbdf/
  );
  assert.match(
    result.text,
    /data5g:durationDeployment_COc5f7b82460cf4207a5a93ca4183ccbdf[^]*time:numericDuration "5"[\s\S]*time:unitType time:unitMinute/s
  );
  assert.doesNotMatch(result.text, /\bdata5g:TenMinuteReportEventDeployment\b/);
});

test("applyPostprocessor uses unitSecond when reportingIntervalSeconds set", () => {
  const result = applyPostprocessor({
    text: SAMPLE,
    context: { reportingIntervalSeconds: 60 }
  });
  assert.ok(result.changes > 0);
  assert.match(
    result.text,
    /data5g:SixtySecondReportEventDeployment_COc5f7b82460cf4207a5a93ca4183ccbdf/
  );
  assert.match(
    result.text,
    /time:numericDuration "60"[\s\S]*time:unitType time:unitSecond/s
  );
  assert.doesNotMatch(result.text, /\bdata5g:TenMinuteReportEventDeployment\b/);
});
