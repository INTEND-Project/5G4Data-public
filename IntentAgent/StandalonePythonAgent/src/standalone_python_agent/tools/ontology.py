from __future__ import annotations

from pathlib import Path


class OntologyReader:
    def __init__(self, ontology_root: Path | None, example_intents_root: Path | None) -> None:
        self.ontology_root = ontology_root
        self.example_intents_root = example_intents_root

    def ontology_summary(self, line_limit: int = 160) -> str:
        if not self.ontology_root or not self.ontology_root.exists():
            return "Ontology root is not configured or does not exist."

        entrypoint = self.ontology_root / "IntentCommonModel.ttl"
        if not entrypoint.exists():
            return f"Ontology entrypoint not found: {entrypoint}"

        lines = entrypoint.read_text(encoding="utf-8", errors="ignore").splitlines()
        snippet = "\n".join(lines[:line_limit]).strip()
        return f"Ontology entrypoint: {entrypoint}\n{snippet}"

    def example_summary(self, file_limit: int = 5, line_limit: int = 60) -> str:
        if not self.example_intents_root or not self.example_intents_root.exists():
            return "Example intents root is not configured or does not exist."

        turtle_files = sorted(self.example_intents_root.glob("*.ttl"))[:file_limit]
        if not turtle_files:
            return f"No Turtle example intents found in {self.example_intents_root}"

        parts: list[str] = []
        for path in turtle_files:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            parts.append(f"Example file: {path.name}\n" + "\n".join(lines[:line_limit]).strip())
        return "\n\n".join(parts)
