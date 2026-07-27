import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentSecurityConfig,
  extractApiKeyFromRequest,
  generateAgentApiKey,
  isAuthorizedRequest,
  resolveAgentAuthConfig,
  verifyApiKey
} from "../core/a2a/auth.js";

test("buildAgentSecurityConfig emits OpenAPI 3.0 apiKey scheme", () => {
  const config = buildAgentSecurityConfig("secret-key", {
    headerName: "X-Custom-Key"
  });
  assert.equal(config.schemeName, "agent-api-key");
  assert.deepEqual(config.security, [{ "agent-api-key": [] }]);
  assert.deepEqual(config.securitySchemes["agent-api-key"], {
    type: "apiKey",
    in: "header",
    name: "X-Custom-Key",
    description: "Shared service API key required for agent invocation and discovery."
  });
});

test("verifyApiKey uses constant-time comparison semantics", () => {
  assert.equal(verifyApiKey("abc123", "abc123"), true);
  assert.equal(verifyApiKey("abc124", "abc123"), false);
  assert.equal(verifyApiKey(undefined, "abc123"), false);
  assert.equal(verifyApiKey("short", "longer-key"), false);
});

test("extractApiKeyFromRequest reads header, query, and cookie", () => {
  const scheme = { type: "apiKey" as const, in: "header" as const, name: "X-Api-Key" };
  assert.equal(
    extractApiKeyFromRequest({ "x-api-key": "from-header" }, new URLSearchParams(), undefined, scheme),
    "from-header"
  );
  assert.equal(
    extractApiKeyFromRequest(
      {},
      new URLSearchParams("token=from-query"),
      undefined,
      { type: "apiKey", in: "query", name: "token" }
    ),
    "from-query"
  );
  assert.equal(
    extractApiKeyFromRequest(
      {},
      new URLSearchParams(),
      "session=abc; X-Api-Key=from-cookie",
      { type: "apiKey", in: "cookie", name: "X-Api-Key" }
    ),
    "from-cookie"
  );
});

test("isAuthorizedRequest validates configured auth", () => {
  const auth = resolveAgentAuthConfig("test-key");
  assert.ok(auth);
  assert.equal(
    isAuthorizedRequest(
      auth!,
      { "x-api-key": "test-key" },
      new URLSearchParams(),
      undefined
    ),
    true
  );
  assert.equal(
    isAuthorizedRequest(auth!, { "x-api-key": "wrong" }, new URLSearchParams(), undefined),
    false
  );
});

test("generateAgentApiKey returns hex string", () => {
  const key = generateAgentApiKey();
  assert.match(key, /^[0-9a-f]{64}$/);
});
