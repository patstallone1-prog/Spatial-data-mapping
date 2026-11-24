"""A16, 2355 Chestnut: readings off the 2022 panorama (rectified wall 12 and a perspective view of the
same frame, scale from the 7.17 m LiDAR facade, camera height ~2.1 m from the parklet roof and ground line).
Run: python observations/src/a16.py  (writes observations/a16.json)"""
import json
from pathlib import Path
LAB = Path(__file__).resolve().parents[2]
mid = 'a16'
m = json.load(open(LAB / 'models' / f'{mid}.json'))
F = [p['frame_id'] for p in m['photos']]
FR = [F[0], F[1]]
WHO = 'kerbfront rectify + reviewer (Claude), 2026-11-24'
obs = []
def ob(path, value, frames, how, conf=0.8):
    obs.append({'path': path, 'value': value, 'evidence': {'frames': frames, 'how': how, 'confidence': conf, 'read_by': WHO}})

BRICK, STONE, WFRAME = '#7c3a2b', '#cdbfa8', '#f1efe9'
ob('height_m', 9.45, FR, 'brick parapet top 7.3 m above a ~2.1 m camera on the 14.4 m line (LiDAR 8.9 m is the roof surface behind the parapet)')
ob('floors', [{'v': 0, 'h': 3.0}, {'v': 3.0, 'h': 2.95}, {'v': 5.95, 'h': 3.5}], FR, 'shop storey to ~3.0 m, flats above')
ob('roof.parapet_h', 0.55, FR, 'flat roof behind a brick parapet')
ob('roof.cornice', {'h': 0.12, 'depth': 0.08, 'colour': STONE, 'raise': 0}, FR, 'thin stone coping')
for k, v in {'material': 'brick', 'colour': BRICK, 'trim_colour': STONE, 'texture_scale': 1.0}.items():
    ob(f'walls.12.{k}', v, FR, 'red brick front')
arch = lambda id, u: {'id': id, 'kind': 'window', 'u': u, 'v': 6.2, 'w': 0.95, 'h': 1.5, 'shape': 'arched', 'mullions': [2, 3], 'frame_colour': WFRAME, 'pane_colour': '#cfd0cb', 'depth': 0.18, 'sill': True}
rect = lambda id, u: {'id': id, 'kind': 'window', 'u': u, 'v': 3.25, 'w': 0.95, 'h': 1.5, 'shape': 'rect', 'mullions': [2, 3], 'frame_colour': WFRAME, 'pane_colour': '#b9bcb8', 'depth': 0.18, 'sill': True}
ob('walls.12.openings', [arch('a0', 0.7), arch('a1', 1.9), arch('a2', 4.45), arch('a3', 5.7), rect('r0', 0.78), rect('r1', 1.93), rect('r2', 4.44), rect('r3', 5.62)], FR,
   'third floor: two pairs of round-arched windows (6.2-7.7 m); second floor: two pairs of double-hung windows (3.25-4.75 m); white frames; positions identical on the rectified wall and the perspective view (within 0.1 m)')
ob('walls.12.ornaments', [{'u': 3.55, 'v': 7.3, 'w': 0.42, 'h': 0.42, 'shape': 'diamond', 'colour': STONE, 'depth': 0.05}], FR, 'stone diamond between the arched pairs')
ob('walls.12.belts', [{'v': 2.95, 'h': 0.14, 'colour': STONE, 'depth': 0.06}], FR, 'stone course over the shop storey', 0.5)
pal = {'wall': '#6e3328', 'accent': '#2f6b4f', 'frame': '#2d2a26', 'base': '#3b2f2a', 'letter': '#f6f1e7', 'metal': '#a5aaa7', 'glass': '#2e3637', 'roughness': 0.8}
blade = {'id': 'a16-round', 'kind': 'blade', 'u': 0.15, 'v': 2.97, 'w': 0.72, 'h': 0.72, 'offset': 0.3, 'thick': 0.08, 'edge_colour': '#2f6b4f',
         'layers': [{'type': 'circle', 'x': 0.5, 'y': 0.5, 'r': 0.49, 'fill': '#2f6b4f'}, {'type': 'ring', 'x': 0.5, 'y': 0.5, 'r': 0.42, 'stroke': '#e9efe9', 'line': 0.03},
                    {'type': 'text', 'text': 'A16', 'x': 0.5, 'y': 0.53, 'size': 0.34, 'fill': '#f2f5f1', 'font': 'Futura, "Trebuchet MS", sans-serif', 'weight': 600}]}
