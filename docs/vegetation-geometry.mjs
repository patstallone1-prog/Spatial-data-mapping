// Render-only botanical forms. Unit crown radius and unit height let clearance use
// real bounding dimensions. No plant here claims to be an observed individual.
import {SPECIES,noiseHash} from './nature-ecology.mjs';
export {UNDERGROWTH,undergrowthAt,LITTER,litterScatter,litterKind} from './nature-ecology.mjs';

export function botanicalGeometry(species,variant=0){
  const form=SPECIES[species]?.form||species,bark={position:[],uv:[]},leaf={position:[],uv:[]};
  let seed=variant*887+Array.from(species).reduce((n,c)=>n+c.charCodeAt(0),0);
  const rnd=()=>noiseHash(++seed,variant,701);
  const triangle=(out,a,b,c,uv=[[0,0],[1,0],[1,1]])=>{out.position.push(...a,...b,...c);out.uv.push(...uv.flat());};
  const branch=(a,b,r0,r1)=>{
    const d=b.map((v,i)=>v-a[i]),L=Math.hypot(...d),u=[d[2],0,-d[0]];
    if(Math.hypot(...u)<1e-6)u.splice(0,3,1,0,0);
    const ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;
    const v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]].map(x=>x/L);
    const ring=(p,r,k)=>p.map((x,i)=>x+r*(u[i]*Math.cos(k*Math.PI/3)+v[i]*Math.sin(k*Math.PI/3)));
    for(let k=0;k<6;k++){
      const p=ring(a,r0,k),q=ring(a,r0,k+1),r=ring(b,r1,k+1),s=ring(b,r1,k);
      triangle(bark,p,q,r);triangle(bark,p,r,s);
    }
  };
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
    branch([0,0,0],trunkAt(1),.05,.006);
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
    branch([0,0,0],fork,.07,.05);
    // The leader carries on up the middle of a tall tree.
    if(['eucalyptus','pine'].includes(form))branch(fork,trunkAt(.82),.05,.02);
    for(let j=0;j<E.clumps;j++){
      // Clumps over the envelope's outer shell, some deeper in, none hollowing the middle.
      const a=j*2.39996+rnd()*.5,y=E.base+.08+(1-E.base-.12)*Math.pow(rnd(),.8);
      const shell=E.shape(y)*(.55+.40*Math.sqrt(rnd())),c=[Math.cos(a)*shell,y,Math.sin(a)*shell];
      const from=trunkAt(Math.min(y-.04,E.base+(y-E.base)*.45));
      const mid=[(from[0]+c[0])*.55,(from[1]+c[1])/2+.03,(from[2]+c[2])*.55];
      branch(from,mid,.035,.02);branch(mid,c,.02,.008);
      cluster(c,E.clump[0]*(.8+rnd()*.4),E.clump[1]*(.8+rnd()*.4),E.cards,E.droop||0);
    }
    // And the middle filled, so the crown is not hollow from below or through a gap.
    cluster(trunkAt((E.base+1)/2+.08),E.shape((E.base+1)/2)*.45,(1-E.base)*.22,Math.round(E.cards*1.2),E.droop||0);
  }
  // Scale the completed crown once, including cards, so advertised clearance is true.
  // The trunk stands at y = 0; a spray tipped below the ground is laid on it rather than the
  // whole tree lifted off the ground to make room for it.
  let radius=0,height=0;
  for(const g of [bark,leaf])for(let i=0;i<g.position.length;i+=3){g.position[i+1]=Math.max(0,g.position[i+1]);radius=Math.max(radius,Math.hypot(g.position[i],g.position[i+2]));height=Math.max(height,g.position[i+1]);}
  for(const g of [bark,leaf])for(let i=0;i<g.position.length;i+=3){g.position[i]/=radius;g.position[i+2]/=radius;g.position[i+1]/=height;}
  return {bark,leaf,species,form};
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
export function vegetationAssets(THREE){
  const textures=new Map(),cache=new Map();
  const normals=new Map();
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
  function geometry(data,foliage=false){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));g.computeVertexNormals();
    if(foliage)foliageNormals(g.getAttribute('position').array,g.getAttribute('normal').array);g.computeBoundingSphere();return g;}
  function tree(species,variant=0){
    const key=`${species}:${variant}`;if(cache.has(key))return cache.get(key);
    const model=botanicalGeometry(species,variant),spec=SPECIES[species];
    const parts=[{geometry:geometry(model.bark),material:new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),colour:spec.bark},
      {geometry:geometry(model.leaf,true),material:new THREE.MeshStandardMaterial({map:texture(species),color:0xffffff,alphaTest:.28,side:THREE.DoubleSide,roughness:.82,
        ...(normalOf(species)?{normalMap:normalOf(species),normalScale:new THREE.Vector2(.9,.9)}:{})}),colour:spec.leaf.map(v=>v*1.15)}];
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
  return {tree,undergrowth,litter,deadwood};
}
