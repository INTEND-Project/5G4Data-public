import assert from "node:assert/strict";
import test from "node:test";
import { buildIntentReportTurtle } from "./intentReportTurtle.js";

test("buildIntentReportTurtle uses icm fields and imo handling state", () => {
  const ttl = buildIntentReportTurtle({
    intentId: "Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    handlingState:
      "http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/StateCompliant",
    reportNumber: 2,
    generatedAt: new Date("2026-05-21T10:00:00.000Z"),
  });
  assert.match(ttl, /a icm:IntentReport/);
  assert.match(ttl, /icm:about data5g:Iaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(ttl, /icm:intentHandlingState imo:StateCompliant/);
  assert.match(ttl, /icm:reportNumber "2"\^\^xsd:positiveInteger/);
  assert.match(ttl, /t:inXSDDateTimeStamp "2026-05-21T10:00:00.000Z"/);
});
