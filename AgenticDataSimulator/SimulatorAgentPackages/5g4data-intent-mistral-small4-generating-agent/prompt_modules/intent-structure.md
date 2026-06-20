Turtle document structure (mandatory):

1. **One subject block per resource.** Each `data5g:…` resource is a separate block ending with `.` on its own terminating line. Never append condition or expectation predicates to the `icm:Intent` block.

2. **`icm:Intent` block** contains only:
   - exactly **one** `dct:description` (high-level intent summary sentence only)
   - `imo:handler "inServ"` and `imo:owner "inChat"`
   - `log:allOf` listing **only** the expectation and reporting locals you actually emit (see §3)
   - **nothing else** — no `log:forAll`, no `set:forAll`, no extra `dct:description`, no condition metrics

3. **Variable intent composition** — include only what the user prompt and runtime flags require. Valid shapes include (non-exhaustive):
   - deployment-only: `DE` + deployment `RE` (+ `CX`, deployment `CO…`)
   - network-only: `NE` + network `RE` (+ network `CO…`, `CX…`)
   - sustainability-only: `SE` + sustainability `RE` (+ sustainability `CO…`, `CX…` when grounded)
   - deployment + sustainability (+ matching `RE` blocks)
   - any of the above + `CE` when coordination is requested (+ coordination `RE` targeting `data5g:coordination-service`)
   Do **not** add `DE`, `SE`, `NE`, or `CE` “to fill the template” when that concern is not in scope.

4. **`icm:Condition` blocks** are separate `data5g:CO… a icm:Condition` subjects. Each has its own `dct:description` and `log:forAll` / `set:forAll` constraint. Create one CO block per selected catalogue objective (deployment `objectives[]` or sustainability `sustainability[]` entry)—metric stems and thresholds come from runtime context.

5. **`data5g:DeploymentExpectation`** (when present): `log:allOf` references one deployment `CO…` and one `CX…`. Never reference bare metric properties or event classes in `log:allOf`.

6. **`data5g:SustainabilityExpectation`** (when present): `log:allOf` lists its sustainability CO block(s) plus a shared `CX…` when context exists.

7. **`data5g:NetworkExpectation`** (when present): `log:allOf` lists network condition(s) and context per network policy.

8. **Reporting:** for **each** expectation block you include, add one `icm:ObservationReportingExpectation` with matching `icm:target` and list that RE in intent `log:allOf`. Omit RE blocks for expectation kinds you did not include. Coordination adds an RE for `data5g:coordination-service` only when `CE` is present.

9. **Placeholders:** use `data5g:I__ID_INTENT_1__`, `data5g:CO__ID_CONDITION_1__`, etc. Never emit angle-bracket tokens (`<uuid4>`, `<condition-id>`).
