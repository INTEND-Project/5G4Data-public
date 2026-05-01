Defaults policy:
- If no override is supplied, use baseline report frequency from ObservationReportingExpectation trigger delay.
- If no span override is supplied, use a conservative synthetic span around the relevant threshold.
- Keep metric unit consistent with Condition `quan:unit` when available.
- If `--noGraphDB` is active, print Turtle report payloads and skip GraphDB writes.
