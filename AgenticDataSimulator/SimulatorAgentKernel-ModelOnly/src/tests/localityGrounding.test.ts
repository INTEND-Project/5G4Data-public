import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const localityToolUrl = pathToFileURL(
  join(
    process.cwd(),
    "..",
    "SimulatorAgentPackages",
    "5g4data-intent-generating-agent-model-only",
    "tools",
    "localityTool.ts"
  )
).href;

const locality = (await import(localityToolUrl)) as {
  extractLocalityPhrase: (text: string) => string | null;
  bboxPolygonWkt: (lat: number, lon: number, deltaDeg?: number) => string;
  formatNetworkGeoContextBlock: (place: string, wkt: string) => string;
  parseGroundedRegionWktFromRuntimeContext: (ctx: string) => string | null;
  applyGroundedRegionWktToTurtle: (turtle: string, wkt: string) => string;
};

test("extractLocalityPhrase supports in/near and filters non-places", () => {
  assert.equal(
    locality.extractLocalityPhrase(
      "I want a network slice in Tromsø with bandwidth above 300Mbit/s"
    ),
    "Tromsø"
  );
  assert.equal(
    locality.extractLocalityPhrase("Deploy an object detection model near Bodø with good network"),
    "Bodø"
  );
  assert.equal(
    locality.extractLocalityPhrase("I want to experiment with a small llm in a datacenter near Tromsø/Norway"),
    "Tromsø"
  );
  assert.equal(
    locality.extractLocalityPhrase("Deploy rusty-llm in a sustainable manner"),
    null
  );
});

test("runtime geo block round-trips and overwrites Bodø few-shot WKT", () => {
  const wkt = locality.bboxPolygonWkt(69.65, 18.95);
  const ctx = locality.formatNetworkGeoContextBlock("Tromsø", wkt);
  assert.match(ctx, /\[Network expectation geographic context\]/);
  assert.equal(locality.parseGroundedRegionWktFromRuntimeContext(ctx), wkt);

  const bodoWkt =
    "POLYGON((14.321750 67.224431,14.441750 67.224431,14.441750 67.344431,14.321750 67.344431,14.321750 67.224431))";
  const turtle = `data5g:RG1 a geo:Feature ;
    geo:hasGeometry [ a geo:Polygon ;
            geo:asWKT "${bodoWkt}"^^geo:wktLiteral ] .`;
  const applied = locality.applyGroundedRegionWktToTurtle(turtle, wkt);
  assert.match(applied, new RegExp(wkt.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(applied, /14\.321750/);

  // Pretty-printer often emits a space: POLYGON( (… ) )
  const prettyBodo =
    "POLYGON( (14.321750 67.224431,14.441750 67.224431,14.441750 67.344431,14.321750 67.344431,14.321750 67.224431 ))";
  const prettyTurtle = `geo:asWKT "${prettyBodo}"^^geo:wktLiteral`;
  const appliedPretty = locality.applyGroundedRegionWktToTurtle(prettyTurtle, wkt);
  assert.equal(appliedPretty, `geo:asWKT "${wkt}"^^geo:wktLiteral`);
});
