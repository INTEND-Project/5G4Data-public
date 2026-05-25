import {
  postRemoteWrite,
  prometheusRemoteWriteUrl,
  type RemoteWriteSample
} from "./prometheusRemoteWrite.js";

export interface PrometheusSample {
  metricName: string;
  value: number;
  labels?: Record<string, string>;
  timestampMs?: number;
}

export class PrometheusTool {
  constructor(
    private readonly pushgatewayUrl?: string,
    readonly prometheusQueryBaseUrl?: string,
    private readonly remoteWriteUrl?: string
  ) {}

  static fromEnv(
    pushgatewayUrl = process.env.PUSHGATEWAY_URL?.trim(),
    prometheusUrl = process.env.PROMETHEUS_URL?.trim() ||
      "http://127.0.0.1:9090/prometheus",
    remoteWriteUrl = process.env.PROMETHEUS_REMOTE_WRITE_URL?.trim()
  ): PrometheusTool {
    const base = prometheusUrl.replace(/\/$/, "");
    return new PrometheusTool(
      pushgatewayUrl,
      base,
      remoteWriteUrl || prometheusRemoteWriteUrl(undefined, base)
    );
  }

  formatSample(sample: PrometheusSample): string {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
          .join(",")}}`
      : "";
    const valuePart =
      sample.timestampMs !== undefined
        ? `${sample.value} ${Math.trunc(sample.timestampMs)}`
        : `${sample.value}`;
    return `${sample.metricName}${labels} ${valuePart}\n`;
  }

  async pushSample(sample: PrometheusSample, job = "intent_reports"): Promise<boolean> {
    if (!this.pushgatewayUrl) return false;
    const endpoint = `${this.pushgatewayUrl.replace(/\/$/, "")}/metrics/job/${encodeURIComponent(job)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: this.formatSample(sample)
    });
    return response.ok;
  }

  async remoteWriteBatch(samples: PrometheusSample[]): Promise<boolean> {
    const url = this.remoteWriteUrl;
    if (!url || samples.length === 0) return false;

    const remoteSamples: RemoteWriteSample[] = samples
      .filter((s) => s.timestampMs !== undefined)
      .map((s) => ({
        metricName: s.metricName,
        value: s.value,
        labels: s.labels,
        timestampMs: Math.trunc(s.timestampMs!)
      }));

    if (remoteSamples.length === 0) return false;

    try {
      return await postRemoteWrite(url, remoteSamples);
    } catch (err) {
      process.stderr.write(
        `Prometheus remote write failed (${remoteSamples.length} samples): ${String(err)}\n`
      );
      return false;
    }
  }
}
