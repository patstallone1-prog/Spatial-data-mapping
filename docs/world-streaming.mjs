// Scheduling/retention only: every near-window uses the unchanged full-detail renderer.
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
  constructor({fetcher=(...args)=>globalThis.fetch(...args), maxBytes=48*1024*1024, concurrency=4}={}) {
    this.fetcher=fetcher; this.maxBytes=maxBytes; this.concurrency=concurrency;
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
      Promise.resolve().then(()=>this.fetcher(entry.url,{cache:'no-cache'})).then(async r=>{
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
