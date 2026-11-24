import json, sys
from pathlib import Path
LAB = str(Path(__file__).resolve().parents[2])
mid = 'super-duper-burgers'
m = json.load(open(f'{LAB}/models/{mid}.json'))
F = [p['frame_id'] for p in m['photos']]
CH = [F[i] for i in (0, 1, 2, 4, 5)]; PI = [F[i] for i in (6, 7, 8)]
WHO = 'kerbfront rectify + reviewer (Claude), 2026-11-24'
obs = []
def ob(path, value, frames, how, conf=0.8):
    obs.append({'path': path, 'value': value, 'evidence': {'frames': frames, 'how': how, 'confidence': conf, 'read_by': WHO}})

BRICK, CREAM, CTRIM, DKGRN, ORANGE, GREYB = '#a4573a', '#e4dac6', '#efe8d8', '#33403a', '#e8722c', '#c9c7c0'
ob('height_m', 9.8, CH + PI, 'brick parapet top at 9.8 m on rectified Chestnut and Pierce walls; bay crests rise to ~10.2')
ob('floors', [{'v': 0, 'h': 6.0}, {'v': 6.0, 'h': 3.8}], CH, 'tall shop storey with a clerestory row (4.65-5.6 m), one residential storey above (windows 6.6-8.6 m)')
ob('roof.cornice', {'h': 0.18, 'depth': 0.12, 'colour': '#8f4a33', 'raise': 0}, CH, 'plain brick coping, no projecting cornice')
ob('roof.parapet_h', 0.5, CH, 'flat roof behind a short parapet')

win = lambda id, u, v, w, h, cols=1, rows=1, **k: {'id': id, 'kind': 'window', 'u': u, 'v': v, 'w': w, 'h': h, 'shape': 'rect', 'mullions': [cols, rows], 'frame_colour': DKGRN, 'depth': 0.16, 'sill': True, **k}
bay = lambda id, u, w, **k: {'id': id, 'kind': 'bay', 'u': u, 'v': 6.6, 'w': w, 'h': 2.0, 'v0': 5.85, 'v1': 9.35, 'projection': 0.62, 'front_share': 0.56,
                             'material': 'stucco', 'colour': CREAM, 'trim_colour': CTRIM, 'mullions': [2, 1], 'cap': {'h': 0.3, 'colour': CTRIM, 'crest_h': 0.75, 'crest_w': 0.75}, **k}
# Chestnut (wall 2, u from the corner chamfer)
for k, v in {'material': 'brick', 'colour': BRICK, 'trim_colour': '#d8d0bf', 'texture_scale': 1.0}.items():
    ob(f'walls.2.{k}', v, CH, 'red-orange brick front with cream canted bays')
ob('walls.2.openings', [
    win('w2:c0', 0.4, 4.65, 2.0, 0.95, 3), win('w2:c1', 2.8, 4.65, 2.3, 0.95, 3), win('w2:c2', 5.9, 4.65, 3.0, 0.95, 4), win('w2:c3', 9.4, 4.65, 2.8, 0.95, 3),
    win('w2:c4', 12.75, 4.0, 4.5, 1.6, 4, 1, frame_colour='#b9b6ae'),
    bay('w2:corner', -0.15, 2.75, front_share=0.62), bay('w2:bay1', 5.8, 3.3), bay('w2:bay2', 15.0, 2.7),
    win('w2:u0', 3.65, 7.25, 0.95, 1.3, 1, 2), win('w2:u1', 10.0, 6.95, 1.9, 1.6, 2, 1), win('w2:u2', 12.3, 6.95, 1.4, 1.6, 1, 2),
    win('w2:u3', 18.0, 6.95, 1.4, 1.6, 1, 2)],
    CH, 'clerestory row 4.65-5.6 m over the shop; bays 5.75-9.1 and 14.7-17.6; flat windows 3.65, 10.0 (fire escape), 12.3; yellow-framed neighbour glazing 12.75-17.25')
