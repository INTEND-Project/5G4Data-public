#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys

def main():
    parser = argparse.ArgumentParser(description="Convert GIF to MP4")
    parser.add_argument("gif_file", help="Input GIF file")
    parser.add_argument("-t", "--duration", type=float, help="Duration in seconds for the output MP4")
    args = parser.parse_args()

    gif_path = args.gif_file

    if not os.path.exists(gif_path):
        print(f"Error: File '{gif_path}' not found")
        sys.exit(1)

    if not gif_path.lower().endswith('.gif'):
        print(f"Warning: File '{gif_path}' does not have .gif extension")

    # Generate output path by replacing .gif with .mp4
    mp4_path = os.path.splitext(gif_path)[0] + ".mp4"

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("Error: ffmpeg not found in PATH")
        sys.exit(1)

    # Build ffmpeg command
    cmd = [ffmpeg, "-y", "-i", gif_path]
    if args.duration:
        cmd.extend(["-t", str(args.duration)])
    cmd.extend(["-movflags", "faststart", "-pix_fmt", "yuv420p", mp4_path])

    print(f"Converting {gif_path} to {mp4_path}...")
    if args.duration:
        print(f"Output duration: {args.duration} seconds")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error: ffmpeg failed with code {result.returncode}")
        print(result.stderr)
        sys.exit(1)

    if os.path.exists(mp4_path) and os.path.getsize(mp4_path) > 0:
        print(f"Successfully created {mp4_path}")
    else:
        print("Error: Output file was not created or is empty")
        sys.exit(1)

if __name__ == "__main__":
    main()
