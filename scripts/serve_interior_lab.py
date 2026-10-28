#!/usr/bin/env python3
"""Local-only review browser and bounded restaurant spend inference endpoint."""

from __future__ import annotations

import argparse
import functools
import json
import re
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from shapely.errors import GEOSException  # noqa: E402

from smc.interiors.inference import HouseInput, infer_house  # noqa: E402
from smc.interiors.restaurants import RestaurantInput, infer_restaurant  # noqa: E402
from smc.interiors.stores import StoreInput, infer_store  # noqa: E402

slots = threading.BoundedSemaphore(1)


def residential_request(row):
    inputs = json.loads((ROOT / "docs/inferred-residential/inputs.json").read_text())
    known = next((dict(r) for r in inputs if r["id"] == row.get("id")), None)
    if known is None:
        raise ValueError("select a known residential test case")
    # Program changes cannot alter Kerbside's stored shell, heights or opening evidence.
    known["households"] = row.get("households", known.get("households", 1))
    known.pop("units_per_floor", None)
    if row.get("garage_cars") is None:
        known.pop("garage_cars", None)
    else:
        known["garage_cars"] = row["garage_cars"]
    known["garage_mode"] = row.get("garage_mode", known.get("garage_mode", "auto"))
    result = infer_house(HouseInput.from_json(known))
    result.update(name=known["name"], input_evidence=known)
    return result


def store_request(row):
    inputs = json.loads((ROOT / "docs/inferred-stores/inputs.json").read_text())
    known = next((dict(r) for r in inputs if r["id"] == row.get("id")), None)
    if known is None:
        raise ValueError("select a known retail test case")
    chain = row.get("chain", known.get("chain", "independent"))
    if chain not in {"independent", "safeway", "whole_foods", "trader_joes"}:
        raise ValueError("unknown store character")
    known["chain"] = chain
    result = infer_store(StoreInput.from_json(known))
    result.update(name=known["name"], input_evidence=known)
    return result


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if self.path not in {"/api/infer-restaurant", "/api/infer-residential", "/api/infer-store"}:
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }:
            self.reply(403, {"error": "local viewer requests only"})
            return
        if not slots.acquire(blocking=False):
            self.reply(409, {"error": "Another inference is running; retry when it completes."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= length <= 65536:
                raise ValueError("inference input must be at most 64 KiB")
            row = json.loads(self.rfile.read(length))
            if self.path in {"/api/infer-store", "/api/infer-residential"}:
                is_store = self.path == "/api/infer-store"
                h = store_request(row) if is_store else residential_request(row)
                folder = ROOT / (
                    "docs/inferred-stores/overrides"
                    if is_store
                    else "docs/inferred-residential/overrides"
                )
                folder.mkdir(exist_ok=True, parents=True)
                target = folder / f"{h['id']}.json"
                temp = target.with_suffix(".tmp")
                temp.write_text(json.dumps(h, indent=2) + "\n")
                temp.replace(target)
                self.reply(200, h)
                return
            spec = RestaurantInput.from_json(row)
            if not re.fullmatch(r"restaurant-[0-9]+", spec.id):
                raise ValueError("select a mapped restaurant first")
            # The interactive economics control cannot replace the test tenant geometry.
            history = json.loads((ROOT / "docs/inferred-restaurants/history.json").read_text())
            known = next(
                (
                    x
                    for run in reversed(history["rounds"])
                    for x in run["selected"]
                    if x["id"] == spec.id
                ),
                None,
            )
            if not known:
                raise ValueError("unknown pilot restaurant")
            known = dict(known)
            known.pop("price_evidence", None)
            known.update(
                average_spend_per_person=spec.average_spend_per_person,
                currency=spec.currency,
                economics_source="caller supplied USD spend per person",
            )
            h = infer_restaurant(RestaurantInput.from_json(known))
            h.update(name=known["name"], input_evidence=known)
            folder = ROOT / "docs/inferred-restaurants/overrides"
            folder.mkdir(exist_ok=True)
            target = folder / f"{spec.id}.json"
            temp = target.with_suffix(".tmp")
            temp.write_text(json.dumps(h, indent=2) + "\n")
            temp.replace(target)
            self.reply(200, h)
        except (ValueError, TypeError, KeyError, GEOSException) as exc:
            self.reply(422, {"error": str(exc)})
        finally:
            slots.release()

    def reply(self, status, data):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8794)
    args = parser.parse_args()
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), functools.partial(Handler, directory=str(ROOT / "docs"))
    )
    print(f"House tours: http://127.0.0.1:{args.port}/inferred-interiors/", flush=True)
    print(f"Restaurant lab: http://127.0.0.1:{args.port}/inferred-restaurants/", flush=True)
    print(f"Apartments & garages: http://127.0.0.1:{args.port}/inferred-residential/", flush=True)
    print(f"Grocery & corner stores: http://127.0.0.1:{args.port}/inferred-stores/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
