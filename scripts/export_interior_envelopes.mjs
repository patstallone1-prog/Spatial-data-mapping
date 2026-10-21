// Execute Kerbside's actual facade rules, rather than a second window generator.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
const source=fs.readFileSync(new URL('scripts/build_sf_corridor_3d.py',root),'utf8');
const names=['random','xy','pageToTerrain','rawTerrainHeightAt','groundBaseFor','entryFloorY','insideFootprint','buildingAt','frontageNormalFor','frontageFitFor','homeStoreyCount','homeStoreyHeight','regularHomeWindows','frontageWindowsOnEdge','homeWindowLayout','photographedEdge','balconyPart','balconyProposal','inferredBalconies','footprintWalls','bestFacadeWall','wallPoint','garagesOnWall','streetDistanceFacing','frontDoorSpot','indexJunctionVertices','isUnmarkedService','isTunnelWay','distanceToSegmentSquared','garageSpansOnEdge','doorOn','photoEntryDoor','settleDoors'];
const functions=names.map(n=>{const match=source.match(new RegExp(`function ${n}\\([^\n]*?\{[^\n]*?\}[^\n]*$`,'m')) || source.match(new RegExp(`function ${n}\\([^]*?\\n}`));if(!match)throw Error(`missing canonical ${n}`);return match[0];}).join('\n');
const DATA=read('docs/sf-corridor-3d.json'),meta=read('docs/sf-corridor-terrain.json'),bytes=fs.readFileSync(new URL('docs/sf-corridor-terrain.bin',root));
const FRONTAGE_FITS={schema:'kerbside.facade_fits/1',buildings:{}};
for(const tile of read('docs/sf-corridor-frontage-fits.manifest.json').tiles)if(tile.region==='sf-corridor')Object.assign(FRONTAGE_FITS.buildings,read('docs/'+tile.path).buildings);
const context=vm.createContext({DATA,FRONTAGE_FITS,HOME_OPENINGS:read('docs/sf-corridor-home-openings.json'),TERRAIN:{meta,data:new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2)},console});
vm.runInContext(`const bbox=DATA.bbox,midLon=(bbox.west+bbox.east)/2,midLat=(bbox.south+bbox.north)/2,metersPerLat=111320,metersPerLon=metersPerLat*Math.cos(midLat*Math.PI/180);
const TERRAIN_FRAME=TERRAIN.meta.frame,OPEN_WATER_GROUND_M=-.14,HOME_STOREY_MAX_M=7,HILLSIDE_RISE_M=1.2,WINDOW_GROUND_CLEAR_M=.45,FRONT_DOOR_PANEL_W_M=3.2,DOOR_HEIGHT_M=2.1,GARAGE_HEIGHT_M=2.7,DOOR_LEAF_M=1.05,DOOR_CLEAR_M=.35,FOOTPRINT_CELL=40,JUNCTION_CELL_M=20,FACADE_PHOTOS=false;
const INFERRED_BALCONY_DEPTH_M=.9,INFERRED_BALCONY_COLOUR='#2b2d30',BALCONY_MIN_BOX_M=1,BALCONY_MIN_FLOOR_M=2.4;
let junctionVertexGrid=null;const footprintGrid=new Map(),UNMARKED_SERVICE=new Set(['driveway','drive-through','parking_aisle','access']);
${functions}
function rotatedBoxPart(group,x,y,z,w,h,d,colour,roughness,yaw){group.push({x,y,z,w,h,d,colour,roughness,yaw});}
function terrainHeightAt(x,z){return rawTerrainHeightAt(x,z);}function terrainGroundAt(x,z){return terrainHeightAt(x,z);}
const entries=new Map();for(const way of DATA.ways){if(way.kind!=='building'||!way.points?.length)continue;
const local=way.points.map(p=>{const [x,y]=xy(...p);return [x,-y];}),xs=local.map(p=>p[0]),zs=local.map(p=>p[1]);
const e={way,local,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};entries.set(String(way.osm_id),e);
for(let x=Math.floor(e.minX/FOOTPRINT_CELL);x<=Math.floor(e.maxX/FOOTPRINT_CELL);x++)for(let z=Math.floor(e.minZ/FOOTPRINT_CELL);z<=Math.floor(e.maxZ/FOOTPRINT_CELL);z++){const k=x+':'+z;if(!footprintGrid.has(k))footprintGrid.set(k,[]);footprintGrid.get(k).push(e);}}
`,context);
context.fits=read('docs/sf-corridor-interiors.json').buildings;
context.inputs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const result=vm.runInContext(`inputs.map(row=>{
if(!row.osm_id)return null;const entry=entries.get(row.osm_id);if(!entry)throw Error('missing mapped shell');entry.fit=fits[row.osm_id];
const way=entry.way,seed=Math.round(way.points[0][0]*1e5+way.points[0][1]*1e5*7919),base=groundBaseFor(way.points);
if(!frontageFitFor(way)){const spot=frontDoorSpot(way);if(spot){const anchor=wallPoint(spot.wall,spot.along);way._frontDoor={x:anchor.x,z:anchor.z};}}
entry.doors=(entry.fit?.[13]||[]).map(([edge,t,width,source])=>doorOn(entry,edge,t,width,source)).filter(Boolean);settleDoors(entry);
const layout=homeWindowLayout(entry,{base,height:Number(way.height_m),seed});if(!layout)throw Error('no habitable shell');
const [ox,oy]=xy(...row.origin_lon_lat),local=p=>[p[0]-ox,-p[1]-oy];
const count=homeStoreyCount(entry,layout.top-layout.floor),height=(layout.top-layout.floor)/count;
const windows=layout.edges.flatMap(e=>e.windows.map((o,i)=>({...o,id:row.id+':window:'+e.edge+':'+i,edge:e.edge,a:local(e.a),b:local(e.b),v:o.v-layout.floor,normal:[-e.nx,e.nz]})));
const fit=frontageFitFor(way),balconies=[];
if(fit){const [ax,ay]=xy(...fit.a),[bx,by]=xy(...fit.b),L=Math.hypot(bx-ax,by-ay),out=frontageNormalFor(fit);const reviewed=(fit.details||[]).filter(d=>d.render&&['balcony','fire_escape'].includes(d.kind));
for(const d of reviewed.length?fit.details||[]:inferredBalconies(fit,L)){if(!out||(!d.inferred&&(!d.render||!d.visible||!d.reviewer||d.image_sha256!==fit.image_sha256))||!['balcony','fire_escape'].includes(d.kind)||![d.u,d.w,d.depth_m].every(Number.isFinite)||d.depth_m<=0||d.depth_m>2.5)continue;
for(const y of d.platform_heights_m||[])if(y>0&&y<=fit.height_m-1.2)balconies.push({...d,a:local([ax,-ay]),b:local([bx,-by]),normal:[out[0],-out[1]],elevation_m:base+y-layout.floor,grade:d.inferred?'image_proposal_not_measured':'reviewed_image_on_prior_geometry'});}}
if(!fit&&way.height_m>7.5&&random(seed+701)<.34){const wall=footprintWalls(way.points).filter(w=>w.nz>.38&&w.span>5.5).sort((a,b)=>b.span-a.span)[0];if(wall){const parts=[];balconyPart(parts,wall,base+Math.min(way.height_m-1.1,3.2*1.2),seed);const width=Math.min(3.4,Math.max(2,wall.span*.24)),along=(random(seed+19)-.5)*wall.span*.28,c=wallPoint(wall,along,0),tx=Math.cos(wall.yaw),tz=-Math.sin(wall.yaw);balconies.push({kind:'balcony',a:local([c.x-tx*width/2,c.z-tz*width/2]),b:local([c.x+tx*width/2,c.z+tz*width/2]),u:0,w:width,depth_m:.72,normal:[wall.nx,-wall.nz],elevation_m:base+Math.min(way.height_m-1.1,3.2*1.2)-layout.floor,colour:'#d4d0c2',grade:'procedural_not_measured',parts:parts.map(p=>({...p,position:[...local([p.x,p.z])],bottom_m:p.y-layout.floor}))});}}
const door=entry.doors[0],entrance=door?local([door.cx,door.cz]):row.entrance;
return {id:row.id,windows,balconies,entrance,storeys:Array.from({length:count},()=>({height_m:height})),floor_y_m:layout.floor,shell_base_y_m:base,shell_top_y_m:layout.top,footprint:{type:'Polygon',coordinates:[entry.local.map(local)]},source:'Kerbside homeWindowLayout / photoDetailParts / addSouthFacadeDetail',measured:false,confidence:.25,freshness:null,corroboration_count:0};
})`,context);
for(const row of result.filter(Boolean))for(const element of [...row.windows,...row.balconies]){element.confidence??=.25;element.measured=false;element.freshness=null;element.corroboration_count=0;}
const hash=crypto.createHash('sha256').update(functions).digest('hex');
console.log(JSON.stringify({schema:'kerbside.interior_envelopes/1',canonical_rules_sha256:hash,canonical_source_sha256:crypto.createHash('sha256').update(source).digest('hex'),buildings:Object.fromEntries(result.filter(Boolean).map(r=>[r.id,r]))}));
