"""Small, real-data renderer reproductions (not deployment assets).

Keeps neighbouring ways/ground rings intact; only limits the inspection area. The
source renderer and full-resolution terrain are unchanged. Serve the repo root.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DIAGNOSTIC = r'''
{
const paintAudit = {surfaces:{}, buried:[], intruders:[],crossings:[]};
for(const w of DATA.ways.filter(w=>w.kind==='crossing'&&wayLength(w.points)<40)){
 const span=crossingRectanglePoints(w.points);
 paintAudit.crossings.push({id:w.osm_id,points:w.points,span,original:wayLength(w.points),
   length:wayLength(span),legs:crossingPaintLegs(span).map(r=>wayLength(r)),provenance:span.provenance});
}
const roadMeshes=[], paintMeshes=[], groundMeshes=[];
groups.streets.traverse(o=>{if(!o.isMesh)return;
  if(o.userData.surface==='road')roadMeshes.push(o);
  if(['crossing','crossing_edges','marking'].includes(o.userData.surface))paintMeshes.push(o);
  if(['walk','walk_narrow','walk_underlay','kerb','divider_block'].includes(o.userData.surface))groundMeshes.push(o);
});
groups.ground.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh)groundMeshes.push(o);});
scene.updateMatrixWorld(true);
// Spatially index triangle bounds: raycasting every merged city mesh per sample
// made the audit itself lock up the UI. This is a read-only vertical probe.
const auditGrids=new Map();
function topHit(objects,x,z){
 let grid=auditGrids.get(objects);
 if(!grid){
  grid=new Map();auditGrids.set(objects,grid);
  for(const object of objects){
   const p=object.geometry.getAttribute('position'),idx=object.geometry.getIndex();
   const n=idx?idx.count:p.count;
   for(let t=0;t+2<n;t+=3){
    const v=[0,1,2].map(k=>idx?idx.getX(t+k):t+k);
    const xs=v.map(i=>p.getX(i)),zs=v.map(i=>p.getZ(i)),ys=v.map(i=>p.getY(i));
    const tri={xs,zs,ys,object};
    for(let ix=Math.max(-25,Math.floor(Math.min(...xs)/8));ix<=Math.min(25,Math.floor(Math.max(...xs)/8));ix++)
     for(let iz=Math.max(-25,Math.floor(Math.min(...zs)/8));iz<=Math.min(25,Math.floor(Math.max(...zs)/8));iz++){
      const key=ix+':'+iz,bucket=grid.get(key)||[];bucket.push(tri);grid.set(key,bucket);
     }
   }
  }
 }
 let best;
 for(const tri of grid.get(Math.floor(x/8)+':'+Math.floor(z/8))||[]){
  const [ax,bx,cx]=tri.xs,[az,bz,cz]=tri.zs;
  const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-8)continue;
  const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den;
  const v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;
  if(Math.min(u,v,w)<-1e-5)continue;
  const y=u*tri.ys[0]+v*tri.ys[1]+w*tri.ys[2];
  if(!best||y>best.point.y)best={point:{y},object:tri.object};
 }
 return best;
}
function topAt(objects,x,z){return topHit(objects,x,z)?.point.y;}
for(const mesh of paintMeshes){
  const p=mesh.geometry.getAttribute('position'),idx=mesh.geometry.getIndex();
  const n=idx?idx.count:p.count, label=mesh.userData.surface;
  const record=paintAudit.surfaces[label] ||= {triangles:0,sampled:0,buried:0,minClearance:999};
  record.triangles+=n/3;
  const stride=Math.max(1,Math.ceil(n/3/250));
  for(let t=0;t+2<n;t+=3*stride){
    const ids=[0,1,2].map(k=>idx?idx.getX(t+k):t+k);
    const x=ids.reduce((s,i)=>s+p.getX(i),0)/3,z=ids.reduce((s,i)=>s+p.getZ(i),0)/3;
    const y=ids.reduce((s,i)=>s+p.getY(i),0)/3;
    const top=topAt(roadMeshes,x,z); if(top===undefined)continue;
    const clearance=y-top;record.sampled++;record.minClearance=Math.min(record.minClearance,clearance);
    const cover=topHit(groundMeshes,x,z);
    if(clearance < -0.002||(cover&&cover.point.y>y+0.002)){record.buried++;if(paintAudit.buried.filter(b=>b.label===label).length<12)paintAudit.buried.push({label,x,z,clearance,carriageway:insideCarriageway(x,z,0.3),paintKey:mesh.userData.mergeKey,cover:cover?.object.userData.surface,key:cover?.object.userData.mergeKey});}
  }
}
for(const way of DATA.ways.filter(w=>w.kind==='street').sort((a,b)=>(b.name==='Bush Street')-(a.name==='Bush Street'))){
  if(paintAudit.intruders.length>=40)break;
  const pts=densifyWay(way.points,5);
  for(let i=1;i<pts.length;i++){
   const p=pts[i], [ax,ay]=xy(...pts[i-1]),[bx,by]=xy(...p),len=Math.hypot(bx-ax,by-ay)||1;
   for(const off of [-0.65,0,0.65]){
    if(paintAudit.intruders.length>=40)break;
    const x=bx-(by-ay)/len*off*renderedRoadWidth(way)/2,y=by+(bx-ax)/len*off*renderedRoadWidth(way)/2,z=-y;
    if(Math.abs(x)>200||Math.abs(z)>200)continue;
    const road=topAt(roadMeshes,x,z), hit=topHit(groundMeshes,x,z),ground=hit?.point.y;
    if(road!==undefined&&ground!==undefined&&ground>road+0.002&&paintAudit.intruders.length<40)
      paintAudit.intruders.push({name:way.name,x,z,road,ground,surface:hit.object.userData.surface,key:hit.object.userData.mergeKey});
   }
  }
}
paintAudit.cornerCovers=[];
for(const sample of paintAudit.buried.filter(s=>s.label.startsWith('crossing'))){
 for(const leg of cornerLegs)for(const side of [1,-1]){
  const q=cornerQuad(leg,side);if(!q||!pointInRing(sample.x,-sample.z,[q.K,q.A1,q.C,q.B1]))continue;
  const other=pavementCornerCuts.get(`${leg.id}:${side}`)?.B;
  paintAudit.cornerCovers.push({x:sample.x,z:sample.z,way:leg.way.osm_id,name:leg.way.name,
   bulbs:leg.bulb,other:other?.way.name,otherBulbs:other?.bulb,ring:[q.K,q.A1,q.C,q.B1]});
 }
}
const auditElement=document.createElement('script');auditElement.type='application/json';
auditElement.id='road-paint-audit';auditElement.textContent=JSON.stringify(paintAudit);document.body.append(auditElement);
console.info('road-paint-audit '+JSON.stringify(paintAudit));
}
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--lon", type=float, default=-122.41868)
    parser.add_argument("--lat", type=float, default=37.78891)
    parser.add_argument("--radius", type=float, default=180)
    parser.add_argument("--yaw", type=float, default=0)
    parser.add_argument("--pitch", type=float, default=0.65)
    parser.add_argument("--distance", type=float, default=100)
    args = parser.parse_args()
    docs = ROOT / "docs"
    viewer = docs if args.region == "sf-corridor" else docs / "app-regions" / args.region
    data_dir = viewer if (viewer / "sf-corridor-3d.json").exists() else docs / "regions" / args.region
    data = json.loads((data_dir / "sf-corridor-3d.json").read_text())
    dx = args.radius / (111320 * math.cos(math.radians(args.lat)))
    dy = args.radius / 111320
    west, south, east, north = args.lon-dx, args.lat-dy, args.lon+dx, args.lat+dy

    def touches(points):
        if not points:
            return False
        if isinstance(points[0], (int, float)):
            points = [points]
        return (min(p[0] for p in points) <= east and max(p[0] for p in points) >= west
                and min(p[1] for p in points) <= north and max(p[1] for p in points) >= south)

    data["ways"] = [w for w in data["ways"] if touches(w.get("points") or w.get("point"))]
    data["intersections"] = [n for n in data["intersections"] if touches([[n["lon"], n["lat"]]])]
    data["bbox"] = dict(west=west, south=south, east=east, north=north)
    for key in ("observations", "sequence_paths", "coverage", "gaps", "districts"):
        data[key] = []
    out = ROOT / "build" / "road-paint-preview" / args.region
    out.mkdir(parents=True, exist_ok=True)
    (out / "sf-corridor-3d.json").write_text(json.dumps(data))
    ground_path = data_dir / "app-sf-corridor-ground.json"
    if not ground_path.exists():
        ground_path = data_dir / "sf-corridor-ground.json"
    if not ground_path.exists():
        ground_path = docs / "regions" / args.region / "sf-corridor-ground.json"
    ground = json.loads(ground_path.read_text())
    for key, items in ground.items():
        if not isinstance(items, list):
            continue
        ground[key] = [item for item in items if not isinstance(item, dict) or
                       touches(item.get("p") or ([item["point"]] if "point" in item else []))]
    (out / "preview-ground.json").write_text(json.dumps(ground))
    page = (viewer / "app-model.html").read_text()
    source = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    current = source["tuned"](source["HTML"], "app")
    module = current.split('<script type="module">', 1)[1].split("</script>", 1)[0]
    before, rest = page.split('<script type="module">', 1)
    page = before + '<script type="module">' + module + '</script>' + rest.split('</script>', 1)[1]
    asset_path = "/" + str(ground_path.parent.relative_to(ROOT)) + "/"
    page = re.sub(r'<meta name="kerbside-assets" content="[^"]*"',
                  f'<meta name="kerbside-assets" content="{asset_path}"', page)
    page = re.sub(r'fetch\((?:asset\()?"sf-corridor-3d.json"\)?', 'fetch("sf-corridor-3d.json"', page, count=1)
    page = re.sub(r'fetch\((?:asset\()?"(?:app-)?sf-corridor-ground.json"\)?', 'fetch("preview-ground.json"', page, count=1)
    page = page.replace('const TILE_BASE = "tiles/";', 'const TILE_BASE = "/docs/tiles/";')
    position = (f'const [previewX,previewY]=xy({args.lon},{args.lat});'
                'goTo({x:previewX,z:-previewY},{travel:true,zoom:true});'
                f'state.dist={args.distance};state.yaw={args.yaw};state.pitch={args.pitch};placeCamera();')
    page = page.replace("// ---- inspection ----", position + DIAGNOSTIC + "\n// ---- inspection ----", 1)
    (out / "index.html").write_text(page)
    print(f"{out}: {len(data['ways'])} ways; use http://127.0.0.1:8898/{out.relative_to(ROOT)}/index.html")


if __name__ == "__main__":
    main()
