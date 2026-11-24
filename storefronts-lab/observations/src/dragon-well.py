"""Dragon Well, 2142 Chestnut: readings off the 2022 panoramas (frames 0, 4, 5) rectified on wall 3
(Chestnut, u from the west end), anchored on the siding/Starbucks joint at u 15.25 (align du +1.35).
Run: python observations/src/dragon-well.py  (writes observations/dragon-well.json)"""
import json
from pathlib import Path
LAB = Path(__file__).resolve().parents[2]
mid = 'dragon-well'
m = json.load(open(LAB / 'models' / f'{mid}.json'))
F = [p['frame_id'] for p in m['photos']]
FR = [F[0], F[4], F[5]]
WHO = 'kerbfront rectify + reviewer (Claude), 2026-11-24'
obs = []
def ob(path, value, frames, how, conf=0.8):
    obs.append({'path': path, 'value': value, 'evidence': {'frames': frames, 'how': how, 'confidence': conf, 'read_by': WHO}})

SIDING, BROWN, CREAM, RED = '#b3a68f', '#55372a', '#ebe0c3', '#8e3a2c'
ob('height_m', 7.4, FR, 'false front of horizontal siding to 7.4 m (LiDAR 7.38)')
ob('floors', [{'v': 0, 'h': 3.6}, {'v': 3.6, 'h': 3.8}], FR, 'shop storey; the upper front is a blank siding parapet with mezzanine windows only over two tenants')
ob('roof.parapet_h', 1.6, FR, 'tall false front hiding a low roof', 0.5)
ob('roof.cornice', {'h': 0.08, 'depth': 0.06, 'colour': '#8d8170', 'raise': 0}, FR, 'plain metal cap, no cornice')
for k, v in {'material': 'wood_siding', 'colour': SIDING, 'trim_colour': '#d9d2c3', 'texture_scale': 0.55}.items():
    ob(f'walls.3.{k}', v, FR, 'narrow horizontal siding (about 0.12 m boards), taupe in sun')
ob('walls.3.openings', [
    {'id': 'mez-w', 'kind': 'window', 'u': 5.9, 'v': 3.75, 'w': 2.2, 'h': 1.0, 'shape': 'rect', 'mullions': [3, 1], 'frame_colour': '#f2f0ea', 'depth': 0.25, 'sill': False, 'surround': True},
    {'id': 'dw-box', 'kind': 'bay', 'u': 8.3, 'v': 3.97, 'w': 3.6, 'h': 0.93, 'v0': 3.85, 'v1': 5.0, 'projection': 0.35, 'front_share': 0.94,
     'material': 'painted_wood', 'colour': BROWN, 'trim_colour': '#4a2f24', 'mullions': [3, 1]}], FR,
   'mezzanine window band (white surround) over the teal-awning shop 5.9-8.1; Dragon Well\'s projecting dark-brown box window with three lights 8.3-11.9, 3.85-5.0 m over the board (3.35-3.82 m)')
ob('walls.3.belts', [{'v': 3.58, 'h': 0.08, 'colour': '#6f6252', 'depth': 0.08}], FR, 'soffit line where the siding front meets the shopfronts')
pal = lambda **k: {'wall': '#3a3633', 'accent': BROWN, 'frame': '#2b2420', 'base': '#3a3633', 'letter': '#f6f1e7', 'metal': '#a5aaa7', 'glass': '#2c3436', 'roughness': 0.8, **k}
sf = lambda id, name, u0, u1, band, palette, openings, **k: {'id': id, 'business_id': k.pop('bid', None), 'name': name, 'edge': 3, 'u0': u0, 'u1': u1, 'band_h': band,
    'category': k.pop('cat', 'retail'), 'brand': None, 'material': 'stucco', 'palette': palette, 'door_style': None, 'signs': [], 'openings': openings,
    'awnings': k.pop('awnings', []), 'extra_signs': k.pop('signs', []), 'lights': []}
win = lambda id, u, w, v=0.45, h=2.4: {'id': id, 'kind': 'window', 'u': u, 'v': v, 'w': w, 'h': h, 'transom_fraction': 0.15, 'privacy_fraction': 0}
door = lambda id, u, w=0.95: {'id': id, 'kind': 'door', 'u': u, 'v': 0, 'w': w, 'h': 2.4}
marina = {'id': 'marina-neon', 'kind': 'blade', 'u': 14.1, 'v': 3.95, 'w': 0.55, 'h': 3.3, 'offset': 0.2, 'thick': 0.14, 'bg': '#9b3226', 'edge_colour': '#7d271d', 'illumination': 'neon',
          'layers': [{'type': 'text', 'text': ch, 'x': 0.5, 'y': 0.1 + k * 0.16, 'size': 0.13, 'fill': '#f4e4c8', 'font': 'Futura, "Trebuchet MS", sans-serif', 'weight': 700} for k, ch in enumerate('MARINA')]}
