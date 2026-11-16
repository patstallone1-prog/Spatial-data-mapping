import {cutExteriorWallBands} from '../storefront-renderer.mjs';
// Temporarily replace only the edited wall band. Original batch indices are restored verbatim.
// Roofs and upper storeys remain in their source renderer; no source map facts are mutated.
export function mountWindowShell(THREE,{house,baseline=house,ranges=[],extras=[],origin,floorY,root}){
 const retained=new THREE.Group(),saved=[],visibility=[];retained.name='retained-source-above-window-edits';
 const original=baseline.envelope?.windows||[],current=house.envelope?.windows||[],windows=[...original,...current];
 const changed=house.storeys.filter(f=>{const onFloor=w=>w.v>=f.elevation_m&&w.v<f.elevation_m+f.height_m;return JSON.stringify(original.filter(onFloor))!==JSON.stringify(current.filter(onFloor));});
 // Restored designs can carry the marker with an identical layout; no band needs replacing.
 const levels=changed.length?changed:house.storeys.filter(f=>windows.some(w=>w.v>=f.elevation_m&&w.v<f.elevation_m+f.height_m));
 const plan={cut_all_groups:true,facades:levels.flatMap(f=>{const ring=f.footprint.coordinates[0],floorWindows=windows.filter(w=>w.v>=f.elevation_m&&w.v<f.elevation_m+f.height_m),top=Math.min(f.elevation_m+f.height_m,Math.max(f.elevation_m+2.3,...floorWindows.map(w=>w.v+w.h))+.08);return ring.slice(1).map((b,i)=>({a:ring[i],b,u0:0,u1:Math.hypot(b[0]-ring[i][0],b[1]-ring[i][1]),band_bottom_m:f.elevation_m,band_height_m:top,clip_tolerance_m:.45}));})},frame={x:origin[0],y:floorY,z:-origin[1]};
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert();
 const preserve=(geometry,material,matrix)=>{geometry.applyMatrix4(matrix);const clipped=cutExteriorWallBands(THREE,geometry,plan,frame);geometry.dispose();if(clipped.getAttribute('position')?.count){const mesh=new THREE.Mesh(clipped,material);mesh.userData.retainedSourceBand=true;retained.add(mesh);}else clipped.dispose();};
 try{
  for(const range of ranges){const {mesh,start,indices}=range,index=mesh.geometry.getIndex();if(!index)continue;mesh.updateMatrixWorld(true);const geometry=new THREE.BufferGeometry();for(const[name,a]of Object.entries(mesh.geometry.attributes)){const array=new Float32Array(indices.length*a.itemSize);for(let i=0;i<indices.length;i++)for(let k=0;k<a.itemSize;k++)array[i*a.itemSize+k]=a.array[indices[i]*a.itemSize+k];geometry.setAttribute(name,new THREE.BufferAttribute(array,a.itemSize));}geometry.addGroup(0,indices.length,0);preserve(geometry,mesh.material,inverse.clone().multiply(mesh.matrixWorld));saved.push({index,start,indices:[...index.array.slice(start,start+indices.length)]});index.array.set(indices.map(()=>indices[0]),start);index.needsUpdate=true;}
  for(const extra of extras.filter(Boolean)){visibility.push([extra,extra.visible]);extra.updateMatrixWorld(true);extra.traverse(n=>{if(!n.isMesh||!n.geometry||!n.visible)return;preserve(n.geometry.clone(),n.material,inverse.clone().multiply(n.matrixWorld));});extra.visible=false;}
  root.add(retained);
 }catch(error){for(const s of saved){s.index.array.set(s.indices,s.start);s.index.needsUpdate=true;}for(const[g,v]of visibility)g.visible=v;retained.traverse(n=>n.geometry?.dispose());throw error;}
 let restored=false;return{retained,restore(){if(restored)return;restored=true;for(const s of saved){s.index.array.set(s.indices,s.start);s.index.needsUpdate=true;}for(const[g,v]of visibility)g.visible=v;retained.parent?.remove(retained);retained.traverse(n=>n.geometry?.dispose());}};
}
