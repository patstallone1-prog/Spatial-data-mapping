import {TourWorld,inPolygon} from './tour-world.mjs';
// Adapter keeps generated geometry local, and leaves other addresses on their existing path.
export function mountGeneratedInterior(THREE, house, entry, context, buildInferredHouse) {
  const {origin, floorY, assetBase, loadAsset, feetY, pointInRing} = context;
  const built=buildInferredHouse(THREE,house,{loadAsset,assetBase,wallHeight:4.5,exterior:false,ceilings:true});
  const [east,north]=origin;
  const physics=new TourWorld(house);
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
    let surface=physics.surface(p[0],p[1],feet),onStair=false;
    if(surface!==null)surface+=floorY;
    const onStep=ring=>pointInRing(p[0],p[1],ring)||ring.slice(1).some((b,i)=>{
      const a=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz)));
      return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)<1e-5;
    });
    for(const s of [...house.stairs,...house.storeys.flatMap(f=>f.level_changes||[])])for(const step of s.steps)if(step.top_m<=feet+.22&&onStep(step.footprint.coordinates[0])) {
      const y=floorY+step.top_m;if(surface===null||y>=surface-1e-5){surface=y;onStair=true;}
    }
    floorSurface.stairs=onStair||(house.ramps||[]).some(r=>inPolygon(p[0],p[1],r.footprint));return surface;
  };
  floorSurface.stairs=false;floorSurface.priority=2;
  const result={group:built.group,floorSurface,roomDoors,floorY,height:house.storeys[0].height_m-.15,
    lights:roomSpecs.map(r=>r.light),plan:house.schema==='kerbside.inferred_store/1'?`Generated ${house.kind.replaceAll('_',' ')} hypothesis · ${house.id}`:`Generated ${house.households||1}-home hypothesis · ${house.id}`,generated:true,house};
  Object.defineProperty(result,'rooms',{get:()=>roomSpecs.filter(r=>r.level===levelAt())});
  Object.defineProperty(result,'segments',{get:()=>{
    const level=levelAt(),out=built.segments.filter(s=>s.level===level).map(s=>{
      const a=world(s.line.slice(0,2)),b=world(s.line.slice(2,4));return [...a,...b];
    });
    for(const o of house.storeys[level].objects)if(o.support.kind==='floor'&&o.position_m[1]+o.size_m[1]>(feetY()??floorY)-floorY+.18) {
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
