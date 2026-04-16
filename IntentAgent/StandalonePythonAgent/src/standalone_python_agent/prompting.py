from __future__ import annotations

import re
from pathlib import Path


def read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def strip_frontmatter(markdown: str) -> str:
    return re.sub(r"(?ms)^---\s*\n.*?\n---\s*\n", "", markdown).strip()


def deployment_lookup_instruction(
    deployment_needed: bool,
    catalogue_summary: str,
    full_catalog_mode: bool,
) -> str:
    if not deployment_needed:
        return "No deployment workflow override is needed for this turn."

    if full_catalog_mode:
        return (
            "Deployment-like request detected. You MUST inspect the workload catalogue entries "
            "provided in the runtime context before asking any workload-selection question.\n"
            "Use the chart names and descriptions semantically, not just by keyword overlap.\n"
            "If one workload is clearly the best match for the user request, choose it and continue.\n"
            "If several workloads are plausible, ask one concise disambiguation question that names "
            "those specific candidate charts.\n"
            "Do not ask a generic question such as 'what workload do you want?' before considering "
            "all provided catalogue entries.\n"
            "If the user also requires network QoS (e.g. bandwidth for 4K video), combine expectations: "
            "include data5g:DeploymentExpectation when a matching chart exists, and data5g:NetworkExpectation "
            "for the stated connectivity needs; use GraphDB locality for data5g:DataCenter when placement matters.\n"
            f"Catalogue entries are provided under [Workload catalogue]."
        )

    return (
        "Deployment-like request detected, but the catalogue is too large for full-catalog mode. "
        "Shortlist mode is needed before asking the user to choose a workload.\n"
        f"Current catalogue state:\n{catalogue_summary}"
    )


def request_implies_deployment(user_text: str) -> bool:
    lowered = user_text.lower()
    signals = [
        "deploy",
        "deployment",
        "model",
        "llm",
        "inference",
        "workload",
        "edge",
        "run close",
        "application",
        "private dialogue",
    ]
    return any(signal in lowered for signal in signals)


def request_implies_locality(user_text: str) -> bool:
    lowered = user_text.lower()
    signals = [
        "near ",
        "closest",
        "location",
        "city",
        "region",
        "edge",
        "local",
    ]
    return any(signal in lowered for signal in signals)


def build_system_prompt(system_prompt_text: str, skill_text: str) -> str:
    trimmed_skill = strip_frontmatter(skill_text)
    return (
        f"{system_prompt_text.strip()}\n\n"
        "Use the following workflow specification as binding domain guidance.\n"
        "Follow it closely, but do not quote it unless asked.\n\n"
        f"{trimmed_skill}"
    )


def build_tool_context(
    ontology_summary: str,
    example_summary: str,
    catalogue_summary: str,
    graphdb_summary: str,
    workflow_override: str,
) -> str:
    return (
        "Runtime grounding context:\n"
        f"\n[Ontology]\n{ontology_summary}\n"
        f"\n[Example intents]\n{example_summary}\n"
        f"\n[Workload catalogue]\n{catalogue_summary}\n"
        f"\n[GraphDB]\n{graphdb_summary}\n"
        f"\n[Workflow override]\n{workflow_override}\n"
    )
