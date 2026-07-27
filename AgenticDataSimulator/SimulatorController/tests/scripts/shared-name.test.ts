import { describe, expect, it } from "vitest";

import {
  buildSharedScriptName,
  defaultSharedNameSuffix,
  normalizeSharedScriptName,
  SHARED_PREFIX,
} from "../../src/lib/scripts/shared-name";

describe("shared script naming", () => {
  it("builds shared names from suffix", () => {
    expect(buildSharedScriptName("foo.dsl")).toBe("shared-foo.dsl");
  });

  it("defaults suffix without duplicating shared prefix", () => {
    expect(defaultSharedNameSuffix("shared-demo.dsl")).toBe("demo.dsl");
    expect(defaultSharedNameSuffix("demo.dsl")).toBe("demo.dsl");
  });

  it("normalizes shared names without double prefix", () => {
    expect(normalizeSharedScriptName("foo.dsl")).toBe(`${SHARED_PREFIX}foo.dsl`);
    expect(normalizeSharedScriptName("shared-foo.dsl")).toBe("shared-foo.dsl");
  });
});
