---
name: tmf-intent-authoring
description: Translate natural-language 5G4Data requirements into TM Forum ontology-based Turtle intents, using only workloads available in the workload catalogue. Use when creating, revising, validating, or explaining 5G4Data intents involving NetworkExpectation, DeploymentExpectation, ReportingExpectation, bandwidth, latency, workload-chart objectives, UUID4 identifiers, ChartMuseum workload lookup, or Turtle intent files.
---

# TM Forum Intent Authoring

## Purpose

Use this skill to translate natural-language user goals into legally formed 5G4Data intent descriptions that follow the TM Forum intent ontology and the local 5G4Data restrictions.

The skill is not just for formatting Turtle. It should infer the likely intent structure from a user's plain-language needs, ask targeted follow-up questions, then produce the closest legal formal intent.

## Read First

From the current workspace root:

- Ontology entrypoint: `../../5G4Data-private/TM-Forum-Intent-Toolkit/TMForumIntentOntology/IntentCommonModel.ttl`
- Example intents: `../Intent-Simulator/intents`

Start with `IntentCommonModel.ttl`, then read any additional ontology files needed for the constructs you use. Ground the output in the ontology and in the local example intents instead of inventing a new pattern.

## Workload catalogue constraint

Deployment expectations may only reference workloads that are present in the workload catalogue.

- Catalogue base URL: `http://start5g-1.cs.uit.no:3040`
- Catalogue API style: ChartMuseum API
- Relevant API routes from the ChartMuseum docs:
  - `GET /api/charts` to list charts
  - `GET /api/charts/<name>` to list versions of a chart
  - `GET /api/charts/<name>/<version>` to inspect a specific chart version

If no suitable workload can be matched to the user's natural-language request, the request is out of scope for deployment intent generation and this must be stated clearly.


## Geographic matching for edge data centers

When the user mentions a place name and a nearby edge deployment is relevant, resolve the location through coordinates and then use the infrastructure knowledge graph to find the closest edge data center.

- First transform the geographic name into latitude and longitude coordinates.
- Then query the knowledge graph `http://intendproject.eu/telenor/infra` in the intents_and_intent_reports repository.
- The GraphDB instance is located at `http://start5g-1.cs.uit.no:7200/`.
- Use a SPARQL query to identify the closest edge data center to the resolved coordinates.
- Use that result to populate the deployment-side `data5g:DataCenter` value.
- If the geographic name cannot be resolved or no suitable nearby edge data center can be found, ask a follow-up question instead of guessing.

## Required workflow

1. Read the ontology entrypoint and inspect matching example intents before drafting anything.
2. Translate the user's natural-language request into:
   - desired business outcome
   - required workload behavior
   - location hints
   - latency and bandwidth needs
   - privacy or locality constraints
   - whether deployment, network, or both are needed
3. If the request mentions a geographic name and deployment locality matters, resolve the location to coordinates and query the infrastructure knowledge graph for the closest edge data center.
4. Search the workload catalogue if the request implies deployment of an application or model.
5. Determine whether the user needs:
   - a deployment-only intent
   - a network-only intent
   - a combined deployment + network intent
6. If key values are missing, ask concise follow-up questions for:
   - `dct:description`
   - `imo:handler`
   - `imo:owner`
   - deployment application, data center, deployment descriptor
   - deployment objective threshold values from the selected chart
   - network bandwidth threshold
   - network latency threshold
   - exact user location or service area if only a city/region is known
   - whether the model must run locally at an edge site
   - whether network QoS guarantees are needed between users and the deployed workload
   - reporting targets if the user wants something unusual
7. If a deployment is needed but no suitable catalogue workload exists, stop and state that the request is out of scope.
8. Output Turtle unless the user explicitly asks for prose only.
9. Before finalizing, verify that every class, property, target, condition, and ID is consistent with the allowed subset below.

## Natural-language translation rules

When the input is informal, convert it into formal intent semantics instead of mirroring the text literally.

