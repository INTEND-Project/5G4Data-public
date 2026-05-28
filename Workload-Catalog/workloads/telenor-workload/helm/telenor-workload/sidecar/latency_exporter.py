import asyncio
import math
import os
import random
import time

import aiohttp
from prometheus_client import Counter, Gauge, Histogram, start_http_server

TARGET_URL = os.getenv("TARGET_URL", "http://localhost:80/")
MIN_RPS = float(os.getenv("MIN_RPS", "10"))
MAX_RPS = float(os.getenv("MAX_RPS", "100"))
PATTERN = os.getenv("PATTERN", "sine")
PERIOD_SECONDS = float(os.getenv("PERIOD_SECONDS", "300"))
METRICS_PORT = int(os.getenv("METRICS_PORT", "9101"))

REQUEST_DURATION = Histogram(
    "nginx_request_duration_seconds",
    "HTTP request duration to nginx",
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)
REQUESTS_TOTAL = Counter("nginx_requests_total", "Total HTTP requests made to nginx")
REQUEST_ERRORS_TOTAL = Counter(
    "nginx_request_errors_total", "Total non-2xx responses or connection errors"
)
ACTIVE_CONNECTIONS = Gauge(
    "nginx_active_connections", "Current number of concurrent HTTP requests in flight"
)
CURRENT_RPS = Gauge("nginx_target_rps", "Current target requests per second")


def get_target_rps(elapsed: float) -> float:
    if PATTERN == "constant":
        return (MIN_RPS + MAX_RPS) / 2
    elif PATTERN == "random":
        return random.uniform(MIN_RPS, MAX_RPS)
    else:
        amplitude = (MAX_RPS - MIN_RPS) / 2
        midpoint = (MAX_RPS + MIN_RPS) / 2
        return midpoint + amplitude * math.sin(2 * math.pi * elapsed / PERIOD_SECONDS)


async def make_request(session: aiohttp.ClientSession):
    ACTIVE_CONNECTIONS.inc()
    start = time.perf_counter()
    try:
        async with session.get(TARGET_URL) as resp:
            await resp.read()
            duration = time.perf_counter() - start
            REQUEST_DURATION.observe(duration)
            REQUESTS_TOTAL.inc()
            if resp.status >= 400:
                REQUEST_ERRORS_TOTAL.inc()
    except Exception:
        duration = time.perf_counter() - start
        REQUEST_DURATION.observe(duration)
        REQUEST_ERRORS_TOTAL.inc()
    finally:
        ACTIVE_CONNECTIONS.dec()


async def load_loop():
    connector = aiohttp.TCPConnector(limit=200)
    async with aiohttp.ClientSession(connector=connector) as session:
        start_time = time.time()
        while True:
            elapsed = time.time() - start_time
            target_rps = get_target_rps(elapsed)
            CURRENT_RPS.set(target_rps)

            interval = 1.0 / max(target_rps, 1)
            batch_start = time.time()
            while time.time() - batch_start < 1.0:
                asyncio.create_task(make_request(session))
                await asyncio.sleep(interval)


def main():
    start_http_server(METRICS_PORT)
    print(
        f"Latency exporter started: target={TARGET_URL}, "
        f"rps={MIN_RPS}-{MAX_RPS}, pattern={PATTERN}, port={METRICS_PORT}"
    )
    asyncio.run(load_loop())


if __name__ == "__main__":
    main()
