import type { ChatSession } from "../models.js";

function normalizeUserConfirmationInput(userText: string): string {
  return userText
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
}

export function isConfirmationText(userText: string, acceptedUserInputs: string[]): boolean {
  const normalized = normalizeUserConfirmationInput(userText);
  return acceptedUserInputs.some(
    (candidate) => normalizeUserConfirmationInput(candidate) === normalized
  );
}

export function assistantRequestedConfirmation(
  session: ChatSession,
  assistantMarkers: string[]
): boolean {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (!message) continue;
    if (message.role !== "assistant") continue;
    const lowered = message.text.toLowerCase();
    return assistantMarkers.some((marker) => lowered.includes(marker.toLowerCase()));
  }
  return false;
}

export function lastSubstantiveUserRequest(
  session: ChatSession,
  acceptedUserInputs: string[]
): string | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (!message) continue;
    if (message.role !== "user") continue;
    if (!isConfirmationText(message.text, acceptedUserInputs)) return message.text;
  }
  return null;
}
