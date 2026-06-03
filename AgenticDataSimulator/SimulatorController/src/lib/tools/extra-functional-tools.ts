export const EXTRA_FUNCTIONAL_TOOL_IDS = ["inSustain", "inCoord", "inExplain"] as const;

export type ExtraFunctionalToolId = (typeof EXTRA_FUNCTIONAL_TOOL_IDS)[number];

export type ExtraFunctionalTool = {
  id: ExtraFunctionalToolId;
  label: string;
};

export const EXTRA_FUNCTIONAL_TOOLS: ExtraFunctionalTool[] = [
  { id: "inSustain", label: "inSustain" },
  { id: "inCoord", label: "inCoord" },
  { id: "inExplain", label: "inExplain" },
];

export function isExtraFunctionalToolId(value: string): value is ExtraFunctionalToolId {
  return (EXTRA_FUNCTIONAL_TOOL_IDS as readonly string[]).includes(value);
}
