"use client";

import Image from "next/image";
import { useEffect } from "react";

export type AboutHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function AboutHelpDialog({ open, onClose }: AboutHelpDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="workspace-save-name-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby="workspace-about-help-dialog-title"
        aria-modal="true"
        className="workspace-save-name-dialog workspace-about-help-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="workspace-about-help-header">
          <Image
            alt="INTEND icon"
            className="workspace-about-help-logo"
            height={44}
            src="https://intendproject.eu/intend-icon.png"
            width={44}
          />
          <div className="workspace-about-help-brand-copy">
            <strong id="workspace-about-help-dialog-title">
              INTEND Data Generation Controller Studio
            </strong>
            <span>
              TM Forum intent data generation script design and execution for cognitive continuum
            </span>
          </div>
        </header>

        <section className="workspace-about-help-section">
          <h4>About</h4>
          <p className="workspace-save-as-dialog-hint">
            Developed by Telenor as part of the{" "}
            <a href="https://intendproject.eu" rel="noopener noreferrer" target="_blank">
              INTEND project
            </a>
            .
          </p>
          <p className="workspace-save-as-dialog-hint">
            INTEND Data Generation Controller Studio is the web workspace for designing and running
            TM Forum intent data-generation scripts in the AgenticDataSimulator stack. It can also be
            used to control integration testing for the INTEND extra functional tools (inSustain,
            inCoord, and inExplain).
          </p>
          <p className="workspace-save-as-dialog-hint">
            It connects to GraphDB (knowledge graphs), Prometheus (metric storage), the A2A agent
            registry, and Grafana for visualization. Scripts use a DSL to discover agents, create
            intents, and request observation reports.
          </p>
        </section>

        <section className="workspace-about-help-section">
          <h4>How to use</h4>
          <ol className="workspace-about-help-steps">
            <li>
              <strong>Domain</strong> — select your agent domain in the left sidebar.
            </li>
            <li>
              <strong>Knowledge graph</strong> — create a KG target in the right panel (required
              before running scripts).
            </li>
            <li>
              <strong>Script</strong> — open or create a script in the script list; edit it in the
              Monaco editor.
            </li>
            <li>
              <strong>Preview</strong> — use <strong>Show metrics</strong> to preview workload metrics
              for a <code>create intent</code> prompt without creating an intent.
            </li>
            <li>
              <strong>Run</strong> — click <strong>Run Script</strong> to execute supported DSL
              statements (intent creation, observation reports, etc.).
            </li>
            <li>
              <strong>Intents</strong> — track generated intents in the right <strong>Intents</strong>{" "}
              panel; cards turn green when observation data is ready.
            </li>
            <li>
              <strong>Grafana</strong> — open dashboards from the Grafana icon on an intent card.
            </li>
            <li>
              <strong>Tools</strong> — send intents to inSustain, inCoord, or inExplain from the{" "}
              <strong>Tools</strong> section (configure TMF921 URLs first).
            </li>
            <li>
              <strong>Agents</strong> — adjust LLM model/temperature per agent via the configure
              icon in <strong>Available agents</strong>.
            </li>
          </ol>
        </section>

        <p className="workspace-about-help-footer">
          Full deployment and setup documentation is in the repository{" "}
          <code>README.md</code>.
        </p>

        <div className="workspace-save-name-dialog-actions">
          <button className="workspace-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
