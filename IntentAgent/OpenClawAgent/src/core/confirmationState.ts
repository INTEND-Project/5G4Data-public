import type { ChatSession } from "../models.js";

const CONFIRMATIONS = new Set([
  "ok",
  "okay",
  "yes",
  "y",
  "proceed",
  "go ahead",
  "generate",
  "confirm",
  "confirmed"
]);

export function isConfirmationText(userText: string): boolean {
  return CONFIRMATIONS.has(userText.trim().toLowerCase());
}

export function assistantRequestedConfirmation(session: ChatSession): boolean {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (!message) continue;
    if (message.role !== "assistant") continue;
    const lowered = message.text.toLowerCase();
    return lowered.includes("please confirm") || lowered.includes("confirm or");
  }
  return false;
}

export function lastSubstantiveUserRequest(session: ChatSession): string | null {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (!message) continue;
    if (message.role !== "user") continue;
    if (!isConfirmationText(message.text)) return message.text;
  }
  return null;
}
