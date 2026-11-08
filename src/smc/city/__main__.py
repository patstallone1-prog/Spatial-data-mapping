"""Run a district's simulation for a while and report on it.

    python -m smc.city --payload docs/sf-corridor-3d.json --hours 24 --npcs 1000 --players 3
    python -m smc.city --hours 6            # the small synthetic district
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from smc.city.currency import fmt
from smc.city.district import load_district, synthetic_district


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--payload", type=Path, help="a region's sf-corridor-3d.json (default: synthetic grid)")
    parser.add_argument("--hours", type=float, default=24.0)
    parser.add_argument("--npcs", type=int, default=1_000)
    parser.add_argument("--players", type=int, default=3)
    parser.add_argument("--step", type=float, default=60.0, help="seconds per step")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--snapshot", type=Path, help="write the world's records here at the end")
    args = parser.parse_args(argv)

    started = time.monotonic()
    world = (load_district(args.payload, seed=args.seed, npcs=args.npcs) if args.payload
             else synthetic_district(seed=args.seed, npcs=args.npcs))
    print(f"district: {world.graph.size:,} street nodes, {len(world.places):,} places, "
          f"{len(world.registry.assets):,} assets, {len(world.population.npcs):,} NPCs "
          f"({time.monotonic() - started:.1f}s)")
    for i in range(args.players):
        print(f"player-{i}:", world.submit(f"player-{i}", "join"))
    if args.players:
        world.submit("player-0", "start_job")
    steps = int(args.hours * 3600 / args.step)
    started = time.monotonic()
    for n in range(steps):
        world.step(args.step)
        if n % max(1, steps // 8) == 0:
            print(json.dumps(world.metrics()))
    m = world.metrics()
    print(json.dumps(m))
    print(f"{args.hours} h in {time.monotonic() - started:.1f}s; money in circulation {fmt(m['money_supply'])}, "
          f"city treasury {fmt(m['treasury'])}")
    world.ledger.check()
    if args.snapshot:
        args.snapshot.write_text(json.dumps(world.snapshot()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
