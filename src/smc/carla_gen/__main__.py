"""Generate a corridor: meshes for the renderer, ground truth for the checker.

    python -m smc.carla_gen build --out build/dc-14th --blocks 12 --seed 20260820
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from smc import geo
from smc.carla_gen.meshio import write_obj
from smc.carla_gen.profile import DEFAULT_PROFILE, audit
from smc.carla_gen.world import (
    build_corridor,
    build_meshes,
    export_ground_truth,
    verify_mesh_fidelity,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smc.carla_gen")
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="generate a corridor")
    build.add_argument("--out", type=Path, required=True)
    build.add_argument("--id", default="corridor")
    build.add_argument("--blocks", type=int, default=8)
    build.add_argument("--block-length", type=float, default=110.0)
    build.add_argument("--seed", type=int, default=20260820)
    build.add_argument("--lat", type=float, default=38.9072)
    build.add_argument("--lon", type=float, default=-77.0369)

    sub.add_parser("audit", help="report which profile parameters are estimates")

    args = parser.parse_args(argv)

    if args.command == "audit":
        print(audit(DEFAULT_PROFILE).report())
        return 0

    corridor = build_corridor(
        args.id,
        geo.Origin(args.lat, args.lon),
        args.seed,
        n_blocks=args.blocks,
        block_length_m=args.block_length,
    )

    fidelity = verify_mesh_fidelity(corridor)
    if not fidelity.ok:
        print("mesh fidelity check FAILED — the render would not match the truth:")
        for failure in fidelity.failures[:10]:
            print(f"  {failure}")
        return 1

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    write_obj(build_meshes(corridor), out / f"{args.id}.obj")

    truth = export_ground_truth(corridor)
    (out / "ground_truth.json").write_text(
        json.dumps([asdict(f) for f in truth], indent=2) + "\n"
    )

    report = audit(DEFAULT_PROFILE)
    (out / "provenance.txt").write_text(report.report() + "\n")

    print(f"corridor {args.id}: {corridor.length_m:.0f} m, {len(corridor.segments)} segments")
    print(f"  meshes       -> {out / f'{args.id}.obj'}")
    print(f"  ground truth -> {out / 'ground_truth.json'} ({len(truth)} facts)")
    print(f"  fidelity     -> exact to {fidelity.max_error_m:.2e} m over {fidelity.checked} checks")
    print(f"  {report.estimate_fraction:.0%} of profile parameters are estimates, not measured")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
