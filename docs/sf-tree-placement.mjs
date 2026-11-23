// DataSF curb bearings run east through north. Scene Z increases south.
export async function surveyedTrees(box, read) {
  const [w,s,e,n] = box;
  if (w > -122.34 || e < -122.53 || s > 37.84 || n < 37.70) return null;
  const index = await read("manifest.json");
  const keys = new Set(index.tiles), loads = [];
  for (let x=Math.floor(w*100); x<=Math.floor(e*100); ++x)
    for (let y=Math.floor(s*100); y<=Math.floor(n*100); ++y) {
      const key = `${x}_${y}`;
      if (keys.has(key)) loads.push(read(key+".json"));
    }
  return (await Promise.all(loads)).flat().filter(({p})=>p[0]>=w && p[0]<=e && p[1]>=s && p[1]<=n);
}

export function sidewalkPlot(tree, curb, outward, walkable) {
  if (tree.site !== "cutout" || !curb) return null;
  const [cx,cz,bearing] = curb;
  const ax=Math.cos(bearing), az=-Math.sin(bearing);
  let nx=-az, nz=ax;
  if (nx*outward[0]+nz*outward[1]<0) { nx=-nx; nz=-nz; }
  const edge=.4572, clear=1.2192;
  const [recordedWidth, length]=tree.plot;
  // Both ends must have a continuous pedestrian path behind the opening.
  // The six-inch curb is included in the minimum total sidewalk width.
  for (const width of [...new Set([recordedWidth, Math.min(recordedWidth,.9144), Math.min(recordedWidth,.6096)])]) {
    const back = Math.max(2.286, edge+width+clear);
    const at=(a,b)=>[cx+a*ax+b*nx,cz+a*az+b*nz];
    const ends=[-length/2,0,length/2];
    if (!ends.every(a=>[edge+.01,edge+width,edge+width+clear/2,back].every(b=>walkable(...at(a,b))))) continue;
    const corners=[at(-length/2,edge),at(length/2,edge),at(length/2,edge+width),at(-length/2,edge+width)];
    // Soil quads use upward-facing winding in the renderer.
    if (ax*nz-az*nx<0) corners.reverse();
    return {center:at(0,edge+width/2), corners};
  }
  return null;
}

// Warp the species model's crown into eight measured wedges. Interpolation at wedge
// boundaries keeps the trunk, major limbs and leaf clusters connected.
export function crownEnvelope(vertices) {
  const wedges=Array.from({length:8},()=>[0,Infinity,-Infinity]);
  for(let i=0;i<vertices.length;i+=3) {
    const x=vertices[i],y=vertices[i+1],z=vertices[i+2];
    const sector=(Math.round(Math.atan2(-z,x)*4/Math.PI)+8)%8, w=wedges[sector];
    w[0]=Math.max(w[0],Math.hypot(x,z)); w[1]=Math.min(w[1],y); w[2]=Math.max(w[2],y);
  }
  const valid=wedges.filter(w=>w[0]>0);
  return wedges.map(w=>w[0]>0?w:valid[0]);
}

export function shapeCrown(vertices, source, measured, trunkScale) {
  for(let i=0;i<vertices.length;i+=3) {
    const x=vertices[i],y=vertices[i+1],z=vertices[i+2];
    const theta=(Math.atan2(-z,x)*4/Math.PI+8)%8, j=Math.floor(theta), k=(j+1)%8, f=theta-j;
    const mix=(wedges,n)=>wedges[j][n]*(1-f)+wedges[k][n]*f;
    const low=mix(source,1),base=mix(measured,1),rise=Math.max(.01,mix(source,2)-low);
    const radial=mix(measured,0)/Math.max(.01,mix(source,0));
    const branch=Math.max(0,Math.min(1,y/Math.max(.01,low)));
    const scale=trunkScale+(radial-trunkScale)*branch*branch;
    vertices[i]=x*scale; vertices[i+2]=z*scale;
    vertices[i+1]=y<low ? y*base/Math.max(.01,low) : base+(y-low)/rise*(mix(measured,2)-base);
  }
}

// Cut just the triangles under a plot. Unaffected faces keep their original indices.
// The plot index is shared by the pavement meshes across a walking window.
export function plotIndex(plots) {
  const bins=new Map(), size=8;
  for(const ring of plots) {
    const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
    const planes=ring.map(([x,z],i)=>{
      const [bx,bz]=ring[(i+1)%4], nx=z-bz,nz=bx-x;
      return [nx,0,nz,-nx*x-nz*z];
    });
    for(let i=Math.floor(Math.min(...xs)/size);i<=Math.floor(Math.max(...xs)/size);i++)
      for(let j=Math.floor(Math.min(...zs)/size);j<=Math.floor(Math.max(...zs)/size);j++){
        const key=i+":"+j;
        if(!bins.has(key)) bins.set(key,[]);
        bins.get(key).push(planes);
      }
  }
  return {bins,size};
}

