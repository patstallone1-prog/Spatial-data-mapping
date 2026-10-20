// Render-only botanical forms. Unit crown radius and unit height let clearance use
// real bounding dimensions. No plant here claims to be an observed individual.
import {SPECIES,noiseHash} from './nature-ecology.mjs';
export {UNDERGROWTH,undergrowthAt,LITTER,litterScatter,litterKind} from './nature-ecology.mjs';

//: The bark's tile, in metres across and up: a furrow or a plate is a few centimetres whatever
//: the limb, so a trunk wraps the tile round several times and a twig once.
export const BARK_TILE_M=[.6,1.2];
//: A tube along a chain of points, its radius at each: the rings at a joint shared by the
//: segments either side, so a bend in a limb is a bend and not a gap. `metric` maps a point
//: of the unit tree to metres for a tree of its species' typical size, so the rings are
//: round once the instance has stretched the tree to that size (a tree is stretched four times
//: taller than it is wide, and a ring drawn round in unit space came out a flat board). The
//: normals are the tube's own, smooth; u wraps the bark tile a whole number of times round.
export function barkTube(out,points,radii,metric,{sides=6,size=[1,1]}={}){
  const [sx,sy]=metric,[SR,SH]=size,M=p=>[p[0]*sx,p[1]*sy,p[2]*sx];
  const P=points.map(M),R=radii.map(r=>r*sx),n=P.length;
  if(n<2)return;
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const tangents=P.map((p,i)=>norm(i===0?sub(P[1],P[0]):i===n-1?sub(P[n-1],P[n-2]):
    sub(norm(sub(P[i+1],P[i])),norm(sub(P[i-1],P[i])))));
  // Parallel transport: each ring's frame turned from the last by the bend, never flipped.
  let u=Math.abs(tangents[0][1])<.9?norm(cross(tangents[0],[0,1,0])):norm(cross(tangents[0],[1,0,0]));
  const around=Math.max(1,Math.round(2*Math.PI*Math.max(...R)/BARK_TILE_M[0]));
  const rings=[];let along=0;
  for(let i=0;i<n;i++){
    const t=tangents[i];u=norm(sub(u,t.map(v=>v*dot(u,t))));const v=cross(t,u);
    if(i)along+=Math.hypot(...sub(P[i],P[i-1]));
    const ring=[];
    for(let k=0;k<=sides;k++){const a=k/sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
      const o=[u[0]*c+v[0]*s,u[1]*c+v[1]*s,u[2]*c+v[2]*s];
      // Back to the unit tree. The normal is for the tree once scaled to `size` (its crown
      // radius and height): the instance's stretch turns it by the inverse, back to the ring's.
      ring.push({p:[(P[i][0]+o[0]*R[i])/sx,(P[i][1]+o[1]*R[i])/sy,(P[i][2]+o[2]*R[i])/sx],
        n:norm([o[0]*SR,o[1]*SH,o[2]*SR]),uv:[k/sides*around,along/BARK_TILE_M[1]]});}
    rings.push(ring);
  }
  const put=q=>{out.position.push(...q.p);out.normal.push(...q.n);out.uv.push(...q.uv);};
  for(let i=1;i<n;i++)for(let k=0;k<sides;k++){
    const a=rings[i-1][k],b=rings[i-1][k+1],c=rings[i][k+1],d=rings[i][k];
    put(a);put(b);put(c);put(a);put(c);put(d);
  }
}

