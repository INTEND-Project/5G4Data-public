"use client";

type PrometheusPanelProps = {
  prometheusConnected: boolean;
};

export function PrometheusPanel({ prometheusConnected }: PrometheusPanelProps) {
  return (
    <section className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Prometheus</h2>
        <span
          className={`workspace-chip ${
            prometheusConnected ? "workspace-chip-live" : "workspace-chip-down"
          }`}
        >
          Prometheus
        </span>
      </div>
      <div className="workspace-stack">
        {!prometheusConnected ? (
          <article className="workspace-card">
            <strong>Prometheus is not reachable</strong>
            <p>Configure PROMETHEUS_URL and confirm the service is running.</p>
          </article>
        ) : (
          <article className="workspace-card">
            <strong>Prometheus is connected</strong>
            <p>Intent observation metrics are listed under Intents.</p>
          </article>
        )}
      </div>
    </section>
  );
}