lounge = {'id': 'marina-board', 'kind': 'board', 'u': 12.95, 'v': 2.88, 'w': 1.3, 'h': 0.34, 'board': '#24402f', 'bg': '#24402f',
          'layers': [{'type': 'text', 'text': 'Marina Lounge', 'x': 0.5, 'y': 0.52, 'size': 0.55, 'fill': '#e9dcb8', 'font': 'Georgia, serif', 'weight': 700}]}
dwsign = {'id': 'dw-board', 'kind': 'board', 'u': 8.5, 'v': 3.35, 'w': 3.2, 'h': 0.47, 'board': CREAM, 'bg': CREAM,
          'layers': [{'type': 'text', 'text': 'DRAGON WELL', 'x': 0.5, 'y': 0.54, 'size': 0.62, 'fill': '#8b2a1f', 'font': 'Optima, "Gill Sans", "Trebuchet MS", sans-serif', 'weight': 700, 'spacing': 0.06}]}
ob('storefronts', [
    sf('west-shop', 'west shop (under the street tree)', 0.3, 5.2, 3.55, pal(), [win('w0', 0.5, 2.2), door('w1', 2.9), win('w2', 4.0, 1.0)]),
    sf('teal-shop', 'teal-awning shop', 5.3, 8.2, 3.55, pal(wall='#e9e6de', frame='#f2f0ea', base='#cfd8d6'), [win('t0', 5.45, 1.5, 0.6, 2.2), door('t1', 7.05, 0.95)],
       awnings=[{'id': 'teal', 'kind': 'shed', 'u0': 5.2, 'u1': 8.2, 'v': 3.6, 'depth_m': 1.0, 'drop_m': 0.45, 'valance_h': 0.12, 'colour': '#2e9aa6'}]),
    sf('dragon-well', 'Dragon Well', 8.3, 12.0, 3.3, pal(wall='#4a2f24', frame='#3a261d', base=CREAM),
       [win('d0', 8.5, 2.1, 0.95, 1.7), door('d1', 10.9, 0.95)], bid=m['business_id'], cat='restaurant', signs=[dwsign]),
    sf('marina-lounge', 'Marina Lounge', 12.05, 14.6, 3.3, pal(wall='#24402f', frame='#1f3528', base='#24402f'), [door('m0', 12.3, 1.0), win('m1', 13.45, 1.0, 0.7, 2.1)], cat='bar', signs=[marina, lounge]),
], FR, 'four shops under one siding front: dark west shop, teal-awning shop, Dragon Well (cream base, dark-brown frames, cream board with red DRAGON WELL letters), Marina Lounge (dark green, red vertical MARINA neon to 7.2 m)')
ob('street_sides', [{'edge': 3, 'name': 'Chestnut Street', 'sidewalk_m': 3.84, 'kerb_m': 0.077, 'road_m': 13.53, 'parking_m': 2.4, 'u0': -14, 'u1': 30}], [], 'app street record', 0.7)
ob('seating', [{'id': 'dw-enclosure', 'kind': 'parklet', 'zone': 'sidewalk', 'offset_m': 0.1, 'edge': 3, 'u0': 0.3, 'u1': 13.5, 'depth_m': 2.0, 'deck_colour': '#8a7660', 'barrier': 'low_wall',
    'barrier_colour': CREAM, 'benches': 'none', 'tables': 'two_top', 'table_shape': 'square', 'colour': '#2f2f2c', 'chair_colour': '#3a2f28', 'roof': 'none', 'plants': False,
    'barrier_h': 1.05, 'posts': {'h': 2.6, 'colour': RED, 'size': 0.13, 'us': [0.6, 3.4, 6.0, 8.6, 11.1, 13.4], 'beam': True, 'beam_h': 0.18},
    'evidence': {'kind': 'observed', 'how': '2021-22 frames: cream low walls (1.05 m) with dark-red posts and a red beam at 2.6 m, no roof; parallax puts its street face ~2.1 m off the facade (posts 2.5 m apart), so it stands on the sidewalk; the registry lists no seating for these licences, so it is photo-only', 'frames': FR}}],
   FR, 'a sidewalk café enclosure along the whole front (leaves ~1.7 m clear: below the 6 ft rule, a Shared Spaces-era structure)', 0.7)
ob('street_objects', [{'id': 'dw-tree', 'kind': 'tree', 'edge': 3, 'u': 1.5, 'w': 3.3, 'r': 2.6, 'trunk_h': 3.0, 'colour': '#5d7a3a'},
                      {'id': 'dw-bins', 'kind': 'box', 'edge': 3, 'u': 15.6, 'w': 2.8, 'len': 1.4, 'h': 1.05, 'depth': 0.7, 'colour': '#2b2b2b'},
                      {'id': 'dw-meter', 'kind': 'pole', 'edge': 3, 'u': 14.9, 'w': 3.5, 'h': 1.3, 'r': 0.04, 'colour': '#6e6e6a'}], FR, 'street tree at the west end, bins and a meter at the east end', 0.6)
ob('photos', m['photos'], [], 'frames 0, 4, 5 anchored on the east joint (du +1.35); 1-3 are aimed badly (heading drift) and unused', 0.9)
json.dump({'model': mid, 'observations': obs}, open(LAB / 'observations' / f'{mid}.json', 'w'), indent=1)
print(len(obs))