export function botanicalGeometry(species,variant=0){
  const form=SPECIES[species]?.form||species,bark={position:[],uv:[],normal:[]},leaf={position:[],uv:[]};
  let seed=variant*887+Array.from(species).reduce((n,c)=>n+c.charCodeAt(0),0);
  const rnd=()=>noiseHash(++seed,variant,701);
  const triangle=(out,a,b,c,uv=[[0,0],[1,0],[1,1]])=>{out.position.push(...a,...b,...c);out.uv.push(...uv.flat());};
  // Limbs are gathered as chains and drawn once the crown's size is known (barkTube).
  const chains=[];
  const chain=(points,radii,sides=6)=>chains.push({points,radii,sides});
  const branch=(a,b,r0,r1)=>chain([a,b],[r0,r1],4);
  const card=(p,w,h,angle,tilt)=>{
    const u=[Math.cos(angle)*w/2,0,Math.sin(angle)*w/2],v=[-Math.sin(angle)*Math.cos(tilt)*h/2,Math.sin(tilt)*h/2,Math.cos(angle)*Math.cos(tilt)*h/2];
    const at=(x,y)=>p.map((a,i)=>a+x*u[i]+y*v[i]);
    triangle(leaf,at(-1,-1),at(1,-1),at(1,1));
    triangle(leaf,at(-1,-1),at(1,1),at(-1,1),[[0,0],[1,1],[0,1]]);
  };
  const cluster=(p,rx,ry,n,droop=0)=>{
    for(let k=0;k<n;k++){
      const a=rnd()*6.283,e=(rnd()-.5)*Math.PI,R=Math.cbrt(rnd());
      card([p[0]+Math.cos(a)*Math.cos(e)*rx*R,p[1]+Math.sin(e)*ry*R,p[2]+Math.sin(a)*Math.cos(e)*rx*R],
        .16+rnd()*.12,.07+rnd()*.06,rnd()*6.283,.3+rnd()*1.1+droop);
    }
  };
  // The crown is grown as a volume, the way the species carries it -- its envelope (where the
  // foliage starts up the trunk, how wide it is at each height), limbs out to clumps of foliage
  // and leaf sprays filling each clump through its depth -- not tufts at the ends of bare
  // limbs, which drew every tree as a pole with a hat.
  const ENVELOPE={
    oak:       {base:.24,clumps:16,clump:[.30,.20],cards:34,shape:y=>Math.sqrt(Math.max(0,1-((y-.60)/.40)**2))},
    broadleaf: {base:.30,clumps:14,clump:[.26,.20],cards:32,shape:y=>Math.sqrt(Math.max(0,1-((y-.64)/.36)**2))*.92},
    willow:    {base:.30,clumps:14,clump:[.28,.22],cards:32,shape:y=>Math.sqrt(Math.max(0,1-((y-.60)/.40)**2)),droop:.6},
    eucalyptus:{base:.46,clumps:12,clump:[.26,.14],cards:30,shape:y=>Math.sqrt(Math.max(0,1-((y-.74)/.26)**2))*.9},
    pine:      {base:.46,clumps:13,clump:[.28,.13],cards:32,shape:y=>Math.sqrt(Math.max(0,1-((y-.76)/.24)**2))},
    cypress:   {base:.24,clumps:16,clump:[.30,.11],cards:32,shape:y=>Math.min(1,.55+(y-.24)*.9)*(y>.93?Math.max(0,(1-y)/.07):1)},
    redwood:   {base:.14,cone:true},
    fir:       {base:.18,cone:true},
  }[form]||{base:.30,clumps:14,clump:[.26,.20],cards:24,shape:y=>Math.sqrt(Math.max(0,1-((y-.64)/.36)**2))};
  const lean=[(rnd()-.5)*.08,(rnd()-.5)*.08];
  const trunkAt=y=>[lean[0]*y,y,lean[1]*y];
  if(ENVELOPE.cone){
    // A conifer: a trunk to the tip and whorls of down-swept branches all the way up, each
    // carrying sprays of needles along its length, shortening to the leader.
    // Sunk a little and flared at the foot, so on a slope it stands in the ground, not on a point.
    chain([[0,-.03,0],[0,.01,0],trunkAt(.08),trunkAt(.5),trunkAt(1)],[.062,.058,.05,.03,.006],9);
    const whorls=14;
    for(let w=0;w<whorls;w++){
      const t=w/(whorls-1),y=ENVELOPE.base+(1-ENVELOPE.base)*t*.96,reach=(1-t)*.95+.06;
      const arms=5;
      for(let j=0;j<arms;j++){
        const a=j*6.283/arms+w*2.4+rnd()*.5,root=trunkAt(y);
        // Never below the ground: the lowest whorl sweeps down to just above it.
        const tip=[root[0]+Math.cos(a)*reach,Math.max(.04,y-reach*(form==='redwood'?.32:.18)+rnd()*.03),root[2]+Math.sin(a)*reach];
        branch(root,tip,.012*(1-t)+.003,.0015);
        const along=Math.max(2,Math.round(reach*7));
        for(let k=1;k<=along;k++){
          const u=k/along,q=root.map((v,i)=>v+(tip[i]-v)*u);
          cluster([q[0],Math.max(.05,q[1]+.01),q[2]],.07+.06*u,.035,3,.3);
        }
      }
    }
    cluster(trunkAt(.995),.04,.05,4);
  }else{
    const E=ENVELOPE,fork=trunkAt(E.base);
    // The trunk sunk a little and flared at the foot; the leader carries on up a tall tree.
    // The trunk runs on up the middle as a tapering leader to the highest limb it carries (a
    // tall tree's further), so no limb starts in the air above the end of it.
    const leader=['eucalyptus','pine'].includes(form),trunk={points:null,radii:null};
    chains.push(trunk);trunk.sides=9;let highest=E.base+.05;
    for(let j=0;j<E.clumps;j++){
      // Clumps over the envelope's outer shell, some deeper in, none hollowing the middle.
      const a=j*2.39996+rnd()*.5,y=E.base+.08+(1-E.base-.12)*Math.pow(rnd(),.8);
      const shell=E.shape(y)*(.55+.40*Math.sqrt(rnd())),c=[Math.cos(a)*shell,y,Math.sin(a)*shell];
      const from=trunkAt(Math.min(y-.04,E.base+(y-E.base)*.45));highest=Math.max(highest,from[1]+.02);
      const mid=[(from[0]+c[0])*.55,(from[1]+c[1])/2+.03,(from[2]+c[2])*.55];
      chain([from,mid,c],[.035,.02,.008],6);
      cluster(c,E.clump[0]*(.8+rnd()*.4),E.clump[1]*(.8+rnd()*.4),E.cards,E.droop||0);
    }
    // And the middle filled, so the crown is not hollow from below or through a gap.
    cluster(trunkAt((E.base+1)/2+.08),E.shape((E.base+1)/2)*.45,(1-E.base)*.22,Math.round(E.cards*1.2),E.droop||0);
    const top=Math.max(highest,leader?.82:0);
    trunk.points=[[0,-.03,0],[0,.01,0],trunkAt(E.base*.25),fork,trunkAt((E.base+top)/2),trunkAt(top)];
    trunk.radii=[.088,.082,.07,.05,.034,.016];
  }
  // Scale the completed crown once, including cards, so advertised clearance is true.
  // The trunk stands at y = 0; a spray tipped below the ground is laid on it rather than the
  // whole tree lifted off the ground to make room for it.
  let radius=0,height=0;
  for(let i=0;i<leaf.position.length;i+=3){leaf.position[i+1]=Math.max(0,leaf.position[i+1]);radius=Math.max(radius,Math.hypot(leaf.position[i],leaf.position[i+2]));height=Math.max(height,leaf.position[i+1]);}
  for(const c of chains)for(const p of c.points){p[1]=Math.max(c===chains[0]?-1:0,p[1]);radius=Math.max(radius,Math.hypot(p[0],p[2]));height=Math.max(height,p[1]);}
  // The unit tree is stretched to the species' size; for its typical size, this is metres.
  const spec=SPECIES[species],R=spec?(spec.radius[0]+spec.radius[1])/2:5,H=spec?(spec.height[0]+spec.height[1])/2:15;
  const metric=[R/radius,H/height];
  for(const c of chains)barkTube(bark,c.points,c.radii,metric,{sides:c.sides,size:[R,H]});
  for(const g of [bark,leaf])for(let i=0;i<g.position.length;i+=3){g.position[i]/=radius;g.position[i+2]/=radius;g.position[i+1]/=height;}
  // The skeleton, in the unit tree: the trunk first, then every limb, for inspection.
  const skeleton=chains.map(c=>({points:c.points.map(p=>[p[0]/radius,p[1]/height,p[2]/radius]),radii:c.radii.map(r=>r/radius)}));
  return {bark,leaf,species,form,skeleton};
}

export function plantGeometry(kind){
  const position=[],uv=[];
  const quad=(a,b,c,d)=>{position.push(...a,...b,...c,...a,...c,...d);uv.push(0,0,1,0,1,1,0,0,1,1,0,1);};
  const fern=kind==='fern',grass=['sedge','bunchgrass'].includes(kind),low=kind==='sorrel';
  for(let j=0;j<(grass?18:fern?9:low?12:22);j++){
    const a=j*2.39996,reach=grass?.5:fern?1:.75,h=low?.7:.75+noiseHash(j,0,991)*.25;
    if(fern){
      for(let k=0;k<7;k++){
        const t=(k+1)/8,r=reach*t,y=Math.sin(t*Math.PI*.8)*h,w=.15*Math.sin(t*Math.PI);
        const x=Math.cos(a)*r,z=Math.sin(a)*r,dx=-Math.sin(a)*w,dz=Math.cos(a)*w;
        quad([x-dx,y,z-dz],[x+dx,y,z+dz],[x+Math.cos(a)*.17,y+.025,z+Math.sin(a)*.17],[x,y+.03,z]);
      }
      }else if(grass||low){
      const dx=Math.cos(a)*reach,dz=Math.sin(a)*reach,w=grass?.035:.24;
      quad([-Math.sin(a)*w,0,Math.cos(a)*w],[Math.sin(a)*w,0,-Math.cos(a)*w],
        [dx+Math.sin(a)*w*.1,h,dz-Math.cos(a)*w*.1],[dx-Math.sin(a)*w*.1,h,dz+Math.cos(a)*w*.1]);
    }
  }
  if(!(fern||grass||low)){
    // A woody shrub: sprays of leaves over a dome, thicker at the top and the outside, the way
    // a bush is lit -- not a fan of flat blades from one point.
    let seed=Array.from(kind).reduce((n,c)=>n+c.charCodeAt(0),0);
    const rnd=()=>noiseHash(++seed,13,977);
    for(let j=0;j<46;j++){
      const a=rnd()*6.283,e=Math.acos(1-rnd()*1.1),R=.55+.45*Math.cbrt(rnd());
      const cx=Math.sin(e)*Math.cos(a)*R,cz=Math.sin(e)*Math.sin(a)*R,cy=.12+Math.cos(e)*.85*R;
      const size=.22+rnd()*.16,turn=rnd()*6.283,tilt=(rnd()-.5)*1.2;
      const u=[Math.cos(turn)*size,0,Math.sin(turn)*size],v=[-Math.sin(turn)*Math.cos(tilt)*size,Math.sin(tilt)*size+size*.35,Math.cos(turn)*Math.cos(tilt)*size];
      const at=(x,y)=>[cx+x*u[0]+y*v[0],cy+x*u[1]+y*v[1],cz+x*u[2]+y*v[2]];
      quad(at(-1,-1),at(1,-1),at(1,1),at(-1,1));
    }
  }
  let radius=0;for(let i=0;i<position.length;i+=3)radius=Math.max(radius,Math.hypot(position[i],position[i+2]));
  if(radius>1)for(let i=0;i<position.length;i+=3){position[i]/=radius;position[i+2]/=radius;}
  // Unit height too, so the shrub stands as tall as the height it is given.
  let top=0;for(let i=1;i<position.length;i+=3)top=Math.max(top,position[i]);
  if(top>1)for(let i=1;i<position.length;i+=3)position[i]/=top;
  return {position,uv};
}

