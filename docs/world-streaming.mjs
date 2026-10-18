// Scheduling/retention only: every near-window uses the unchanged full-detail renderer.
// Ray/prism picking uses canonical footprints, not the visibility/merging of facade meshes.
export function rayPrism(origin, direction, ring, floor, roof) {
  const inside=(x,z)=>{let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;};
  let best=Infinity;
  if(Math.abs(direction[1])>1e-10)for(const y of [floor,roof]) {
    const t=(y-origin[1])/direction[1];
    if(t>=0 && inside(origin[0]+t*direction[0],origin[2]+t*direction[2]))best=Math.min(best,t);
  }
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const det=direction[0]*dz-direction[2]*dx;if(Math.abs(det)<1e-10)continue;
    const qx=a[0]-origin[0],qz=a[1]-origin[2];
    const t=(qx*dz-qz*dx)/det,u=(qx*direction[2]-qz*direction[0])/det,y=origin[1]+t*direction[1];
    if(t>=0 && u>=0 && u<=1 && y>=floor && y<=roof)best=Math.min(best,t);
  }
  return Number.isFinite(best)?best:null;
}

// No stationary shrink/rebuild loop: grow once, then request BEFORE the visible edge.
export function windowMargin(box, focus, metres, region=null) {
  const [lon,lat]=focus,[kx,ky]=metres;
  const distances=[(lon-box[0])*kx,(lat-box[1])*ky,(box[2]-lon)*kx,(box[3]-lat)*ky];
  return Math.min(...distances.map((d,i)=>region && Math.abs(box[i]-region[i])<1e-8 ? Infinity : d));
}
// The defaults are a small device's. A roomier one passes a wider square (radius), and every
// caller passes how fast the focus is going and how long a window last took to build: a
// window is asked for while the walker still has that many metres of it left, centred that
// far ahead, so a drive or a glide does not outrun the build onto the simple city.
export const DETAIL_SMALL={radius:350,arrival:220,keep:280,lead:160};
export function detailRequest(box, radius, focus, metres, previous=null, region=null, options={}) {
  const {radius:full,arrival,keep,lead:minLead,speed=0,buildSeconds=0}={...DETAIL_SMALL,...options};
  const [lon,lat]=focus,[kx,ky]=metres;
  const margin=windowMargin(box,focus,metres,region);
  // An unexpected jump prioritizes a small arrival, not an expensive outer ring.
  if(margin < -100)return {lon,lat,radius:arrival};
  if(!Number.isFinite(margin))return null;
  // Metres covered while the next window builds (and a couple of seconds to fetch it).
  const ahead=Math.max(0,speed)*(Math.max(0,buildSeconds)+2);
  const trigger=Math.max(keep,Math.min(full-40,ahead+120));
  if(radius>=full && margin>=trigger)return null;
  let dx=previous?(lon-previous[0])*kx:0,dy=previous?(lat-previous[1])*ky:0;
  const lead=Math.min(0.7*full,Math.max(minLead,ahead));
  const length=Math.hypot(dx,dy),step=length>1?lead/length:0;
  return {lon:lon+dx*step/kx,lat:lat+dy*step/ky,radius:full};
}

export function windowCells(manifest, box, lon, lat) {
  const [ox, oy] = manifest.origin, [dx, dy] = manifest.cell;
  const keys = [];
  for (let x = Math.floor((box[0]-ox)/dx); x <= Math.floor((box[2]-ox)/dx); x++)
    for (let y = Math.floor((box[1]-oy)/dy); y <= Math.floor((box[3]-oy)/dy); y++) {
      const key = `${x}_${y}`;
      if (key in manifest.cells) keys.push({key, d:Math.hypot((ox+(x+.5)*dx-lon)*Math.cos(lat*Math.PI/180),oy+(y+.5)*dy-lat)});
    }
  return ['any', ...keys.sort((a,b)=>a.d-b.d || a.key.localeCompare(b.key)).map(k=>k.key)]
    .filter(k=>k in manifest.cells);
}

export class CellCache {
  constructor({fetcher=(...args)=>globalThis.fetch(...args), maxBytes=48*1024*1024, concurrency=4, retries=2}={}) {
    this.fetcher=fetcher; this.maxBytes=maxBytes; this.concurrency=concurrency;
    this.retries=retries;
    this.entries=new Map(); this.queue=[]; this.active=0; this.bytes=0; this.epoch=0;
    this.stats={hits:0, fetched:0, failed:0, evicted:0};
  }
  focus() { this.epoch++; }
  load(url, priority=0) {
    url=String(url);
    const found=this.entries.get(url);
    if(found) {found.epoch=this.epoch;found.priority=Math.max(found.priority,priority);
      found.used=performance.now();this.stats.hits++;return found.promise.then(structuredClone);}
    const entry={url,priority,epoch:this.epoch,used:performance.now(),bytes:0};
    entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
    this.entries.set(url,entry);this.queue.push(entry);this.pump();return entry.promise.then(structuredClone);
  }
  pump() {
    while(this.active<this.concurrency && this.queue.length) {
      this.queue.sort((a,b)=>b.epoch-a.epoch || b.priority-a.priority);
      const entry=this.queue.shift();this.active++;
      const fetchCell=async()=>{
        for(let attempt=0;;attempt++)try {
          const r=await this.fetcher(entry.url,{cache:'no-cache'});
          if(r.ok || (r.status<500 && r.status!==429) || attempt>=this.retries)return r;
          throw Error(`cell HTTP ${r.status}: ${entry.url}`);
        }catch(error){
          if(attempt>=this.retries)throw error;
          await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
        }
      };
      Promise.resolve().then(fetchCell).then(async r=>{
        if(!r.ok)throw Error(`cell HTTP ${r.status}: ${entry.url}`);
        const text=await r.text(), data=JSON.parse(text);
        // A conservative decoded-JSON allowance, not just compressed network bytes.
        entry.bytes=text.length*4;entry.done=true;this.bytes+=entry.bytes;
        this.stats.fetched++;entry.resolve(data);this.evict();
      }).catch(error=>{this.entries.delete(entry.url);this.stats.failed++;entry.reject(error);})
        .finally(()=>{this.active--;this.pump();});
    }
  }
  evict() {
    const pinned=e=>e.epoch===this.epoch && e.priority>=0;
    const old=[...this.entries.values()].filter(e=>e.done).sort((a,b)=>Number(pinned(a))-Number(pinned(b)) || a.used-b.used);
    while(this.bytes>this.maxBytes && old.length) {
      const e=old.shift();this.entries.delete(e.url);this.bytes-=e.bytes;this.stats.evicted++;
    }
  }
  snapshot() {return {...this.stats,residentBytes:this.bytes,active:this.active,queued:this.queue.length};}
}
