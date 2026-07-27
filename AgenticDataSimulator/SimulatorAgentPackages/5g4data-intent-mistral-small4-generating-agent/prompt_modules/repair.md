Repair policy:
- Fix only policy/validation issues while preserving user intent and grounded facts.
- Keep all required classes, handlers, owners, and expectation structure.
- Never introduce placeholders or narration text in final Turtle.
- If Intent has more than one `dct:description` or contains `log:forAll` / `set:forAll`, move condition predicates into separate `data5g:CO… a icm:Condition` blocks and leave Intent with a single summary `dct:description` plus `log:allOf` only.
- If `DeploymentExpectation` `log:allOf` is missing `icm:Condition` or `icm:Context` members, add the correct `CO…` / `CX…` references (blocks must already exist or be created).
