from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pyshacl import validate
from rdflib import Graph


@dataclass(slots=True)
class ShaclValidationResult:
    conforms: bool
    report_text: str


def validate_turtle_with_shapes(
    turtle_text: str,
    *,
    shapes_file: Path,
) -> ShaclValidationResult:
    data_graph = Graph().parse(data=turtle_text, format="turtle")
    shapes_graph = Graph().parse(str(shapes_file), format="turtle")
    conforms, _, report_text = validate(
        data_graph=data_graph,
        shacl_graph=shapes_graph,
        inference="none",
        abort_on_first=False,
        allow_infos=True,
        allow_warnings=True,
        meta_shacl=False,
        debug=False,
    )
    return ShaclValidationResult(conforms=bool(conforms), report_text=str(report_text))
