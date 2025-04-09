# Changes to GUI
Remove the "State Change, Update Change and Expectation buttons in the form.

Start with only the intent list shown. Add "Create Report" selection (select one of the 3 types) instead of button on the right side in the intent table. When selected, go to the correct form and allow for generation of a report after the fields have been filled in. Go back to "first page" (with the intent list) when the "Generate Report" button in the form is clicked.

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

