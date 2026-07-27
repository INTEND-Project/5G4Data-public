#!/usr/bin/env python3
"""Convert the synthetic Nordic edge-datacenter CSV into Turtle for GraphDB.

Emits one `schema:edgeCluster` resource per edge data center, matching the
SPARQL shape the intent-generating agent queries (see
`SimulatorAgentPackages/5g4data-intent-generating-agent/tools/graphdbTool.ts`):

    ?datacenter a schema:edgeCluster ;
                schema:latitude  ?lat ;
                schema:longitude ?long .
    OPTIONAL { ?datacenter schema:clusterId ?clusterId . }
    OPTIONAL { ?datacenter aeros:location  ?location  . }

All remaining CSV columns (GPUs, CPUs, memory, access URL, electricity source,
cost of compute) are emitted as extra triples for later energy-aware routing.

Usage:
    python3 csv_to_infra_ttl.py \
        --csv ../../Synthetic-Infrastructure-Data-Generation/infrastructure-data/5G4Data_Nordic_Edge_Datacenters.csv \
        --out nordic_edge_infra.ttl

The output is loaded into the `telenor-infrastructure-5g4data` repository's
named graph `http://intendproject.eu/telenor/infra` — see load-infra.sh.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

SCHEMA = "https://intendproject.eu/schema/"
AEROS = "https://aeros.eu/schema/"

# Default paths relative to this script's directory.
HERE = Path(__file__).resolve().parent
DEFAULT_CSV = (
    HERE
    / ".."
    / ".."
    / "Synthetic-Infrastructure-Data-Generation"
    / "infrastructure-data"
    / "5G4Data_Nordic_Edge_Datacenters.csv"
)
DEFAULT_OUT = HERE / "nordic_edge_infra.ttl"


def escape_literal(value: str) -> str:
    """Escape a string for a double-quoted Turtle literal."""
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def emit(rows: list[dict[str, str]]) -> str:
    lines: list[str] = [
        f"@prefix schema: <{SCHEMA}> .",
        f"@prefix aeros: <{AEROS}> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]

    for row in rows:
        cluster_id = (row.get("Cluster_ID") or "").strip()
        if not cluster_id:
            continue  # skip blank trailing lines

        subject = f"schema:{cluster_id}"
        city = escape_literal((row.get("City") or "").strip())
        lat = (row.get("Latitude") or "").strip()
        lon = (row.get("Longitude") or "").strip()
        gpus = escape_literal((row.get("GPUs") or "").strip())
        cpus = escape_literal((row.get("CPUs") or "").strip())
        memory = escape_literal((row.get("Memory") or "").strip())
        access = (row.get("Access") or "").strip()
        electricity = escape_literal(
            (row.get("Major_source_of_electricity") or "").strip()
        )
        cost = (row.get("Cost_of_compute") or "").strip()

        triples: list[str] = ["a schema:edgeCluster"]
        triples.append(f'schema:clusterId "{escape_literal(cluster_id)}"')
        if city:
            triples.append(f'aeros:location "{city}"')
        if lat:
            triples.append(f'schema:latitude "{lat}"^^xsd:decimal')
        if lon:
            triples.append(f'schema:longitude "{lon}"^^xsd:decimal')
        if gpus:
            triples.append(f'schema:gpus "{gpus}"')
        if cpus:
            triples.append(f'schema:cpus "{cpus}"')
        if memory:
            triples.append(f'schema:memory "{memory}"')
        if access:
            triples.append(f"schema:accessEndpoint <{access}>")
        if electricity:
            triples.append(f'schema:electricitySource "{electricity}"')
        if cost:
            triples.append(f'schema:costOfCompute "{cost}"^^xsd:decimal')

        block = f"{subject} " + " ;\n    ".join(triples) + " ."
        lines.append(block)
        lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--delimiter", default=";", help="CSV delimiter (default ';')"
    )
    args = parser.parse_args()

    if not args.csv.exists():
        print(f"CSV not found: {args.csv}", file=sys.stderr)
        return 1

    with args.csv.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh, delimiter=args.delimiter)
        rows = list(reader)

    turtle = emit(rows)
    args.out.write_text(turtle, encoding="utf-8")
    count = sum(1 for r in rows if (r.get("Cluster_ID") or "").strip())
    print(f"Wrote {count} edge clusters to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
