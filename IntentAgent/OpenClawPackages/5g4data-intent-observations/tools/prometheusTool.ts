export interface PrometheusSample {
  metricName: string;
  value: number;
  labels?: Record<string, string>;
}

export class PrometheusTool {
  constructor(private readonly pushgatewayUrl?: string) {}

  private formatSample(sample: PrometheusSample): string {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
          .join(",")}}`
      : "";
    return `${sample.metricName}${labels} ${sample.value}\n`;
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
}
