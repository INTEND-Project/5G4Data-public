"""Extract metric bounds from intent Turtle (TIO Condition dialect).

Floor ops (atLeast/greater/larger) -> value1 only.
Ceiling ops (smaller/atMost) -> value2 only.
inRange -> value1 + value2.
Never invents fake floors/ceilings.
"""

from __future__ import annotations

import re
from typing import Any

from rdflib import Graph, RDF, URIRef
from rdflib.term import BNode, Literal, Node

QUAN = "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/"
ICM = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/"
DATA5G = "http://5g4data.eu/5g4data#"

FLOOR_OPS = frozenset({"atLeast", "greater", "larger"})
CEILING_OPS = frozenset({"smaller", "atMost"})
RANGE_OPS = frozenset({"inRange"})
BOUND_OPS = FLOOR_OPS | CEILING_OPS | RANGE_OPS

_COMPOUND_RE = re.compile(r"^(?P<stem>.+)_CO(?P<uuid>[a-f0-9]{32})$", re.IGNORECASE)


def local_name(term: Node | None) -> str:
    if term is None:
        return ""
    if isinstance(term, Literal):
        return str(term)
    value = str(term)
    for sep in ("#", "/", ":"):
        if sep in value:
            value = value.rsplit(sep, 1)[-1]
    return value


def rdf_list_members(graph: Graph, node: Node) -> list[Node]:
    if node == RDF.nil:
        return []
    if (node, RDF.first, None) not in graph:
        return [node]
    members: list[Node] = []
    cur: Node | None = node
    seen: set[str] = set()
    while cur is not None and cur != RDF.nil and str(cur) not in seen:
        seen.add(str(cur))
        first = graph.value(cur, RDF.first)
        if first is not None:
            members.append(first)
        cur = graph.value(cur, RDF.rest)
    return members


def objects_by_pred_local(graph: Graph, subject: Node, pred_local: str) -> list[Node]:
    out: list[Node] = []
    for _s, p, o in graph.triples((subject, None, None)):
        if local_name(p) == pred_local:
            out.append(o)
    return out


def object_locals(graph: Graph, subject: Node, pred_local: str) -> list[str]:
    out: list[str] = []
    for obj in objects_by_pred_local(graph, subject, pred_local):
        for member in rdf_list_members(graph, obj):
            name = local_name(member)
            if name:
                out.append(name)
    return out


def subjects_typed(graph: Graph, type_local: str) -> list[Node]:
    seen: set[str] = set()
    out: list[Node] = []
    for s, _p, o in graph.triples((None, RDF.type, None)):
        if local_name(o) != type_local:
            continue
        key = str(s)
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def condition_constraint_nodes(graph: Graph, condition: Node) -> list[Node]:
    nodes: list[Node] = [condition]
    seen = {str(condition)}

    def push(child: Node, pred_local: str) -> None:
        if str(child) in seen:
            return
        child_local = local_name(child)
        if pred_local == "allOf" and (
            child_local.startswith("CO") or child_local.startswith("CX")
        ):
            return
        seen.add(str(child))
        nodes.append(child)

    for _s, p, o in graph.triples((condition, None, None)):
        pred_local = local_name(p)
        if pred_local not in ("forAll", "allOf"):
            continue
        for child in rdf_list_members(graph, o):
            push(child, pred_local)
    return nodes


def compound_metric_for_condition(graph: Graph, condition: Node) -> list[str]:
    condition_id = local_name(condition)
    compounds: list[str] = []
    for node in condition_constraint_nodes(graph, condition):
        props = object_locals(graph, node, "valuesOfTargetProperty")
        for prop in props:
            # Prefer compound already present as data5g local; else stem_conditionId.
            if _COMPOUND_RE.match(prop):
                compounds.append(prop)
            else:
                compounds.append(f"{prop}_{condition_id}" if condition_id else prop)
    return compounds


def metric_matches(requested: str, candidate: str) -> bool:
    req = requested.strip()
    cand = candidate.strip()
    if not req or not cand:
        return False
    if req == cand:
        return True
    if req.lower() == cand.lower():
        return True
    # Stem vs compound
    m_req = _COMPOUND_RE.match(req)
    m_cand = _COMPOUND_RE.match(cand)
    if m_req and m_cand:
        return (
            m_req.group("stem").lower() == m_cand.group("stem").lower()
            and m_req.group("uuid").lower() == m_cand.group("uuid").lower()
        )
    if m_cand and not m_req:
        return m_cand.group("stem").lower() == req.lower()
    if m_req and not m_cand:
        return m_req.group("stem").lower() == cand.lower()
    return False


def _literal_float(node: Node | None) -> float | None:
    if node is None:
        return None
    if isinstance(node, Literal):
        try:
            return float(node)
        except (TypeError, ValueError):
            return None
    try:
        return float(str(node))
    except (TypeError, ValueError):
        return None


