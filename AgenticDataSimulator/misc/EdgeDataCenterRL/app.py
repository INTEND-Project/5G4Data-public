"""Streamlit control panel for the trained-policy visualization.

Alternative front-end to the visualize.py CLI: configure the full initial
simulator state, set how electricity cost and session arrivals vary over the
episode, preview schedules, then click Run to roll out the trained policy.

Usage:
    streamlit run app.py
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pandas as pd
import streamlit as st

from env_config import DEFAULT_MAX_CAPACITY, DEFAULT_MIN_TPS, EnvConfig
from model_info import ALL_KNOB_IDS, ModelObsInfo, get_model_obs_info
from schedules import PATTERNS, make_schedule, preview
from visualize import build_frames, run_episode, save_animation

# Streamlit UI defaults for initial state and episode variation.
COST_RANGE = (0.08, 0.18)   # env base_cost_per_kw
COST_DEFAULT_DC0 = 0.080
COST_DEFAULT_DC1 = 0.150
ARRIVAL_DEFAULT = 22.0
ARRIVAL_BOUNDS = (0.0, 40.0)
ARRIVAL_DEFAULT_PATTERN = "ramp up"
ARRIVAL_DEFAULT_RANGE = (5.0, 30.0)
DEFAULT_CAPACITY_FRAC = 0.0
DEFAULT_INITIAL_SESSIONS = 0
DEFAULT_INITIAL_DURATION = 1
MODELS_DIR = Path("models")
DEFAULT_MODEL = "models/edge_dc_ppo_v5"

st.set_page_config(page_title="Edge Data Center RL", layout="wide")

st.title("Edge Data Center RL — policy visualization")
st.caption(
    "Configure the full initial state and how cost and arrivals evolve over "
    "the episode, then click Run to watch the trained policy."
)


def list_model_paths() -> list[str]:
    """Saved model prefixes in models/ (*.zip), newest first."""
    if not MODELS_DIR.is_dir():
        return []
    zips = list(MODELS_DIR.glob("*.zip"))
    zips.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [str(path.with_suffix("")) for path in zips]


def model_label(path: str) -> str:
    prefix = Path(path)
    vecnorm = prefix.parent / f"{prefix.name}_vecnormalize.pkl"
    parts = [prefix.name]
    try:
        obs_info = get_model_obs_info(path)
        parts.append(f"Box({obs_info.obs_dim},)")
    except (FileNotFoundError, ValueError, KeyError):
        pass
    if vecnorm.exists():
        parts.append("vecnorm")
    return " · ".join(parts)


@st.cache_data(show_spinner=False)
def cached_model_obs_info(model_path: str) -> ModelObsInfo:
    return get_model_obs_info(model_path)


def knob_enabled(knob_id: str, supported: frozenset[str]) -> bool:
    return knob_id in supported


def unsupported_knob_caption(knob_id: str, *, default: object) -> None:
    st.caption(
        f"Not in this model's observation schema. Using default: `{default}`."
    )


def gated_number_input(
    knob_id: str,
    supported: frozenset[str],
    *,
    default: float | int,
    **kwargs: object,
) -> float | int:
    if knob_enabled(knob_id, supported):
        return st.number_input(**kwargs)
    unsupported_knob_caption(knob_id, default=default)
    return default


def gated_slider(
    knob_id: str,
    supported: frozenset[str],
    *,
    default: float | int,
    **kwargs: object,
) -> float | int:
    if knob_enabled(knob_id, supported):
        return st.slider(**kwargs)
    unsupported_knob_caption(knob_id, default=default)
    return default


def gated_checkbox(
    knob_id: str,
    supported: frozenset[str],
    *,
    default: bool,
    **kwargs: object,
) -> bool:
    if knob_enabled(knob_id, supported):
        return st.checkbox(**kwargs)
    unsupported_knob_caption(knob_id, default=default)
    return default


def schedule_knobs(
    label: str,
    key: str,
    *,
    default_pattern: str,
    default_value: float,
    bounds: tuple[float, float],
    default_range: tuple[float, float],
    step: float,
    fmt: str,
    total_steps: int,
    seed: int,
    enabled: bool = True,
):
    """Render pattern controls for one quantity and return its schedule."""
    st.markdown(f"**{label}**")
    if not enabled:
        unsupported_knob_caption(key, default=default_value)
        return make_schedule(
            "fixed",
            value=default_value,
            low=default_value,
            high=default_value,
            total_steps=total_steps,
            cycles=2.0,
            seed=seed,
        )

    pattern = st.selectbox(
        "Variation",
        PATTERNS,
        index=PATTERNS.index(default_pattern),
        key=f"{key}_pattern",
    )
    if pattern == "fixed":
        value = st.slider(
            "Value",
            min_value=bounds[0],
            max_value=bounds[1],
            value=default_value,
            step=step,
            format=fmt,
            key=f"{key}_value",
        )
        low = high = value
        cycles = 0.0
    else:
        low, high = st.slider(
            "Min / max",
            min_value=bounds[0],
            max_value=bounds[1],
            value=default_range,
            step=step,
            format=fmt,
            key=f"{key}_range",
        )
        value = (low + high) / 2.0
        cycles = (
            st.slider(
                "Cycles over the episode",
                min_value=0.5,
                max_value=8.0,
                value=2.0,
                step=0.5,
                key=f"{key}_cycles",
            )
            if pattern == "sine"
            else 0.0
        )

    return make_schedule(
        pattern,
        value=value,
        low=low,
        high=high,
        total_steps=total_steps,
        cycles=cycles or 2.0,
        seed=seed,
    )


# --- Episode settings ------------------------------------------------------------

with st.sidebar:
    st.header("Episode")
    seed = st.number_input("Seed", min_value=0, value=0, step=1)
    available_models = list_model_paths()
    if not available_models:
        st.warning("No models in `models/`. Train with: `python train.py`")
        model_path = None
    else:
        default_index = (
            available_models.index(DEFAULT_MODEL)
            if DEFAULT_MODEL in available_models
            else 0
        )
        model_path = st.selectbox(
            "Model",
            available_models,
            index=default_index,
            format_func=model_label,
        )
    algorithm = st.selectbox("Algorithm", ("ppo", "sac"), index=0)
    st.header("Animation")
    total_steps = st.slider(
        "Steps to visualize",
        min_value=10,
        max_value=500,
        value=100,
        step=10,
        help=(
            "Length of the policy rollout and animation in environment steps. "
            "Lower values render faster."
        ),
    )
    fps = st.slider("FPS", min_value=4, max_value=20, value=10)
    smooth = st.slider(
        "Interpolated frames per step", min_value=1, max_value=4, value=2
    )

model_obs_info: ModelObsInfo | None = None
supported_knobs = ALL_KNOB_IDS
if model_path is not None:
    try:
        model_obs_info = cached_model_obs_info(model_path)
        supported_knobs = model_obs_info.supported_knobs
        st.sidebar.caption(
            f"Observations: `Box({model_obs_info.obs_dim},)` — "
            f"{model_obs_info.features_per_dc} features per datacenter"
        )
        unsupported = ALL_KNOB_IDS - supported_knobs
        if unsupported:
            st.sidebar.caption(
                "Some controls are locked because this model's observation "
                f"schema does not include the corresponding features."
            )
    except (FileNotFoundError, ValueError, KeyError) as error:
        st.sidebar.warning(f"Could not read model observation schema: {error}")

# --- Initial state ---------------------------------------------------------------

st.subheader("Initial state")
if model_obs_info is not None:
    st.caption(
        f"Configured for model observation size `Box({model_obs_info.obs_dim},)`. "
        "Controls that do not map to features in this schema are locked."
    )
else:
    st.caption(
        "Values at `reset()` before the agent takes its first action. "
        "Electricity cost and arrival rate at step 0 follow the variation "
        "schedules below when those patterns are not fixed."
    )

hw_col, cap_col, sess_col = st.columns(3)

with hw_col:
    st.markdown("**Hardware & SLA**")
    max_cap_dc0 = int(
        gated_number_input(
            "max_cap_dc0",
            supported_knobs,
            default=int(DEFAULT_MAX_CAPACITY[0]),
            label="DC0 max capacity (tokens/sec)",
            min_value=10_000,
            max_value=500_000,
            value=int(DEFAULT_MAX_CAPACITY[0]),
            step=10_000,
            key="max_cap_dc0",
        )
    )
    max_cap_dc1 = int(
        gated_number_input(
            "max_cap_dc1",
            supported_knobs,
            default=int(DEFAULT_MAX_CAPACITY[1]),
            label="DC1 max capacity (tokens/sec)",
            min_value=10_000,
            max_value=500_000,
            value=int(DEFAULT_MAX_CAPACITY[1]),
            step=10_000,
            key="max_cap_dc1",
        )
    )
    min_tps = int(
        gated_number_input(
            "min_tps",
            supported_knobs,
            default=int(DEFAULT_MIN_TPS),
            label="Minimum TPS per session (SLA)",
            min_value=50,
            max_value=2_000,
            value=int(DEFAULT_MIN_TPS),
            step=50,
            key="min_tps",
        )
    )
    session_count_scale = float(
        gated_number_input(
            "session_count_scale",
            supported_knobs,
            default=1024,
            label="Session count scale (obs normalization)",
            min_value=64,
            max_value=4096,
            value=1024,
            step=64,
            key="session_count_scale",
        )
    )

with cap_col:
    st.markdown("**Provisioned capacity at reset**")
    cap_frac_dc0 = int(
        gated_slider(
            "cap_frac_dc0",
            supported_knobs,
            default=int(DEFAULT_CAPACITY_FRAC * 100),
            label="DC0 capacity (% of max)",
            min_value=0,
            max_value=100,
            value=int(DEFAULT_CAPACITY_FRAC * 100),
            step=1,
            key="cap_frac_dc0",
        )
    )
    cap_frac_dc1 = int(
        gated_slider(
            "cap_frac_dc1",
            supported_knobs,
            default=int(DEFAULT_CAPACITY_FRAC * 100),
            label="DC1 capacity (% of max)",
            min_value=0,
            max_value=100,
            value=int(DEFAULT_CAPACITY_FRAC * 100),
            step=1,
            key="cap_frac_dc1",
        )
    )
    st.caption(
        f"DC0: {cap_frac_dc0 / 100 * max_cap_dc0:,.0f} tokens/sec  ·  "
        f"DC1: {cap_frac_dc1 / 100 * max_cap_dc1:,.0f} tokens/sec"
    )

with sess_col:
    st.markdown("**Sessions at reset**")
    sessions_dc0 = int(
        gated_number_input(
            "sessions_dc0",
            supported_knobs,
            default=DEFAULT_INITIAL_SESSIONS,
            label="DC0 active sessions",
            min_value=0,
            max_value=500,
            value=DEFAULT_INITIAL_SESSIONS,
            step=1,
            key="sessions_dc0",
        )
    )
    sessions_dc1 = int(
        gated_number_input(
            "sessions_dc1",
            supported_knobs,
            default=DEFAULT_INITIAL_SESSIONS,
            label="DC1 active sessions",
            min_value=0,
            max_value=500,
            value=DEFAULT_INITIAL_SESSIONS,
            step=1,
            key="sessions_dc1",
        )
    )
    use_fixed_initial_duration = gated_checkbox(
        "fixed_initial_duration",
        supported_knobs,
        default=True,
        label="Fixed remaining steps for initial sessions",
        value=True,
        key="fixed_initial_duration",
    )
    if use_fixed_initial_duration:
        initial_session_duration = int(
            gated_slider(
                "initial_session_duration",
                supported_knobs,
                default=DEFAULT_INITIAL_DURATION,
                label="Initial session remaining steps",
                min_value=1,
                max_value=120,
                value=DEFAULT_INITIAL_DURATION,
                key="initial_session_duration",
            )
        )
    else:
        initial_session_duration = None
    dur_col1, dur_col2 = st.columns(2)
    with dur_col1:
        session_duration_min = int(
            gated_number_input(
                "session_duration_min",
                supported_knobs,
                default=20,
                label="New session min duration",
                min_value=1,
                max_value=120,
                value=20,
                step=1,
                key="session_duration_min",
            )
        )
    with dur_col2:
        session_duration_max = int(
            gated_number_input(
                "session_duration_max",
                supported_knobs,
                default=60,
                label="New session max duration",
                min_value=1,
                max_value=120,
                value=60,
                step=1,
                key="session_duration_max",
            )
        )
    if session_duration_max < session_duration_min:
        st.error("Max session duration must be >= min.")

# --- Variation over episode ------------------------------------------------------

st.subheader("Variation over episode")

col_dc0, col_dc1, col_arrivals = st.columns(3)

with col_dc0:
    cost0_schedule = schedule_knobs(
        "DC0 cost per kW (USD/kWh)",
        "cost0",
        default_pattern="fixed",
        default_value=COST_DEFAULT_DC0,
        bounds=COST_RANGE,
        default_range=COST_RANGE,
        step=0.005,
        fmt="%.3f",
        total_steps=total_steps,
        seed=int(seed),
        enabled=knob_enabled("cost0", supported_knobs),
    )

with col_dc1:
    cost1_schedule = schedule_knobs(
        "DC1 cost per kW (USD/kWh)",
        "cost1",
        default_pattern="fixed",
        default_value=COST_DEFAULT_DC1,
        bounds=COST_RANGE,
        default_range=COST_RANGE,
        step=0.005,
        fmt="%.3f",
        total_steps=total_steps,
        seed=int(seed) + 1,
        enabled=knob_enabled("cost1", supported_knobs),
    )

with col_arrivals:
    if knob_enabled("arrival_mode", supported_knobs):
        arrival_mode = st.selectbox(
            "Arrival process",
            ("poisson", "bernoulli"),
            index=0,
            key="arrival_mode",
        )
    else:
        arrival_mode = "poisson"
        unsupported_knob_caption("arrival_mode", default=arrival_mode)
    arrival_schedule = schedule_knobs(
        "Incoming sessions per step",
        "arrivals",
        default_pattern=ARRIVAL_DEFAULT_PATTERN,
        default_value=ARRIVAL_DEFAULT,
        bounds=ARRIVAL_BOUNDS,
        default_range=ARRIVAL_DEFAULT_RANGE,
        step=1.0,
        fmt="%.0f",
        total_steps=total_steps,
        seed=int(seed) + 2,
        enabled=knob_enabled("arrivals", supported_knobs),
    )

# --- Schedule preview ---------------------------------------------------------------

preview_cost, preview_arrivals = st.columns(2)
steps_index = list(range(total_steps + 1))

with preview_cost:
    st.caption("Electricity cost profile (USD/kWh)")
    st.line_chart(
        pd.DataFrame(
            {
                "DC0": preview(cost0_schedule, total_steps),
                "DC1": preview(cost1_schedule, total_steps),
            },
            index=steps_index,
        ),
        height=200,
    )

with preview_arrivals:
    st.caption("Arrival rate profile (sessions/step)")
    st.line_chart(
        pd.DataFrame(
            {"arrival rate": preview(arrival_schedule, total_steps)},
            index=steps_index,
        ),
        height=200,
    )

# --- Initial state summary -------------------------------------------------------

with st.expander("Initial state summary (step 0)"):
    init_cost0 = cost0_schedule(0)
    init_cost1 = cost1_schedule(0)
    init_arrival = arrival_schedule(0)
    st.markdown(
        f"| | DC0 | DC1 |\n"
        f"|---|---|---|\n"
        f"| Max capacity | {max_cap_dc0:,} tps | {max_cap_dc1:,} tps |\n"
        f"| Provisioned capacity | {cap_frac_dc0}% "
        f"({cap_frac_dc0 / 100 * max_cap_dc0:,.0f} tps) | "
        f"{cap_frac_dc1}% ({cap_frac_dc1 / 100 * max_cap_dc1:,.0f} tps) |\n"
        f"| Active sessions | {sessions_dc0} | {sessions_dc1} |\n"
        f"| Electricity cost | {init_cost0:.3f} USD/kWh | {init_cost1:.3f} USD/kWh |\n"
        f"| min TPS (SLA) | {min_tps} | {min_tps} |"
    )
    duration_note = (
        f"{initial_session_duration} steps (fixed)"
        if initial_session_duration is not None
        else f"random {session_duration_min}–{session_duration_max} steps"
    )
    st.markdown(
        f"- **Initial session remaining steps:** {duration_note}\n"
        f"- **New session duration (arrivals):** "
        f"{session_duration_min}–{session_duration_max} steps\n"
        f"- **Arrival rate at step 0:** {init_arrival:.1f}/step ({arrival_mode})\n"
        f"- **Seed:** {int(seed)}"
    )
    if model_obs_info is not None:
        st.markdown(
            f"- **Model observation schema:** `Box({model_obs_info.obs_dim},)` "
            f"({model_obs_info.features_per_dc} features per datacenter)"
        )

# --- Run ---------------------------------------------------------------------------

run = st.button("Run", type="primary", width="stretch")

if run:
    if model_path is None:
        st.error("No model available. Train a policy first with `python train.py`.")
        st.stop()
    if session_duration_max < session_duration_min:
        st.error("Fix session duration range before running.")
        st.stop()

    env_cfg = EnvConfig(
        max_episode_steps=total_steps,
        session_count_scale=float(session_count_scale),
        arrival_rate=float(arrival_schedule(0)),
        arrival_mode=arrival_mode,
        session_duration_range=(session_duration_min, session_duration_max),
        max_capacity=(float(max_cap_dc0), float(max_cap_dc1)),
        min_tps=float(min_tps),
        initial_capacity_fraction=(
            cap_frac_dc0 / 100.0,
            cap_frac_dc1 / 100.0,
        ),
        initial_sessions_per_dc=(int(sessions_dc0), int(sessions_dc1)),
        initial_session_duration=initial_session_duration,
        obs_features_per_dc=(
            model_obs_info.features_per_dc if model_obs_info is not None else None
        ),
    )
    env_kwargs = env_cfg.to_kwargs()
    env_kwargs["cost_schedule"] = lambda step: (
        cost0_schedule(step),
        cost1_schedule(step),
    )

    try:
        with st.spinner("Running episode with the trained policy..."):
            snapshots, params = run_episode(
                model_path,
                algorithm,
                env_kwargs,
                seed=int(seed),
                deterministic=True,
                arrival_schedule=arrival_schedule,
            )
    except FileNotFoundError as error:
        st.error(str(error))
        st.stop()
    except ValueError as error:
        st.error(str(error))
        st.stop()

    frames = build_frames(snapshots, params, max(1, smooth))

    progress_bar = st.progress(0, text="Rendering animation...")

    def report(current: int, total: int) -> None:
        progress_bar.progress(
            (current + 1) / total, text=f"Rendering animation... {current + 1}/{total}"
        )

    with tempfile.NamedTemporaryFile(suffix=".gif", delete=False) as tmp:
        gif_path = Path(tmp.name)
    try:
        save_animation(frames, params, gif_path, fps, progress_callback=report)
        gif_bytes = gif_path.read_bytes()
    finally:
        gif_path.unlink(missing_ok=True)
    progress_bar.empty()

    st.session_state["result"] = {
        "gif": gif_bytes,
        "snapshots": snapshots,
        "terminated": params["terminated"],
    }

# --- Results (persist across reruns) -------------------------------------------------

result = st.session_state.get("result")
if result is not None:
    final = result["snapshots"][-1]
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Total reward", f"{final['total_reward']:.1f}")
    m2.metric("Steps", final["step"])
    m3.metric("Completed sessions", final["completed"])
    m4.metric("Dropped sessions", final["dropped"])
    m5.metric("SLA violation steps", final["sla_violations"])
    if result["terminated"]:
        st.warning("Episode terminated early: SLA violation limit reached.")
    st.image(result["gif"], caption="Trained policy episode", width="stretch")
