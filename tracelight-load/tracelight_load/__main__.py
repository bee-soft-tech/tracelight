"""
Randomized traffic generator for the Tracelight demo app.

Usage:
    python -m tracelight_load --url http://localhost:8080 --rps 20
    python -m tracelight_load --rps 50 --duration 30
"""

from __future__ import annotations

import argparse
import asyncio
import random
import time

import httpx

COUNTRIES = ["PL", "DE", "FR", "US", "JP", "BR", "IN"]
SEARCH_TERMS = ["", "tv", "laptop", "ergonomic standing desk", "phone", "wireless noise cancelling headphones"]


def random_order() -> dict:
    # ~10% invalid orders so the "invalid-amount" branch gets traffic too.
    if random.random() < 0.10:
        amount = random.choice([0, -5, -100])
    else:
        amount = round(random.uniform(5, 2000), 2)
    return {
        "amount": amount,
        "premium": random.random() < 0.4,
        "country": random.choice(COUNTRIES),
    }


async def fire_one(client: httpx.AsyncClient, base_url: str, stats: dict) -> None:
    try:
        if random.random() < 0.7:
            await client.post(f"{base_url}/order", json=random_order())
            stats["order"] += 1
        else:
            await client.get(f"{base_url}/search", params={"q": random.choice(SEARCH_TERMS)})
            stats["search"] += 1
    except Exception:  # noqa: BLE001 - load tool, keep going on any transport error
        stats["error"] += 1


async def run(base_url: str, rps: float, duration: float) -> None:
    interval = 1.0 / rps
    deadline = time.time() + duration if duration > 0 else None
    stats = {"order": 0, "search": 0, "error": 0}
    pending: set[asyncio.Task] = set()
    last_report = time.time()

    print(f"→ firing ~{rps} req/s at {base_url}" + (f" for {duration}s" if duration > 0 else " (Ctrl-C to stop)"))

    async with httpx.AsyncClient(timeout=5.0) as client:
        while deadline is None or time.time() < deadline:
            task = asyncio.create_task(fire_one(client, base_url, stats))
            pending.add(task)
            task.add_done_callback(pending.discard)

            # Poisson-ish spacing so traffic looks organic.
            await asyncio.sleep(interval * random.uniform(0.4, 1.6))

            now = time.time()
            if now - last_report >= 2.0:
                total = stats["order"] + stats["search"]
                print(f"  sent={total} (orders={stats['order']}, searches={stats['search']}, errors={stats['error']})")
                last_report = now

        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    total = stats["order"] + stats["search"]
    print(f"done. total={total}, orders={stats['order']}, searches={stats['search']}, errors={stats['error']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Tracelight load generator")
    parser.add_argument("--url", default="http://localhost:8080", help="base URL of the demo app")
    parser.add_argument("--rps", type=float, default=10.0, help="target requests per second")
    parser.add_argument("--duration", type=float, default=0.0, help="seconds to run (0 = until Ctrl-C)")
    args = parser.parse_args()

    try:
        asyncio.run(run(args.url.rstrip("/"), args.rps, args.duration))
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