ob('walls.2.balconies', [{'u': 9.75, 'w': 2.35, 'v': 6.45, 'depth': 0.85, 'h': 1.0, 'colour': '#2b2b2a', 'ladder': 1.1}], CH, 'black fire-escape balcony in front of the 10.0 m window')
ob('walls.2.belts', [{'v': 5.68, 'h': 0.1, 'colour': '#d8d0bf', 'depth': 0.05}], CH, 'stone sill course over the clerestory')
# the zigzag walls west of the shop: same brick, white-framed shops of other tenants
for e in (3, 4, 5, 6):
    ob(f'walls.{e}.material', 'brick', [F[0], F[5]], 'brick continues west (other tenants, partly behind a street tree)', 0.5)
    ob(f'walls.{e}.colour', BRICK, [F[0], F[5]], 'brick continues west', 0.5)
# corner chamfer (wall 1): corner bay over the entrance
for k, v in {'material': 'brick', 'colour': BRICK, 'trim_colour': '#d8d0bf'}.items():
    ob(f'walls.1.{k}', v, CH + PI, 'corner chamfer')
ob('walls.1.openings', [win('w1:c0', 0.25, 4.65, 1.4, 0.95, 2), {**win('w1:u0', 0.35, 6.6, 1.2, 2.0, 1, 1), 'frame_colour': DKGRN}], CH + PI, 'the corner bay wraps the chamfer: Chestnut -0.15..2.6, Pierce 5.0..7.04, cream panel on the chamfer itself')
ob('walls.1.bands', [{'v0': 5.85, 'v1': 9.35, 'material': 'stucco', 'colour': CREAM}], CH + PI, 'cream cladding on the chamfer between the two bay halves')
# Pierce (wall 0, u from the party wall north to the corner)
for k, v in {'material': 'brick', 'colour': BRICK, 'trim_colour': '#d8d0bf'}.items():
    ob(f'walls.0.{k}', v, PI, 'brick to the ground on Pierce')
ob('walls.0.openings', [
    {'id': 'w0:d0', 'kind': 'door', 'u': 2.85, 'v': 0.25, 'w': 0.55, 'h': 1.9, 'colour': '#c7944f', 'glazed': False},
    {'id': 'w0:d1', 'kind': 'door', 'u': 3.85, 'v': 0.25, 'w': 0.55, 'h': 1.9, 'colour': '#c7944f', 'glazed': False},
    {'id': 'w0:bench', 'kind': 'door', 'u': 0.4, 'v': 0.05, 'w': 1.6, 'h': 0.75, 'colour': '#c7944f', 'glazed': False},
    win('w0:c0', 4.85, 4.6, 1.55, 0.85, 2), win('w0:u0', 1.35, 6.6, 1.0, 1.9, 1, 2),
    bay('w0:corner', 4.95, 2.2, front_share=0.62),
    {'id': 'w0:pg', 'kind': 'window', 'u': 4.55, 'v': 0.9, 'w': 0.8, 'h': 1.9, 'shape': 'rect', 'mullions': [1, 1], 'frame_colour': '#1e2321', 'depth': 0.1, 'sill': False}], PI,
    'two plywood-boarded openings and a slatted bench box on Pierce; clerestory 4.85-6.4; one upper window behind the fire escape')
ob('walls.0.belts', [{'v': 3.42, 'h': 0.2, 'colour': '#bdbab3', 'depth': 0.12}], PI, 'light grey ledge under the Pierce lettering')
ob('walls.0.balconies', [{'u': 1.05, 'w': 1.6, 'v': 6.4, 'depth': 0.7, 'h': 1.0, 'colour': '#2b2b2a', 'ladder': 1.0}], PI, 'fire escape on Pierce')

