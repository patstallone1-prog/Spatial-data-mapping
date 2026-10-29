"""Index accepted single-tenant restaurant hypotheses for the Mac world, not the headset.

Keep the existing engine's outputs and provenance. Never stretch a restaurant into another
building, occupy a multi-tenant floor, or call an inferred layout a measured interior.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]


def accepted(root: Path = ROOT) -> dict:
    ways = {str(w['osm_id']): w for w in json.loads((root / 'docs/sf-corridor-3d.json').read_text())['ways']
            if w.get('kind') == 'building'}
    result = {}
    for file in sorted((root / 'docs/inferred-restaurants').glob('restaurant-*.json')):
        h = json.loads(file.read_text())
        source = h.get('input_evidence', {})
        w = ways.get(str(source.get('osm_id')))
        if (not w or not h.get('validation', {}).get('passed') or h.get('grade') != 'inferred'
                or len(h.get('storeys', [])) != 1 or len(w.get('shops') or []) != 1
                or w['shops'][0].get('n') != h.get('name')):
            continue
        origin = source.get('origin_lon_lat')
        if not origin or len(origin) != 2:
            continue
        lon, lat = origin
        shell = Polygon([((x-lon)*111320*math.cos(math.radians(lat)), (y-lat)*111320)
                         for x, y in w['points']])
        inside = Polygon(h['storeys'][0]['footprint']['coordinates'][0])
        if not shell.is_valid or not inside.is_valid or shell.symmetric_difference(inside).area > .05:
            continue
        result[str(w['osm_id'])] = {'file': '../inferred-restaurants/' + file.name,
                                  'kind': 'restaurant', 'name': h['name'],
                                  'footprint': w['points'],
                                  'origin_lon_lat': origin, 'measured': False,
                                  'confidence': h.get('confidence', .25),
                                  'tenancy': 'single listed food tenant; boundaries inferred'}
    return {'schema': 'kerbside.inferred_restaurant_overlay/1', 'buildings': result}


if __name__ == '__main__':
    data = accepted()
    target = ROOT / 'docs/inferred-restaurants/map-overlay.json'
    target.write_text(json.dumps(data, indent=1) + '\n')
    print(f'{len(data["buildings"])} accepted restaurant layouts indexed')
