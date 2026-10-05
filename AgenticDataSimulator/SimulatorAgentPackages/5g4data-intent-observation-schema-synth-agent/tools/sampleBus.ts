export interface SampleEvent {
  metric: string;
  timestampMs: number;
  value: number;
  conditionId?: string;
}

interface StoredSample extends SampleEvent {
  publishedAtMs: number;
}

export class SampleBus {
  private readonly byMetric = new Map<string, StoredSample[]>();

  publish(event: SampleEvent): void {
    const metric = event.metric.trim();
    if (!metric || !Number.isFinite(event.timestampMs) || !Number.isFinite(event.value)) {
      return;
    }
    const list = this.byMetric.get(metric) ?? [];
    list.push({ ...event, metric, publishedAtMs: Date.now() });
    this.byMetric.set(metric, list);
  }

  getSamplesInWindow(metric: string, endMs: number, windowMs: number): SampleEvent[] {
    const key = metric.trim();
    const startMs = endMs - Math.max(0, windowMs);
    const list = this.byMetric.get(key);
    if (!list || list.length === 0) return [];
    return list
      .filter((s) => s.timestampMs > startMs && s.timestampMs <= endMs)
      .map(({ metric: m, timestampMs, value, conditionId }) => ({
        metric: m,
        timestampMs,
        value,
        ...(conditionId !== undefined ? { conditionId } : {}),
      }));
  }

  clear(): void {
    this.byMetric.clear();
  }
}
