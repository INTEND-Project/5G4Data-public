# Run `pip install -r requirements.txt` for dependencies.
import argparse
from pathlib import Path

from stable_baselines3 import PPO, SAC
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import VecEnv, VecNormalize

import edge_datacenter_env  # noqa: F401 — registers EdgeDataCenter-v0
from edge_datacenter_env import make_env
from env_config import (
    DEFAULT_COMBINED_MAX_SESSIONS_AT_SLA,
    TrainEnvConfig,
    add_env_arguments,
    env_config_from_args,
    steady_state_sessions_estimate,
)

ALGORITHMS = {
    "ppo": PPO,
    "sac": SAC,
}


def vecnormalize_path(save_path: Path) -> Path:
    return save_path.parent / f"{save_path.name}_vecnormalize.pkl"


class MixedLoadCurriculumCallback(BaseCallback):
    """Four-phase arrival curriculum: extended low load → medium → high."""

    def __init__(
        self,
        vec_env: VecEnv,
        *,
        rate_low: float,
        rate_mid: float,
        rate_high: float,
        total_timesteps: int,
        verbose: int = 0,
    ):
        super().__init__(verbose)
        self.vec_env = vec_env
        self.rate_low = rate_low
        self.rate_mid = rate_mid
        self.rate_high = rate_high
        self.total_timesteps = total_timesteps
        self._last_logged_rate: float | None = None

    def _current_rate(self) -> float:
        progress = self.num_timesteps / max(self.total_timesteps, 1)
        # Phase 1 (0–50%): low load — learn right-sizing and consolidation.
        if progress < 0.50:
            return self.rate_low
        # Phase 2 (50–75%): ramp to medium load.
        if progress < 0.75:
            phase = (progress - 0.50) / 0.25
            return self.rate_low + (self.rate_mid - self.rate_low) * phase
        # Phase 3 (75–90%): ramp to peak load.
        if progress < 0.90:
            phase = (progress - 0.75) / 0.15
            return self.rate_mid + (self.rate_high - self.rate_mid) * phase
        # Phase 4 (90–100%): hold at peak.
        return self.rate_high

    def _on_step(self) -> bool:
        rate = self._current_rate()
        self.vec_env.set_attr("arrival_rate", rate)
        if self.verbose and (
            self._last_logged_rate is None
            or abs(rate - self._last_logged_rate) >= 0.5
        ):
            print(f"Curriculum arrival_rate={rate:.2f}")
            self._last_logged_rate = rate
        return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a policy on the edge data center environment."
    )
    parser.add_argument(
        "--algorithm",
        choices=sorted(ALGORITHMS),
        default="ppo",
        help="RL algorithm to use (default: ppo).",
    )
    parser.add_argument(
        "--timesteps",
        type=int,
        default=500_000,
        help="Total environment steps to train for (default: 500000).",
    )
    parser.add_argument(
        "--n-envs",
        type=int,
        default=4,
        help="Number of parallel environments (default: 4).",
    )
    parser.add_argument(
        "--max-episode-steps",
        type=int,
        default=200,
        help="Episode step limit (default: 200).",
    )
    parser.add_argument(
        "--save-path",
        type=Path,
        default=Path("models/edge_dc_policy"),
        help="Path prefix for the saved model (default: models/edge_dc_policy).",
    )
    parser.add_argument(
        "--tensorboard-log",
        type=Path,
        default=Path("tb_logs"),
        help="TensorBoard log directory (default: tb_logs).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=0,
        help="Random seed (default: 0).",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=3e-4,
        help="Optimizer learning rate (default: 3e-4).",
    )
    parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="Disable VecNormalize on observations and rewards.",
    )
    parser.add_argument(
        "--no-curriculum",
        action="store_true",
        help="Keep arrival rate fixed at --arrival-rate-end.",
    )
    parser.add_argument(
        "--arrival-rate-start",
        type=float,
        default=4.0,
        help="Curriculum start Poisson mean arrivals/step (default: 4).",
    )
    parser.add_argument(
        "--arrival-rate-mid",
        type=float,
        default=12.0,
        help="Curriculum medium Poisson mean arrivals/step (default: 12).",
    )
    parser.add_argument(
        "--arrival-rate-end",
        type=float,
        default=22.0,
        help=(
            "Curriculum end Poisson mean arrivals/step (default: 22, "
            f"~{DEFAULT_COMBINED_MAX_SESSIONS_AT_SLA} sessions at mean duration 40)."
        ),
    )
    add_env_arguments(parser)
    parser.set_defaults(
        arrival_rate=None,
        arrival_mode="poisson",
        initial_sessions_min=10,
        initial_sessions_max=40,
        session_duration_min=20,
        session_duration_max=60,
        session_count_scale=1024.0,
    )
    return parser.parse_args()


