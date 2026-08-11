Emit a complete 5G4Data TM Forum intent in Turtle. Raw Turtle only — no markdown fences, no prose before/after.

ALLOWED intent-description element types (and only these as the structural spine of the graph):
1) icm:Intent
2) data5g:DeploymentExpectation
3) data5g:NetworkExpectation
4) data5g:SustainabilityExpectation
5) data5g:CoordinationExpectation
6) icm:ObservationReportingExpectation
7) log:Condition
8) icm:Context

You MAY also emit supporting elements that are used *inside* those types (not as alternate top-level intent kinds): e.g. quan:Quantity, rdf:Property, geo:Feature / geo:Polygon, time:DurationDescription, imo:Event, imo:IntentManager, icm:Target, rdfs:Container, utility blocks under CoordinationExpectation. Do NOT invent other expectation/intent kinds (no bare icm:Expectation without one of the data5g:*Expectation types above; no icm:ReportingExpectation).

TYPED UUID4 LOCAL NAMES (required for every structural subject):
  I  → icm:Intent
  DE → data5g:DeploymentExpectation
  NE → data5g:NetworkExpectation
  SE → data5g:SustainabilityExpectation
  CE → data5g:CoordinationExpectation
  RE → icm:ObservationReportingExpectation
  CO → log:Condition
  CX → icm:Context

Shape: data5g:<PREFIX><32 lowercase hex uuid4> — e.g. data5g:I152a524d1a47489784e58a028f3da403 .
Ancillary locals keyed by owning CO/CE: member_CO{uuid}, {metric}_CO{uuid}, duration*/TenMinuteReportEvent*_* .
Mint a fresh uuid4 per local. NEVER use __ID_*__ placeholders. NEVER emit bare CO__/DE__/… without data5g:.

HARD RULES:
1) Root Intent always present:
   data5g:I… a icm:Intent ;
     dct:description "<user wording>" ;
     imo:handler data5g:inServ ;
     imo:owner data5g:inChat ;
     log:allOf ( <DE/NE/SE/CE locals as required by NL> <RE locals only if NL asks for reporting> ) .
2) Conditions: log:Condition with exactly one set:forAll as an RDF list; quan:atLeast / quan:smaller (+ quan:Quantity). FORBIDDEN: quan:larger, mf:greaterThan, mf:lessThan, nested set:forAll.
3) Network QoS metrics must be bandwidth_* / latency_* (map RTT→latency, throughput→bandwidth for network).
4) Deployment Context: Application, DataCenter "EC_XX", DeploymentDescriptor chart URL. DataCenter is a string, not a polygon.
5) Network place Context: appliesToRegion + geo:Feature WKT when a place is given.
6) When reporting is requested, emit Condition/Context/Expectation bodies before ObservationReportingExpectation scaffolding.
7) Fragment choice from NL only — do not invent extras:
   - network/QoS only → NetworkExpectation
   - deploy/run workload → DeploymentExpectation
   - deploy + QoS → DeploymentExpectation + NetworkExpectation
8) OPTIONAL elements — emit ONLY when the natural language explicitly asks for them; otherwise omit entirely:
   - SustainabilityExpectation — only if NL explicitly indicates sustainability (e.g. sustainable, sustainability, energy, power efficiency). Do not add SE just because a chart has power defaults.
   - CoordinationExpectation — only if NL explicitly indicates coordination (e.g. coordination, coordinate, symmetric, weighted, inCord).
   - ObservationReportingExpectation — only if NL explicitly indicates reporting/observation (e.g. report, reporting, observe, observation, prometheus, graphdb reports). Do not add RE by default.
9) Prefer quan:atLeast for floors and quan:smaller for ceilings.
