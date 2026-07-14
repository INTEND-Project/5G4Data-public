# Run `pip install -r requirements.txt` for dependencies.
import argparse

from edge_datacenter_env import make_env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a random-policy demo on the edge data center environment."
    )
    parser.add_argument(
        "--max-episode-steps",
        type=int,
        default=200,
        help="Episode step limit (default: 200).",
    )
    parser.add_argument(
        "--episodes",
        type=int,
        default=3,
        help="Number of episodes to run (default: 3).",
    )
    parser.add_argument(
        "--render",
        action="store_true",
        help="Print environment state each step.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    render_mode = "human" if args.render else None

    for episode in range(args.episodes):
        env = make_env(
            max_episode_steps=args.max_episode_steps,
            render_mode=render_mode,
        )
        observation, info = env.reset(seed=episode)
        total_reward = 0.0
        done = False

        print(f"\nEpisode {episode + 1}")
        print(f"Observation shape: {observation.shape}")

        while not done:
            action = env.action_space.sample()
            observation, reward, terminated, truncated, info = env.step(action)
            total_reward += reward
            done = terminated or truncated

        print(f"Episode finished. Total reward: {total_reward:.2f}")
        print(
            f"completed={info['completed_sessions']} "
            f"dropped={info['dropped_sessions']} "
            f"sla_violations={info['sla_violations']}"
        )
        for index, dc in enumerate(info["datacenters"]):
            print(
                f"dc{index}: capacity={dc['capacity']:.1f}  "
                f"energy={dc['energy']:.2f} kW  "
                f"sessions={dc['active_sessions']}  "
                f"accum_tps={dc['accumulated_tps']:.1f}"
            )
        env.close()


if __name__ == "__main__":
    main()
