"""Build spatial tree tiles from DataSF tkzw-k3nq, emxt-b6yg and 2023 USGS EPT LAZ nodes.

Inputs are Socrata JSON exports and a CA_SanFrancisco_1_B23/ept-data directory.
Only nodes containing ground and a sufficiently sampled, rough, isolated crown contribute
a profile. Missing scans leave the inventory tree intact. Heights are metres above ground.
"""
import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import laspy
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Polygon, Point
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'scripts'), str(ROOT / 'src')]
from build_ground_cover import species_variant

K = np.array([111320 * math.cos(math.radians(37.76)), 111320])
ORIGIN = np.array([-122.45, 37.76])
R = 6378137.0


def plotsize(value):
    s = str(value or '').strip().lower()
    pair = re.fullmatch(r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)", s)
    width = re.fullmatch(r"width (\d+(?:\.\d+)?)ft", s)
    dims = sorted(map(float, pair.groups())) if pair else [float(width[1]), 3] if width else [3, 3]
    return [round(n * .3048, 3) for n in dims] if all(0 < n <= 30 for n in dims) else [.9144, .9144]


def curb_index(rows):
    starts, ends = [], []
    for row in rows:
        if row.get('layer') != 'CURBS':
            continue
        g = row['the_geom']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for line in lines:
            pts = (np.asarray(line)[:, :2] - ORIGIN) * K
            pts = np.asarray(LineString(pts).simplify(.03).coords)
            for a, b in zip(pts, pts[1:]):
                length = np.linalg.norm(b-a)
                if length < .01:
                    continue
                steps = max(1, math.ceil(length/4))
                cut = np.linspace(a, b, steps+1)
                starts.extend(cut[:-1]); ends.extend(cut[1:])
    a, b = np.asarray(starts), np.asarray(ends)
    return a, b, cKDTree((a+b)/2)


def add_curbs(trees, rows):
    islands = []
    for row in rows:
        if row.get("layer") == "ISLANDS" and row["the_geom"]["type"] == "LineString":
            line = LineString(row["the_geom"]["coordinates"])
            if line.is_ring:
                islands.append(Polygon(line))
    island_grid = STRtree(islands)
    a, b, grid = curb_index(rows)
    for t in trees:
        if t['site'] == 'median':
            t['island'] = bool(len(island_grid.query(Point(t['p']), predicate='within')))
        if t['site'] != 'cutout':
            continue
        p = (np.asarray(t['p'])-ORIGIN)*K
        ids = grid.query_ball_point(p, 4.5)
        if not ids:
            continue
        d = b[ids]-a[ids]
        u = np.clip(np.sum((p-a[ids])*d, axis=1)/np.sum(d*d, axis=1), 0, 1)
        foot = a[ids]+u[:, None]*d
        dist = np.linalg.norm(p-foot, axis=1)
        i = np.argmin(dist)
        if dist[i] < 2.5:
            t['curb'] = [*np.round(foot[i]/K+ORIGIN, 7), round(math.atan2(d[i,1], d[i,0]), 4)]


def profile(points, ground):
    # Bin multiple returns through foliage. A flat roof, one wire or a few isolated
    # branches cannot supply a closed crown. Sector order starts east and runs CCW.
    xy, h = points[:, :2], points[:, 2]-ground
    bins = np.floor(xy/.5).astype(int)
    _, index = np.unique(bins, axis=0, return_inverse=True)
    lo = np.full(index.max()+1, np.inf); hi = -lo.copy()
    np.minimum.at(lo,index,h); np.maximum.at(hi,index,h)
    keep = (hi[index]-lo[index] > .8) & (h > 1.5) & (h < 45)
    if keep.sum() < 70:
        return None
    xy, h = xy[keep], h[keep]
    radius = np.linalg.norm(xy, axis=1)
    sectors = np.floor((np.arctan2(xy[:,1],xy[:,0]) + np.pi/8) % (2*np.pi)/(np.pi/4)).astype(int)
    envelope = []
    for sector in range(8):
        mask = sectors == sector
        if mask.sum() < 5:
            return None
        envelope.append([round(float(np.percentile(radius[mask],95)),1),
                         round(float(np.percentile(h[mask],10)),1),round(float(np.percentile(h[mask],98)),1)])
    height = round(float(np.percentile(h,99)),1)
    if height < 3:
        return None
    volume = sum(.5 * math.sin(math.pi/4) * s[0] * envelope[(i+1)%8][0]
                 * ((s[2]-s[1]) + (envelope[(i+1)%8][2]-envelope[(i+1)%8][1]))/2
                 for i,s in enumerate(envelope))
    return dict(h=height, crown_m=round(2*np.mean([s[0] for s in envelope]),1),
                profile=envelope, volume_m3=round(volume,1), src='usgs_3dep_2023')