def build_train_config(args: argparse.Namespace) -> TrainEnvConfig:
    defaults = TrainEnvConfig(
        max_episode_steps=args.max_episode_steps,
        arrival_rate=args.arrival_rate_end if args.no_curriculum else args.arrival_rate_start,
        arrival_mode=args.arrival_mode or "poisson",
        initial_sessions_range=(args.initial_sessions_min, args.initial_sessions_max),
        session_duration_range=(args.session_duration_min, args.session_duration_max),
        session_count_scale=args.session_count_scale or 1024.0,
        arrival_rate_start=args.arrival_rate_start,
        arrival_rate_mid=args.arrival_rate_mid,
        arrival_rate_end=args.arrival_rate_end,
        curriculum_enabled=not args.no_curriculum,
    )
    env_cfg = env_config_from_args(args, defaults=defaults)
    return TrainEnvConfig(
        max_episode_steps=env_cfg.max_episode_steps,
        session_count_scale=env_cfg.session_count_scale,
        arrival_rate=env_cfg.arrival_rate,
        arrival_mode=env_cfg.arrival_mode,
        initial_sessions_range=env_cfg.initial_sessions_range,
        session_duration_range=env_cfg.session_duration_range,
        arrival_rate_start=args.arrival_rate_start,
        arrival_rate_mid=args.arrival_rate_mid,
        arrival_rate_end=args.arrival_rate_end,
        curriculum_enabled=not args.no_curriculum,
    )


def main() -> None:
    args = parse_args()
    train_cfg = build_train_config(args)
    args.save_path.parent.mkdir(parents=True, exist_ok=True)
    args.tensorboard_log.mkdir(parents=True, exist_ok=True)

    env_kwargs = train_cfg.to_kwargs()
    vec_env = make_vec_env(
        lambda: Monitor(make_env(**env_kwargs)),
        n_envs=args.n_envs,
        seed=args.seed,
    )

    if not args.no_normalize:
        vec_env = VecNormalize(
            vec_env,
            norm_obs=True,
            norm_reward=True,
            clip_obs=10.0,
            clip_reward=10.0,
        )

    algorithm = ALGORITHMS[args.algorithm]
    model = algorithm(
        "MlpPolicy",
        vec_env,
        verbose=1,
        learning_rate=args.learning_rate,
        seed=args.seed,
        tensorboard_log=str(args.tensorboard_log),
    )

    mid_estimate = steady_state_sessions_estimate(
        train_cfg.arrival_rate_mid,
        train_cfg.session_duration_range,
        arrival_mode=train_cfg.arrival_mode,
    )
    end_estimate = steady_state_sessions_estimate(
        train_cfg.arrival_rate_end,
        train_cfg.session_duration_range,
        arrival_mode=train_cfg.arrival_mode,
    )
    print(
        f"Training {args.algorithm.upper()} for {args.timesteps} timesteps "
        f"with {args.n_envs} parallel env(s)..."
    )
    print(
        f"Load: mode={train_cfg.arrival_mode}, "
        f"initial_sessions={train_cfg.initial_sessions_range}, "
        f"combined_max_sessions_at_sla={train_cfg.combined_max_sessions_at_sla}"
    )
    if train_cfg.curriculum_enabled:
        print(
            f"Mixed-load curriculum: {train_cfg.arrival_rate_start:.1f} "
            f"(0-50%) -> {train_cfg.arrival_rate_mid:.1f} (50-75%) -> "
            f"{train_cfg.arrival_rate_end:.1f} (75-90%+, hold to end) "
            f"(est. ~{mid_estimate:.0f} / ~{end_estimate:.0f} concurrent sessions)"
        )
    else:
        print(
            f"Fixed arrival_rate={train_cfg.arrival_rate_end:.1f} "
            f"(est. ~{end_estimate:.0f} concurrent sessions)"
        )

    callbacks = []
    if train_cfg.curriculum_enabled:
        callbacks.append(
            MixedLoadCurriculumCallback(
                vec_env,
                rate_low=train_cfg.arrival_rate_start,
                rate_mid=train_cfg.arrival_rate_mid,
                rate_high=train_cfg.arrival_rate_end,
                total_timesteps=args.timesteps,
                verbose=1,
            )
        )
        vec_env.set_attr("arrival_rate", train_cfg.arrival_rate_start)

    model.learn(
        total_timesteps=args.timesteps,
        progress_bar=True,
        callback=callbacks or None,
    )

    save_file = str(args.save_path)
    model.save(save_file)
    print(f"Saved model to {save_file}.zip")

    if isinstance(vec_env, VecNormalize):
        norm_path = vecnormalize_path(args.save_path)
        vec_env.save(str(norm_path))
        print(f"Saved VecNormalize stats to {norm_path}")

    vec_env.close()


if __name__ == "__main__":
    main()