- Identify the user goal first, then map it to legal 5G4Data constructs.
- Convert vague wording into explicit assumptions, but make those assumptions visible.
- Ask follow-up questions when a missing value materially changes whether deployment, network, or both are required.
- If the user expresses goals that are outside the supported subset, preserve the intent of the request by mapping it to the closest allowed expectations and explain what could not be represented directly.
- If the user asks for an application, model, or workload that is not available in the workload catalogue, do not fabricate a deployment expectation.

## Workload selection rules

Whenever a `DeploymentExpectation` is being considered, perform a workload lookup before writing the final intent.

- Infer the likely workload from the user's language.
- Search the workload catalogue at `https://start5g-1.cs.uit.no:3040`.
- Use the ChartMuseum API to identify candidate charts and versions.
- Prefer exact semantic matches over loose keyword matches.
- If several catalogue workloads appear plausible, ask the user to choose.
- Only create a `DeploymentExpectation` when a suitable catalogue workload has been identified.
- Retrieve the selected workload Helm chart from the catalogue and inspect its `values.yaml`.
- Use the chosen catalogue workload to populate `data5g:DeploymentDescriptor`.
- Do not invent workload names, chart names, versions, or deployment descriptors.
- If there is no suitable workload, respond that the request is out of scope.

## Geographic lookup guidance

Use this flow when the request includes a city, town, region, address, or any other geographic name and the workload should run close to that location.

1. Extract the geographic name from the natural-language input.
2. Transform the geographic name into latitude and longitude.
3. Query the GraphDB instance at `http://start5g-1.cs.uit.no:7200/`.
4. Query the knowledge graph `http://intendproject.eu/telenor/infra` using SPARQL.
5. Find the closest edge data center to the resolved coordinates.
6. Use that edge data center in `data5g:DataCenter`.
7. If multiple edge data centers are similarly suitable, ask the user to choose or state the assumption.
8. If the geographic name cannot be resolved reliably, ask a follow-up question.

## Deployment condition extraction from Helm charts

Deployment conditions must be derived from the selected workload Helm chart instead of being invented manually.

- After selecting the workload from the catalogue, retrieve the Helm chart package from the workload catalogue.
- Inspect the chart's `values.yaml` file.
- Look for an `objectives` list in `values.yaml`.
- For each listed objective, create a deployment-side condition metric using the objective `name`.
- If more than one objective is listed, create one deployment condition per objective unless the user explicitly narrows the scope.
- Prefer the objective name exactly as it appears in `values.yaml` for the condition metric, but append the _<Condition uuid>
- Use `tmf-value-hint` as the default threshold hint when the user does not provide a concrete value.
- If the user provides an explicit value, use that instead of the hint.
- If `value` is null or set aside for deployment-time injection, that does not prevent creating the intent condition.
- If no `objectives` section exists and no authoritative deployment metric can be identified from the selected chart, ask a follow-up question or state that deployment-condition generation is out of scope.

Example `values.yaml` fragment:

```yaml
objectives:
  - name: p99-token-target
    value: 0.0
    tmf-value-hint: 400.0
    measuredBy: intend/p99token
```

From this example, use `p99-token-target_COuuid` as the deployment condition metric name.

## Catalogue lookup guidance

Use this lookup flow for deployment-capable requests.

1. Extract probable workload terms from the natural-language input.
2. Query `GET https://start5g-1.cs.uit.no:3040/api/charts`.
3. Filter candidate charts by workload purpose, model type, and deployment semantics.
4. If needed, inspect chart versions with `GET https://start5g-1.cs.uit.no:3040/api/charts/<name>`.
5. If needed, inspect a specific version with `GET https://start5g-1.cs.uit.no:3040/api/charts/<name>/<version>`.
6. Choose the most suitable available chart.
7. Retrieve the chosen Helm chart package and inspect `values.yaml`.
8. Extract deployment objectives from `values.yaml`.
9. If no suitable chart exists, declare the deployment request out of scope instead of guessing.

## Inference rules for expectation selection

Use these heuristics when translating natural language.

