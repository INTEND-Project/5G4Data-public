Report planning rules:
- Build one report stream per report target (deployment, network-slice, sustainability).
- Include all mapped target Conditions in each stream.
- Determine schedule frequency from trigger delay expression in the intent.
- Build an execution plan summary before generating payloads:
  - target,
  - condition IDs,
  - metric IDs/properties,
  - unit,
  - baseline frequency.
