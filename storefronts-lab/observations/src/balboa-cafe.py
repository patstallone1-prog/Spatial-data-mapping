"""Balboa Cafe, 3199 Fillmore at Greenwich: readings off rectified Mapillary frames (kerbfront stack).
Run: python observations/src/balboa-cafe.py  (writes observations/balboa-cafe.json)"""
import json, math
from pathlib import Path
LAB = Path(__file__).resolve().parents[2]
mid = 'balboa-cafe'
m = json.load(open(LAB / 'models' / f'{mid}.json'))
F = [p['frame_id'] for p in m['photos']]
FI = [F[i] for i in (5, 0, 1)]; GR = [F[i] for i in (6, 7, 8, 9)]
WHO = 'kerbfront rectify + reviewer (Claude), 2026-11-24'
obs = []
def ob(path, value, frames, how, conf=0.8):
    obs.append({'path': path, 'value': value, 'evidence': {'frames': frames, 'how': how, 'confidence': conf, 'read_by': WHO}})

WHITE, TRIM, GREEN, FRAME = '#eeece5', '#f4f1ea', '#2f4a3e', '#25302b'
ob('height_m', 3.05, FI + GR, 'single storey: cornice top 2.95 m on the 2016 frontal frame (the camera height reference); LiDAR 5.5 m is the rear two-storey wing, modelled as a mass')
ob('floors', [{'v': 0, 'h': 3.05}], FI, 'one storey')
ob('roof.parapet_h', 0.1, FI, 'flat roof just behind the cornice')
ob('roof.cornice', {'h': 0.26, 'depth': 0.28, 'colour': TRIM, 'raise': 0.1}, FI + GR, 'white moulded cornice 2.7-2.95 m over a dark green dentil frieze')
fr = [{'v': 2.43, 'h': 0.27, 'colour': GREEN, 'motif': 'dentil', 'motif_colour': '#ece3cc', 'spacing': 0.22, 'depth': 0.06}]
win = lambda id, u, w, v=0.75, h=1.35, cols=2: {'id': id, 'kind': 'window', 'u': u, 'v': v, 'w': w, 'h': h, 'shape': 'rect', 'mullions': [cols, 1], 'frame_colour': FRAME, 'depth': 0.12, 'sill': True}
for e, frames in ((3, FI), (0, GR)):
    for k, v in {'material': 'smooth_render', 'colour': WHITE, 'trim_colour': TRIM, 'texture_scale': 1.0}.items():
        ob(f'walls.{e}.{k}', v, frames, 'white painted render')
    ob(f'walls.{e}.friezes', fr, frames, 'dark green frieze with cream dentils under the cornice')
    ob(f'walls.{e}.belts', [{'v': 0.0, 'h': 0.25, 'colour': '#d9d6cf', 'depth': 0.04}], frames, 'low plinth')
ob('walls.3.openings', [{'id': 'w3:arch', 'kind': 'door', 'u': 0.35, 'v': 0.0, 'w': 0.7, 'h': 1.95, 'shape': 'arched', 'colour': '#2a2624', 'glazed': False}], FI,
   'arched side door 0.35-1.05 m at the south end of the Fillmore front (2016 frame)')
ob('walls.0.openings', [win('g0', 4.3, 1.5), win('g1', 7.0, 1.4), win('g2', 9.7, 1.2), win('g3', 12.0, 1.4),
    win('g4', 17.4, 1.1), win('g5', 19.4, 0.9, 0.9, 1.0, 1), win('g6', 21.3, 1.0, 0.9, 1.0, 1)], GR,
   'Greenwich windows (dark frames) and the side door with its "Balboa Cafe" plaque at 14.4-15.5 m; heights off the 2016 Fillmore reference')
for e in (1, 2):
    ob(f'walls.{e}.colour', '#d9d6cf', [], 'rear and party walls unseen', 0.3)
    ob(f'walls.{e}.openings', [], [], 'rear and party walls unseen', 0.3)

