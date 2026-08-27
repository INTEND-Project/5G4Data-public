# Scoring

Each prompt is pass/fail per criterion. Cell score = **% of prompts that pass**. `SUMMARY.md` is criteria × cells. Each `exp_<cell_id>/REPORT.md` is the same criteria with that cell’s single column (pass %, n, failures).

Ranking for a production pick (in this order):

1. **NL semantic match** (primary)
2. **Both SHACL** (use-case + tio-shacl)
3. **Structural all-pass** (conjunction of the six structure checks)

A cell is production-eligible only if it is strong on all three, not dialect-F1 alone. V1 light pass / expectation F1 are logged as **diagnostics only**.

## Structure

Target from gold `meta.mixture_kind` / `fragment_ids`, which encode the NL.

1. **prefixes** — required `@prefix` set from few-shots: `data5g dct geo icm imo log quan rdf rdfs set time ut fun mf xsd`
2. **intent_and_expectations** — one `icm:Intent`; `data5g:NetworkExpectation` and/or `data5g:DeploymentExpectation` exactly as NL/kind requires (no extras of those two)
3. **condition_or_context** — each required expectation has `log:Condition` and/or `icm:Context` as the kind requires (DE: Context + Condition; NE: Condition, Context if place/QoS locality)
4. **reporting_per_expectation** — one `icm:ObservationReportingExpectation` per DE and per NE, listed on Intent `log:allOf`, with `imo:eventFor` pointing at that expectation
5. **fewshot_structure** — block order aligned with few-shots: prefixes → managers/targets → Intent → expectation bodies (DE/NE) **before** reporting; DE Context has Application / DataCenter / DeploymentDescriptor when deployment is required
6. **uuid4_unique** — typed locals `I|DE|NE|SE|CE|RE|CO|CX|RG` + 32 hex; **no reuse inside the graph** (same hex with two type prefixes); **no copy of few-shot example IDs** (banned set extracted from `prompts/fewshot_*_asst.ttl`)

## Dual SHACL

Use-case SHACL and tio-shacl run on the **same Turtle** that structure/`nl_semantic` scored. They do **not** apply agent uuidFix/prefixes as a scoring side effect.

The `_postprocessing` cell rewrites Turtle **before** evaluation (`lib/postprocess.py`: pad typed ids, remint copied few-shot ids, uniquify reused uuid4 hex, grounding DataCenter, then agent uuidFix/prefixes). Other cells are scored on raw model output (after fence stripping only).

7. **usecase_shacl**
8. **tio_shacl**
9. **both_shacl** — conjunction of 7 and 8

## Semantics (primary)

10. **nl_semantic** — produced Turtle matches the **user NL**, not merely gold-echo F1:
    - expectation kinds from NL (`mixture_kind` / flags in Grounding JSON, which were derived from that NL)
    - numeric QoS in NL (latency/bandwidth regex) vs `quan:*` values/units in Turtle
    - named workload / place in NL vs `data5g:Application` / DC / region text
    - do **not** invent sustainability/coordination unless NL asks
    - grounded cells: Application/chart/DC may match Grounding JSON; still fail if they contradict the NL