EPT_SOURCE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23'
CROWN_CLASSES = (1, 3, 4, 5)


def _mercator(trees):
    ll = np.radians([t['p'] for t in trees])
    return R*np.column_stack((ll[:, 0], np.log(np.tan(np.pi/4+ll[:, 1]/2))))


def ept_nodes(ept, xy, reach):
    """Every node of the EPT octree (any depth) with points within ``reach`` (mercator m) of a
    tree: an EPT keeps a share of the points at each depth, so a crown at full density is the
    union of every depth's nodes over it, not the one deepest node."""
    meta = json.loads((ept/'ept.json').read_text())
    b = meta['bounds']
    hierarchy = {}
    for f in (ept/'ept-hierarchy').glob('*.json'):
        hierarchy.update(json.loads(f.read_text()))
    grid = cKDTree(xy)
    out = []
    for key, count in hierarchy.items():
        if count <= 0:
            continue
        d, x, y, _ = map(int, key.split('-'))
        size = (b[3]-b[0])/2**d
        lo = np.array([b[0]+x*size, b[1]+y*size])
        centre = lo+size/2
        if grid.query_ball_point(centre, size/math.sqrt(2)+reach, return_length=True):
            out.append(key)
    return sorted(out, key=lambda k: int(k.split('-')[0]))


def _node_file(ept, key, fetch, scratch):
    local = ept/'ept-data'/f'{key}.laz'
    if local.exists():
        return local, False
    if not fetch:
        return None, False
    import urllib.request
    target = scratch/f'{key}.laz'
    with urllib.request.urlopen(f'{EPT_SOURCE}/ept-data/{key}.laz', timeout=60) as r:
        target.write_bytes(r.read())
    return target, True


def add_profiles(trees, ept, fetch=False, scratch=None, box=None):
    """Crown profiles for ``trees`` from the 2023 USGS 3DEP EPT at ``ept`` (its ept.json and
    ept-hierarchy, and the ept-data nodes on hand). With ``fetch``, a node not on hand is read
    from the public bucket into ``scratch`` and deleted once its points are taken."""
    pick = [i for i, t in enumerate(trees)
            if box is None or (box[0] <= t['p'][0] <= box[2] and box[1] <= t['p'][1] <= box[3])]
    if not pick:
        return 0
    xy_all = _mercator(trees)
    xy = xy_all[pick]
    scale = math.cos(math.radians(37.76))
    grid_all = cKDTree(xy_all)
    # How far round a tree its crown is looked for: half way to the next tree, at most 8 m.
    spacing = grid_all.query(xy, k=2)[0][:, 1]*scale
    reach = np.minimum(8, spacing/2)
    crowns = [[] for _ in pick]
    grounds = [[] for _ in pick]
    keys = ept_nodes(ept, xy, 8/scale)
    grid = cKDTree(xy)
    taken = fetched = 0
    for n, key in enumerate(keys):
        try:
            path, temporary = _node_file(ept, key, fetch, scratch)
        except Exception as error:  # a node the bucket does not give is a gap, not a failure
            print('skipped', key, error, file=sys.stderr)
            continue
        if path is None:
            continue
        try:
            with laspy.open(path) as f:
                cloud = f.read()
        finally:
            if temporary:
                path.unlink()
                fetched += 1
        taken += 1
        xyz = cloud.xyz
        cls = np.asarray(cloud.classification)
        lo, hi = xyz[:, :2].min(axis=0), xyz[:, :2].max(axis=0)
        ids = grid.query_ball_point((lo+hi)/2, np.linalg.norm(hi-lo)/2+8/scale)
        if not ids:
            continue
        near = cKDTree(xyz[:, :2])
        for i in ids:
            idx = np.asarray(near.query_ball_point(xy[i], reach[i]/scale), dtype=int)
            if not len(idx):
                continue
            c = cls[idx]
            g = idx[c == 2]
            if len(g):
                grounds[i].append(xyz[g, 2].astype(np.float32))
            v = idx[np.isin(c, CROWN_CLASSES)]
            if len(v):
                crowns[i].append(np.column_stack(((xyz[v, :2]-xy[i])*scale, xyz[v, 2])).astype(np.float32))
        if n % 100 == 0:
            print(f'{n}/{len(keys)} nodes ({fetched} fetched)', file=sys.stderr)
    made = 0
    for i, k in enumerate(pick):
        t = trees[k]
        for field in ('h', 'crown_m', 'profile', 'volume_m3', 'src'):
            if t.get('src') == 'usgs_3dep_2023':
                t.pop(field, None)
        if reach[i] < 1.5 or not grounds[i] or not crowns[i]:
            continue
        g = np.concatenate(grounds[i])
        pts = np.concatenate(crowns[i])
        if len(g) < 5 or len(pts) < 70:
            continue
        result = profile(pts.astype(np.float64), float(np.median(g)))
        if result and max(s[0] for s in result['profile']) < reach[i]-.1:
            t.update(result)
            made += 1
    print(f'{made} crowns from {taken} nodes ({fetched} fetched) for {len(pick)} trees', file=sys.stderr)
    return made


