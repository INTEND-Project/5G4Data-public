from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re

import httpx
from anthropic import Anthropic
from openai import OpenAI

from standalone_python_agent.config import AppConfig
from standalone_python_agent.models import ChatMessage, ChatSession
from standalone_python_agent.prompting import (
    build_system_prompt,
    build_tool_context,
    deployment_lookup_instruction,
    read_text_file,
    request_implies_deployment,
    request_implies_locality,
)
from standalone_python_agent.llm_transcript import LLMTranscriptLogger
from standalone_python_agent.tools.catalogue import WorkloadCatalogueClient
from standalone_python_agent.tools.graphdb import GraphDBClient
from standalone_python_agent.tools.ontology import OntologyReader


@dataclass(slots=True)
class AgentTurnResult:
    response: str
    warnings: list[str]
    debug: list[str]


class AgentCore:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        openai_kwargs = {"api_key": config.openai_api_key}
        if config.openai_base_url:
            openai_kwargs["base_url"] = config.openai_base_url
        self.openai_client = OpenAI(**openai_kwargs)

        anthropic_kwargs = {"api_key": config.anthropic_api_key}
        if config.anthropic_base_url:
            anthropic_kwargs["base_url"] = config.anthropic_base_url
        self.anthropic_client = Anthropic(**anthropic_kwargs)
        self.catalogue = WorkloadCatalogueClient(config.workload_catalog_base_url)
        self.graphdb = GraphDBClient(
            config.graphdb_endpoint,
            config.graphdb_named_graph,
            query_limit=config.graphdb_query_limit,
        )
        self.ontology = OntologyReader(config.ontology_root, config.example_intents_root)
        self.skill_text = read_text_file(config.skill_file)
        self.system_prompt_text = read_text_file(config.system_prompt_file)
        self.system_prompt = build_system_prompt(self.system_prompt_text, self.skill_text)
        self._llm_logger = LLMTranscriptLogger(config.llm_log_path) if config.llm_log_path else None

    def _log_llm(self, phase: str, request: dict[str, object], response: object) -> None:
        if self._llm_logger is None:
            return
        self._llm_logger.append(phase, request, response)

    @staticmethod
    def _output_policy_instruction() -> str:
        return (
            "Output policy (strict):\n"
            "- Do not narrate actions or progress (forbidden examples: 'I will proceed', "
            "'please hold on', 'now I will create').\n"
            "- If sufficient data exists, return only the final Turtle intent.\n"
            "- If critical data is missing, ask at most 2 concise clarifying questions and stop.\n"
            "- Never output placeholders such as <uuid4>, <same-uuid4>, <condition-id>.\n"
            "- If you output Turtle, use concrete UUID4-derived local names."
        )

    def _fixed_defaults_instruction(self) -> str:
        description_rule = (
            "Always generate a plausible dct:description from user intent unless explicitly provided."
            if self.config.auto_generate_description
            else "Use provided dct:description only."
        )
        return (
            "Fixed defaults policy (strict):\n"
            f"- Always set imo:handler to \"{self.config.default_intent_handler}\".\n"
            f"- Always set imo:owner to \"{self.config.default_intent_owner}\".\n"
            f"- {description_rule}\n"
            "- Do NOT ask user for handler, owner, or description."
        )

    @staticmethod
    def _human_review_instruction() -> str:
        return (
            "Human review policy (strict):\n"
            "- Before generating any Turtle intent, first provide a concise summary of what you will generate.\n"
            "- The summary must include: selected workload (if any), expected expectations (deployment/network), "
            "selected data center (if locality applies), and threshold defaults to use.\n"
            "- End the summary by asking the user to confirm or adjust.\n"
            "- Generate Turtle only after explicit user confirmation (e.g., 'yes', 'ok', 'proceed', 'generate')."
        )

    @staticmethod
    def _violates_output_policy(text: str) -> bool:
        lowered = text.lower()
        placeholder_markers = ("<uuid4>", "<same-uuid4>", "<condition-id>")
        narration_markers = (
            "i will proceed",
            "please hold on",
            "now, i will",
            "now i will",
            "i will create the intent",
            "i will create",
        )
        has_placeholder = any(marker in lowered for marker in placeholder_markers)
        has_narration = any(marker in lowered for marker in narration_markers)
        return has_placeholder or has_narration

    @staticmethod
    def _request_implies_network_qos(user_text: str) -> bool:
        lowered = user_text.lower()
        signals = (
            "latency",
            "bandwidth",
            "throughput",
            "qos",
            "jitter",
            "packet loss",
            "network",
            "response time",
            "delay",
        )
        return any(signal in lowered for signal in signals)

    def _build_runtime_context(self, user_text: str) -> tuple[str, list[str], list[str]]:
        warnings: list[str] = []
        debug: list[str] = []

        ontology_summary = self.ontology.ontology_summary()
        example_summary = self.ontology.example_summary()
        debug.append(
            f"ontology_summary_ready={bool(ontology_summary)} example_summary_ready={bool(example_summary)}"
        )

        catalogue_summary = "No charts found in the workload catalogue."
        full_catalog_mode = False
        selected_chart: str | None = None
        try:
            catalogue_summary = self.catalogue.catalogue_summary_for_llm()
            full_catalog_mode = "Shortlist mode is needed" not in catalogue_summary
            if "No charts found in the workload catalogue." in catalogue_summary:
                debug.append("catalogue_entries=0")
            else:
                debug.append(f"catalogue_full_mode={full_catalog_mode}")

            selected_chart = self._select_chart_semantically(user_text, catalogue_summary, debug)
            if selected_chart:
                objectives_summary = self.catalogue.objectives_summary_for_chart(selected_chart)
                catalogue_summary = (
                    f"{catalogue_summary}\n\n"
                    "[Selected workload objectives]\n"
                    f"{objectives_summary}\n"
                    "Use these objective thresholds as deployment-condition defaults unless the user overrides."
                )
                debug.append(f"selected_chart={selected_chart}")
                objective_names = [
                    match.group(1).strip()
                    for match in re.finditer(r"(?m)^-\s+([^:]+):\s+threshold=", objectives_summary)
                ]
                debug.append(f"chart_objectives_found={len(objective_names)}")
                if objective_names:
                    debug.append(f"chart_objective_names={', '.join(objective_names)}")
        except Exception as exc:  # noqa: BLE001
            catalogue_summary = f"Catalogue lookup failed: {exc}"
            warnings.append("Workload catalogue lookup failed.")
            debug.append(f"catalogue_lookup_error={type(exc).__name__}: {exc}")

        deployment_needed = bool(selected_chart) or request_implies_deployment(user_text)
        debug.append(f"deployment_needed={deployment_needed}")

        graphdb_summary = "GraphDB lookup not required for this turn."
        locality_needed = request_implies_locality(user_text)
        debug.append(f"locality_needed={locality_needed}")
        if locality_needed:
            try:
                payload = self.graphdb.nearest_edge_candidates()
                all_bindings = payload.get("results", {}).get("bindings", [])
                debug.append(f"graphdb_bindings_count={len(all_bindings)}")
                if all_bindings:
                    bindings = list(all_bindings)
                    place_query = self._extract_locality_phrase(user_text)
                    geocoded_anchor: tuple[float, float] | None = None
                    selected_candidate_label = ""
                    selected_candidate_ref = ""
                    if place_query:
                        geocoded_anchor = self._geocode_place(place_query)
                        if geocoded_anchor:
                            place_lat, place_lon = geocoded_anchor
                            debug.append(f"locality_geocode={place_query} ({place_lat:.4f}, {place_lon:.4f})")
                            ranked_bindings: list[tuple[float, dict]] = []
                            for binding in bindings:
                                lat_text = binding.get("lat", {}).get("value", "")
                                lon_text = binding.get("long", {}).get("value", "")
                                try:
                                    dc_lat = float(lat_text)
                                    dc_lon = float(lon_text)
                                except Exception:  # noqa: BLE001
                                    continue
                                distance_km = self._haversine_km(place_lat, place_lon, dc_lat, dc_lon)
                                ranked_bindings.append((distance_km, binding))
                            ranked_bindings.sort(key=lambda item: item[0])
                            if ranked_bindings:
                                bindings = [item[1] for item in ranked_bindings]
                                best = bindings[0]
                                best_cluster = best.get("clusterId", {}).get("value", "")
                                best_location = best.get("location", {}).get("value", "")
                                selected_candidate_label = best_cluster or best_location
                                selected_candidate_ref = f"data5g:{best_cluster}" if best_cluster else ""
                                debug.append(
                                    f"graphdb_selected_nearest={selected_candidate_label or '<unknown>'}"
                                )
                    bindings = bindings[: self.config.graphdb_context_limit]

                    formatted = []
                    for binding in bindings:
                        datacenter = binding.get("datacenter", {}).get("value", "")
                        cluster_id = binding.get("clusterId", {}).get("value", "")
                        location = binding.get("location", {}).get("value", "")
                        lat = binding.get("lat", {}).get("value", "")
                        lon = binding.get("long", {}).get("value", "")
                        label = cluster_id or location or datacenter
                        formatted.append(f"- {label} ({lat}, {lon})")
                    recommendation = (
                        f"Recommended nearest edge data center: {selected_candidate_label}\n"
                        if selected_candidate_label
                        else ""
                    )
                    graphdb_summary = (
                        f"{recommendation}Candidate edge data centers from GraphDB:\n" + "\n".join(formatted)
                    )
                    if selected_candidate_ref:
                        graphdb_summary += (
                            "\n\n[Deployment locality binding]\n"
                            f"For any locality-aware DeploymentExpectation in this turn, use exactly "
                            f"`data5g:DataCenter {selected_candidate_ref} .`\n"
                            "Do not invent or substitute free-text labels such as city names or edge-node aliases."
                        )
                    if place_query and geocoded_anchor:
                        place_lat, place_lon = geocoded_anchor
                        region_wkt = self._bbox_polygon_wkt(place_lat, place_lon)
                        graphdb_summary += (
                            "\n\n[Network expectation geographic context]\n"
                            "Per SKILL.md: when you emit data5g:NetworkExpectation and the user intent is tied to a "
                            "geographic area, add a dedicated icm:Context (separate from deployment context) linked "
                            "from the NetworkExpectation's log:allOf list with:\n"
                            "- data5g:appliesToRegion data5g:RG<unique-id>\n"
                            "- data5g:RG<same-id> a geo:Feature ; geo:hasGeometry [ a geo:Polygon ; "
                            "geo:asWKT \"<WKT>\"^^geo:wktLiteral ] .\n"
                            "Include @prefix geo: <http://www.opengis.net/ont/geosparql#> .\n"
                            f"Approximate region for \"{place_query}\" (center lat={place_lat:.5f}, lon={place_lon:.5f}); "
                            "use this closed polygon unless the user specifies a different area:\n"
                            f"  \"{region_wkt}\"^^geo:wktLiteral\n"
                        )
                else:
                    graphdb_summary = "GraphDB query returned no candidate data centers."
            except Exception as exc:  # noqa: BLE001
                graphdb_summary = f"GraphDB lookup failed: {exc}"
                warnings.append("GraphDB lookup failed.")
                debug.append(f"graphdb_lookup_error={type(exc).__name__}: {exc}")

        workflow_override = deployment_lookup_instruction(deployment_needed, catalogue_summary, full_catalog_mode)
        debug.append("workflow_override_applied=true")

        return (
            build_tool_context(
                ontology_summary=ontology_summary,
                example_summary=example_summary,
                catalogue_summary=catalogue_summary,
                graphdb_summary=graphdb_summary,
                workflow_override=workflow_override,
            ),
            warnings,
            debug,
        )

    @staticmethod
    def _is_confirmation_text(user_text: str) -> bool:
        lowered = user_text.strip().lower()
        confirmations = {
            "ok",
            "okay",
            "yes",
            "y",
            "proceed",
            "go ahead",
            "generate",
            "confirm",
            "confirmed",
        }
        return lowered in confirmations

    @staticmethod
    def _assistant_requested_confirmation(session: ChatSession) -> bool:
        for message in reversed(session.messages):
            if message.role != "assistant":
                continue
            lowered = message.text.lower()
            if "please confirm" in lowered or "confirm or" in lowered:
                return True
            return False
        return False

    @staticmethod
    def _last_substantive_user_request(session: ChatSession) -> str | None:
        for message in reversed(session.messages):
            if message.role != "user":
                continue
            if not AgentCore._is_confirmation_text(message.text):
                return message.text
        return None

    @staticmethod
    def _extract_locality_phrase(user_text: str) -> str | None:
        match = re.search(r"\bnear\s+([^,\n]+)", user_text, re.IGNORECASE)
        if not match:
            return None
        phrase = match.group(1).strip()
        phrase = phrase.split("/")[0].strip()
        return phrase or None

    @staticmethod
    def _geocode_place(place: str) -> tuple[float, float] | None:
        try:
            response = httpx.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": place, "format": "json", "limit": 1},
                headers={"User-Agent": "standalone-python-agent/0.1"},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, list) or not data:
                return None
            first = data[0]
            return float(first["lat"]), float(first["lon"])
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius_km = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return radius_km * c

    @staticmethod
    def _bbox_polygon_wkt(lat: float, lon: float, delta_deg: float = 0.06) -> str:
        """Closed lon/lat ring (WKT geographic), ~delta_deg box around center."""
        west, east = lon - delta_deg, lon + delta_deg
        south, north = lat - delta_deg, lat + delta_deg
        ring = [
            (west, south),
            (east, south),
            (east, north),
            (west, north),
            (west, south),
        ]
        coords = ",".join(f"{lo:.6f} {la:.6f}" for lo, la in ring)
        return f"POLYGON(({coords}))"

    def _select_chart_semantically(
        self,
        user_text: str,
        catalogue_summary: str,
        debug: list[str],
    ) -> str | None:
        charts = self.catalogue.list_charts()
        unique_names = sorted({str(c.get("name", "")).strip() for c in charts if c.get("name")})
        if not unique_names:
            return None

        # Preserve explicit user choice exactly when provided.
        lowered = user_text.lower()
        for name in unique_names:
            if name.lower() in lowered:
                debug.append("chart_selection_mode=explicit_user_choice")
                return name

        prompt = (
            "Choose the single best matching workload chart for the user request using semantic relevance.\n"
            "Return strict JSON only with keys: best_match, confidence, reason.\n"
            "- best_match must be one exact chart name from the provided list, or null.\n"
            "- confidence must be a number between 0 and 1.\n"
            "- reason must be brief.\n\n"
            f"User request:\n{user_text}\n\n"
            f"Available charts:\n{catalogue_summary}"
        )
        if self.config.llm_provider == "openai":
            raw = self._run_openai_turn(
                [
                    {"role": "system", "content": "You are a strict JSON workload selector."},
                    {"role": "user", "content": prompt},
                ],
                phase="chart_selection_openai",
            )
        else:
            selector_request = {
                "model": self.config.anthropic_model,
                "max_tokens": 400,
                "temperature": 0.0,
                "system": "You are a strict JSON workload selector.",
                "messages": [{"role": "user", "content": prompt}],
            }
            response = self.anthropic_client.messages.create(**selector_request)
            self._log_llm("chart_selection_anthropic", selector_request, response)
            text_parts = []
            for block in response.content:
                if getattr(block, "type", "") == "text":
                    text_parts.append(getattr(block, "text", ""))
            raw = "".join(text_parts).strip()
        parsed = self._extract_selector_json(raw)
        candidate = parsed.get("best_match")
        confidence = float(parsed.get("confidence", 0.0) or 0.0)
        debug.append(f"chart_selection_mode=semantic_llm confidence={confidence:.2f}")
        if isinstance(candidate, str) and candidate in unique_names and confidence >= 0.65:
            return candidate
        return None

    @staticmethod
    def _extract_selector_json(raw_text: str) -> dict[str, object]:
        text = (raw_text or "").strip()
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:  # noqa: BLE001
            pass
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                if isinstance(parsed, dict):
                    return parsed
            except Exception:  # noqa: BLE001
                return {}
        return {}

    def _run_openai_turn(self, messages: list[dict[str, str]], *, phase: str = "openai_chat") -> str:
        model_id = self.config.openai_model
        create_kwargs: dict[str, object] = {
            "model": model_id,
            "messages": messages,
        }
        # Some newer models (o* and gpt‑5* families, including Codex variants)
        # only support the default temperature and reject explicit values.
        if not (model_id.startswith("o") or model_id.startswith("gpt-5")):
            create_kwargs["temperature"] = 0.1
        response = self.openai_client.chat.completions.create(**create_kwargs)
        self._log_llm(phase, {"kwargs": create_kwargs}, response)
        return response.choices[0].message.content or ""

    def _run_anthropic_turn(
        self,
        runtime_context: str,
        session_messages: list[dict[str, str]],
        *,
        phase: str = "anthropic_messages",
    ) -> str:
        system = (
            f"{self.system_prompt}\n\n"
            "Use this runtime grounding context when it is relevant. "
            "If it conflicts with your assumptions, trust the grounding context.\n\n"
            f"{runtime_context}"
        )
        request = {
            "model": self.config.anthropic_model,
            "max_tokens": 2000,
            "temperature": 0.1,
            "system": system,
            "messages": session_messages,
        }
        response = self.anthropic_client.messages.create(**request)
        self._log_llm(phase, request, response)
        text_parts = []
        for block in response.content:
            if getattr(block, "type", "") == "text":
                text_parts.append(getattr(block, "text", ""))
        return "".join(text_parts).strip()

    def _repair_output_if_needed(
        self,
        text: str,
        runtime_context: str,
        openai_messages: list[dict[str, str]],
        provider_messages: list[dict[str, str]],
        debug: list[str],
        user_text: str,
    ) -> str:
        issues = self._collect_output_issues(
            text=text,
            user_text=user_text,
            runtime_context=runtime_context,
        )
        if not issues:
            return text

        debug.append("output_policy_violation_detected=true")
        for issue in issues:
            debug.append(f"output_issue={issue}")
        issues_block = "\n".join(f"- {issue}" for issue in issues)
        repair_instruction = (
            "Your previous response violated output policy. "
            "Rewrite now following all rules exactly. Return either:\n"
            "1) a concise summary + confirmation question (if not yet confirmed), or\n"
            "2) a valid final Turtle intent (only if user has confirmed), or\n"
            "3) at most 2 concise clarifying questions if critical values are missing.\n\n"
            f"{self._output_policy_instruction()}\n\n"
            f"{self._fixed_defaults_instruction()}\n\n"
            f"{self._human_review_instruction()}\n\n"
            f"Validation failures to fix:\n{issues_block}\n\n"
            f"Previous invalid response:\n{text}"
        )
        if self.config.llm_provider == "anthropic":
            repair_request = {
                "model": self.config.anthropic_model,
                "max_tokens": 2000,
                "temperature": 0.0,
                "system": (
                    f"{self.system_prompt}\n\n"
                    f"{self._output_policy_instruction()}\n\n"
                    f"{self._fixed_defaults_instruction()}\n\n"
                    f"{self._human_review_instruction()}\n\n"
                    "Use runtime context below.\n\n"
                    f"{runtime_context}"
                ),
                "messages": [*provider_messages, {"role": "user", "content": repair_instruction}],
            }
            repaired = self.anthropic_client.messages.create(**repair_request)
            self._log_llm("repair_anthropic", repair_request, repaired)
            text_parts = []
            for block in repaired.content:
                if getattr(block, "type", "") == "text":
                    text_parts.append(getattr(block, "text", ""))
            return "".join(text_parts).strip()

        repair_kwargs: dict[str, object] = {
            "model": self.config.openai_model,
            "messages": [*openai_messages, {"role": "user", "content": repair_instruction}],
        }
        model_id = self.config.openai_model
        if not (model_id.startswith("o") or model_id.startswith("gpt-5")):
            repair_kwargs["temperature"] = 0.0
        repaired = self.openai_client.chat.completions.create(**repair_kwargs)
        self._log_llm("repair_openai", {"kwargs": repair_kwargs}, repaired)
        repaired_text = repaired.choices[0].message.content or ""
        second_issues = self._collect_output_issues(
            text=repaired_text,
            user_text=user_text,
            runtime_context=runtime_context,
        )
        if second_issues:
            debug.append("output_repair_still_invalid=true")
            return (
                "I cannot produce a valid final Turtle intent yet. "
                "Please provide missing critical deployment/network constraints, "
                "or ask me to regenerate from the selected workload with strict validation."
            )
        return repaired_text

    @staticmethod
    def _collect_output_issues(text: str, user_text: str, runtime_context: str = "") -> list[str]:
        issues: list[str] = []
        lowered = text.lower()
        runtime_lowered = runtime_context.lower()
        runtime_has_selected_workload = "[selected workload objectives]" in runtime_lowered or "selected chart:" in runtime_lowered
        if AgentCore._violates_output_policy(text):
            issues.append("Contains narration/progress text or placeholder markers.")

        if "@prefix" in text or "icm:Intent" in text:
            subject_defs = re.findall(r"(?m)^(data5g:[A-Za-z0-9_\-]+)\s+a\s+", text)
            duplicates = sorted({s for s in subject_defs if subject_defs.count(s) > 1})
            if duplicates:
                issues.append(f"Duplicate subject identifiers found: {', '.join(duplicates[:5])}")

            required_tokens = ["icm:Intent", "icm:ReportingExpectation"]
            if runtime_has_selected_workload or request_implies_deployment(user_text):
                required_tokens.append("data5g:DeploymentExpectation")
            if AgentCore._request_implies_network_qos(user_text):
                required_tokens.append("data5g:NetworkExpectation")
            missing = [token for token in required_tokens if token not in text]
            if missing:
                issues.append(f"Missing required classes/blocks: {', '.join(missing)}")

            if "data5g:DeploymentDescriptor" not in text and (
                runtime_has_selected_workload or "deploy" in lowered
            ):
                issues.append("Missing data5g:DeploymentDescriptor in deployment context.")

            if (
                request_implies_locality(user_text)
                and "data5g:DeploymentExpectation" in text
                and "data5g:DataCenter" not in text
            ):
                issues.append("Missing data5g:DataCenter in deployment context for locality-aware deployment.")
            required_datacenter_match = re.search(
                r"For any locality-aware DeploymentExpectation in this turn, use exactly "
                r"`data5g:DataCenter (data5g:[A-Za-z0-9_\-]+)`",
                runtime_context,
            )
            if required_datacenter_match and "data5g:DeploymentExpectation" in text:
                required_datacenter = required_datacenter_match.group(1)
                datacenter_values = re.findall(r"data5g:DataCenter\s+([^ ;]+)\s*\.", text)
                if not datacenter_values:
                    issues.append(
                        f"Missing required deployment datacenter binding `{required_datacenter}` from GraphDB selection."
                    )
                else:
                    if required_datacenter not in datacenter_values:
                        issues.append(
                            f"Deployment datacenter must use GraphDB-selected value `{required_datacenter}`, "
                            f"not {', '.join(datacenter_values[:3])}."
                        )
                    invalid_free_text = [value for value in datacenter_values if value.startswith("\"")]
                    if invalid_free_text:
                        issues.append(
                            "Deployment datacenter must be a data5g resource reference, not a free-text string."
                        )

            if (
                "data5g:NetworkExpectation" in text
                and request_implies_locality(user_text)
                and AgentCore._request_implies_network_qos(user_text)
            ):
                if "data5g:appliesToRegion" not in text:
                    issues.append(
                        "NetworkExpectation with geographic user intent must include icm:Context with "
                        "data5g:appliesToRegion pointing to a geo:Feature (see SKILL.md)."
                    )
                if "geo:Feature" not in text or "geo:asWKT" not in text:
                    issues.append(
                        "Network region must be expressed as geo:Feature with geo:Polygon/geo:asWKT "
                        "(and @prefix geo: <http://www.opengis.net/ont/geosparql#>)."
                    )

            if "rusty-llm" in lowered and "rusty-llm" not in text:
                issues.append("Selected workload rusty-llm is not reflected in the output.")

            condition_ids = re.findall(r"(?m)^(data5g:([A-Za-z0-9_\-]+))\s+a\s+icm:Condition\s*;", text)
            invalid_condition_ids = [full for full, short in condition_ids if not short.startswith("CO")]
            if invalid_condition_ids:
                issues.append(
                    "Condition identifiers must start with 'CO': "
                    + ", ".join(invalid_condition_ids[:5])
                )

        if "please provide the following details" in lowered:
            issues.append("Asked for details that should be auto-filled by fixed defaults policy.")
        if "handler" in lowered and "please provide" in lowered:
            issues.append("Asked user for handler even though handler is fixed.")
        if "owner" in lowered and "please provide" in lowered:
            issues.append("Asked user for owner even though owner is fixed.")
        if "description" in lowered and "please provide" in lowered:
            issues.append("Asked user for description even though description should be auto-generated.")
        has_objective_defaults = "deployment objective defaults from values.yaml objectives" in runtime_lowered
        asks_for_thresholds = (
            "threshold" in lowered
            and (
                "please provide" in lowered
                or "do you want to set" in lowered
                or "what" in lowered
                or "which" in lowered
            )
            and "?" in text
        )
        if has_objective_defaults and asks_for_thresholds:
            issues.append(
                "Asked user for deployment thresholds even though values.yaml objective defaults are available."
            )

            objective_names = {
                match.group(1).strip().lower()
                for match in re.finditer(r"(?m)^-\s+([^:]+):\s+threshold=", runtime_context)
            }
            if objective_names:
                mentions_known_objective = any(name in lowered for name in objective_names)
                if not mentions_known_objective:
                    issues.append(
                        "Threshold question is not grounded in objective names extracted from values.yaml."
                    )

        return issues

    def run_turn(self, session: ChatSession, user_text: str) -> AgentTurnResult:
        confirmation_ack = self._is_confirmation_text(user_text) and self._assistant_requested_confirmation(session)
        effective_user_text = user_text
        if confirmation_ack:
            previous_request = self._last_substantive_user_request(session)
            if previous_request:
                effective_user_text = previous_request

        runtime_context, warnings, debug = self._build_runtime_context(effective_user_text)
        debug.append(f"confirmation_acknowledged={confirmation_ack}")
        if confirmation_ack and effective_user_text != user_text:
            debug.append("confirmation_context_reused=true")
        session.messages.append(ChatMessage(role="user", text=user_text))
        debug.append(f"session_messages_after_user={len(session.messages)}")

        openai_messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "system", "content": self._output_policy_instruction()},
            {"role": "system", "content": self._fixed_defaults_instruction()},
            {"role": "system", "content": self._human_review_instruction()},
            {
                "role": "system",
                "content": (
                    "Use this runtime grounding context when it is relevant. "
                    "If it conflicts with your assumptions, trust the grounding context.\n\n"
                    f"{runtime_context}"
                ),
            },
        ]
        if confirmation_ack:
            openai_messages.append(
                {
                    "role": "system",
                    "content": (
                        "The user has explicitly confirmed. Do not ask for confirmation again. "
                        "Generate the final Turtle intent now."
                    ),
                }
            )
        provider_messages: list[dict[str, str]] = []
        for message in session.messages:
            openai_messages.append({"role": message.role, "content": message.text})
            provider_messages.append({"role": message.role, "content": message.text})

        if self.config.llm_provider == "anthropic":
            debug.append(f"llm_provider=anthropic model={self.config.anthropic_model}")
            text = self._run_anthropic_turn(
                runtime_context=runtime_context,
                session_messages=provider_messages,
                phase="main_turn_anthropic",
            )
        else:
            debug.append(f"llm_provider=openai model={self.config.openai_model}")
            text = self._run_openai_turn(openai_messages, phase="main_turn_openai")

        text = self._repair_output_if_needed(
            text=text,
            runtime_context=runtime_context,
            openai_messages=openai_messages,
            provider_messages=provider_messages,
            debug=debug,
            user_text=effective_user_text,
        )

        session.messages.append(ChatMessage(role="assistant", text=text))
        debug.append(f"session_messages_after_assistant={len(session.messages)}")
        return AgentTurnResult(response=text, warnings=warnings, debug=debug)
