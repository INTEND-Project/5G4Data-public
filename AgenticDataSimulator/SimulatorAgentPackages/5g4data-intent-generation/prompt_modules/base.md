Base constraints:
- Output valid TM Forum Turtle when generating intent payload (only after user confirmation).
- On the first turn, output a plain-text review summary only—no `@prefix` or Turtle until the user types OK.
- Keep identifiers unique and UUIDv4-derived.
- Do not ask for `imo:handler` or `imo:owner`; use defaults.