def reprofile(tiles, ept, box, fetch, scratch):
    """The crowns of the survey's trees in ``box`` measured again, in place in ``tiles``."""
    manifest = json.loads((tiles/'manifest.json').read_text())
    keys = [k for k in manifest['tiles']
            if box[0]-.01 <= int(k.split('_')[0])/100 <= box[2] and box[1]-.01 <= int(k.split('_')[1])/100 <= box[3]]
    rows = {k: json.loads((tiles/f'{k}.json').read_text()) for k in keys}
    trees = [t for k in keys for t in rows[k]]
    add_profiles(trees, ept, fetch, scratch, box)
    for k in keys:
        (tiles/f'{k}.json').write_text(json.dumps(rows[k], separators=(',', ':'), ensure_ascii=False))
    total = 0
    for k in manifest['tiles']:
        total += sum('profile' in t for t in json.loads((tiles/f'{k}.json').read_text()))
    manifest['profiles'] = total
    manifest['lidar_depths'] = 'all (EPT nodes unioned)'
    (tiles/'manifest.json').write_text(json.dumps(manifest))
    print(manifest['trees'], total)


#: Public Works / Better Streets clearances from a tree opening (m): 25 ft from a stop sign,
#: 5 ft from a hydrant, 3 ft from a parking sign or a meter.
CLEARANCE_M = {'stop': 7.62, 'hydrant': 1.524, 'meter': .9144, 'sign': .9144}
PARKING_SIGNS = {'parking', 'no_parking', 'loading'}


def socrata_points(rows):
    out = []
    for row in rows:
        point = row.get('shape', {}).get('coordinates') or [row.get('longitude'), row.get('latitude')]
        if len(point) == 2 and all(p is not None for p in point):
            out.append(list(map(float, point)))
    return out


def add_obstacles(trees, points, kind):
    """Each curb-side tree's ``kind`` obstacles (stop signs, hydrants, signs, meters) near
    enough its opening to matter; the renderer measures them from the opening it settles on."""
    if not points:
        return 0
    obstacle = np.array(points)
    index = cKDTree((obstacle-ORIGIN)*K)
    clearance, n = CLEARANCE_M[kind], 0
    for t in trees:
        if 'curb' not in t:
            continue
        have = {(o[0], o[1], o[2]) for o in t.get('obstacles', [])}
        pos = (np.array(t['curb'][:2])-ORIGIN)*K
        for j in index.query_ball_point(pos, clearance+.4572+t['plot'][0]/2):
            row = (*np.round(obstacle[j], 7).tolist(), kind)
            if row not in have:
                t.setdefault('obstacles', []).append(list(row)); have.add(row); n += 1
    return n


