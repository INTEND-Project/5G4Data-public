const KNOWN_INTERVAL_LABELS_MINUTES: Record<number, string> = {
  1: "OneMinute",
  5: "FiveMinute",
  10: "TenMinute",
  15: "FifteenMinute",
  30: "ThirtyMinute",
  60: "SixtyMinute"
};

const KNOWN_INTERVAL_LABELS_SECONDS: Record<number, string> = {
  1: "OneSecond",
  5: "FiveSecond",
  10: "TenSecond",
  15: "FifteenSecond",
  30: "ThirtySecond",
  60: "SixtySecond",
  90: "NinetySecond",
  120: "OneHundredTwentySecond",
  300: "ThreeHundredSecond",
  360: "ThreeHundredSixtySecond",
  600: "SixHundredSecond"
};

export function formatIntervalLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  return KNOWN_INTERVAL_LABELS_MINUTES[rounded] ?? `${rounded}Minute`;
}

export function formatIntervalLabelFromSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  return KNOWN_INTERVAL_LABELS_SECONDS[rounded] ?? `${rounded}Second`;
}

export function clampReportingIntervalMinutes(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(1440, Math.max(1, Math.round(value)));
}

export function clampReportingIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return 600;
  return Math.min(86_400, Math.max(1, Math.round(value)));
}