- Choose a `DeploymentExpectation` when the user implies that an application or model must be placed somewhere specific.
- Choose a `DeploymentExpectation` when the user mentions local inference, edge deployment, on-site processing, privacy through local execution, or a need to keep data close to where it is generated.
- Choose a `DeploymentExpectation` when the user mentions a location and asks for the workload to run close to that location or in a nearby edge data center.
- Only keep that `DeploymentExpectation` in the final intent if a suitable workload exists in the catalogue.
- Choose a `NetworkExpectation` when the user asks for low latency, stable response time, predictable performance, connectivity guarantees, or an explicitly managed network slice.
- Choose a `NetworkExpectation` when end users, devices, or external clients must reliably reach the deployed workload over the network.
- Choose both expectations when the user needs both local placement and communication quality.
- If the request is only about placing the workload and says nothing meaningful about traffic quality, default to deployment-only and state that assumption.
- If the request is only about communication quality to an already assumed service, default to network-only.

## Inference rules for natural-language cues

Map common phrases to the legal subset as follows.

- "local compute", "run close to me", "edge", "near location", "keep data local" -> likely `DeploymentExpectation`
- "private dialogue", "keep prompts private", "avoid sending data far away" -> likely `DeploymentExpectation` close to the user, because privacy is approximated here through local placement rather than a dedicated privacy construct
- "low response time", "fast replies" -> likely latency conditions
- "consistent over time", "stable performance", "predictable response time" -> likely network latency guarantees and possibly deployment close to the user
- "many users", "video", "high throughput", "large data transfer" -> likely bandwidth conditions

## Follow-up dialogue guidance

When the initial request is high level, ask only the questions needed to disambiguate the formal intent.

- Ask where the users or business are located if the location matters for edge placement.
- Ask whether the model must be deployed in the edge data center nearest to that location.
- Ask whether there is an existing deployment descriptor or workload package.
- Ask which available catalogue workload should be used if more than one matches.
- Ask whether low response time should be captured through deployment objectives from the selected chart, network latency, or both.
- Ask whether stable response time should be treated as a network QoS requirement.
- Ask for concrete threshold values if the user uses terms like "low", "fast", or "high".
- If the user cannot provide exact numbers, propose reasonable placeholders and clearly label them as assumptions.
- If no catalogue workload matches, tell the user explicitly that the deployment request is out of scope.

## Allowed 5G4Data subset

Stay inside these boundaries even if other examples contain extra constructs.

- Allowed expectation classes:
  - `data5g:NetworkExpectation`
  - `data5g:DeploymentExpectation`
  - `icm:ReportingExpectation`
- An intent may contain:
  - only a network expectation
  - only a deployment expectation
  - both network and deployment expectations
- Do not introduce any other expectation type.
- Ignore out-of-scope example patterns such as token latency or other KPI-specific conditions unless the user explicitly changes the scope.
- A `DeploymentExpectation` is only allowed when its workload is present in the workload catalogue.

## Condition restrictions

- `data5g:DeploymentExpectation` conditions must be derived from the selected workload chart's `values.yaml` `objectives` entries.
- The deployment condition metric name should be the objective `name`, or names if multiple objectives are listed.
- Use one deployment condition per selected objective.
- `data5g:NetworkExpectation` conditions may only express bandwidth and latency restrictions.
- Logistic functions are allowed in conditions when the user asks for a soft threshold or non-linear evaluation.
- Default to simple quantity operators unless there is a reason not to:
  - `quan:smaller`
  - `quan:larger`
  - `quan:inRange`

## Naming and identifier rules

- Every intent-local resource identifier must be generated from UUID4.
- Generate fresh UUID4-derived identifiers for:
  - the intent
  - every condition
  - every context
  - every expectation
  - every reporting expectation
  - any region or auxiliary resource you introduce
- Follow the local naming style used in the example intents:
  - `data5g:I<uuid4>`
  - `data5g:CO<uuid4>`
  - `data5g:CX<uuid4>`
  - `data5g:DE<uuid4>`
  - `data5g:NE<uuid4>`
  - `data5g:RE<uuid4>`
  - `data5g:RG<uuid4>`