def obstacles(tiles, signs=None, hydrants=None):
    """Parking signs (the SFMTA sign shop's, from the corridor's street furniture) and hydrants
    added to the survey tiles' trees."""
    manifest = json.loads((tiles/'manifest.json').read_text())
    sign_points = []
    if signs:
        furniture = json.loads(signs.read_text())
        sign_points = [s['p'] for s in furniture['geometry_based']['street_signs'] if s.get('sign_kind') in PARKING_SIGNS]
    hydrant_points = json.loads(hydrants.read_text()) if hydrants else []
    added = {'sign': 0, 'hydrant': 0}
    for k in manifest['tiles']:
        rows = json.loads((tiles/f'{k}.json').read_text())
        added['sign'] += add_obstacles(rows, sign_points, 'sign')
        added['hydrant'] += add_obstacles(rows, hydrant_points, 'hydrant')
        (tiles/f'{k}.json').write_text(json.dumps(rows, separators=(',', ':'), ensure_ascii=False))
    manifest['obstacles'] = sorted(set(manifest.get('obstacles', ['stop', 'meter'])) | {k for k, v in added.items() if v})
    (tiles/'manifest.json').write_text(json.dumps(manifest))
    print(added)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'obstacles':
        ap = argparse.ArgumentParser(description='Add parking signs and hydrants to the survey tiles.')
        ap.add_argument('cmd')
        ap.add_argument('tiles', type=Path)
        ap.add_argument('--signs', type=Path, help='docs/sf-corridor-furniture.json (SFMTA signs)')
        ap.add_argument('--hydrants', type=Path, help='JSON [[lon, lat], ...] (OSM emergency=fire_hydrant)')
        args = ap.parse_args()
        obstacles(args.tiles, args.signs, args.hydrants)
        return
    if len(sys.argv) > 1 and sys.argv[1] == 'reprofile':
        ap = argparse.ArgumentParser(description='Measure the survey tiles\' crowns again from every EPT depth.')
        ap.add_argument('cmd')
        ap.add_argument('tiles', type=Path)
        ap.add_argument('ept', type=Path, help='CA_SanFrancisco_1_B23 directory (ept.json, ept-hierarchy, ept-data)')
        ap.add_argument('--box', required=True, help='west,south,east,north')
        ap.add_argument('--fetch', action='store_true', help='read nodes not on hand from the public USGS bucket')
        ap.add_argument('--scratch', type=Path, default=Path('/tmp'))
        args = ap.parse_args()
        args.scratch.mkdir(parents=True, exist_ok=True)
        reprofile(args.tiles, args.ept, [float(v) for v in args.box.split(',')], args.fetch, args.scratch)
        return
    ap = argparse.ArgumentParser(description=__doc__)
    for arg in ('inventory','curbs','laz','output'):
        ap.add_argument(arg,type=Path)
    ap.add_argument('--stops', type=Path, required=True, help='DataSF 4542-gpa3 Point export')
    ap.add_argument('--meters', type=Path, required=True, help='DataSF 8vzz-qzz9 coordinate export')
    args=ap.parse_args()
    trees=[]
    for row in json.loads(args.inventory.read_text()):
        species=row.get('species','')
        if not row.get('longitude') or not row.get('latitude') or re.search('planting site|stump|vacant',species,re.I):
            continue
        p=list(map(float,[row['longitude'],row['latitude']]))
        if not (-122.53<p[0]<-122.34 and 37.70<p[1]<37.84):
            continue
        site=row.get('siteinfo','').lower()
        t=dict(p=p,id=row['treeid'],species=species,v=species_variant(species),
               d=max(1,min(48,float(row.get('mapdbh') or 0))),site='median' if 'median' in site else
               'cutout' if 'curb side' in site and 'cutout' in site else 'other')
        if t['site']=='cutout':
            t['plot']=plotsize(row.get('plotsize'))
        trees.append(t)
    add_curbs(trees,json.loads(args.curbs.read_text()))
    # Store the conflicting records only. The renderer checks their distances to the
    # proposed plot center, which may differ slightly from the inventoried stem.
    for source, kind in [(args.stops,'stop'),(args.meters,'meter')]:
        add_obstacles(trees, socrata_points(json.loads(source.read_text())), kind)
    add_profiles(trees, args.laz.parent if args.laz.name == 'ept-data' else args.laz)
    tiles=defaultdict(list)
    for t in trees:
        tiles[tuple(math.floor(c*100) for c in t['p'])].append(t)
    args.output.mkdir(parents=True,exist_ok=True)
    for (x,y),rows in tiles.items():
        (args.output/f'{x}_{y}.json').write_text(json.dumps(rows,separators=(',',':'),ensure_ascii=False))
    manifest=dict(tiles=sorted(f'{x}_{y}' for x,y in tiles), inventory='tkzw-k3nq',curbs='emxt-b6yg',
                  lidar='CA_SanFrancisco_1_B23',trees=len(trees), profiles=sum('profile' in t for t in trees))
    (args.output/'manifest.json').write_text(json.dumps(manifest))
    print(manifest['trees'],manifest['profiles'],len(tiles))


if __name__=='__main__':
    main()
