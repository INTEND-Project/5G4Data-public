const EXCLUDED_FRAGMENTS = [
  "embedding",
  "whisper",
  "tts",
  "dall-e",
  "dalle",
  "realtime",
  "audio",
  "transcribe",
  "moderation",
  "sora",
];

export function filterChatCapableOpenAiModels(modelIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of modelIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    const lower = id.toLowerCase();
    if (EXCLUDED_FRAGMENTS.some((fragment) => lower.includes(fragment))) continue;
    if (!lower.startsWith("gpt-") && !lower.startsWith("o") && !lower.startsWith("chatgpt")) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }

  return result.sort((a, b) => a.localeCompare(b));
}
