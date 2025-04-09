# Changes to the intent reports

We could consider to add more info in the reports, some obvious additions are shown in the table:

| Field | Property | Why it's useful |
|-------|----------|-----------------|
| Handler | `imo:handler` | Identifies who reported |
| Owner | `imo:owner` (via `icm:about`) | Traces ownership |
| Update state | `icm:intentUpdateState` | Indicates parallel update activity |
| Reason | `icm:reason` | Explainability |

We should probably add owner and handler to the intent as well.

Add "full reports" (Expectation button) based on the content of the intent and/or intent reporting expectations expressed in the intent description.

