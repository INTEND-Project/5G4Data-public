export type ScriptListSortMode = "name" | "created";

type ScriptListEntry = {
  name: string;
  createdAt?: string;
};

export function sortScripts<T extends ScriptListEntry>(
  scripts: T[],
  mode: ScriptListSortMode,
): T[] {
  const copy = [...scripts];
  if (mode === "created") {
    return copy.sort((left, right) => {
      const leftMs = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightMs = right.createdAt ? Date.parse(right.createdAt) : 0;
      if (rightMs !== leftMs) {
        return rightMs - leftMs;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
  }

  return copy.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