pal = {'wall': '#cfccc4', 'accent': ORANGE, 'frame': '#1e2321', 'base': '#2d302e', 'letter': '#ffffff', 'metal': '#a5aaa7', 'glass': '#41525a', 'roughness': 0.7}
glaz = lambda id, u, w, v=0.3, h=2.8: {'id': id, 'kind': 'window', 'u': u, 'v': v, 'w': w, 'h': h, 'transom_fraction': 0.0, 'privacy_fraction': 0}
door = lambda id, u, w=1.0: {'id': id, 'kind': 'door', 'u': u, 'v': 0, 'w': w, 'h': 2.4}
awn = lambda id, u0, u1, v=3.55, **k: {'id': id, 'kind': 'retractable', 'u0': u0, 'u1': u1, 'v': v, 'depth_m': 1.3, 'drop_m': 0.45, 'valance_h': 0.14, 'colour': ORANGE, **k}
letters = lambda id, u, w, text, v=3.82: {'id': id, 'kind': 'letters', 'u': u, 'v': v, 'w': w, 'h': 0.42,
    'layers': [{'type': 'text', 'text': text, 'x': 0.5, 'y': 0.55, 'size': 0.8, 'fill': '#fbfaf6', 'font': '"Avenir Next", "Trebuchet MS", sans-serif', 'weight': 500, 'maxw': 0.99}]}
badge = {'id': 'sdb-badge', 'kind': 'blade', 'u': 0.95, 'v': 3.5, 'w': 1.35, 'h': 0.85, 'offset': 0.15, 'thick': 0.12, 'bg': '#b22a2b', 'radius': 0.22, 'edge_colour': '#7c1d1e',
         'layers': [{'type': 'roundrect', 'x': 0.04, 'y': 0.06, 'w': 0.92, 'h': 0.88, 'r': 0.18, 'fill': 'transparent', 'stroke': '#f1dfbd', 'line': 0.05},
                    {'type': 'text', 'text': 'SUPER', 'x': 0.5, 'y': 0.34, 'size': 0.34, 'fill': '#f1dfbd', 'font': '"Cooper Black", "Rockwell", Georgia, serif', 'weight': 800},
                    {'type': 'text', 'text': 'DUPER', 'x': 0.5, 'y': 0.68, 'size': 0.34, 'fill': '#f1dfbd', 'font': '"Cooper Black", "Rockwell", Georgia, serif', 'weight': 800}]}
base = {'business_id': m['business_id'], 'name': 'Super Duper Burgers', 'category': 'fast_food', 'brand': None, 'material': 'metal_panel', 'palette': pal, 'door_style': None, 'signs': []}
ob('storefronts', [
    {**base, 'id': 'sdb-chestnut', 'edge': 2, 'u0': 0.0, 'u1': 12.6, 'band_h': 4.45,
     'openings': [glaz('g0', 0.2, 2.2), glaz('g1', 2.6, 2.3), door('d0', 5.05, 1.05), glaz('g2', 6.25, 2.6), glaz('g3', 9.0, 3.4)],
     'awnings': [awn('a0', 0.05, 2.5), awn('a1', 2.6, 7.45), awn('a2', 7.6, 12.5)],
     'extra_signs': [letters('l0', 0.15, 12.4, 'SUPER DUPER  BURGERS & FRIES  SHAKES & DIPPED CONES')], 'lights': []},
    {**base, 'id': 'sdb-corner', 'edge': 1, 'u0': 0.0, 'u1': 1.91, 'band_h': 4.45, 'openings': [door('cd', 0.45, 1.0)],
     'awnings': [awn('ac', 0.02, 1.89)], 'extra_signs': [badge], 'lights': []},
    {**base, 'id': 'sdb-pierce', 'edge': 0, 'u0': 5.45, 'u1': 6.55, 'band_h': 2.5,
     'openings': [{'id': 'pd', 'kind': 'door', 'u': 5.5, 'v': 0, 'w': 1.0, 'h': 2.4}],
     'awnings': [], 'extra_signs': [letters('lp', 1.0, 6.0, 'BURGERS & FRIES  SHAKES & CONES', 3.85)], 'lights': []},
    {**base, 'id': 'sdb-neighbour', 'name': 'neighbour shop (yellow frames)', 'business_id': None, 'category': 'retail', 'edge': 2, 'u0': 12.7, 'u1': 17.4, 'band_h': 3.9,
     'palette': {**pal, 'frame': '#2a2d2b', 'base': '#e0b93a', 'wall': '#3a3d3b'},
     'openings': [glaz('n0', 12.85, 2.0, 0.55, 2.4), door('n1', 14.95, 1.0), glaz('n2', 16.05, 1.2, 0.55, 2.4)],
     'awnings': [{'id': 'na', 'kind': 'flat_canopy', 'u0': 12.6, 'u1': 17.5, 'v': 3.3, 'depth_m': 0.45, 'drop_m': 0.0, 'valance_h': 0.28, 'colour': '#e0b93a'}], 'extra_signs': [], 'lights': []},
], CH + PI, 'Super Duper wraps the corner: Chestnut 0-12.6 (three orange retractable awnings, white channel letters on a grey fascia 3.8-4.25 m), chamfer entrance with the red SUPER DUPER badge blade, Pierce door by the corner; boarded openings further south')
ob('street_sides', [
    {'edge': 2, 'name': 'Chestnut Street', 'sidewalk_m': 3.66, 'kerb_m': 0.077, 'road_m': 13.53, 'parking_m': 2.4, 'u0': -8, 'u1': 40},
    {'edge': 0, 'name': 'Pierce Street', 'sidewalk_m': 4.57, 'kerb_m': 0.15, 'road_m': 11.71, 'parking_m': 2.4, 'u0': -20, 'u1': 11}], [], 'app street records (curb geometry)', 0.7)
