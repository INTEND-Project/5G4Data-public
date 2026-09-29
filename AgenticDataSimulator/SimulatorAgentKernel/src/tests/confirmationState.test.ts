import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantRequestedConfirmation,
  confirmationExtraInstructions,
  isConfirmationAck,
  isConfirmationText,
  isReviewTurnOutput,
  lastSubstantiveUserRequest
} from "../core/confirmationState.js";
import type { ChatSession } from "../models.js";

test("isConfirmationText accepts only OK variants", () => {
  assert.equal(isConfirmationText("OK", ["ok"]), true);
  assert.equal(isConfirmationText("ok.", ["ok"]), true);
  assert.equal(isConfirmationText("Proceed", ["ok"]), false);
  assert.equal(isConfirmationText("Confirm", ["ok"]), false);
  assert.equal(
    isConfirmationText(
      "OK, use the `small-llm-inference` version `0.1.29` as the `data5g:DeploymentDescriptor`",
      ["ok"]
    ),
    false
  );
});

test("isConfirmationAck accepts OK with trailing instructions", () => {
  assert.equal(isConfirmationAck("OK", ["ok"]), true);
  assert.equal(
    isConfirmationAck(
      "OK, use the `small-llm-inference` version `0.1.29` as the `data5g:DeploymentDescriptor`",
      ["ok"]
    ),
    true
  );
  assert.equal(isConfirmationAck("Okay deploy now", ["ok"]), false);
  assert.equal(
    confirmationExtraInstructions(
      "OK, use the `small-llm-inference` version `0.1.29` as the `data5g:DeploymentDescriptor`",
      ["ok"]
    ),
    "use the `small-llm-inference` version `0.1.29` as the `data5g:DeploymentDescriptor`"
  );
});

test("lastSubstantiveUserRequest skips confirmation-prefixed replies", () => {
  const session: ChatSession = {
    sessionId: "s1",
    createdAt: new Date().toISOString(),
    messages: [
      {
        role: "user",
        text: "I want a small llm near Tromsø/Norway in a sustainable manner",
        createdAt: new Date().toISOString()
      },
      {
        role: "assistant",
        text: "Type OK to confirm generation of Turtle.",
        createdAt: new Date().toISOString()
      },
      {
        role: "user",
        text: "OK, use the chartmuseum descriptor",
        createdAt: new Date().toISOString()
      }
    ]
  };
  assert.equal(
    lastSubstantiveUserRequest(session, ["ok"]),
    "I want a small llm near Tromsø/Norway in a sustainable manner"
  );
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

test("isReviewTurnOutput detects confirmation prompt and objective sections", () => {
  assert.equal(
    isReviewTurnOutput("Summary complete. Type OK to confirm generation of Turtle."),
    true
  );
  assert.equal(isReviewTurnOutput("Extracted deployment objectives\n- metric: threshold=1"), true);
  assert.equal(isReviewTurnOutput("@prefix data5g: <http://example/> .\ndata5g:I1 a icm:Intent ."), false);
});
