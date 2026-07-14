"""Animated, diagram-style visualization of a trained policy episode.

Runs the trained model on the simulated environment, records per-step
snapshots, then renders an animated scene: a load balancer with routing
split bars on top, and per-datacenter barrels (accumulated TPS), battery
energy indicators, and mean per-session TPS bars below.

Usage:
    python visualize.py --model-path models/edge_dc_ppo_v5 --out run.gif
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FFMpegWriter, FuncAnimation, PillowWriter
from matplotlib.patches import Circle, Ellipse, FancyArrowPatch, FancyBboxPatch, Rectangle

import edge_datacenter_env  # noqa: F401 — registers EdgeDataCenter-v0
from edge_datacenter_env import make_env
from env_config import EnvConfig, add_env_arguments, env_config_from_args
from eval import ALGORITHMS, load_normalizer, normalize_observation, vecnormalize_path

# Rolling window (in env steps) used for the load balancer routing split bars.
ROUTING_WINDOW = 20

# --- Palette -----------------------------------------------------------------
BG = "#0d1117"
PANEL = "#161d27"
TEXT = "#e6edf3"
DIM = "#8b949e"
OUTLINE = "#3d4b5c"
EMPTY = "#1a2332"
DC_ACCENTS = ("#38bdf8", "#fb923c")  # DC0 sky blue, DC1 orange
DC_ACCENTS_LIGHT = ("#7dd3fc", "#fdba74")
GOOD = "#4ade80"
WARN = "#facc15"
BAD = "#f87171"

# --- Scene layout (data coordinates; canvas is 128 x 72, aspect equal) --------
DC_CX = (28.0, 100.0)          # barrel center x per DC
BARREL_W = 20.0
BARREL_H = 22.0
BARREL_Y0 = 20.0               # barrel bottom y
BARREL_RY = 2.4                # vertical radius of barrel ellipses
BATTERY_W = 6.0
BATTERY_H = 18.0
LB_X0, LB_X1 = 52.0, 76.0      # load balancer box
LB_Y0, LB_Y1 = 58.0, 66.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Visualize a trained policy episode as an animated scene."
    )
    parser.add_argument(
        "--model-path",
        type=Path,
        default=Path("models/edge_dc_policy"),
        help="Path to the saved model prefix (default: models/edge_dc_policy).",
    )
    parser.add_argument(
        "--algorithm",
        choices=sorted(ALGORITHMS),
        default="ppo",
        help="Algorithm used to train the model (default: ppo).",
    )
    parser.add_argument(
        "--max-episode-steps",
        type=int,
        default=200,
        help="Episode step limit (default: 200).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Random seed for the episode reset (default: 0).",
    )
    parser.add_argument(
        "--stochastic",
        action="store_true",
        help="Sample actions from the policy instead of using the mean.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("viz.gif"),
        help="Output animation file: .gif or .mp4 (default: viz.gif).",
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=10,
        help="Animation frames per second (default: 10).",
    )
    parser.add_argument(
        "--smooth",
        type=int,
        default=2,
        help="Interpolated frames per env step for smoother motion (default: 2).",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Show an interactive window instead of saving to file.",
    )
    add_env_arguments(parser)
    parser.set_defaults(
        arrival_rate=22.0,
        arrival_mode="poisson",
        initial_sessions_min=10,
        initial_sessions_max=40,
        session_duration_min=20,
        session_duration_max=60,
        session_count_scale=1024.0,
    )
    return parser.parse_args()


# --- Phase 1: rollout ----------------------------------------------------------


def snapshot_from(info: dict, *, reward: float, total_reward: float) -> dict[str, Any]:
    return {
        "step": info["step"],
        "reward": reward,
        "total_reward": total_reward,
        "arrivals": list(info.get("arrivals_this_step", (0, 0))),
        "dropped_this_step": info.get("dropped_this_step", 0),
        "completed": info["completed_sessions"],
        "dropped": info["dropped_sessions"],
        "sla_violations": info["sla_violations"],
        "total_active": info["total_active_sessions"],
        "dcs": [
            {
                "capacity": dc["capacity"],
                "max_capacity": dc["max_capacity"],
                "accumulated_tps": dc["accumulated_tps"],
                "active_sessions": dc["active_sessions"],
                "mean_tps": (
                    dc["accumulated_tps"] / dc["active_sessions"]
                    if dc["active_sessions"] > 0
                    else 0.0
                ),
                "energy": dc["energy"],
                "cost_per_kw": dc["cost_per_kw"],
            }
            for dc in info["datacenters"]
        ],
    }


def rollout(args: argparse.Namespace) -> tuple[list[dict], dict[str, Any]]:
    """Run one episode with the trained policy and record per-step snapshots."""
    model_path = str(args.model_path)
    if not Path(f"{model_path}.zip").exists():
        raise FileNotFoundError(
            f"Model not found at {model_path}.zip. Train first with: python train.py"
        )

    defaults = EnvConfig(max_episode_steps=args.max_episode_steps)
    env_cfg = env_config_from_args(args, defaults=defaults)
    env_kwargs = env_cfg.to_kwargs()

    model = ALGORITHMS[args.algorithm].load(model_path)
    normalizer = load_normalizer(vecnormalize_path(args.model_path), env_kwargs)
    if normalizer is None:
        print(
            "Warning: VecNormalize stats not found; running without "
            "observation normalization."
        )

    env = make_env(**env_kwargs)
    observation, info = env.reset(seed=args.seed)
    snapshots = [snapshot_from(info, reward=0.0, total_reward=0.0)]

    total_reward = 0.0
    done = False
    while not done:
        policy_input = (
            normalize_observation(normalizer, observation)
            if normalizer is not None
            else observation
        )
        action, _ = model.predict(policy_input, deterministic=not args.stochastic)
        action = np.asarray(action, dtype=np.float32).reshape(-1)
        observation, reward, terminated, truncated, info = env.step(action)
        total_reward += float(reward)
        snapshots.append(
            snapshot_from(info, reward=float(reward), total_reward=total_reward)
        )
        done = terminated or truncated

    params = {
        "min_tps": env.min_tps,
        "max_capacity": env.max_capacity,
        "idle_energy_kw": env.idle_energy_kw,
        "throughput_energy_kw": env.throughput_energy_kw,
        "base_cost_per_kw": env.base_cost_per_kw,
        "terminated": terminated,
    }
    env.close()
    if normalizer is not None:
        normalizer.close()
    return snapshots, params


# --- Frame preparation (interpolation between env steps) ------------------------


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def routing_shares(snapshots: list[dict]) -> list[float]:
    """DC0 share of arrivals over the trailing ROUTING_WINDOW steps."""
    shares: list[float] = []
    previous = 0.5
    for t in range(len(snapshots)):
        window = snapshots[max(0, t - ROUTING_WINDOW + 1) : t + 1]
        dc0 = sum(s["arrivals"][0] for s in window)
        dc1 = sum(s["arrivals"][1] for s in window)
        share = dc0 / (dc0 + dc1) if dc0 + dc1 > 0 else previous
        previous = share
        shares.append(share)
    return shares


def continuous_state(snap: dict, share: float, max_energy: tuple[float, ...]) -> dict:
    dcs = []
    for i, dc in enumerate(snap["dcs"]):
        dcs.append(
            {
                "fill": float(np.clip(dc["accumulated_tps"] / dc["max_capacity"], 0.0, 1.0)),
                "cap": float(np.clip(dc["capacity"] / dc["max_capacity"], 0.0, 1.0)),
                "energy_frac": float(np.clip(dc["energy"] / max_energy[i], 0.0, 1.0)),
                "energy_kw": dc["energy"],
                "mean_tps": dc["mean_tps"],
                "cost": dc["cost_per_kw"],
                "sessions": dc["active_sessions"],
            }
        )
    return {"share": share, "dcs": dcs}


def interpolate_state(a: dict, b: dict, t: float) -> dict:
    dcs = []
    for dc_a, dc_b in zip(a["dcs"], b["dcs"]):
        dcs.append(
            {
                "fill": lerp(dc_a["fill"], dc_b["fill"], t),
                "cap": lerp(dc_a["cap"], dc_b["cap"], t),
                "energy_frac": lerp(dc_a["energy_frac"], dc_b["energy_frac"], t),
                "energy_kw": lerp(dc_a["energy_kw"], dc_b["energy_kw"], t),
                "mean_tps": lerp(dc_a["mean_tps"], dc_b["mean_tps"], t),
                "cost": lerp(dc_a["cost"], dc_b["cost"], t),
                "sessions": dc_b["sessions"],
            }
        )
    return {"share": lerp(a["share"], b["share"], t), "dcs": dcs}


def discrete_state(snap: dict) -> dict:
    return {
        "step": snap["step"],
        "reward": snap["reward"],
        "total_reward": snap["total_reward"],
        "arrivals": snap["arrivals"],
        "dropped_this_step": snap["dropped_this_step"],
        "completed": snap["completed"],
        "dropped": snap["dropped"],
        "sla_violations": snap["sla_violations"],
        "total_active": snap["total_active"],
    }


def build_frames(snapshots: list[dict], params: dict, smooth: int) -> list[dict]:
    shares = routing_shares(snapshots)
    max_energy = tuple(
        params["idle_energy_kw"] + params["throughput_energy_kw"] * mc
        for mc in params["max_capacity"]
    )

    frames: list[dict] = []
    for t, snap in enumerate(snapshots):
        current = continuous_state(snap, shares[t], max_energy)
        if t > 0 and smooth > 1:
            previous = continuous_state(snapshots[t - 1], shares[t - 1], max_energy)
            for s in range(1, smooth):
                frame = interpolate_state(previous, current, s / smooth)
                frame.update(discrete_state(snap))
                frames.append(frame)
        current.update(discrete_state(snap))
        frames.append(current)
    return frames


# --- Phase 2: scene drawing ------------------------------------------------------


def energy_color(frac: float) -> str:
    if frac < 0.4:
        return GOOD
    if frac < 0.7:
        return WARN
    return BAD


def draw_barrel(ax, cx: float, dc: dict, accent: str, accent_light: str) -> None:
    """Cylinder filled by accumulated TPS, with a provisioned-capacity marker."""
    y0, w, h, ry = BARREL_Y0, BARREL_W, BARREL_H, BARREL_RY
    x0 = cx - w / 2

    # Empty vessel.
    ax.add_patch(Ellipse((cx, y0), w, 2 * ry, fc=EMPTY, ec=OUTLINE, lw=1.0, zorder=2))
    ax.add_patch(Rectangle((x0, y0), w, h, fc=EMPTY, ec="none", zorder=2))

    # Liquid = accumulated TPS as a fraction of max capacity.
    fill = dc["fill"]
    if fill > 0.005:
        fh = fill * h
        ax.add_patch(
            Ellipse((cx, y0), w, 2 * ry, fc=accent, ec="none", alpha=0.9, zorder=3)
        )
        ax.add_patch(
            Rectangle((x0, y0), w, fh, fc=accent, ec="none", alpha=0.9, zorder=3)
        )
        ax.add_patch(
            Ellipse(
                (cx, y0 + fh), w, 2 * ry,
                fc=accent_light, ec=accent, lw=0.8, alpha=0.95, zorder=4,
            )
        )

    # Side walls and top rim (open barrel).
    ax.plot([x0, x0], [y0, y0 + h], color=OUTLINE, lw=1.4, zorder=5)
    ax.plot([x0 + w, x0 + w], [y0, y0 + h], color=OUTLINE, lw=1.4, zorder=5)
    ax.add_patch(
        Ellipse((cx, y0 + h), w, 2 * ry, fc=BG, ec=OUTLINE, lw=1.4, zorder=5)
    )

    # Provisioned capacity marker.
    cap_y = y0 + dc["cap"] * h
    ax.plot(
        [x0 - 1.2, x0 + w + 1.2], [cap_y, cap_y],
        color=TEXT, lw=1.2, ls=(0, (4, 2)), zorder=6,
    )
    ax.text(
        x0 - 1.8, cap_y, "prov", ha="right", va="center",
        fontsize=6.5, color=DIM, zorder=6,
    )

    # Utilization percent in the middle of the barrel. Use dark text when the
    # bright liquid is behind the label, light text otherwise.
    on_liquid = fill > 0.42
    ax.text(
        cx, y0 + h * 0.45, f"{fill * 100:.0f}%",
        ha="center", va="center", fontsize=12, fontweight="bold",
        color=BG if on_liquid else TEXT, zorder=7,
    )
    ax.text(
        cx, y0 + h * 0.45 - 3.2, "of max TPS",
        ha="center", va="center", fontsize=6.5,
        color=BG if fill > 0.30 else DIM, zorder=7,
    )


def draw_battery(ax, x: float, y: float, dc: dict) -> None:
    """Battery-style energy indicator: segments fill with power draw."""
    w, h = BATTERY_W, BATTERY_H
    frac = dc["energy_frac"]
    color = energy_color(frac)

    # Terminal nub and casing.
    ax.add_patch(
        Rectangle((x + w * 0.3, y + h), w * 0.4, 1.1, fc=DIM, ec="none", zorder=3)
    )
    ax.add_patch(
        FancyBboxPatch(
            (x, y), w, h,
            boxstyle="round,pad=0.25,rounding_size=0.6",
            fc="#101820", ec=DIM, lw=1.3, zorder=3,
        )
    )

    # Segments fill from the bottom.
    n = 5
    pad = 0.7
    seg_h = (h - pad * (n + 1)) / n
    filled = frac * n
    for k in range(n):
        amount = float(np.clip(filled - k, 0.0, 1.0))
        if amount <= 0:
            continue
        seg_y = y + pad + k * (seg_h + pad)
        ax.add_patch(
            Rectangle(
                (x + pad, seg_y), w - 2 * pad, seg_h * amount,
                fc=color, ec="none", alpha=0.95, zorder=4,
            )
        )

    ax.text(
        x + w / 2, y - 1.6, f"{dc['energy_kw']:,.0f} kW",
        ha="center", va="top", fontsize=8, color=color, fontweight="bold",
    )
    ax.text(
        x + w / 2, y - 4.4, "energy", ha="center", va="top", fontsize=6.5, color=DIM
    )


def draw_cost_tag(
    ax, x: float, y: float, dc: dict, cost_range: tuple[float, float]
) -> None:
    """Electricity price above the battery, color-coded cheap -> expensive."""
    low, high = cost_range
    frac = float(np.clip((dc["cost"] - low) / max(high - low, 1e-6), 0.0, 1.0))
    color = energy_color(frac)
    # Note: avoid "$" in the strings — matplotlib would parse it as mathtext.
    ax.text(
        x, y + 2.2, f"{dc['cost']:.3f}",
        ha="center", va="bottom", fontsize=8.5, fontweight="bold", color=color,
    )
    ax.text(
        x, y, "USD/kWh", ha="center", va="bottom", fontsize=6.5, color=DIM
    )


def draw_mean_tps_bar(ax, cx: float, dc: dict, min_tps: float, accent: str) -> None:
    """Horizontal mean per-session TPS bar with the SLA floor marked."""
    w, h = 28.0, 2.6
    x0, y0 = cx - w / 2, 11.0
    scale = 2.0 * min_tps  # SLA floor sits at the middle of the bar
    frac = float(np.clip(dc["mean_tps"] / scale, 0.0, 1.0))
    below_sla = dc["sessions"] > 0 and dc["mean_tps"] < min_tps
    bar_color = BAD if below_sla else accent

    ax.add_patch(
        Rectangle((x0, y0), w, h, fc=EMPTY, ec=OUTLINE, lw=1.0, zorder=3)
    )
    if frac > 0:
        ax.add_patch(
            Rectangle((x0, y0), w * frac, h, fc=bar_color, ec="none", zorder=4)
        )

    # SLA floor line.
    sla_x = x0 + w * 0.5
    ax.plot(
        [sla_x, sla_x], [y0 - 0.7, y0 + h + 0.7],
        color=TEXT, lw=1.1, ls=(0, (3, 2)), zorder=5,
    )
    ax.text(
        sla_x, y0 + h + 1.2, f"SLA {min_tps:.0f}",
        ha="center", va="bottom", fontsize=6.5, color=DIM, zorder=5,
    )

    ax.text(
        x0, y0 - 1.2, "mean TPS / session",
        ha="left", va="top", fontsize=7, color=DIM,
    )
    ax.text(
        x0 + w, y0 - 1.2, f"{dc['mean_tps']:,.0f}",
        ha="right", va="top", fontsize=8.5, fontweight="bold",
        color=BAD if below_sla else TEXT,
    )


def draw_datacenter(ax, index: int, dc: dict, params: dict) -> None:
    cx = DC_CX[index]
    accent = DC_ACCENTS[index]
    accent_light = DC_ACCENTS_LIGHT[index]

    ax.text(
        cx, 50.5, f"DC{index}",
        ha="center", va="bottom", fontsize=13, fontweight="bold", color=accent,
    )
    ax.text(
        cx, 48.8, f"{dc['sessions']} active sessions",
        ha="center", va="top", fontsize=8, color=TEXT,
    )

    battery_x = cx + BARREL_W / 2 + 4.0
    battery_y = BARREL_Y0 + 1.0
    draw_barrel(ax, cx, dc, accent, accent_light)
    draw_battery(ax, battery_x, battery_y, dc)
    draw_cost_tag(
        ax,
        battery_x + BATTERY_W / 2,
        battery_y + BATTERY_H + 2.4,
        dc,
        params["base_cost_per_kw"],
    )
    draw_mean_tps_bar(ax, cx, dc, params["min_tps"], accent)


def draw_load_balancer(ax, frame: dict, frame_index: int) -> None:
    share = frame["share"]
    arrivals_total = int(sum(frame["arrivals"]))

    # Box.
    ax.add_patch(
        FancyBboxPatch(
            (LB_X0, LB_Y0), LB_X1 - LB_X0, LB_Y1 - LB_Y0,
            boxstyle="round,pad=0.4,rounding_size=1.2",
            fc=PANEL, ec=OUTLINE, lw=1.4, zorder=3,
        )
    )
    ax.text(
        (LB_X0 + LB_X1) / 2, (LB_Y0 + LB_Y1) / 2, "LOAD BALANCER",
        ha="center", va="center", fontsize=10, fontweight="bold", color=TEXT, zorder=4,
    )

    # Incoming session dots drifting toward the box.
    lane_y = (LB_Y0 + LB_Y1) / 2
    lane_x0, lane_span = 33.0, 16.0
    ax.text(lane_x0 + lane_span / 2, lane_y + 3.0, "incoming",
            ha="center", va="bottom", fontsize=7, color=DIM)
    ax.plot(
        [lane_x0 - 1, LB_X0 - 1.2], [lane_y, lane_y],
        color=OUTLINE, lw=0.8, ls=(0, (1, 2)), zorder=2,
    )
    n_dots = min(arrivals_total, 8)
    for k in range(n_dots):
        x = lane_x0 + ((frame_index * 1.3 + k * 5.3) % lane_span)
        progress = (x - lane_x0) / lane_span
        ax.add_patch(
            Circle((x, lane_y), 0.85, fc="#a5b4fc", ec="none",
                   alpha=0.35 + 0.65 * progress, zorder=4)
        )
    if arrivals_total > 0:
        ax.text(
            lane_x0 + lane_span / 2, lane_y - 2.6, f"+{arrivals_total} this step",
            ha="center", va="top", fontsize=7, color="#a5b4fc",
        )
    if frame["dropped_this_step"] > 0:
        ax.text(
            (LB_X0 + LB_X1) / 2, LB_Y0 - 1.4,
            f"× {frame['dropped_this_step']} dropped",
            ha="center", va="top", fontsize=8, fontweight="bold", color=BAD,
        )

    # Routing split bars (rolling share of recent arrivals).
    bar_x0, bar_w, bar_h = 82.0, 22.0, 1.9
    ax.text(
        bar_x0, 67.2, f"routing split (last {ROUTING_WINDOW} steps)",
        ha="left", va="bottom", fontsize=7, color=DIM,
    )
    for i, (frac, y) in enumerate(((share, 63.8), (1.0 - share, 60.2))):
        ax.add_patch(
            Rectangle((bar_x0, y), bar_w, bar_h, fc=EMPTY, ec=OUTLINE, lw=0.8, zorder=3)
        )
        if frac > 0:
            ax.add_patch(
                Rectangle((bar_x0, y), bar_w * frac, bar_h,
                          fc=DC_ACCENTS[i], ec="none", zorder=4)
            )
        ax.text(
            bar_x0 - 1.0, y + bar_h / 2, f"DC{i}",
            ha="right", va="center", fontsize=7.5, color=DC_ACCENTS[i],
            fontweight="bold",
        )
        ax.text(
            bar_x0 + bar_w + 1.0, y + bar_h / 2, f"{frac * 100:.0f}%",
            ha="left", va="center", fontsize=7.5, color=TEXT,
        )

    # Arrows from the load balancer to each datacenter.
    starts = ((LB_X0 + 6.0, LB_Y0 - 0.6), (LB_X1 - 6.0, LB_Y0 - 0.6))
    shares = (share, 1.0 - share)
    for i, ((sx, sy), frac) in enumerate(zip(starts, shares)):
        ax.add_patch(
            FancyArrowPatch(
                (sx, sy), (DC_CX[i], 52.5),
                arrowstyle="-|>", mutation_scale=13,
                lw=1.0 + 5.0 * frac, color=DC_ACCENTS[i], alpha=0.85, zorder=2,
                connectionstyle="arc3,rad={}".format(0.25 if i == 0 else -0.25),
            )
        )


def draw_status(ax, frame: dict, total_steps: int, terminated: bool) -> None:
    center = 64.0
    parts = [
        f"reward {frame['reward']:+.1f}  (total {frame['total_reward']:+.1f})",
        f"active {frame['total_active']}",
        f"completed {frame['completed']}",
        f"dropped {frame['dropped']}",
        f"SLA violation steps {frame['sla_violations']}",
    ]
    ax.text(
        center, 4.8, "     ".join(parts),
        ha="center", va="center", fontsize=8.5, color=TEXT,
    )

    # Header.
    ax.text(
        2.0, 70.4, "Edge Data Center RL — trained policy run",
        ha="left", va="top", fontsize=11, fontweight="bold", color=TEXT,
    )
    step_label = f"step {frame['step']} / {total_steps}"
    if terminated and frame["step"] == total_steps:
        step_label += "  (terminated)"
    ax.text(126.0, 70.4, step_label, ha="right", va="top", fontsize=10, color=DIM)


def draw_scene(
    ax, frame: dict, params: dict, frame_index: int, total_steps: int
) -> None:
    ax.clear()
    ax.set_xlim(0, 128)
    ax.set_ylim(0, 72)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_facecolor(BG)

    draw_load_balancer(ax, frame, frame_index)
    for i, dc in enumerate(frame["dcs"]):
        draw_datacenter(ax, i, dc, params)
    draw_status(ax, frame, total_steps, params["terminated"])


# --- Animation -------------------------------------------------------------------


def main() -> None:
    args = parse_args()

    print("Running episode with trained policy...")
    snapshots, params = rollout(args)
    total_steps = snapshots[-1]["step"]
    print(
        f"Episode finished after {total_steps} steps "
        f"(total reward {snapshots[-1]['total_reward']:.1f}). Rendering..."
    )

    smooth = max(1, args.smooth)
    frames = build_frames(snapshots, params, smooth)

    fig, ax = plt.subplots(figsize=(12.8, 7.2), dpi=110)
    fig.patch.set_facecolor(BG)
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)

    def render(i: int):
        draw_scene(ax, frames[i], params, i, total_steps)
        return []

    animation = FuncAnimation(
        fig, render, frames=len(frames), interval=1000 / args.fps, blit=False
    )

    if args.live:
        plt.show()
        return

    if args.out.suffix.lower() == ".mp4":
        writer = FFMpegWriter(fps=args.fps)
    else:
        writer = PillowWriter(fps=args.fps)

    last_report = -1

    def progress(current: int, total: int) -> None:
        nonlocal last_report
        percent = int(100 * (current + 1) / total)
        if percent // 20 > last_report:
            last_report = percent // 20
            print(f"  saving... {percent}%")

    animation.save(str(args.out), writer=writer, progress_callback=progress)
    print(f"Saved animation to {args.out} ({len(frames)} frames at {args.fps} fps)")


if __name__ == "__main__":
    main()
