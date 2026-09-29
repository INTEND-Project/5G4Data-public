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

/**
 * True for exact confirmation tokens ("OK") and confirmation-prefixed replies
 * such as "OK, use the chartmuseum URL…" when the assistant asked for confirmation.
 */
export function isConfirmationAck(userText: string, acceptedUserInputs: string[]): boolean {
  if (isConfirmationText(userText, acceptedUserInputs)) return true;
  const normalized = normalizeUserConfirmationInput(userText);
  return acceptedUserInputs.some((candidate) => {
    const token = normalizeUserConfirmationInput(candidate);
    if (!token) return false;
    return (
      normalized.startsWith(`${token},`) ||
      normalized.startsWith(`${token}:`) ||
      normalized.startsWith(`${token} `)
    );
  });
}

/** Text after a confirmation prefix ("OK, …"); null when the message is bare OK. */
export function confirmationExtraInstructions(
  userText: string,
  acceptedUserInputs: string[]
): string | null {
  if (isConfirmationText(userText, acceptedUserInputs)) return null;
  const trimmed = userText.trim();
  for (const candidate of acceptedUserInputs) {
    const token = candidate.trim();
    if (!token) continue;
    const re = new RegExp(`^${escapeRegExp(token)}\\s*[,:]\\s*`, "i");
    const match = trimmed.match(re);
    if (match) {
      const rest = trimmed.slice(match[0].length).trim();
      return rest.length > 0 ? rest : null;
    }
    const spaceRe = new RegExp(`^${escapeRegExp(token)}\\s+`, "i");
    const spaceMatch = trimmed.match(spaceRe);
    if (spaceMatch) {
      const rest = trimmed.slice(spaceMatch[0].length).trim();
      return rest.length > 0 ? rest : null;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (!isConfirmationAck(message.text, acceptedUserInputs)) return message.text;
  }
  return null;
}

export const DEFAULT_REVIEW_ASSISTANT_MARKERS = [
  "type ok to confirm generation of turtle",
  "type ok to confirm",
  "confirm to generate final turtle",
  "please confirm",
  "confirm or"
];

export function isReviewTurnOutput(
  text: string,
  assistantMarkers: string[] = DEFAULT_REVIEW_ASSISTANT_MARKERS
): boolean {
  const lowered = text.toLowerCase();
  if (assistantMarkers.some((marker) => lowered.includes(marker.toLowerCase()))) {
    return true;
  }
  if (/extracted deployment objectives/i.test(text)) return true;
  if (/extracted sustainability objectives/i.test(text)) return true;
  return false;
}
