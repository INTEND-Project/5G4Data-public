import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantRequestedConfirmation,
  isConfirmationText
} from "../core/confirmationState.js";
import type { ChatSession } from "../models.js";

test("isConfirmationText accepts only OK variants", () => {
  assert.equal(isConfirmationText("OK", ["ok"]), true);
  assert.equal(isConfirmationText("ok.", ["ok"]), true);
  assert.equal(isConfirmationText("Proceed", ["ok"]), false);
  assert.equal(isConfirmationText("Confirm", ["ok"]), false);
});

test("assistantRequestedConfirmation detects explicit OK instruction", () => {
  const session: ChatSession = {
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    messages: [
      {
        role: "assistant",
        text: "Summary done. Type OK to confirm generation of Turtle.",
        createdAt: new Date().toISOString()
      }
    ]
  };
  assert.equal(assistantRequestedConfirmation(session, ["type ok to confirm"]), true);
});
