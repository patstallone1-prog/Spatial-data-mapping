// Adapter keeps generated geometry local, and leaves other addresses on their existing path.
export function mountGeneratedInterior(THREE, house, entry, context, buildInferredHouse) {
  const {origin, floorY, assetBase, loadAsset, feetY, pointInRing} = context;
  const built=buildInferredHouse(THREE,house,{loadAsset,assetBase,wallHeight:4.5,exterior:false,ceilings:true});
  const [east,north]=origin;
  built.group.position.set(east,floorY,-north);built.group.scale.z=-1;
  const world=(p)=>[east+p[0],-north-p[1]], local=(x,z)=>[x-east,-z-north];
  const levelAt=()=>{const y=(feetY()??floorY)-floorY;let best=0;
    for(const f of house.storeys)if(f.elevation_m<=y+.22)best=f.level;return best;};
  const roomDoors=built.doors.map(d=>({...d,x:east+d.x,z:-north-d.z,y:floorY+house.storeys[d.level].elevation_m}));
  const roomSpecs=house.storeys.flatMap(f=>f.rooms.map(r=>{
    const pts=r.polygon.coordinates[0].map(world),c=pts.reduce((a,b)=>[a[0]+b[0]/pts.length,a[1]+b[1]/pts.length],[0,0]);
    return {kind:r.kind,pts,level:f.level,light:[c[0],floorY+f.elevation_m+f.height_m-.2,c[1]]};
  }));
  const floorSurface=(x,z)=>{
    const p=local(x,z),feet=(feetY()??floorY)-floorY;
    let surface=null, onStair=false;
    for(const f of house.storeys)if(f.elevation_m<=feet+.22&&pointInRing(p[0],p[1],f.inside.coordinates[0])) {
      if(!(f.slab_holes||[]).some(h=>pointInRing(p[0],p[1],h.coordinates[0])))surface=floorY+f.elevation_m;
    }
    for(const s of house.stairs)for(const step of s.steps)if(step.top_m<=feet+.22&&pointInRing(p[0],p[1],step.footprint.coordinates[0])) {
      const y=floorY+step.top_m;if(surface===null||y>surface){surface=y;onStair=true;}
    }
    floorSurface.stairs=onStair;return surface;
  };
  floorSurface.stairs=false;floorSurface.priority=2;
  const result={group:built.group,floorSurface,roomDoors,floorY,height:house.storeys[0].height_m-.15,
    lights:roomSpecs.map(r=>r.light),plan:`Generated single-family hypothesis · ${house.id}`,generated:true,house};
  Object.defineProperty(result,'rooms',{get:()=>roomSpecs.filter(r=>r.level===levelAt())});
  Object.defineProperty(result,'segments',{get:()=>{
    const level=levelAt(),out=built.segments.filter(s=>s.level===level).map(s=>{
      const a=world(s.line.slice(0,2)),b=world(s.line.slice(2,4));return [...a,...b];
    });
    for(const o of house.storeys[level].objects)if(o.support.kind==='floor') {
      const r=o.footprint.coordinates[0];for(let i=0;i<r.length-1;i++)out.push([...world(r[i]),...world(r[i+1])]);
    }
    for(const s of house.stairs.filter(s=>s.from_level===level||s.to_level===level))if(s.guard_segment)out.push([...world(s.guard_segment.coordinates[0]),...world(s.guard_segment.coordinates[1])]);
    for(const d of roomDoors)if(d.level===level&&!d.open){
      const o=house.storeys[level].openings.find(o=>Math.hypot((o.segment.coordinates[0][0]+o.segment.coordinates[1][0])/2-(d.x-east),
        (o.segment.coordinates[0][1]+o.segment.coordinates[1][1])/2-(-north-d.z))<.01);
      if(o)out.push([...world(o.segment.coordinates[0]),...world(o.segment.coordinates[1])]);
    }
    return out;
  }});
  return result;
}
