import {createDraft,dispatch,suggestPlacement,validateDraft} from './model.mjs';
import {PROGRAMS,businessKind,ROOM_ROLES,FIXTURES} from './profiles.mjs';

// This lays out a game hypothesis inside a supplied tenancy. It never claims an as-built interior.
export function businessStarter({id,kind,footprint,height=3.2,entrances=[],windows=[],name,assets=[],service=null}) {
  const assetRef=a=>Object.fromEntries(['id','role','model','dimensions_m','license','source','attribution','detail'].filter(k=>a[k]!==undefined).map(k=>[k,structuredClone(a[k])]));
  const program=PROGRAMS[businessKind(kind)];
  if(!program||!id||footprint?.type!=='Polygon'||!entrances.length)throw Error('A supported business, its actual tenancy polygon and an entrance are required.');
  const clearance=e=>{if(e.clearance)return e.clearance;const[a,b]=e.segment.coordinates,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=-dz/length*.65,nz=dx/length*.65;return{type:'Polygon',coordinates:[[[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz],[a[0]+nx,a[1]+nz]]]};};
  const style={id:'studio-business',usage:'business',walls:['#d8dfd2','#b2c3bb','#dfc9b5'],wood:'#a57d58',fabric:'#647d78',metal:'#647075',stone:'#d2d2c5',accent:'#668a80'};
  const sanitary=program.group==='Healthcare'||['grocery','corner_store','laundry','jewelry'].includes(businessKind(kind)),industrial=['industrial','car_dealership','gas_station'].includes(businessKind(kind));
  const materials={wall:style.walls[0],floor:sanitary?'#d0d9d5':industrial?'#aeb7b7':'#b9ad96',floor_finish:sanitary?'tile':industrial?'concrete':'timber',wood:style.wood,fabric:style.fabric,metal:style.metal,ceiling:'#eee9df',trim:'#e4ddcf'};
  const roomId=`${id}:public`,house={schema:'kerbside.inferred_business/1',id,name:name||program.label,kind,units:'metres',grade:'inferred',measured:false,confidence:.2,freshness:null,corroboration_count:0,style,envelope:{windows:structuredClone(windows)},stairs:[],ramps:[],provenance:{layout:'Editable game starter within supplied tenancy geometry; not a surveyed interior'},storeys:[{level:0,elevation_m:0,height_m:height,footprint:structuredClone(footprint),inside:structuredClone(footprint),slab_holes:[],rooms:[{id:roomId,kind:program.primary,polygon:structuredClone(footprint),materials,grade:'inferred',measured:false,confidence:.2,freshness:null,corroboration_count:0}],walls:[],openings:entrances.map((e,i)=>({...structuredClone(e),clearance:clearance(e),id:e.id||`${id}:entry:${i}`,entrance:true,rooms:[roomId,'outside'],width_m:e.width_m||Math.hypot(e.segment.coordinates[1][0]-e.segment.coordinates[0][0],e.segment.coordinates[1][1]-e.segment.coordinates[0][1]),height_m:e.height_m||2.2,type:e.type||'double_door',leaf_count:e.leaf_count??2})),objects:[]}]};
  let draft=createDraft(house),f=draft.house.storeys[0],ring=footprint.coordinates[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]),bounds=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
  // Choose a service band opposite the source entrance, trying both axes for angled spaces.
  const entry=entrances[0].segment.coordinates,mid=[(entry[0][0]+entry[1][0])/2,(entry[0][1]+entry[1][1])/2];
  for(const axis of ['z','x']){
    const d=axis==='x'?0:1,low=bounds[d],high=bounds[d+2],at=mid[d]<(low+high)/2?low+(high-low)*.72:low+(high-low)*.28;
    if(high-low<8)continue;
    try {const attempt=dispatch(draft,{type:'split-room',level:0,id:roomId,axis,at,newRoomId:`${id}:service`,newKind:program.back});
      const af=attempt.house.storeys[0],publicRoom=af.rooms.find(r=>af.openings.some(o=>o.entrance&&o.rooms.includes(r.id))),service=af.rooms.find(r=>r!==publicRoom);
      if(!publicRoom||!service)continue;publicRoom.kind=program.primary;service.kind=program.back;service.materials={...service.materials,wall:style.walls[1],floor_finish:'tile'};
      // The service room gets a separate, connected toilet when it has enough usable width.
      const other=axis==='x'?'z':'x',k=other==='x'?0:1,coords=service.polygon.coordinates[0],lo=Math.min(...coords.map(p=>p[k])),hi=Math.max(...coords.map(p=>p[k]));
      let complete=attempt;
      if(hi-lo>5){try{complete=dispatch(attempt,{type:'split-room',level:0,id:service.id,axis:other,at:lo+2.1,newRoomId:`${id}:toilet`,newKind:'toilet'});const cf=complete.house.storeys[0],parts=cf.rooms.filter(r=>r.id===service.id||r.id===`${id}:toilet`);parts.sort((a,b)=>a.area_m2-b.area_m2);parts[0].kind='toilet';parts[1].kind=program.back;}catch{}}
      if(!validateDraft(complete).valid)continue;draft=complete;break;
    } catch { /* Never replace a disconnected/non-square source with a rectangle. */ }
  }
  f=draft.house.storeys[0];
  for(const room of f.rooms){
    const roles=room.kind===program.primary?program.roles:ROOM_ROLES[room.kind]||['storage_cabinet'];
    for(const role of roles){if(role==='dining_chair'&&f.objects.some(o=>o.room_id===room.id&&o.role==='dining_table'))continue;const area=room.area_m2 ?? (bounds[2]-bounds[0])*(bounds[3]-bounds[1]);
      const tables=service?Math.max(1,Math.min(12,Math.floor(area/(service.style==='dining'?10:7)))):3;
      const count=role==='hospital_bed'?4:role==='dining_chair'?4:role==='dining_table'?tables:/gondola|commercial_washer|commercial_dryer|barber_chair|salon_chair/.test(role)?3:1;
      for(let i=0;i<count;i++){
        const asset=assets.find(a=>a.role===role&&a.model&&a.detail==='low_poly')||assets.find(a=>a.role===role&&a.model),size=asset?.dimensions_m||FIXTURES[role];if(!size)continue;
        const coordinates=room.polygon.coordinates[0],xs=coordinates.map(p=>p[0]),zs=coordinates.map(p=>p[1]),loX=Math.min(...xs),hiX=Math.max(...xs),loZ=Math.min(...zs),hiZ=Math.max(...zs);
        const preferred=['hospital_bed','dining_table','gondola_shelf'].includes(role)?[loX+(i+.5)*(hiX-loX)/count,(loZ+hiZ)/2]:null;
        const position=suggestPlacement(draft.house,0,room.id,size,role,preferred);if(!position)continue;
        const object={id:`${id}:item:${f.objects.length}`,role,position_m:position,size_m:[...size],rotation_deg:0,room_id:room.id,support:{kind:'floor',id:room.id,surface_y_m:0},asset:asset?assetRef(asset):{id:`procedural:${role}`,role,procedural:true},materials:structuredClone(room.materials),grade:'inferred',measured:false,confidence:.2,freshness:null,corroboration_count:0};
        const attempt=dispatch(draft,{type:'add-object',level:0,object});if(validateDraft(attempt).valid){draft=attempt;f=draft.house.storeys[0];
          if(['dining_table','meeting_table'].includes(role)){
            const chairRole=role==='meeting_table'?'office_chair':'dining_chair',chairAsset=assets.find(a=>a.role===chairRole&&a.detail==='low_poly')||assets.find(a=>a.role===chairRole&&a.model),chairSize=chairAsset?.dimensions_m||FIXTURES[chairRole];
            const seats=service && (area<26 || service.style==='counter' && i%2===0)?[[0,1,0],[0,-1,180]]:[[1,0,90],[-1,0,-90],[0,1,0],[0,-1,180]];
            for(const [sx,sz,rotation]of seats){
              const chair={id:`${id}:item:${f.objects.length}`,role:chairRole,position_m:[position[0]+sx*(size[0]/2+chairSize[2]/2+.12),0,position[2]+sz*(size[2]/2+chairSize[2]/2+.12)],size_m:[...chairSize],rotation_deg:rotation,room_id:room.id,support:{kind:'floor',id:room.id,surface_y_m:0},asset:chairAsset?assetRef(chairAsset):{id:'procedural:'+chairRole,role:chairRole,procedural:true},materials:structuredClone(room.materials),grade:'inferred',measured:false,confidence:.2,freshness:null,corroboration_count:0};
              const seated=dispatch(draft,{type:'add-object',level:0,object:chair});if(validateDraft(seated).valid){draft=seated;f=draft.house.storeys[0];}
            }
          }
        }
      }
    }
  }
  // Restore room colors for the renderer while keeping all opening/structure geometry fixed.
  for(const r of draft.house.storeys[0].rooms)r.custom_finish=true;
  draft.house.validation=validateDraft(draft);draft.house.validation.passed=draft.house.validation.valid;
  return draft.house;
}