- If you remove hyphens from UUID4 values for Turtle local names, keep the UUID4 origin intact.
- Do not reuse one UUID across different resources.
- For condition-scoped properties, suffix the property with the condition ID, following the local example style.

## Local modeling rules

- The root intent should be an `icm:Intent`.
- The root intent should as default combine its child elements with `log:allOf`. Only choose more complex log functions from log:Vocabulary in ontology file LogicalOperators.ttl if natural language input or subsequent dialogue with the user indicates other relationships between all or some of the Expectations.
- Each expectation should have exactly one `icm:target`.
- Use these targets:
  - deployment expectations: `data5g:deployment`
  - network expectations: `data5g:network-slice`
  - reporting expectations: target the same resource they report on
- By default, include one reporting expectation per target present:
  - deployment-only intent -> one reporting expectation targeting `data5g:deployment`
  - network-only intent -> one reporting expectation targeting `data5g:network-slice`
  - combined intent -> two reporting expectations, one for each target

## Context guidance

Use only the context that supports the requested intent.

- Deployment context commonly uses:
  - `data5g:Application`
  - `data5g:DataCenter`
  - `data5g:DeploymentDescriptor`
- Network context commonly uses:
  - `data5g:appliesToCustomer`
  - `data5g:appliesToRegion`
- Do not invent extra context properties unless the ontology or local examples support them.
- If the user mentions a city or region, resolve that name to coordinates and use the infrastructure knowledge graph to identify the closest edge data center for DeploymentExpectations.
- For statements like "my business is in geolocation", geocode `geolocation`, query the infrastructure graph, and use the nearest edge data center rather than guessing a site name.
- Set `data5g:DeploymentDescriptor` from the selected catalogue workload, not from a fabricated URL.

## Property naming guidance

The examples show minor naming variation for some metric properties. Prefer the local example pattern closest to the requested intent and stay consistent within one file.

- Network bandwidth: use a condition-scoped property such as `data5g:bandwidth_<condition-id>`
- Network latency: use a condition-scoped property such as `data5g:networklatency_<condition-id>`
- Deployment metrics from Helm objectives: use the objective name as the metric stem, for example `data5g:p99-token-target_<condition-id>`

Do not mix naming variants for the same metric within one generated file.

## Default Turtle skeleton

Use this as a starting shape, then remove the blocks that are not needed.

```turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix imo: <http://tio.models.tmforum.org/tio/v3.6.0/IntentManagementOntology/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .

data5g:I<uuid4> a icm:Intent ;
    dct:description "<intent description>" ;
    imo:handler "<handler>" ;
    imo:owner "<owner>" ;
    log:allOf data5g:DE<uuid4>,
        data5g:NE<uuid4>,
        data5g:RE<uuid4>,
        data5g:RE<uuid4> .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "<objective-name> condition quan:smaller: <value><unit>" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:<objective-name>_CO<same-uuid4> ;
            quan:smaller [ quan:unit "<unit>" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Bandwidth condition quan:larger: <value>mbit/s" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:bandwidth_CO<same-uuid4> ;
            quan:larger [ quan:unit "mbit/s" ;
                    rdf:value <value> ] ] .

data5g:CO<uuid4> a icm:Condition ;
    dct:description "Latency condition quan:smaller: <value>ms" ;
    set:forAll [ icm:valuesOfTargetProperty data5g:networklatency_CO<same-uuid4> ;
            quan:smaller [ quan:unit "ms" ;
                    rdf:value <value> ] ] .

data5g:CX<uuid4> a icm:Context ;
    data5g:Application "<application>" ;
    data5g:DataCenter "<data-center>" ;
    data5g:DeploymentDescriptor "<catalogue-deployment-descriptor-url>" .

data5g:CX<uuid4> a icm:Context ;
    data5g:appliesToCustomer "<customer>" ;
    data5g:appliesToRegion data5g:RG<uuid4> .

data5g:DE<uuid4> a data5g:DeploymentExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "<deployment expectation description>" ;
    icm:target data5g:deployment ;
    log:allOf data5g:CO<deployment-condition-uuid4>,
        data5g:CX<deployment-context-uuid4> .

data5g:NE<uuid4> a data5g:NetworkExpectation,
        icm:Expectation,
        icm:IntentElement ;
    dct:description "<network expectation description>" ;
    icm:target data5g:network-slice ;
    log:allOf data5g:CO<bandwidth-condition-uuid4>,
        data5g:CO<latency-condition-uuid4>,
        data5g:CX<network-context-uuid4> .

data5g:RE<uuid4> a icm:ReportingExpectation ;
    dct:description "Report if expectation is met with reports including metrics related to expectations." ;
    icm:target data5g:deployment .

data5g:RE<uuid4> a icm:ReportingExpectation ;
    dct:description "Report if expectation is met with reports including metrics related to expectations." ;
    icm:target data5g:network-slice .
```