export function cutPavement(THREE, geom, grid, clip) {
  if (!grid.bins.size || geom.groups.length) return false;
  const pos=geom.attributes.position, old=geom.index?.array, count=old?.length ?? pos.count;
  const kept=[], append={}, attrs=Object.entries(geom.attributes);
  for(const [name] of attrs) append[name]=[];
  let next=pos.count, changed=false;
  for(let i=0;i<count;i+=3) {
    const tri=old?[old[i],old[i+1],old[i+2]]:[i,i+1,i+2];
    const xs=tri.map(v=>pos.getX(v)),zs=tri.map(v=>pos.getZ(v)), candidates=new Set();
    for(let c=Math.floor(Math.min(...xs)/grid.size);c<=Math.floor(Math.max(...xs)/grid.size);c++)
      for(let r=Math.floor(Math.min(...zs)/grid.size);r<=Math.floor(Math.max(...zs)/grid.size);r++)
        for(const prism of grid.bins.get(c+":"+r)||[]) {
          if(!prism.some(([a,,b,k])=>xs.every((x,j)=>a*x+b*zs[j]+k<=0))) candidates.add(prism);
        }
    if(!candidates.size) { kept.push(...tri); continue; }
    const triangle={};
    for(const [name,attr] of attrs) triangle[name]={size:attr.itemSize,
      array:tri.flatMap(v=>Array.from({length:attr.itemSize},(_,k)=>attr.getComponent(v,k)))};
    const result=clip(triangle,[...candidates]);
    for(const [name] of attrs) append[name].push(...result[name]);
    for(let k=0;k<result.position.length;k+=3) kept.push(next++);
    changed=true;
  }
  if(!changed) return false;
  for(const [name,attr] of attrs) {
    const array=new attr.array.constructor(attr.array.length+append[name].length);
    array.set(attr.array); array.set(append[name],attr.array.length);
    geom.setAttribute(name,new THREE.BufferAttribute(array,attr.itemSize,attr.normalized));
  }
  geom.setIndex(kept);
  return true;
}

//: Records of one tree: the city's list (and the lidar's canopy trees beside it) has the same
//: tree more than once a little apart -- re-surveyed, or listed by two sources -- and drawn as
//: recorded that is a knot of trunks growing out of each other. Trunks do not stand this close
//: (the city plants no nearer than 15 ft), so records within CLUMP_M of each other, joined in a
//: chain no wider than CLUMP_SPAN_M, are one tree.
export const CLUMP_M = 2.5, CLUMP_SPAN_M = 6;

//: `trees` with each clump made one tree: the record with the thickest trunk, standing at the
//: average of the clump's positions; its kerb point (`curb`: [lon, lat, bearing]) moved along the
//: kerb to be abreast of it, so the opening is cut at the city's setback from the kerb there and
//: the Public Works distances (a stop sign, a hydrant, a crossing, a driveway) are asked of the
//: one place. `merged` is how many records it stands for; its neighbours' obstacles are kept.
export function mergeClumps(trees, radius = CLUMP_M, span = CLUMP_SPAN_M) {
  if (trees.length < 2) return trees.slice();
  const lat0 = trees[0].p[1], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 111320;
  const at = trees.map((t) => [t.p[0] * kx, t.p[1] * ky]);
  const cells = new Map(), cell = (x, y) => Math.floor(x / radius) + ":" + Math.floor(y / radius);
  at.forEach(([x, y], i) => { const k = cell(x, y); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
  const owner = trees.map((_, i) => i), box = at.map(([x, y]) => [x, y, x, y]);
  const root = (i) => (owner[i] === i ? i : (owner[i] = root(owner[i])));
  for (let i = 0; i < trees.length; i += 1) {
    const [x, y] = at[i], cx = Math.floor(x / radius), cy = Math.floor(y / radius);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const j of cells.get((cx + dx) + ":" + (cy + dy)) || []) {
      if (j <= i || Math.hypot(at[j][0] - x, at[j][1] - y) > radius) continue;
      const a = root(i), b = root(j);
      if (a === b) continue;
      const m = [Math.min(box[a][0], box[b][0]), Math.min(box[a][1], box[b][1]), Math.max(box[a][2], box[b][2]), Math.max(box[a][3], box[b][3])];
      // (A row of saplings a pace apart is a row, not one tree: a chain is not let grow wide.)
      if (Math.hypot(m[2] - m[0], m[3] - m[1]) > span) continue;
      owner[b] = a; box[a] = m;
    }
  }
  const clumps = new Map();
  trees.forEach((t, i) => { const r = root(i); if (!clumps.has(r)) clumps.set(r, []); clumps.get(r).push(i); });
  const out = [];
  for (const members of clumps.values()) {
    if (members.length === 1) { out.push(trees[members[0]]); continue; }
    const mx = members.reduce((a, i) => a + at[i][0], 0) / members.length, my = members.reduce((a, i) => a + at[i][1], 0) / members.length;
    // The thickest trunk is the tree; a surveyed record before a canopy guess of the same girth.
    const keep = members.map((i) => trees[i]).reduce((a, b) => ((b.d || 0) > (a.d || 0) || ((b.d || 0) === (a.d || 0) && b.curb && !a.curb) ? b : a));
    const one = { ...keep, p: [mx / kx, my / ky], merged: members.length };
    const kerbed = members.map((i) => trees[i]).filter((t) => t.curb);
    if (kerbed.length) {
      const near = kerbed.reduce((a, b) => (Math.hypot(b.p[0] * kx - mx, b.p[1] * ky - my) < Math.hypot(a.p[0] * kx - mx, a.p[1] * ky - my) ? b : a));
      const [clon, clat, bearing] = near.curb, ex = Math.cos(bearing), ny = Math.sin(bearing);
      const along = (mx - clon * kx) * ex + (my - clat * ky) * ny;
      one.curb = [(clon * kx + ex * along) / kx, (clat * ky + ny * along) / ky, bearing];
      one.site = near.site; one.plot = near.plot;
    }
    const obstacles = members.flatMap((i) => trees[i].obstacles || []);
    if (obstacles.length) one.obstacles = obstacles;
    out.push(one);
  }
  return out;
}
