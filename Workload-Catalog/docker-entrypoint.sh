#!/bin/sh
set -e
# Chart icons + manifest are written at runtime; volume mounts may be root-owned.
mkdir -p /app/public/chart-icons
chown -R appuser:appuser /app/public/chart-icons
exec su-exec appuser /app/server "$@"
