/**
 * Rewrites LLM outputs that copy forbidden SKILL angle-bracket tokens or wrong reporting class
 * before output-policy validation runs.
 */
export function applyPostprocessor(args: { text: string }): {
  text: string;
  changes: number;
  note?: string;
} {
  let text = args.text;
  let changes = 0;
  const notes: string[] = [];

  if (/icm:ReportingExpectation/i.test(text)) {
    text = text.replace(/icm:ReportingExpectation/gi, "icm:ObservationReportingExpectation");
    changes += 1;
    notes.push("ReportingExpectation→ObservationReportingExpectation");
  }

  let seq = 0;
  const nextPlaceholder = (): string => {
    seq += 1;
    return `__ID_GEN_${seq}__`;
  };

  if (/<uuid4>/i.test(text)) {
    text = text.replace(/<uuid4>/gi, () => nextPlaceholder());
    changes += 1;
    notes.push("angle-bracket-<uuid4>");
  }
  if (/<same-uuid4>/i.test(text)) {
    text = text.replace(/<same-uuid4>/gi, "__ID_GEN_1__");
    changes += 1;
    notes.push("angle-bracket-<same-uuid4>");
  }
  if (/<condition-id>/i.test(text)) {
    text = text.replace(/<condition-id>/gi, "__ID_CONDITION_1__");
    changes += 1;
    notes.push("angle-bracket-<condition-id>");
  }

  return {
    text,
    changes,
    note: notes.length > 0 ? notes.join(", ") : undefined
  };
}