pal = {'wall': WHITE, 'accent': GREEN, 'frame': FRAME, 'base': '#d9d6cf', 'letter': '#f6f1e7', 'metal': '#a5aaa7', 'glass': '#3c4a4c', 'roughness': 0.8}
coke = lambda x: [{'type': 'circle', 'x': x, 'y': 0.5, 'r': 0.48, 'fill': '#c62127'}, {'type': 'ring', 'x': x, 'y': 0.5, 'r': 0.44, 'stroke': '#f3efe8', 'line': 0.03},
                  {'type': 'text', 'text': 'DRINK', 'x': x, 'y': 0.3, 'size': 0.1, 'fill': '#f3efe8', 'font': 'Helvetica, Arial, sans-serif', 'weight': 700, 'maxw': 0.08},
                  {'type': 'text', 'text': 'Coca-Cola', 'x': x, 'y': 0.52, 'size': 0.2, 'fill': '#f3efe8', 'font': '"Brush Script MT", "Snell Roundhand", cursive', 'weight': 400, 'italic': True, 'maxw': 0.12}]
roofsign = {'id': 'bal-roof', 'kind': 'rooftop', 'u': 1.0, 'v': 3.02, 'w': 5.45, 'h': 0.78, 'offset': -0.5, 'board_inset': 0.14, 'edge_colour': '#dfe9e4',
            'layers': [{'type': 'rect', 'x': 0.05, 'y': 0.14, 'w': 0.9, 'h': 0.72, 'fill': '#d5e6df'},
                       {'type': 'text', 'text': 'BALBOA CAFE', 'x': 0.5, 'y': 0.36, 'size': 0.34, 'fill': '#1f2523', 'font': 'Futura, "Trebuchet MS", sans-serif', 'weight': 600, 'maxw': 0.5},
                       {'type': 'text', 'text': 'OFF SALE LIQUORS', 'x': 0.5, 'y': 0.67, 'size': 0.2, 'fill': '#1f2523', 'font': 'Futura, "Trebuchet MS", sans-serif', 'weight': 500, 'maxw': 0.42},
                       *coke(0.075), *coke(0.925)]}
corner = {'id': 'bal-corner', 'kind': 'blade', 'u': 7.35, 'v': 3.15, 'w': 1.95, 'h': 0.9, 'offset': 0.25, 'thick': 0.12, 'bg': '#f1efe8', 'edge_colour': '#2b2b2b',
          'layers': [{'type': 'rect', 'x': 0.02, 'y': 0.25, 'w': 0.96, 'h': 0.73, 'fill': 'transparent', 'stroke': '#2b2b2b', 'line': 0.04},
                     {'type': 'text', 'text': 'BALBOA', 'x': 0.3, 'y': 0.52, 'size': 0.32, 'fill': '#2b2b2b', 'font': '"Cooper Black", Georgia, serif', 'weight': 700, 'maxw': 0.5},
                     {'type': 'text', 'text': 'CAFE', 'x': 0.76, 'y': 0.2, 'size': 0.3, 'fill': '#2b2b2b', 'font': '"Cooper Black", Georgia, serif', 'weight': 700, 'maxw': 0.4},
                     {'type': 'text', 'text': 'BAR & GRILL', 'x': 0.3, 'y': 0.82, 'size': 0.17, 'fill': '#2b2b2b', 'font': 'Georgia, serif', 'weight': 700, 'maxw': 0.45}]}
plaque = {'id': 'bal-plaque', 'kind': 'board', 'u': 6.15, 'v': 1.7, 'w': 0.7, 'h': 0.3, 'board': '#2b2622',
          'layers': [{'type': 'text', 'text': 'Balboa Cafe', 'x': 0.5, 'y': 0.5, 'size': 0.55, 'fill': '#e9dfc8', 'font': '"Snell Roundhand", "Brush Script MT", cursive', 'weight': 400}]}