export function trianglePrismPlanes(ring,bottom,top){
  const [a,b,c]=ring,sign=Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
  if(!sign)return [];
  const planes=[[0,1,0,-bottom],[0,-1,0,top]];
  for(let i=0;i<3;i++){const a=ring[i],b=ring[(i+1)%3],nx=-(b[1]-a[1])*sign,nz=(b[0]-a[0])*sign;
    planes.push([nx,0,nz,-nx*a[0]-nz*a[1]]);}
  return planes;
}
export function clipOutsidePrisms(attributes,prisms){
  // Subtract convex building prisms, splitting triangles at their actual edges.
  // Dropping whole triangles/trees leaves gaps; shrinking/moving trees changes
  // the surveyed layout. All attributes interpolate with the new edge vertices.
  const names=Object.keys(attributes),sizes=names.map(n=>attributes[n].size),offsets=[];
  let stride=0;for(const size of sizes){offsets.push(stride);stride+=size;}
  const pOffset=offsets[names.indexOf('position')],out=Object.fromEntries(names.map(n=>[n,[]]));
  const vertex=i=>names.flatMap((name,j)=>Array.from(attributes[name].array.slice(i*sizes[j],(i+1)*sizes[j])));
  const distance=(v,p)=>p[0]*v[pOffset]+p[1]*v[pOffset+1]+p[2]*v[pOffset+2]+p[3];
  const split=(poly,plane,inside)=>{
    const result=[];for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a,plane),db=distance(b,plane),ia=inside?da>=0:da<=0,ib=inside?db>=0:db<=0;
      if(ia)result.push(a);
      if(ia!==ib){const t=da/(da-db);result.push(a.map((v,k)=>v+(b[k]-v)*t));}
    }return result;
  };
  for(let i=0;i<attributes.position.array.length/3;i+=3){
    let polys=[[vertex(i),vertex(i+1),vertex(i+2)]];
    for(const prism of prisms){
      if(!prism.length)continue;const next=[];
      for(const polygon of polys){
        // Most triangles miss most prisms: reject without allocating split lists.
        if(prism.some(p=>polygon.every(v=>distance(v,p)<=1e-8))){next.push(polygon);continue;}
        let remaining=polygon;
        for(const plane of prism){if(remaining.length<3)break;const outside=split(remaining,plane,false);
          if(outside.length>=3)next.push(outside);remaining=split(remaining,plane,true);}
      }polys=next;if(!polys.length)break;
    }
    for(const poly of polys)for(let k=1;k+1<poly.length;k++){
      const tri=[poly[0],poly[k],poly[k+1]],u=[0,1,2].map(i=>tri[1][pOffset+i]-tri[0][pOffset+i]),v=[0,1,2].map(i=>tri[2][pOffset+i]-tri[0][pOffset+i]);
      if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-10)continue;
      for(const vertex of tri)names.forEach((name,j)=>out[name].push(...vertex.slice(offsets[j],offsets[j]+sizes[j])));
    }
  }
  return out;
}

