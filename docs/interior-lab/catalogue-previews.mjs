import * as THREE from 'three';
import {buildInferredHouse} from '../inferred-interiors/renderer.mjs';
// One small renderer, a bounded work queue, and cached images. Catalog cards show actual assets.
export class CataloguePreviews {
 constructor({loadAsset,assetBase}){Object.assign(this,{loadAsset,assetBase});this.images=new Map();this.queue=[];this.running=false;}
 image(asset){if(!this.images.has(asset.id))this.images.set(asset.id,new Promise((resolve,reject)=>{this.queue.push({asset,resolve,reject});this.drain();}));return this.images.get(asset.id);}
 async drain(){if(this.running)return;this.running=true;while(this.queue.length){const job=this.queue.shift();try{job.resolve(await this.render(job.asset));}catch(e){job.reject(e);}}this.running=false;}
 async render(asset){
  if(!this.renderer){this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});this.renderer.setSize(192,144);this.renderer.setPixelRatio(1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;}
  const size=asset.dimensions_m,o={id:'preview',role:asset.role,asset,position_m:[0,0,0],rotation_deg:0,size_m:size,support:{kind:'floor',id:'preview-room'},materials:{wood:'#a6815d',fabric:'#7e9b8a',metal:'#808e91',wall:'#eee8da',countertop:'#ded9cd'}};
  const h={id:'preview',style:{wood:'#a6815d',fabric:'#7e9b8a',metal:'#808e91',stone:'#d4d7cf',accent:'#9d795c',walls:['#e1ded2']},stairs:[],envelope:{},storeys:[{level:0,elevation_m:0,height_m:4,rooms:[],walls:[],openings:[],objects:[o],footprint:{type:'Polygon',coordinates:[[[-5,-5],[5,-5],[5,5],[-5,5],[-5,-5]]]}}]};
  const built=buildInferredHouse(THREE,h,{loadAsset:this.loadAsset,assetBase:this.assetBase,exterior:false}),scene=new THREE.Scene();scene.background=new THREE.Color('#eef0e9');scene.add(built.group,new THREE.HemisphereLight('#fff8ed','#74847b',2.4));const light=new THREE.DirectionalLight('#fff5df',3);light.position.set(4,6,5);scene.add(light);await built.ready;
  const box=new THREE.Box3().setFromObject(built.group),centre=box.getCenter(new THREE.Vector3()),span=Math.max(...box.getSize(new THREE.Vector3()).toArray(),.2),camera=new THREE.PerspectiveCamera(30,4/3,.01,150);camera.position.copy(centre).add(new THREE.Vector3(.9,.6,1.15).normalize().multiplyScalar(span*2.6));camera.lookAt(centre);this.renderer.render(scene,camera);const url=this.renderer.domElement.toDataURL('image/jpeg',.83);
  built.group.traverse(n=>{if(n.userData.sharedInteriorAsset)return;n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose();});return url;
 }
}