board = {'id': 'a16-board', 'kind': 'board', 'u': 2.4, 'v': 3.08, 'w': 1.25, 'h': 0.55, 'board': '#2f6b4f', 'bg': '#2f6b4f',
         'layers': [{'type': 'text', 'text': 'A 16', 'x': 0.5, 'y': 0.52, 'size': 0.62, 'fill': '#f2f5f1', 'font': 'Futura, "Trebuchet MS", sans-serif', 'weight': 600}]}
glz = lambda id, u, w: {'id': id, 'kind': 'window', 'u': u, 'v': 0.45, 'w': w, 'h': 2.15, 'transom_fraction': 0.18, 'privacy_fraction': 0}
ob('storefronts', [{'id': 'a16-chestnut', 'business_id': m['business_id'], 'name': 'A16', 'edge': 12, 'u0': 0.0, 'u1': 7.17, 'band_h': 2.95,
    'category': 'restaurant', 'brand': None, 'material': 'brick', 'palette': pal, 'door_style': None, 'signs': [],
    'openings': [glz('s0', 0.25, 2.2), {'id': 'sd', 'kind': 'door', 'u': 2.6, 'v': 0, 'w': 0.95, 'h': 2.4}, glz('s1', 3.7, 3.25)],
    'awnings': [], 'extra_signs': [blade, board], 'lights': [{'kind': 'string', 'u0': -1.0, 'u1': 7.3, 'v': 2.45, 'w': 3.0}]}], FR,
   'dark shopfront behind the parklet, door lined up with the parklet entrance (2.6-3.5 m); round green A16 blade at the east edge, green A 16 board over the entrance')
ob('street_sides', [{'edge': 12, 'name': 'Chestnut Street', 'sidewalk_m': 5.26, 'kerb_m': 0.077, 'road_m': 13.53, 'parking_m': 2.4, 'u0': -14, 'u1': 22}], [], 'app street record', 0.7)
ob('seating', [{'id': 'a16-parklet', 'kind': 'parklet', 'edge': 12, 'u0': -1.2, 'u1': 7.5, 'depth_m': 2.1, 'deck_colour': '#7f6a52', 'barrier': 'planks', 'barrier_h': 1.15,
    'barrier_colour': '#3d5a48', 'entrance': [2.6, 3.5], 'rails': [1.97], 'benches': 'none', 'tables': 'two_top', 'table_shape': 'square', 'colour': '#2f2f2c', 'chair_colour': '#4a3a2c',
    'roof': 'corrugated', 'roof_colour': '#6d7275', 'roof_h': 2.75, 'roof_pitch': 0.1, 'post_colour': '#b08a5e', 'post_size': 0.11,
    'post_us': [-1.1, 0.74, 2.59, 3.54, 5.49, 7.39], 'glass_panels': True, 'wall_side_to_roof': True, 'plants': False,
    'evidence': {'kind': 'observed', 'how': 'enclosed parklet -1.2..7.5 m: green plank lower panels to 1.15 m, light timber posts at -1.1/0.74/2.59/3.54/5.49/7.39, rail at 1.97 m, clear panels, grey corrugated roof falling to the street (front edge 2.6 m); registry FIXED COMMERCIAL PARKLET', 'frames': FR}}],
   FR, 'one large enclosed parklet in the parking lane')
ob('street_objects', [{'id': 'a16-tree', 'kind': 'tree', 'edge': 12, 'u': -4.4, 'w': 4.6, 'r': 2.2, 'trunk_h': 2.6, 'colour': '#3f5e34'},
                      {'id': 'a16-pole', 'kind': 'pole', 'edge': 12, 'u': 9.5, 'w': 4.9, 'h': 9.5, 'r': 0.12, 'colour': '#c9c6be'}], FR,
   'street tree east of the parklet (u -4.4), light pole west of it (u 9.5); u along the wall runs west', 0.6)
ob('photos', m['photos'], [], 'frames 0-1 (2021-22 panoramas) carry the readings; 2-5 are aimed at other walls', 0.9)
json.dump({'model': mid, 'observations': obs}, open(LAB / 'observations' / f'{mid}.json', 'w'), indent=1)
print(len(obs))
