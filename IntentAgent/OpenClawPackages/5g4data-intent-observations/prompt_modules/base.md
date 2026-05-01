Base constraints:
- Require an intent identifier as input (`intent_id` or equivalent token).
- Parse user instructions into two channels:
  - Natural language operation instructions.
  - Optional structured JSON override.
- Only generate observation payloads for Conditions that are in-scope through expectations referenced by ObservationReportingExpectation.