## Logistic-function guidance

If the user explicitly asks for logistic behavior, use the log ontology instead of inventing a custom function shape.

- Keep the surrounding condition structure legal for the chosen metric.
- State clearly in the output or surrounding explanation that a logistic function is being used.
- If the user does not ask for a soft or graded condition, use the simpler quantity operators instead.

## Translation example

Example natural-language input:

"I am owning a small business in Tromso and I want to test out local inference using a small language model. The dialogue with the LLM should be kept private and the response time should be relatively low and should be consistent over time."

Translate this in stages:

1. Infer likely needs:
   - local inference -> deployment near the user
   - privacy of dialogue -> prefer local edge deployment
   - low response time -> latency requirement
   - consistent response time -> likely network QoS requirement
   - Tromso -> geocode Tromso, then find the nearest edge data center in the infrastructure knowledge graph
2. Ask follow-up questions such as:
   - Should the deployment use the edge data center nearest to Tromso as determined from the infrastructure knowledge graph?
   - Which available catalogue workload should be used for the small language model?
   - Which deployment objective from the chart `values.yaml` should represent low response time if multiple objectives are present?
   - Do you want explicit network guarantees for users reaching the model?
3. If the answers confirm both placement and QoS needs, produce a combined intent with:
   - one `DeploymentExpectation`
   - one `NetworkExpectation`
   - one reporting expectation per target
4. If the answers confirm only local deployment and no network guarantees, produce a deployment-only intent.
5. If no suitable workload exists in the catalogue for the requested small language model use case, state that the request is out of scope instead of generating a deployment intent.

Do not claim that privacy itself is modeled directly unless the ontology subset supports it. In this scope, privacy-related language is handled by preferring local deployment and proximity assumptions.

## Validation checklist

Before returning the intent:

- Confirm the root resource is an `icm:Intent`.
- Confirm `log:allOf` at the intent root references only the included expectations and reporting expectations.
- Confirm each referenced condition and context is defined exactly once.
- Confirm deployment conditions come from the selected chart's `values.yaml` `objectives`.
- Confirm network conditions only mention bandwidth and latency.
- Confirm no unsupported expectation types were introduced.
- Confirm each expectation has the correct target.
- Confirm reporting expectations target the same resource they report on.
- Confirm every `DeploymentExpectation` uses a workload that exists in the workload catalogue.
- Confirm `data5g:DeploymentDescriptor` comes from the selected catalogue workload.
- Confirm each deployment condition metric uses the objective name from `values.yaml`.
- Confirm any location-derived `data5g:DataCenter` was selected via coordinate resolution plus SPARQL lookup against `http://intendproject.eu/telenor/infra`.
- Confirm units match the metric definition in the selected workload objective or network metric:
  - network latency -> `"ms"` when latency is used
  - bandwidth -> `"mbit/s"` when bandwidth is used
- Confirm all IDs are UUID4-derived and unique.
- Confirm Turtle punctuation is complete.

## Response style

- If the user asks for a full intent file, return a ready-to-save Turtle document.
- If the user asks for an intent description but leaves values unspecified, ask only the minimum clarifying questions needed.
- If a request conflicts with the allowed subset, explain the restriction and propose the closest legal 5G4Data intent instead.
- If the request implies deployment but no suitable workload can be found in the catalogue, say clearly that the request is out of scope.
