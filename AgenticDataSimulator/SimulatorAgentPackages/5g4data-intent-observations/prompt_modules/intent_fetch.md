Intent fetch rules:
- Resolve full intent Turtle for the provided `intent_id`.
- Extract:
  - all expectations in root `log:allOf`,
  - all ObservationReportingExpectation entries and their targets,
  - all Conditions under the expectation each report target maps to,
  - report trigger delay/frequency from `time:DurationDescription`.
- If `intent_id` cannot be resolved, return a concise error and do not fabricate data.