ob('seating', [
    {'id': 'sdb-parklet-pierce', 'kind': 'parklet', 'edge': 0, 'u0': -0.6, 'u1': 7.6, 'depth_m': 2.0, 'deck_colour': '#8c8f8f', 'barrier': 'planks',
     'barrier_h': 1.05, 'barrier_colour': '#8e9396', 'benches': 'street_side', 'bench_colour': '#b98d5a', 'tables': 'two_top', 'table_shape': 'square',
     'colour': '#3b3b38', 'chair_colour': '#3b3b38', 'roof': 'none', 'plants': False, 'posts': {'h': 2.6, 'spacing': 2.7, 'colour': '#8e9396'},
     'string_lights': True, 'evidence': {'kind': 'observed', 'how': '2022 panorama: grey plank parklet in the Pierce parking lane with tall grey posts and string lights; registry FIXED COMMERCIAL PARKLET', 'frames': [F[6]]}}],
   PI, 'parklet on Pierce, not Chestnut (the Chestnut kerb holds the bus shelter)')
ob('street_objects', [
    {'id': 'sdb-shelter', 'kind': 'bus_shelter', 'edge': 2, 'u': 4.9, 'w': 2.5, 'len': 5.6, 'waves': 6, 'depth': 1.45, 'h': 2.75, 'roof_style': 'wave', 'roof_colour': '#a8302a', 'frame_colour': '#7d8380'},
    {'id': 'sdb-cone', 'kind': 'cone_statue', 'edge': 0, 'u': 6.7, 'w': 1.2, 'h': 2.7, 'cone_r': 0.3},
    {'id': 'sdb-pole', 'kind': 'pole', 'edge': 2, 'u': 11.7, 'w': 3.35, 'h': 9.2, 'r': 0.12, 'colour': '#a4a39b'},
    {'id': 'sdb-meter', 'kind': 'pole', 'edge': 0, 'u': 2.4, 'w': 4.3, 'h': 1.3, 'r': 0.04, 'colour': '#6e6e6a'},
    {'id': 'sdb-bins', 'kind': 'box', 'edge': 0, 'u': 5.5, 'w': 1.2, 'len': 1.8, 'h': 1.1, 'depth': 0.7, 'colour': '#2f5a44'},
    {'id': 'sdb-tree', 'kind': 'tree', 'edge': 2, 'u': 22.0, 'w': 3.0, 'r': 3.0, 'trunk_h': 2.8, 'colour': '#55703c'}],
   CH + PI, 'Muni shelter with the red wave roof at the Chestnut kerb 1.6-7.0; giant ice-cream cone at the corner; grey light pole 11.7; green bins on Pierce; street tree west of 19 m')
ob('photos', m['photos'], [], 'Chestnut frames 0-5 plus Pierce frames 6-9 (more-photos --wall 0); alignment by anchoring the LiDAR corner', 0.9)
json.dump({'model': mid, 'observations': obs}, open(f'{LAB}/observations/{mid}.json', 'w'), indent=1)
print(len(obs))