//: Leaf cards lit as the crown they make up rather than as so many flat cards: each card's
//: normal is mostly the direction out from the middle of the foliage (a little of its own face
//: kept), so a crown shades round from its sunny side to its shadowed one and does not read as
//: paper. The usual foliage trick; it changes lighting only, never a position.
export function foliageNormals(position,normal,keep=.3){
  let cx=0,cy=0,cz=0;const n=position.length/3;if(!n)return normal;
  for(let i=0;i<position.length;i+=3){cx+=position[i];cy+=position[i+1];cz+=position[i+2];}
  cx/=n;cy/=n;cz/=n;
  for(let i=0;i<position.length;i+=3){
    let x=position[i]-cx,y=(position[i+1]-cy)*1.4,z=position[i+2]-cz,l=Math.hypot(x,y,z)||1;
    const face=[normal[i],normal[i+1],normal[i+2]],flip=face[0]*x+face[1]*y+face[2]*z<0?-1:1;
    x=x/l*(1-keep)+face[0]*flip*keep;y=y/l*(1-keep)+face[1]*flip*keep;z=z/l*(1-keep)+face[2]*flip*keep;
    l=Math.hypot(x,y,z)||1;normal[i]=x/l;normal[i+1]=y/l;normal[i+2]=z/l;
  }
  return normal;
}
// ---- leaves, painted as a leaf is built ----
//
// A leaf is a blade on a petiole, its veins a tree of their own: the midrib up the middle,
// thick at the base and fine at the tip; secondary veins leaving it alternately and arching up
// towards the margin, where each bends forward to join the one above (the loops of a
// brochidodromous leaf, as most broadleaves are); tertiary veins laddered across between them;
// and the finest network filling every space. Each vein stands a little proud of the blade, so
// the normal map catches the light along it the way a real leaf does. The blade is painted
// pale -- the instance or vertex colour makes it green -- and no two leaves are alike: each has
// its own length, breadth, asymmetry, shade, a touch of yellow or blue in its green, and now
// and then one turned over, showing the paler underside where its veins stand out most.
//: Blade forms. ratio: breadth over length; widest: where along it the blade is broadest;
//: teeth: serrations a side (0, an entire margin); veins: secondary pairs.
export const LEAF_FORMS={
  broad:{ratio:.56,widest:.42,teeth:0,veins:8,tip:1.4},
  street:{ratio:.62,widest:.38,teeth:22,veins:7,tip:1.2},
  narrow:{ratio:.2,widest:.4,teeth:0,veins:14,tip:1.8},
  oak:{ratio:.62,widest:.5,teeth:7,veins:6,tip:1},
};
//: The blade's half-width at t (0 base, 1 tip) as a share of its length.
export function leafHalfWidth(form,t){
  const f=LEAF_FORMS[form]||LEAF_FORMS.broad;if(t<=0||t>=1)return 0;
  const u=t<f.widest?t/f.widest:(1-t)/(1-f.widest);
  const shape=t<f.widest?Math.sin(u*Math.PI/2)**.8:Math.sin(u*Math.PI/2)**f.tip;
  return f.ratio/2*shape;
}
//: The blade's outline in leaf units (petiole at (0, 0), tip at (0, 1)), with its teeth and a
//: little asymmetry of its own. [[x, y], ...] round the margin.
export function leafOutline(form,rnd){
  const f=LEAF_FORMS[form]||LEAF_FORMS.broad,n=72,skew=1+(rnd()-.5)*.14,right=[],left=[];
  for(let k=0;k<=n;k++){
    const t=k/n;let w=leafHalfWidth(form,t);
    if(f.teeth&&t>.12&&t<.96){const p=(t*f.teeth)%1;w*=1-(form==='oak'?.18:.07)*(p<.7?p/.7:(1-p)/.3);}
    right.push([w*skew,t]);left.push([-w/skew,t]);
  }
  return right.concat(left.reverse());
}
function leafPath(ctx,outline,len){ctx.beginPath();outline.forEach(([x,y],i)=>i?ctx.lineTo(x*len,-y*len):ctx.moveTo(x*len,-y*len));ctx.closePath();}
//: One leaf onto the colour canvas `c` and the height canvas `h`, at (x, y), pointing along
//: `angle`, `len` pixels long. tone: [r, g, b] of the blade (pale, 0..255).
export function paintLeaf(c,h,{x,y,angle,len,form='broad',tone=[214,222,196],underside=false,squeeze=1,rnd}){
  const f=LEAF_FORMS[form]||LEAF_FORMS.broad,outline=leafOutline(form,rnd);
  const rgb=(k,a=1)=>`rgba(${tone.map(v=>Math.max(0,Math.min(255,Math.round(v*k)))).join(',')},${a})`;
  for(const [g,height] of [[c,false],[h,true]]){
    g.save();g.translate(x,y);g.rotate(angle);g.scale(squeeze,1);
    // The petiole.
    g.strokeStyle=height?'rgb(150,150,150)':rgb(.86);g.lineWidth=Math.max(1,len*.028);g.lineCap='round';
    g.beginPath();g.moveTo(0,len*.13);g.quadraticCurveTo(len*.02,len*.05,0,0);g.stroke();
    // The blade, a little darker at its margin and lighter along its middle.
    leafPath(g,outline,len);
    if(height){const r=g.createRadialGradient(0,-len*.45,len*.05,0,-len*.45,len*.6);r.addColorStop(0,'rgb(150,150,150)');r.addColorStop(1,'rgb(108,108,108)');g.fillStyle=r;}
    else{const w=f.ratio*len/2,lg=g.createLinearGradient(-w,0,w,0),k=underside?1.1:1;
      lg.addColorStop(0,rgb(.84*k));lg.addColorStop(.5,rgb(1.0*k));lg.addColorStop(1,rgb(.88*k));g.fillStyle=lg;}
    g.fill();g.save();leafPath(g,outline,len);g.clip();
    if(!height){
      // Mottling: the blade is not one even colour.
      for(let m=0;m<26;m++){const mx=(rnd()-.5)*f.ratio*len,my=-rnd()*len,r=len*(.04+rnd()*.1);
        g.fillStyle=rgb(rnd()<.5?.9:1.08,.08+rnd()*.07);g.beginPath();g.ellipse(mx,my,r,r*.6,rnd()*3,0,6.283);g.fill();}
    }
    // Veins: lighter than the blade on both faces, raised on the height map.
    const vein=(k,a)=>height?`rgba(${k},${k},${k},${a})`:rgb(underside?1.16:1.1,a);
    const vy=t=>-t*len;
    // The finest network first, under the rest.
    const fine=Math.round(len*len/260);
    for(let q=0;q<fine;q++){
      const t=.04+rnd()*.92,hw=leafHalfWidth(form,t)*len,sx=(rnd()*2-1)*hw*.92,sy=vy(t),a=rnd()*6.283,l=len*(.02+rnd()*.035);
      g.strokeStyle=vein(150,underside?.5:.32);g.lineWidth=Math.max(.5,len*.0035);
      g.beginPath();g.moveTo(sx,sy);g.lineTo(sx+Math.cos(a)*l,sy+Math.sin(a)*l);g.lineTo(sx+Math.cos(a+1.4)*l*1.2,sy+Math.sin(a+1.4)*l*1.2);g.stroke();
    }
    // Secondary veins, alternate, arching to the margin and looping into the next.
    const pairs=f.veins,stations=[];
    for(let s=0;s<pairs;s++)stations.push(.08+(s+.3+(rnd()-.5)*.3)/pairs*.82);
    for(const side of [1,-1]){
      let prevEnd=null;
      stations.forEach((t0,s)=>{
        const t=Math.min(.95,t0+(side>0?0:.5/pairs*.82));
        const reach=.86*leafHalfWidth(form,Math.min(.97,t+.1))*len,ey=vy(Math.min(.97,t+(form==='narrow'?.22:.13)));
        const sw=Math.max(.7,len*(.011-.006*t)),sy=vy(t),mid=[side*reach*.55,(sy+ey)/2+len*.02];
        g.strokeStyle=vein(205,underside?.95:.85);
        g.lineWidth=sw;g.beginPath();g.moveTo(0,sy);g.quadraticCurveTo(mid[0],mid[1],side*reach,ey);g.stroke();
        if(prevEnd){g.lineWidth=sw*.55;g.beginPath();g.moveTo(...prevEnd);g.quadraticCurveTo(side*(Math.abs(prevEnd[0])+reach)/2*1.06,(prevEnd[1]+ey)/2,side*reach*.94,ey+len*.03);g.stroke();}
        // Tertiary veins laddered across to the next secondary.
        const next=stations[s+1];if(next!==undefined){
          const rungs=Math.max(2,Math.round(len/38));
          for(let r=1;r<=rungs;r++){const u=r/(rungs+1),ax=side*reach*u*.9,ay=sy+(ey-sy)*u-len*.01,by=ay-(vy(t)-vy(Math.min(.95,next)))*.85;
            g.lineWidth=Math.max(.5,len*.005);g.globalAlpha=height?.8:.6;g.beginPath();g.moveTo(ax,ay);
            g.quadraticCurveTo(ax+side*len*.015*(rnd()-.3),(ay+by)/2,ax+side*len*.01,by);g.stroke();g.globalAlpha=1;}
        }
        prevEnd=[side*reach,ey];
      });
    }
    // The midrib, thick at the base and fine at the tip.
    for(let k=0;k<12;k++){const t0=k/12,t1=(k+1)/12;g.strokeStyle=height?vein(230,1):rgb(underside?1.14:1.07);
      g.lineWidth=Math.max(.8,len*(.021-.017*t0));g.beginPath();g.moveTo(0,vy(t0));g.lineTo(0,vy(t1));g.stroke();}
    g.restore();
    // A fine dark edge, where the blade turns away.
    leafPath(g,outline,len);g.strokeStyle=height?'rgba(80,80,80,.9)':rgb(.62,.55);g.lineWidth=Math.max(.6,len*.006);g.stroke();
    g.restore();
  }
}
//: The relief of a height canvas as a tangent-space normal map (a canvas of the same size).
export function normalsFromHeight(h,strength=2.2){
  const w=h.canvas.width,H=h.canvas.height,src=h.getImageData(0,0,w,H).data,out=h.createImageData(w,H),d=out.data;
  const at=(x,y)=>src[((Math.min(H-1,Math.max(0,y)))*w+Math.min(w-1,Math.max(0,x)))*4]/255;
  for(let y=0;y<H;y++)for(let x=0;x<w;x++){
    const dx=(at(x+1,y)-at(x-1,y))*strength,dy=(at(x,y+1)-at(x,y-1))*strength,l=Math.hypot(dx,dy,1),i=(y*w+x)*4;
    d[i]=Math.round((-dx/l*.5+.5)*255);d[i+1]=Math.round((dy/l*.5+.5)*255);d[i+2]=Math.round((1/l*.5+.5)*255);d[i+3]=255;}
  return out;
}
//: Bark, by species form: how its surface is cut. Each is a network of cells over the tile --
//: cells `cells` across and up, stretched up the trunk -- whose edges are the cracks: long
//: narrow cells are the ridges and fissures of oak and fir, short wide ones the plates of
//: pine, very long thin ones the fibres of redwood and cypress; `fine` is a second, shallower
//: network inside the first (flakes on a plate, checks on a ridge). 'smooth' is a skin with
//: lenticels (bay, acacia, a street tree), 'peeling' the blue gum's patches of grey, cream and
//: olive, 'rings' a palm's leaf scars. `crevice` and `ridge` multiply the species' bark colour
//: (the instance's), so one texture serves every shade of a species. The fine grain under it
//: all is a photograph (BARK_GRAIN_URL), where the page can load one.
export const BARK_STYLES={
  oak:       {kind:'cracked',cells:[7,3],crack:.34,fine:[16,9,.35],depth:1,crevice:[.30,.28,.27],ridge:[1.16,1.14,1.10]},
  fir:       {kind:'cracked',cells:[5,2],crack:.42,fine:[12,6,.30],depth:1.15,crevice:[.42,.24,.15],ridge:[1.12,1.04,.98]},
  willow:    {kind:'cracked',cells:[9,4],crack:.30,fine:[18,10,.3],depth:.85,crevice:[.40,.40,.38],ridge:[1.12,1.10,1.06]},
  pine:      {kind:'cracked',cells:[4,5],crack:.10,fine:[11,13,.45],depth:1.1,crevice:[.20,.16,.14],ridge:[1.22,1.08,.95],dome:.5},
  redwood:   {kind:'cracked',cells:[16,1],crack:.30,fine:[34,3,.4],depth:1,crevice:[.40,.28,.22],ridge:[1.20,1.08,1.00]},
  cypress:   {kind:'cracked',cells:[20,2],crack:.26,fine:[40,4,.35],depth:.8,crevice:[.46,.42,.40],ridge:[1.14,1.10,1.06]},
  broadleaf: {kind:'smooth',depth:.5,crevice:[.60,.58,.56],ridge:[1.08,1.06,1.04]},
  eucalyptus:{kind:'peeling',depth:.55,crevice:[.72,.68,.62],ridge:[1.08,1.06,1.03]},
  palm:      {kind:'rings',rings:9,depth:.8,crevice:[.55,.50,.45],ridge:[1.12,1.08,1.02]},
};
export const BARK_GRAIN_URL='nature/bark/bark-grain.jpg';
//: Value noise that tiles: `px` by `py` lattice cells over the unit square.
function tiledNoise(px,py,seed){
  const v=(i,j)=>noiseHash(((i%px)+px)%px,((j%py)+py)%py,seed);
  return (x,y)=>{const fx=x*px,fy=y*py,i=Math.floor(fx),j=Math.floor(fy),u=fx-i,w=fy-j;
    const su=u*u*(3-2*u),sw=w*w*(3-2*w);
    return (v(i,j)*(1-su)+v(i+1,j)*su)*(1-sw)+(v(i,j+1)*(1-su)+v(i+1,j+1)*su)*sw;};
}
function tiledFbm(px,py,seed,octaves=4){
  const layers=Array.from({length:octaves},(_,k)=>tiledNoise(px<<k,py<<k,seed+k*131));
  return (x,y)=>{let a=0,s=0,amp=1;for(const n of layers){a+=n(x,y)*amp;s+=amp;amp*=.5;}return a/s;};
}
//: A cell network that tiles: for (u, v), the distance to the nearest cell's point and to the
//: second nearest (in cell widths), and which cell is nearest.
function tiledCells(cx,cy,seed){
  const pts=[];for(let j=0;j<cy;j++)for(let i=0;i<cx;i++)pts.push([(i+.1+.8*noiseHash(i,j,seed))/cx,(j+.1+.8*noiseHash(i,j,seed+1))/cy]);
  return (u,v)=>{let f1=9,f2=9,id=0;const ci=Math.floor(u*cx),cj=Math.floor(v*cy);
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
      const i=((ci+di)%cx+cx)%cx,j=((cj+dj)%cy+cy)%cy,p=pts[j*cx+i];
      // The neighbour across the tile's edge is the cell on the far side, moved over a tile.
      const dist=Math.hypot((p[0]+(ci+di-i)/cx-u)*cx,(p[1]+(cj+dj-j)/cy-v)*cy);
      if(dist<f1){f2=f1;f1=dist;id=j*cx+i;}else if(dist<f2)f2=dist;}
    return [f1,f2,id];};
}
//: The bark's surface, tiling both ways: a height (0 deep, 1 proud) and a colour multiplier
//: per pixel, `w` by `h` (h is twice w: the tile is BARK_TILE_M, twice as tall as wide).
//: `grain`, if given, is the photograph's fine relief (w by h, mean 1), laid over the pattern.
export function barkField(style,w=256,h=512,seed=1,grain=null){
  const S=BARK_STYLES[style]||BARK_STYLES.broadleaf,height=new Float32Array(w*h),colour=new Float32Array(w*h*3);
  const detail=tiledFbm(16,32,seed+7,4),warpX=tiledFbm(4,6,seed+11,3),warpY=tiledFbm(4,6,seed+13,3),mottle=tiledFbm(4,6,seed+17,3);
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const coarse=S.cells?tiledCells(S.cells[0],S.cells[1],seed+19):null,fine=S.fine?tiledCells(S.fine[0],S.fine[1],seed+23):null;
  const patches=S.kind==='peeling'?tiledCells(3,4,seed+29):null,lenticels=S.kind==='smooth'?tiledCells(12,40,seed+31):null;
  const checks=S.kind==='smooth'?tiledCells(6,3,seed+41):null;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=x/w,v=y/h,d=detail(u,v);let ht=.5,tone=1;
    // The cracks wander: the network is sampled through a gentle warp.
    const wu=((u+(warpX(u,v)-.5)*.08)%1+1)%1,wv=((v+(warpY(u,v)-.5)*.05)%1+1)%1;
    if(S.kind==='cracked'){
      const [f1,f2,id]=coarse(wu,wv),edge=f2-f1;
      // A ridge is rounded over, a fissure deep and narrow; inside it, shallower checks.
      ht=Math.pow(smooth(0,S.crack,edge),.7)*(S.dome?1-S.dome*.5*f1*f1:1);
      const [g1,g2]=fine(wu,wv);ht-=(1-smooth(0,.12,g2-g1))*S.fine[2]*smooth(.1,.4,ht);
      ht=ht*.82+d*.18;tone=.88+.24*noiseHash(id,0,seed+37);
    }else if(S.kind==='smooth'){
      // A skin: a little relief, dark lenticels lying across the trunk, faint checks.
      const [l1]=lenticels(wu,wv),[f1,f2]=checks(wu,wv);
      ht=.62+.22*(d-.5)-.28*(1-smooth(.0,.05,f2-f1))-.3*(1-smooth(.12,.22,l1));
      tone=.9+.2*mottle(u,v);
    }else if(S.kind==='peeling'){
      // Patches of new and old bark; an old patch's edge lifts as it curls away.
      const [f1,f2,id]=patches(wu,wv),edge=f2-f1;
      ht=.55+.1*(d-.5)+.18*(1-smooth(0,.06,edge))-.22*(1-smooth(0,.025,edge));
      const age=noiseHash(id,1,seed+43);tone=.8+.35*age;
    }else if(S.kind==='rings'){
      const r=v*S.rings*2+(warpX(u,v)-.5)*.5,f=r-Math.floor(r);
      ht=smooth(0,.25,f)*(1-smooth(.75,1,f))*.85+d*.15;
    }
    const i=y*w+x,g=grain?grain[i]:1;
    // The photograph's grain is the bark's own fine relief: more of it on the ridges.
    ht=Math.max(0,Math.min(1,.5+(ht-.5)*S.depth+(g-1)*(.10+.12*ht)));
    height[i]=ht;
    const lit=smooth(.08,.8,ht),shade=(.86+.28*d)*tone*(grain?Math.max(.4,Math.min(1.6,g)):1);
    for(let c=0;c<3;c++)colour[i*3+c]=(S.crevice[c]+(S.ridge[c]-S.crevice[c])*lit)*shade;
    if(S.kind==='peeling'){const m=mottle(u,v),olive=smooth(.6,.78,m)*(tone<.95?1:.3),cream=1-smooth(.25,.42,m);
      colour[i*3]*=1+.10*cream-.12*olive;colour[i*3+1]*=1+.06*cream-.02*olive;colour[i*3+2]*=1-.02*cream-.20*olive;}
  }
  return {height,colour,w,h};
}
//: The bark's textures: a colour multiplier (stored linear, over BARK_GAIN so a ridge can be
//: brighter than the species colour) and a normal map from the height, both tiling. `grain`
//: is the photograph's fine relief, if loaded (barkGrain); without it the pattern alone.
export const BARK_GAIN=1.4;
export function barkTextures(THREE,{style='broadleaf',width=256,seed=1,grain=null}={}){
  const f=barkField(style,width,width*2,seed,grain),{w,h}=f;
  const make=()=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  const colourCanvas=make(),normalCanvas=make(),ci=colourCanvas.getContext('2d').createImageData(w,h),ni=normalCanvas.getContext('2d').createImageData(w,h);
  const at=(x,y)=>f.height[((y+h)%h)*w+((x+w)%w)];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,o=i*4;
    for(let c=0;c<3;c++)ci.data[o+c]=Math.round(Math.min(1,f.colour[i*3+c]/BARK_GAIN)*255);ci.data[o+3]=255;
    const dx=(at(x+1,y)-at(x-1,y))*4,dy=(at(x,y+1)-at(x,y-1))*4,l=Math.hypot(dx,dy,1);
    ni.data[o]=Math.round((-dx/l*.5+.5)*255);ni.data[o+1]=Math.round((dy/l*.5+.5)*255);ni.data[o+2]=Math.round((1/l*.5+.5)*255);ni.data[o+3]=255;}
  colourCanvas.getContext('2d').putImageData(ci,0,0);normalCanvas.getContext('2d').putImageData(ni,0,0);
  const texture=(canvas)=>{const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;};
  return {map:texture(colourCanvas),normalMap:texture(normalCanvas)};
}
//: The photograph's grain (BARK_GRAIN_URL: a fallen trunk's bark from a Poly Haven scan, CC0,
//: tiled), `width` by twice that, as relief about 1. Null where it cannot be had.
export async function barkGrain(url,width=256){
  try{
    const image=new Image();image.crossOrigin='anonymous';image.src=url;await image.decode();
    const c=document.createElement('canvas');c.width=width;c.height=width*2;const x=c.getContext('2d',{willReadFrequently:true});
    x.drawImage(image,0,0,width,width*2);const d=x.getImageData(0,0,width,width*2).data,out=new Float32Array(width*width*2);
    for(let i=0;i<out.length;i++)out[i]=d[i*4]/255*2;
    return out;
  }catch(error){return null;}
}
//: Leaves that stay leaves at a distance. A cut-out leaf is kept where its texture's alpha
//: passes the material's alphaTest; the smaller versions of the texture a far crown is drawn
//: from average each leaf's edge with the sky round it, so a crown of thin leaves thinned with
//: distance and then vanished, leaving its trunk standing bare -- the floating trunks of the
//: far wood. The alpha is raised by how far down those versions the texture is read, so a far
//: crown keeps the cover it has close to. `size` is the texture's width in pixels.
export function keepLeavesAtDistance(material,size=1024,gain=.45){
  if(material.userData.leavesKept)return material;material.userData.leavesKept=true;
  const before=material.onBeforeCompile,key=material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile=function(shader,renderer){
    if(before)before.call(this,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
#ifdef USE_MAP
{vec2 texel=vMapUv*${size.toFixed(1)};float lod=log2(max(max(length(dFdx(texel)),length(dFdy(texel))),1.0));
diffuseColor.a=min(1.0,diffuseColor.a*(1.0+${gain.toFixed(2)}*lod));}
#endif`);
  };
  material.customProgramCacheKey=function(){return `${key?key():''}|leaves-kept-v1`;};
  material.needsUpdate=true;return material;
}
//: A card of leaves on twigs: { map, normalMap } textures, `size` pixels square. layout
//: 'spray': a few twigs of large leaves, a branch-end seen close (street trees); 'crown': many
//: twigs of smaller leaves, a piece of a crown (the landscape's trees).
export function leafCardTextures(THREE,{form='broad',layout='spray',size=1024,seed=1}={}){
  const make=()=>{const cv=document.createElement('canvas');cv.width=cv.height=size;return cv;};
  const colour=make(),relief=make(),c=colour.getContext('2d'),h=relief.getContext('2d',{willReadFrequently:true});
  h.fillStyle='rgb(128,128,128)';h.fillRect(0,0,size,size);
  let n=seed*7919;const rnd=()=>noiseHash(++n,seed,2207);
  const twigs=layout==='spray'?6:30,per=layout==='spray'?(form==='narrow'?9:6):(form==='narrow'?14:10);
  const base=layout==='spray'?size*.24:size*(form==='narrow'?.11:.085);
  // Twigs spread over the card: one in each cell of a grid, placed at random within it, so the
  // card is foliage all over rather than a clump in one corner.
  const cols=Math.ceil(Math.sqrt(twigs));
  for(let j=0;j<twigs;j++){
    const x=size*((j%cols+.15+rnd()*.7)/cols),y=size*((Math.floor(j/cols)+.15+rnd()*.7)/Math.ceil(twigs/cols)),a=rnd()*6.283,tl=base*(2.2+rnd()*1.4);
    const ux=Math.cos(a),uy=Math.sin(a);
    c.strokeStyle='rgb(128,112,92)';c.lineWidth=Math.max(1.5,base*.035);c.lineCap='round';
    c.beginPath();c.moveTo(x-ux*tl/2,y-uy*tl/2);c.lineTo(x+ux*tl/2,y+uy*tl/2);c.stroke();
    h.strokeStyle='rgb(170,170,170)';h.lineWidth=c.lineWidth;h.beginPath();h.moveTo(x-ux*tl/2,y-uy*tl/2);h.lineTo(x+ux*tl/2,y+uy*tl/2);h.stroke();
    for(let k=0;k<per;k++){
      const t=(k+.5)/per-.5,side=k%2?1:-1,len=base*(.75+rnd()*.45)*(k===per-1?1.1:1);
      // Each leaf its own: a shade, a hint of yellow or blue, its breadth, and now and then its underside.
      const shade=.86+rnd()*.24,warm=(rnd()-.5)*.16,underside=rnd()<.14;
      const tone=[214*(shade+warm),222*shade,196*(shade-warm*.6)].map(v=>underside?v*1.06+10:v);
      // The petiole's end on the twig, the blade beyond it.
      const angle=a+Math.PI/2+side*(.55+rnd()*.55)+(k===per-1?-side*.6:0),stalk=len*.13;
      paintLeaf(c,h,{x:x+ux*t*tl+Math.sin(angle)*stalk,y:y+uy*t*tl-Math.cos(angle)*stalk,angle,len,form,tone,underside,
        squeeze:.78+rnd()*.3,rnd});
    }
  }
  // A leaf's surface is not flat colour: a fine grain of cells over every blade (drawn only
  // where a leaf is), and the same grain faintly in the relief.
  const grain=document.createElement('canvas');grain.width=grain.height=128;const gg=grain.getContext('2d'),img=gg.createImageData(128,128);
  for(let i=0;i<img.data.length;i+=4){const v=96+Math.round(noiseHash(i>>2,seed,2213)*64);img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;}
  gg.putImageData(img,0,0);
  const mask=make(),mg=mask.getContext('2d');mg.fillStyle=mg.createPattern(grain,'repeat');mg.fillRect(0,0,size,size);
  mg.globalCompositeOperation='destination-in';mg.drawImage(colour,0,0);
  c.save();c.globalCompositeOperation='overlay';c.globalAlpha=.45;c.drawImage(mask,0,0);c.restore();
  h.save();h.globalAlpha=.12;h.globalCompositeOperation='overlay';h.fillStyle=h.createPattern(grain,'repeat');h.fillRect(0,0,size,size);h.restore();
  const map=new THREE.CanvasTexture(colour);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
  const nm=make();nm.getContext('2d').putImageData(normalsFromHeight(h),0,0);
  const normalMap=new THREE.CanvasTexture(nm);normalMap.anisotropy=8;
  return {map,normalMap};
}

// Raster leaf silhouettes only; tree shape is actual branched geometry, not spheres.
export function vegetationAssets(THREE,{grainUrl=null}={}){
  const textures=new Map(),cache=new Map();
  const normals=new Map();
  //: Bark, one material a form (BARK_STYLES), its tile wrapped round each limb (barkTube). The
  //: photograph's grain is laid in when it arrives; until then the pattern alone.
  const barks=new Map();let grain=null;
  function bark(style){
    if(!BARK_STYLES[style])style='broadleaf';
    if(barks.has(style))return barks.get(style);
    const t=barkTextures(THREE,{style,seed:style.length*13+5,grain});
    const m=new THREE.MeshStandardMaterial({color:new THREE.Color(BARK_GAIN,BARK_GAIN,BARK_GAIN),map:t.map,normalMap:t.normalMap,
      normalScale:new THREE.Vector2(1.3,1.3),roughness:.94,metalness:0});
    m.userData.barkStyle=style;barks.set(style,m);return m;
  }
  if(grainUrl&&typeof document!=='undefined')barkGrain(grainUrl).then(g=>{if(!g)return;grain=g;
    for(const [style,m] of barks){const t=barkTextures(THREE,{style,seed:style.length*13+5,grain});
      m.map.dispose();m.normalMap.dispose();m.map=t.map;m.normalMap=t.normalMap;m.needsUpdate=true;}});
  //: The leaf card's normal map (veins standing proud), for a broadleaf; none for needles.
  function normalOf(species){texture(species);const form=SPECIES[species]?.form||species;return normals.get(form)||null;}
  function texture(species){
    const form=SPECIES[species]?.form||species,key=['pine','redwood','fir','cypress'].includes(form)?'needle':form;
    if(textures.has(key))return textures.get(key);
    if(key!=='needle'){
      // A piece of crown: twigs of leaves painted vein by vein (leafCardTextures).
      const leafForm=form==='oak'?'oak':form==='eucalyptus'||form==='willow'?'narrow':'broad';
      const pair=leafCardTextures(THREE,{form:leafForm,layout:'crown',size:1024,seed:key.length*31+7});
      textures.set(key,pair.map);normals.set(key,pair.normalMap);return pair.map;
    }
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
    if(key==='needle'){
      // Sprays of needles off twigs, darker at the base of each spray.
      for(let j=0;j<40;j++){
        const x=20+noiseHash(j,1,811)*216,y=20+noiseHash(j,2,811)*216,a=noiseHash(j,3,811)*6.283,len=48+noiseHash(j,4,811)*44;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle='rgb(150,140,120)';ctx.lineWidth=1.6;
        ctx.beginPath();ctx.moveTo(-len/2,0);ctx.lineTo(len/2,0);ctx.stroke();
        for(let k=0;k<34;k++){const t=k/33-.5,side=k%2?1:-1,l=10+noiseHash(j,k,823)*9,g=200+Math.round(noiseHash(j,k,829)*55);
          ctx.strokeStyle=`rgb(${g-14},${g},${g-20})`;ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(t*len,0);ctx.lineTo(t*len+l*.45,side*l);ctx.stroke();}
        ctx.restore();
      }
    }else{
      // Twigs with leaves along them -- a petiole, a pointed blade lit on one side, a midrib --
      // at a leaf's own size (a card is about a metre of crown, a leaf six to twelve centimetres).
      const narrow=form==='eucalyptus'||form==='willow',small=form==='cypress'||form==='oak';
      // Dense: a card is a piece of crown, mostly leaf with sky through the gaps, so a crown
      // reads as foliage from across a meadow and not as a scatter of specks.
      for(let j=0;j<34;j++){
        const x=16+noiseHash(j,1,811)*224,y=16+noiseHash(j,2,811)*224,a=noiseHash(j,3,811)*6.283,len=56+noiseHash(j,4,811)*50;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle='rgb(120,105,90)';ctx.lineWidth=1.8;
        ctx.beginPath();ctx.moveTo(-len/2,0);ctx.lineTo(len/2,0);ctx.stroke();
        const leaves=small?16:12;
        for(let k=0;k<leaves;k++){
          const t=(k+.5)/leaves-.5,side=k%2?1:-1,l=(small?15:22)+noiseHash(j,k,823)*(small?7:12),w=l*(narrow?.22:small?.45:.38);
          ctx.save();ctx.translate(t*len,0);ctx.rotate(side*(.65+noiseHash(j,k,827)*.5));
          const lit=205+Math.round(noiseHash(j,k,829)*50),g=ctx.createLinearGradient(-w,0,w,0);
          g.addColorStop(0,`rgb(${lit-40},${lit-28},${lit-46})`);g.addColorStop(1,`rgb(${lit},${Math.min(255,lit+10)},${lit-14})`);
          ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,2);
          ctx.bezierCurveTo(w,l*.25,w*.8,l*.8,0,l+2);ctx.bezierCurveTo(-w*.8,l*.8,-w,l*.25,0,2);ctx.fill();
          ctx.strokeStyle='rgba(90,100,70,.7)';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,l);ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }
    }
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;textures.set(key,t);return t;
  }
  function geometry(data,foliage=false){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));
    // A limb's own normals (barkTube), round; a card's from its faces.
    if(data.normal&&data.normal.length===data.position.length)g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normal,3));else g.computeVertexNormals();
    if(foliage)foliageNormals(g.getAttribute('position').array,g.getAttribute('normal').array);g.computeBoundingSphere();return g;}
  function tree(species,variant=0){
    const key=`${species}:${variant}`;if(cache.has(key))return cache.get(key);
    const model=botanicalGeometry(species,variant),spec=SPECIES[species];
    const parts=[{geometry:geometry(model.bark),material:bark(spec.form),colour:spec.bark},
      {geometry:geometry(model.leaf,true),material:keepLeavesAtDistance(new THREE.MeshStandardMaterial({map:texture(species),color:0xffffff,alphaTest:.28,side:THREE.DoubleSide,roughness:.82,
        ...(normalOf(species)?{normalMap:normalOf(species),normalScale:new THREE.Vector2(.9,.9)}:{})}),texture(species).image.width||1024),colour:spec.leaf.map(v=>v*1.15)}];
    cache.set(key,parts);return parts;
  }
  function undergrowth(kind){
    const key=`ground:${kind}`;if(cache.has(key))return cache.get(key);
    const part={geometry:geometry(plantGeometry(kind),true),material:new THREE.MeshStandardMaterial({color:0xffffff,side:THREE.DoubleSide,roughness:1,
      ...(kind==='fern'||kind==='bunchgrass'||kind==='sedge'?{}:{map:texture('oak'),alphaTest:.35})})};
    cache.set(key,part);return part;
  }
  //: The ground under trees: a litter patch is a flat card of fallen leaves, bark or needles,
  //: thick in the middle and thinning to nothing at its edge so patches overlap into a floor.
  function litterTexture(kind){
    const key=`litter:${kind}`;if(textures.has(key))return textures.get(key);
    const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');
    const at=(j,salt)=>{const a=noiseHash(j,salt,1301)*6.283,r=118*Math.pow(noiseHash(j,salt+1,1301),.75);return [128+Math.cos(a)*r,128+Math.sin(a)*r];};
    const browns=[[107,74,43],[138,106,62],[167,132,79],[90,61,34],[120,96,48],[150,140,80]];
    // No backing disc: the patch is only the things lying in it, thinning towards its edge, so
    // its outline is ragged and overlapping patches run together into a floor.
    for(let j=0;j<160;j++){const [x,y]=at(j,77),r=2+noiseHash(j,78,1301)*5,b=browns[(j+2)%4];
      ctx.fillStyle=`rgb(${b[0]-30},${b[1]-28},${b[2]-18})`;ctx.beginPath();ctx.ellipse(x,y,r,r*.7,noiseHash(j,79,1301)*3,0,6.283);ctx.fill();}
    if(kind==='needle_duff'){
      for(let j=0;j<1600;j++){const [x,y]=at(j,3),a=noiseHash(j,5,1301)*6.283,l=6+noiseHash(j,6,1301)*10,b=browns[j%4];
        ctx.strokeStyle=`rgb(${b[0]+30},${b[1]+10},${b[2]})`;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);ctx.stroke();}
    }else{
      const euc=kind==='eucalyptus_litter';
      if(euc)for(let j=0;j<26;j++){
        // Blue gum sheds its bark in long pale ribbons, curling as they dry.
        const [x,y]=at(j,40),a=noiseHash(j,41,1301)*6.283,l=40+noiseHash(j,42,1301)*60;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle=`rgb(${190+j%30},${170+j%25},${135+j%20})`;
        ctx.fillRect(-l/2,-3,l,6);ctx.fillStyle='rgba(110,90,70,.6)';ctx.fillRect(-l/2,1.5,l,1.5);ctx.restore();
      }
      for(let j=0;j<(euc?420:700);j++){
        const [x,y]=at(j,7),a=noiseHash(j,8,1301)*6.283,l=(euc?16:9)+noiseHash(j,9,1301)*(euc?10:8),w=euc?l*.16:l*.42;
        const b=euc?[[150,140,110],[170,150,110],[120,110,80]][j%3]:browns[j%browns.length],k=.8+noiseHash(j,10,1301)*.35;
        ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.fillStyle=`rgb(${Math.round(b[0]*k)},${Math.round(b[1]*k)},${Math.round(b[2]*k)})`;
        ctx.beginPath();ctx.moveTo(0,-l/2);
        if(euc){ctx.quadraticCurveTo(w*2.2,0,0,l/2);ctx.quadraticCurveTo(w*.6,0,0,-l/2);}
        else{ctx.bezierCurveTo(w,-l/4,w,l/4,0,l/2);ctx.bezierCurveTo(-w,l/4,-w,-l/4,0,-l/2);}
        ctx.fill();ctx.strokeStyle='rgba(60,40,25,.5)';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,-l/2);ctx.lineTo(0,l/2);ctx.stroke();ctx.restore();
      }
    }
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;textures.set(key,t);return t;
  }
  function litter(kind){
    const key=`litter:${kind}`;if(cache.has(key))return cache.get(key);
    const g=new THREE.PlaneGeometry(1,1);g.rotateX(-Math.PI/2);g.computeBoundingSphere();
    const part={geometry:g,material:new THREE.MeshStandardMaterial({map:litterTexture(kind),color:0xffffff,alphaTest:.45,roughness:1,
      polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4})};
    cache.set(key,part);return part;
  }
  //: Deadwood: a stick or a log lying along its own x axis, unit length and radius; a log's
  //: ends are left open and dark, the way the heart rots first.
  function deadwood(kind){
    const key=`deadwood:${kind}`;if(cache.has(key))return cache.get(key);
    const g=new THREE.CylinderGeometry(1,1,1,kind==='log'?9:5,1,kind!=='log');g.rotateZ(Math.PI/2);
    const pos=g.getAttribute('position');for(let i=0;i<pos.count;i++){const x=pos.getX(i);
      // A little crooked, so a stick is not a dowel.
      pos.setY(i,pos.getY(i)+Math.sin(x*5.1+1.3)*.35);pos.setZ(i,pos.getZ(i)+Math.sin(x*3.7)*.3);}
    g.computeVertexNormals();g.computeBoundingSphere();
    const part={geometry:g,material:new THREE.MeshStandardMaterial({color:kind==='log'?0x5b4a3a:0x6b5640,roughness:1})};
    cache.set(key,part);return part;
  }
  return {tree,undergrowth,litter,deadwood,bark};
}
