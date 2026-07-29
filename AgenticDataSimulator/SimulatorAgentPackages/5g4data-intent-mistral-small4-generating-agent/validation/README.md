# validation

SHACL profile: `skill_subset_intent_shapes.ttl` (e1 intent subset).

TIO extension ontology (classes / `icm:Target` typing): `../../../data5g-onto/`  
(see that folder’s README for offline `tio-shacl validate -O` usage). Generated Turtle also gets these idioms from the `tio-idioms` postprocessor.

## i17 additions

- **DataCenter** — `data5g:DataCenter` on deployment contexts must match `^EC_[0-9]+$` (infra KG clusterId).
- **CoordinationExpectation** — requires metric COs in `log:allOf`; CE metric CO count must match linked `utilityFn_*` `fun:arityMax`.
- **UtilityInformation / UtilityProfile** — `ut:function`, `ut:withArguments`, `ut:forMetric`, `UP_coord` min/max 0.0–1.0.
- **Fixtures** — `fixtures/i16-bad-*.ttl` negative examples; validated by `tests/shacl-validation.test.ts`.

Limitations: SHACL checks structural consistency only (not prompt-specific metric choice).