glz = lambda id, u, w: {'id': id, 'kind': 'window', 'u': u, 'v': 0.55, 'w': w, 'h': 1.5, 'transom_fraction': 0.0, 'privacy_fraction': 0}
ob('storefronts', [{'id': 'bal-fillmore', 'business_id': m['business_id'], 'name': 'Balboa Cafe', 'edge': 3, 'u0': 1.1, 'u1': 7.5, 'band_h': 2.43,
    'category': 'restaurant', 'brand': None, 'material': 'stucco', 'palette': pal, 'door_style': None, 'signs': [],
    'openings': [glz('f0', 1.85, 1.45), glz('f1', 3.6, 1.45), {'id': 'fd', 'kind': 'door', 'u': 5.2, 'v': 0, 'w': 0.85, 'h': 2.05}, glz('f2', 6.15, 0.7)],
    'awnings': [], 'extra_signs': [roofsign, corner, plaque], 'lights': [{'kind': 'string', 'u0': 1.2, 'u1': 7.4, 'v': 2.32, 'w': 0.12}]},
   {'id': 'bal-greenwich', 'business_id': m['business_id'], 'name': 'Balboa Cafe (Greenwich door)', 'edge': 0, 'u0': 14.3, 'u1': 15.6, 'band_h': 2.4,
    'category': 'restaurant', 'brand': None, 'material': 'stucco', 'palette': pal, 'door_style': None, 'signs': [],
    'openings': [{'id': 'gd', 'kind': 'door', 'u': 14.4, 'v': 0, 'w': 1.1, 'h': 2.1}], 'awnings': [],
    'extra_signs': [{**roofsign, 'id': 'bal-roof-greenwich', 'u': 1.0}, {**plaque, 'id': 'bal-plaque-g', 'u': 14.6, 'v': 2.12}], 'lights': []}], FI + GR,
   'an L-shaped roof sign: the same mint BALBOA CAFE / OFF SALE LIQUORS board with Coca-Cola discs faces Greenwich too (u 1.0-6.45; frames 6-9 read it facing north); Fillmore front 1.1-7.5: two big windows, glazed door 5.2, vestibule window with plaque; mint roof board BALBOA CAFE / OFF SALE LIQUORS with Coca-Cola discs at both ends (3.0-3.8 m); BALBOA CAFE BAR & GRILL blade at the corner')
ob('street_sides', [{'edge': 3, 'name': 'Fillmore Street', 'sidewalk_m': 3.89, 'kerb_m': 0.15, 'road_m': 13.64, 'parking_m': 2.4, 'u0': -14, 'u1': 12},
                    {'edge': 0, 'name': 'Greenwich Street', 'sidewalk_m': 4.57, 'kerb_m': 0.15, 'road_m': 11.85, 'parking_m': 2.4, 'u0': -6, 'u1': 34}], [], 'app street records', 0.7)
ev = lambda how, fr: {'kind': 'observed', 'how': how, 'frames': fr}
ob('seating', [
    {'id': 'bal-parklet-fillmore', 'kind': 'parklet', 'edge': 3, 'u0': -2.6, 'u1': 7.3, 'depth_m': 2.0, 'deck_colour': '#7d5f45', 'barrier': 'planks', 'barrier_h': 1.0,
     'barrier_colour': '#7b5a3e', 'benches': 'street_side', 'bench_colour': '#8a6546', 'tables': 'two_top', 'table_shape': 'round', 'colour': '#2f2f2c', 'chair_colour': '#6b5038',
     'roof': 'corrugated', 'roof_colour': '#8a5a3c', 'roof_h': 2.75, 'roof_pitch': 0.08, 'post_colour': '#7b5a3e', 'post_size': 0.14, 'post_spacing': 2.5, 'plants': False,
     'evidence': ev('2021-22 panoramas from inside it: timber frame, rust corrugated roof, wood benches along the street side, wicker chairs; registry FIXED COMMERCIAL PARKLET', [F[0], F[1]])},
    {'id': 'bal-parklet-greenwich', 'kind': 'parklet', 'edge': 0, 'u0': 3.6, 'u1': 17.4, 'depth_m': 2.0, 'deck_colour': '#8a6a4c', 'barrier': 'planter_wall', 'barrier_h': 0.85,
     'barrier_colour': '#86684c', 'benches': 'none', 'tables': 'two_top', 'table_shape': 'square', 'colour': '#2f2f2c', 'chair_colour': '#3a3330', 'roof': 'none', 'plants': True,
     'evidence': ev('wooden planter boxes with succulents enclosing deck seating in the Greenwich parking lane', [F[8]])},
    {'id': 'bal-parklet-greenwich-roofed', 'kind': 'parklet', 'edge': 0, 'u0': 17.8, 'u1': 23.0, 'depth_m': 2.0, 'deck_colour': '#8a6a4c', 'barrier': 'planks', 'barrier_h': 1.0,
     'barrier_colour': '#86684c', 'benches': 'street_side', 'bench_colour': '#8a6546', 'tables': 'two_top', 'colour': '#2f2f2c', 'chair_colour': '#3a3330',
     'roof': 'corrugated', 'roof_colour': '#9aa0a2', 'roof_h': 2.8, 'roof_pitch': 0.18, 'post_colour': '#8a6546', 'post_size': 0.12, 'glass_panels': True, 'wall_side_to_roof': True, 'plants': False,
     'evidence': ev('a roofed bay at the west end: grey corrugated roof sloping to the street, timber posts, glazed upper panels', [F[9]])},
    {'id': 'bal-sidewalk-greenwich', 'kind': 'sidewalk_strip', 'edge': 0, 'u0': 1.2, 'u1': 13.8, 'offset_m': 0.15, 'depth_m': 1.4, 'table': 'two_top', 'spacing_m': 2.1,
     'colour': '#2f2f2c', 'chair_colour': '#3a3330', 'umbrellas': False, 'barrier': 'none', 'evidence': ev('tables and chairs against the Greenwich wall between the heaters', [F[6], F[7]])},
    {'id': 'bal-sidewalk-greenwich-w', 'kind': 'sidewalk_strip', 'edge': 0, 'u0': 15.8, 'u1': 21.8, 'offset_m': 0.15, 'depth_m': 1.4, 'table': 'two_top', 'spacing_m': 2.1,
     'colour': '#2f2f2c', 'chair_colour': '#3a3330', 'umbrellas': False, 'barrier': 'none', 'evidence': ev('tables west of the side door', [F[6], F[7]])}],
   FI + GR, 'parklets on both streets plus a sidewalk strip on Greenwich (6 ft clear path kept: 1.55 m strip on a 4.57 m sidewalk)')
