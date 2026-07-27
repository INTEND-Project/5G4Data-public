import { describe, expect, it } from "vitest";

import {
  normalizeTmfBaseUrl,
  parseTmfBaseUrlInput,
  tmfCreateIntentUrl,
} from "../../src/lib/tools/parse-tmf-base-url";

describe("parse-tmf-base-url", () => {
  it("normalizes trailing slashes and strips /intent suffix", () => {
    expect(
      normalizeTmfBaseUrl("http://host:3021/tmf-api/intentManagement/v5/"),
    ).toBe("http://host:3021/tmf-api/intentManagement/v5");
    expect(
      normalizeTmfBaseUrl("http://host:3021/tmf-api/intentManagement/v5/intent"),
    ).toBe("http://host:3021/tmf-api/intentManagement/v5");
  });

  it("builds createIntent URL without duplicating /intent", () => {
    expect(tmfCreateIntentUrl("http://host:3021/tmf-api/intentManagement/v5/")).toBe(
      "http://host:3021/tmf-api/intentManagement/v5/intent",
    );
    expect(
      tmfCreateIntentUrl("http://host:3021/tmf-api/intentManagement/v5/intent/"),
    ).toBe("http://host:3021/tmf-api/intentManagement/v5/intent");
  });

  it("rejects invalid URLs", () => {
    const result = parseTmfBaseUrlInput("not-a-url");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("accepts valid http URLs", () => {
    const result = parseTmfBaseUrlInput("http://localhost:3021/tmf-api/intentManagement/v5");
    expect(result).toEqual({
      ok: true,
      url: "http://localhost:3021/tmf-api/intentManagement/v5",
    });
  });
});
