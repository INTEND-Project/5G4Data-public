const DESTINATION_BLOCK =
  /icm:reportDestinations\s*\[\s*a\s+rdfs:Container\s*;\s*rdfs:member\s+data5g:(?:prometheus|graphdb)\s*\]\s*;/gi;

function destinationMember(flags: { reportToPrometheus?: boolean; reportToGraphdb?: boolean }): string {
  if (flags.reportToPrometheus) return "prometheus";
  if (flags.reportToGraphdb) return "graphdb";
  return "graphdb";
}

export function applyPostprocessor(args: {
  text: string;
  context: {
    intentFlags?: Record<string, boolean>;
    runtimeContext?: string;
  };
}): { text: string; changes: number; note?: string } {
  const flags = args.context.intentFlags ?? {};
  const member = destinationMember({
    reportToPrometheus: Boolean(flags.reportToPrometheus),
    reportToGraphdb: Boolean(flags.reportToGraphdb)
  });

  const replacement = `icm:reportDestinations [ a rdfs:Container ;
            rdfs:member data5g:${member} ] ;`;

  let changes = 0;
  const text = args.text.replace(DESTINATION_BLOCK, () => {
    changes += 1;
    return replacement;
  });

  return {
    text,
    changes,
    note: changes > 0 ? `reportDestinations → data5g:${member} (${changes} block(s))` : undefined
  };
}
