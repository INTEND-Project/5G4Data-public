"""Observation schema metadata and lightweight model introspection."""
from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

from edge_datacenter_env import (
    DC_OBS_FEATURES_V10,
    DC_OBS_FEATURES_V8,
    NUM_DATACENTERS,
    OBS_FEATURES_PER_DC,
)

# Streamlit knob ids mapped to observation features they configure at step 0.
# ``None`` means the knob is always available (episode dynamics, not obs dims).
KNOB_REQUIRED_FEATURES: dict[str, frozenset[str] | None] = {
    "max_cap_dc0": frozenset({"capacity", "energy", "accumulated_tps"}),
    "max_cap_dc1": frozenset({"capacity", "energy", "accumulated_tps"}),
    "min_tps": frozenset({"sla_pressure", "sla_headroom"}),
    "session_count_scale": frozenset({"active_sessions"}),
    "cap_frac_dc0": frozenset({"capacity"}),
    "cap_frac_dc1": frozenset({"capacity"}),
    "sessions_dc0": frozenset({"active_sessions", "mean_remaining_steps"}),
    "sessions_dc1": frozenset({"active_sessions", "mean_remaining_steps"}),
    "fixed_initial_duration": frozenset({"mean_remaining_steps"}),
    "initial_session_duration": frozenset({"mean_remaining_steps"}),
    "session_duration_min": frozenset({"mean_remaining_steps"}),
    "session_duration_max": frozenset({"mean_remaining_steps"}),
    "cost0": frozenset({"cost"}),
    "cost1": frozenset({"cost"}),
    "arrival_mode": None,
    "arrivals": None,
}

ALL_KNOB_IDS = frozenset(KNOB_REQUIRED_FEATURES)


@dataclass(frozen=True)
class ObsSchema:
    obs_dim: int
    features_per_dc: int
    dc_features: tuple[str, ...]
    global_features: tuple[str, ...] = ()

    def all_features(self) -> frozenset[str]:
        return frozenset(self.dc_features) | frozenset(self.global_features)


OBS_SCHEMAS: dict[int, ObsSchema] = {
    16: ObsSchema(16, 8, DC_OBS_FEATURES_V8),
    20: ObsSchema(20, 10, DC_OBS_FEATURES_V10),
    24: ObsSchema(
        24,
        10,
        DC_OBS_FEATURES_V10,
        ("hour_sin", "hour_cos", "dow_sin", "dow_cos"),
    ),
}


@dataclass(frozen=True)
class ModelObsInfo:
    obs_dim: int
    features_per_dc: int
    schema: ObsSchema
    supported_knobs: frozenset[str]
    model_path: str


def obs_schema_for_dim(obs_dim: int) -> ObsSchema:
    schema = OBS_SCHEMAS.get(obs_dim)
    if schema is None:
        features_per_dc = obs_dim // NUM_DATACENTERS
        if obs_dim % NUM_DATACENTERS != 0:
            raise ValueError(
                f"Unsupported observation size {obs_dim}: "
                f"not divisible by {NUM_DATACENTERS} datacenters."
            )
        if features_per_dc == 8:
            dc_features = DC_OBS_FEATURES_V8
        elif features_per_dc == 10:
            dc_features = DC_OBS_FEATURES_V10
        else:
            raise ValueError(
                f"Unsupported observation size {obs_dim} "
                f"({features_per_dc} features per datacenter)."
            )
        schema = ObsSchema(obs_dim, features_per_dc, dc_features)
    return schema


def supported_knobs_for_schema(schema: ObsSchema) -> frozenset[str]:
    model_features = schema.all_features()
    supported: set[str] = set()
    for knob_id, required in KNOB_REQUIRED_FEATURES.items():
        if required is None or required <= model_features:
            supported.add(knob_id)
    return frozenset(supported)


def read_obs_dim(model_path: Path | str) -> int:
    """Read observation dimension from an SB3 ``.zip`` without loading PyTorch."""
    prefix = Path(model_path)
    zip_path = prefix if prefix.suffix == ".zip" else Path(f"{prefix}.zip")
    if not zip_path.is_file():
        raise FileNotFoundError(f"Model not found at {zip_path}")

    with zipfile.ZipFile(zip_path) as archive:
        payload = json.loads(archive.read("data"))

    obs_space = payload.get("observation_space", {})
    shape = obs_space.get("_shape")
    if shape is None:
        raise ValueError(f"Could not read observation shape from {zip_path}")
    if len(shape) != 1:
        raise ValueError(
            f"Expected 1-D observation space in {zip_path}, got shape {shape}"
        )
    return int(shape[0])


def get_model_obs_info(model_path: Path | str) -> ModelObsInfo:
    path = str(model_path)
    obs_dim = read_obs_dim(path)
    schema = obs_schema_for_dim(obs_dim)
    return ModelObsInfo(
        obs_dim=obs_dim,
        features_per_dc=schema.features_per_dc,
        schema=schema,
        supported_knobs=supported_knobs_for_schema(schema),
        model_path=path,
    )


def default_obs_features_per_dc() -> int:
    return OBS_FEATURES_PER_DC
