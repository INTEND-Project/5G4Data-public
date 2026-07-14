# Run `pip install -r requirements.txt` for dependencies.
import argparse
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO, SAC
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

import edge_datacenter_env  # noqa: F401 — registers EdgeDataCenter-v0
from edge_datacenter_env import make_env
from env_config import EnvConfig, add_env_arguments, env_config_from_args

ALGORITHMS = {
    "ppo": PPO,
    "sac": SAC,
}


def vecnormalize_path(model_path: Path) -> Path:
    return model_path.parent / f"{model_path.name}_vecnormalize.pkl"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate a trained policy on the edge data center environment."
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
        "--episodes",
        type=int,
        default=5,
        help="Number of evaluation episodes (default: 5).",
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
        help="Base random seed for episode resets (default: 0).",
    )
    parser.add_argument(
        "--stochastic",
        action="store_true",
        help="Sample actions from the policy instead of using the mean.",
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


def print_episode_summary(episode: int, total_reward: float, info: dict) -> None:
    print(f"\nEpisode {episode}")
    print(f"Episode finished. Total reward: {total_reward:.2f}")
    print(
        f"completed={info['completed_sessions']} "
        f"dropped={info['dropped_sessions']} "
        f"sla_violations={info['sla_violations']} "
        f"stranded_sessions={info.get('stranded_sessions', 0)} "
        f"migrated={info.get('migrated_sessions', 0)} "
        f"total_active={info.get('total_active_sessions', 0)}"
    )
    for index, dc in enumerate(info["datacenters"]):
        required = dc["active_sessions"] * 400
        print(
            f"dc{index}: capacity={dc['capacity']:.1f}  "
            f"required~={required:.0f}  "
            f"energy={dc['energy']:.2f} kW  "
            f"sessions={dc['active_sessions']}  "
            f"accum_tps={dc['accumulated_tps']:.1f}"
        )


def load_normalizer(norm_file: Path, env_kwargs: dict) -> VecNormalize | None:
    if not norm_file.exists():
        return None

    vec_env = DummyVecEnv([lambda: make_env(**env_kwargs)])
    normalizer = VecNormalize.load(str(norm_file), vec_env)
    normalizer.training = False
    normalizer.norm_reward = False
    return normalizer


def normalize_observation(normalizer: VecNormalize, observation: np.ndarray) -> np.ndarray:
    return normalizer.normalize_obs(
        np.asarray(observation, dtype=np.float32).reshape(1, -1)
    )


def main() -> None:
    args = parse_args()
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
            "Warning: VecNormalize stats not found; evaluating without "
            "observation normalization."
        )

    env = make_env(**env_kwargs)
    rewards: list[float] = []
    for episode in range(args.episodes):
        observation, info = env.reset(seed=args.seed + episode)
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
            total_reward += reward
            done = terminated or truncated

        rewards.append(total_reward)
        print_episode_summary(episode + 1, total_reward, info)

    mean_reward = sum(rewards) / len(rewards)
    print(f"\nMean reward over {args.episodes} episode(s): {mean_reward:.2f}")

    env.close()
    if normalizer is not None:
        normalizer.close()


if __name__ == "__main__":
    main()
