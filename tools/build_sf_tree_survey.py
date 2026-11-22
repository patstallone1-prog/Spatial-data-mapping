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


def add_profiles(trees, directory):
    ll = np.radians([t['p'] for t in trees])
    xy = R*np.column_stack((ll[:,0],np.log(np.tan(np.pi/4+ll[:,1]/2))))
    scale = math.cos(math.radians(37.76))
    grid = cKDTree(xy)
    for file in sorted(directory.glob('*.laz')):
        if int(file.stem.split('-')[0]) < 7:
            continue
        with laspy.open(file) as f:
            low, high = f.header.mins[:2], f.header.maxs[:2]
            ids = grid.query_ball_point((low+high)/2, np.linalg.norm(high-low)/2)
            if not ids:
                continue
            cloud = f.read()
        xyz = cloud.xyz
        cls = np.asarray(cloud.classification)
        near = cKDTree(xyz[:,:2])
        for i in ids:
            spacing = grid.query(xy[i],k=2)[0][1]*scale
            reach = min(8,spacing/2)
            if reach < 1.5 or np.min(np.minimum(xy[i]-low,high-xy[i]))*scale < reach:
                continue
            idx = np.asarray(near.query_ball_point(xy[i],reach/scale),dtype=int)
            g = idx[cls[idx]==2]
            pts = idx[np.isin(cls[idx],[1,3,4,5])]
            if len(g)<5 or len(pts)<70:
                continue
            result = profile(np.column_stack(((xyz[pts,:2]-xy[i])*scale,xyz[pts,2])),np.median(xyz[g,2]))
            if result and max(s[0] for s in result['profile']) < reach-.1:
                trees[i].update(result)


def main():
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
    for source, clearance, kind in [(args.stops,7.62,'stop'),(args.meters,.9144,'meter')]:
        obstacle=[]
        for row in json.loads(source.read_text()):
            point=row.get('shape',{}).get('coordinates') or [row.get('longitude'),row.get('latitude')]
            if len(point)==2 and all(p is not None for p in point):
                obstacle.append(list(map(float,point)))
        obstacle=np.array(obstacle)
        index=cKDTree((obstacle-ORIGIN)*K)
        for t in trees:
            if 'curb' not in t:
                continue
            pos=(np.array(t['curb'][:2])-ORIGIN)*K
            for j in index.query_ball_point(pos,clearance+.4572+t['plot'][0]/2):
                t.setdefault('obstacles',[]).append([*np.round(obstacle[j],7),kind])
    add_profiles(trees,args.laz)
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