heat = lambda id, e, u, w: {'id': id, 'kind': 'heater', 'edge': e, 'u': u, 'w': w, 'h': 2.3}
ob('street_objects', [heat('h1', 0, 3.4, 1.9), heat('h2', 0, 7.6, 1.9), heat('h3', 0, 11.2, 1.9), heat('h4', 0, 16.6, 1.9), heat('h5', 0, 19.8, 1.9),
    heat('h6', 3, 4.6, 5.0), heat('h7', 3, 1.4, 5.0),
    {'id': 'bal-pole', 'kind': 'pole', 'edge': 3, 'u': 7.9, 'w': 3.5, 'h': 9.5, 'r': 0.15, 'colour': '#6f5f4e', 'arm': 1.2},
    {'id': 'bal-flag', 'kind': 'pole', 'edge': 3, 'u': 6.9, 'w': 0.4, 'h': 6.4, 'r': 0.03, 'colour': '#d9d9d6'},
    {'id': 'bal-stop', 'kind': 'pole', 'edge': 0, 'u': 2.1, 'w': 4.2, 'h': 2.9, 'r': 0.035, 'colour': '#8a8c88'},
    {'id': 'bal-planter1', 'kind': 'planter', 'edge': 3, 'u': 2.6, 'w': 0.35, 'len': 0.5, 'depth': 0.5, 'h': 0.6, 'colour': '#c9c6bf'},
    {'id': 'bal-planter2', 'kind': 'planter', 'edge': 3, 'u': 5.6, 'w': 0.35, 'len': 0.5, 'depth': 0.5, 'h': 0.6, 'colour': '#c9c6bf'}],
   FI + GR, 'pyramid patio heaters along Greenwich and in the Fillmore parklet; wooden utility pole at the corner, flagpole, stop sign, two planters by the windows')
# the rear two-storey wing (grey siding) at the west end of the Greenwich front
fp = m['footprint']; a = fp[0]; b = fp[1]; L = math.dist(a, b); t = ((b[0] - a[0]) / L, (b[1] - a[1]) / L); n = (t[1], -t[0])
P = lambda u, d: [round(a[0] + u * t[0] - d * n[0], 3), round(a[1] + u * t[1] - d * n[1], 3)]
ob('context', m.get('context', []) + [{'id': 'bal-rear-wing', 'footprint': [P(22.4, 0.05), P(30.4, 0.05), P(30.4, 8.1), P(22.4, 8.1)], 'height_m': 5.6, 'colour': '#c3c7c4', 'roof_colour': '#6d6f6e'}],
   GR, 'the west 8 m of the lot is a two-storey grey wing (LiDAR 5.5 m) with a roof deck railing toward Fillmore', 0.6)
ob('photos', m['photos'], [], 'Fillmore frames 0-5 plus Greenwich frames 6-9; 2021-22 panoramas sit ~1 m lower than the default 2 m (align dz -0.95, set from the 2016 frontal frame)', 0.9)
json.dump({'model': mid, 'observations': obs}, open(LAB / 'observations' / f'{mid}.json', 'w'), indent=1)
print(len(obs))
