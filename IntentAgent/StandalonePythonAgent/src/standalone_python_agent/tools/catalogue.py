from __future__ import annotations

import json
import io
import re
import tarfile
from typing import Any

import httpx
import yaml

FULL_CATALOG_LLM_MATCH_THRESHOLD = 50


class WorkloadCatalogueClient:
    def __init__(self, base_url: str, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _get(self, path: str) -> Any:
        response = httpx.get(
            f"{self.base_url}{path}",
            timeout=self.timeout,
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        return response.json()

    def _get_bytes(self, url_or_path: str) -> bytes:
        if url_or_path.startswith("http://") or url_or_path.startswith("https://"):
            url = url_or_path
        else:
            url = f"{self.base_url}/{url_or_path.lstrip('/')}"
        response = httpx.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.content

    def list_charts(self) -> list[dict[str, Any]]:
        payload = self._get("/api/charts")
        if isinstance(payload, dict) and "charts" in payload:
            charts = payload["charts"]
            if isinstance(charts, list):
                return charts
        # ChartMuseum typically returns a map:
        # { "<chart-name>": [ {version1...}, {version2...} ], ... }
        if isinstance(payload, dict):
            flattened: list[dict[str, Any]] = []
            for chart_name, versions in payload.items():
                if not isinstance(versions, list):
                    continue
                for entry in versions:
                    if not isinstance(entry, dict):
                        continue
                    normalized = dict(entry)
                    normalized.setdefault("name", chart_name)
                    flattened.append(normalized)
            if flattened:
                flattened.sort(
                    key=lambda item: (
                        str(item.get("name", "")),
                        str(item.get("version", "")),
                    ),
                    reverse=True,
                )
                return flattened
        if isinstance(payload, list):
            return payload
        return []

    def catalogue_summary_for_llm(self, max_entries: int = FULL_CATALOG_LLM_MATCH_THRESHOLD) -> str:
        charts = self.list_charts()
        if not charts:
            return "No charts found in the workload catalogue."

        if len(charts) > max_entries:
            names = ", ".join(str(chart.get("name", "<unknown>")) for chart in charts[:max_entries])
            return (
                f"Catalogue currently has {len(charts)} entries, which exceeds the full-catalog "
                f"LLM matching threshold of {max_entries}. Shortlist mode is needed. "
                f"First {max_entries} chart names: {names}"
            )

        lines = []
        for chart in charts:
            name = str(chart.get("name", "<unknown>"))
            description = str(chart.get("description", "")).strip()
            version = chart.get("version")
            version_text = f" (version: {version})" if version else ""
            lines.append(f"- {name}{version_text}: {description}")
        return "\n".join(lines)

    def get_chart_versions(self, name: str) -> Any:
        return self._get(f"/api/charts/{name}")

    def get_chart_version(self, name: str, version: str) -> Any:
        return self._get(f"/api/charts/{name}/{version}")

    @staticmethod
    def _normalize_text(value: str) -> str:
        return re.sub(r"\s+", " ", value.strip().lower())

    @staticmethod
    def _objectives_from_values_payload(values: Any) -> list[dict[str, Any]]:
        def _extract_objectives(node: Any) -> list[dict[str, Any]]:
            if isinstance(node, dict):
                direct = node.get("objectives")
                if isinstance(direct, list):
                    typed = [item for item in direct if isinstance(item, dict)]
                    if typed:
                        return typed
                for child in node.values():
                    found = _extract_objectives(child)
                    if found:
                        return found
            elif isinstance(node, list):
                for child in node:
                    found = _extract_objectives(child)
                    if found:
                        return found
            return []

        if isinstance(values, dict):
            return _extract_objectives(values)

        if isinstance(values, str):
            stripped = values.strip()
            if not stripped:
                return []
            parsed: Any
            try:
                parsed = json.loads(stripped)
            except Exception:  # noqa: BLE001
                parsed = yaml.safe_load(stripped)
            if isinstance(parsed, (dict, list)):
                return _extract_objectives(parsed)
        return []

    def objectives_summary_for_chart(self, chart_name: str) -> str:
        payload = self.get_chart_versions(chart_name)
        entries: list[dict[str, Any]]
        if isinstance(payload, list):
            entries = [item for item in payload if isinstance(item, dict)]
        elif isinstance(payload, dict):
            entries = [payload]
        else:
            entries = []

        entries.sort(key=lambda item: str(item.get("version", "")), reverse=True)
        for entry in entries:
            version = str(entry.get("version", "")).strip() or "<unknown>"
            objectives = self._objectives_from_values_payload(entry.get("values"))
            if not objectives and version != "<unknown>":
                try:
                    version_payload = self.get_chart_version(chart_name, version)
                    if isinstance(version_payload, dict):
                        objectives = self._objectives_from_values_payload(version_payload.get("values"))
                        if not objectives:
                            for key in ("files", "chart", "config", "raw_values", "values_yaml"):
                                objectives = self._objectives_from_values_payload(version_payload.get(key))
                                if objectives:
                                    break
                except Exception:  # noqa: BLE001
                    objectives = []
            if not objectives:
                objectives = self._objectives_from_chart_archive(entry)
            if not objectives:
                continue
            lines = [
                f"Selected chart: {chart_name} (version {version})",
                "Deployment objective defaults from values.yaml objectives:",
            ]
            for objective in objectives:
                name = str(objective.get("name", "<unnamed>")).strip()
                hint = objective.get("tmf-value-hint")
                measured_by = str(objective.get("measuredBy", "")).strip()
                if hint is not None and str(hint).strip() != "":
                    threshold = str(hint).strip()
                    source = "tmf-value-hint"
                else:
                    threshold = str(objective.get("value", "")).strip() or "unspecified"
                    source = "value"
                measured_clause = f", measuredBy={measured_by}" if measured_by else ""
                lines.append(f"- {name}: threshold={threshold} (source={source}{measured_clause})")
            return "\n".join(lines)

        return (
            f"Selected chart: {chart_name}. Could not extract objectives from chart values.yaml. "
            "Ask user for thresholds only if no objective defaults can be retrieved."
        )

    def _objectives_from_chart_archive(self, chart_entry: dict[str, Any]) -> list[dict[str, Any]]:
        urls = chart_entry.get("urls")
        if not isinstance(urls, list) or not urls:
            return []
        for candidate_url in urls:
            if not isinstance(candidate_url, str) or not candidate_url:
                continue
            try:
                archive_bytes = self._get_bytes(candidate_url)
                with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as tf:
                    members = [m for m in tf.getmembers() if m.isfile() and m.name.endswith("/values.yaml")]
                    if not members:
                        continue
                    values_file = tf.extractfile(members[0])
                    if values_file is None:
                        continue
                    values_text = values_file.read().decode("utf-8", errors="replace")
                    objectives = self._objectives_from_values_payload(values_text)
                    if objectives:
                        return objectives
            except Exception:  # noqa: BLE001
                continue
        return []