def _quantity_value(graph: Graph, qty_node: Node) -> float | None:
    for local in ("value",):
        for obj in objects_by_pred_local(graph, qty_node, local):
            for member in rdf_list_members(graph, obj):
                n = _literal_float(member)
                if n is not None:
                    return n
            n = _literal_float(obj)
            if n is not None:
                return n
    # Blank quantity may carry rdf:value
    for obj in graph.objects(qty_node, RDF.value):
        n = _literal_float(obj)
        if n is not None:
            return n
    return None


def _numeric_values_from_list(graph: Graph, list_head: Node) -> list[float]:
    values: list[float] = []
    for member in rdf_list_members(graph, list_head):
        n = _quantity_value(graph, member)
        if n is None:
            n = _literal_float(member)
        if n is not None:
            values.append(n)
    return values


def parse_condition_bounds(graph: Graph, condition: Node) -> dict[str, float] | None:
    for node in condition_constraint_nodes(graph, condition):
        for _s, p, o in graph.triples((node, None, None)):
            pred = local_name(p)
            if pred not in BOUND_OPS:
                continue
            if pred in RANGE_OPS:
                nums = _numeric_values_from_list(graph, o)
                if len(nums) >= 2:
                    lo, hi = min(nums), max(nums)
                    return {"value1": lo, "value2": hi}
                continue
            threshold = None
            for qty in rdf_list_members(graph, o):
                threshold = _quantity_value(graph, qty)
                if threshold is not None:
                    break
            if threshold is None:
                continue
            if pred in FLOOR_OPS:
                return {"value1": threshold}
            if pred in CEILING_OPS:
                return {"value2": threshold}
    return None


def extract_metric_bounds_from_turtle(
    intent_turtle: str,
    condition_metric: str,
) -> dict[str, float] | None:
    """Return {value1?} and/or {value2?} for the Condition matching condition_metric."""
    graph = Graph()
    graph.parse(data=intent_turtle, format="turtle")
    requested = condition_metric.strip()
    if not requested:
        return None

    for condition in subjects_typed(graph, "Condition"):
        compounds = compound_metric_for_condition(graph, condition)
        if not any(metric_matches(requested, c) for c in compounds):
            # Also match when valuesOfTargetProperty is bare stem and request is compound
            props = []
            for node in condition_constraint_nodes(graph, condition):
                props.extend(object_locals(graph, node, "valuesOfTargetProperty"))
            if not any(metric_matches(requested, p) for p in props):
                continue
        bounds = parse_condition_bounds(graph, condition)
        if bounds:
            return bounds
    return None


# Grafana time-series threshold *areas* paint each step's color only until the next
# step (not to ±∞). configFromData also replaces panel thresholds and drops the Base
# step, so floor metrics need an explicit lower red rail (value0).
#
# Dashboard maps (all via threshold1 push, field order):
#   value0 -> dark-red, value1 -> semi-dark-green, value2 -> dark-red
# Ceiling: omit value0; green [open_lower, T) + red [T, …)
# Floor:   value0 red below T, green [T, open_upper), red above
# inRange: value0 red below lo, green [lo, hi), red [hi, …)
#
# Rails stay near the bound: extreme ±1e15 values do not paint as filled regions.
def _rail_span(ref: float) -> float:
    return max(abs(ref) * 10.0, 100.0)


def grafana_open_lower(ref: float) -> float:
    return ref - _rail_span(ref)


def grafana_open_upper(ref: float) -> float:
    return ref + _rail_span(ref)


# Back-compat aliases used by tests/importers.
GRAFANA_OPEN_LOWER = -1.0e15
GRAFANA_OPEN_UPPER = 1.0e15


def close_bounds_for_grafana(bounds: dict[str, float]) -> dict[str, float]:
    """Close one-sided Condition bounds into Grafana threshold steps (value0/1/2).

    Key order matters: Infinity/configFromData push threshold steps in field order.
    """
    has1 = bounds.get("value1") is not None
    has2 = bounds.get("value2") is not None
    if has1 and not has2:
        # Floor (atLeast/greater/larger): explicit red below the bound.
        t = float(bounds["value1"])
        return {
            "value0": grafana_open_lower(t),
            "value1": t,
            "value2": grafana_open_upper(t),
        }
    if has2 and not has1:
        # Ceiling (smaller/atMost): green below the bound (no value0).
        t = float(bounds["value2"])
        return {
            "value1": grafana_open_lower(t),
            "value2": t,
        }
    if has1 and has2:
        # inRange: explicit red below the lower bound.
        lo = float(bounds["value1"])
        hi = float(bounds["value2"])
        return {
            "value0": grafana_open_lower(lo),
            "value1": lo,
            "value2": hi,
        }
    return dict(bounds)
