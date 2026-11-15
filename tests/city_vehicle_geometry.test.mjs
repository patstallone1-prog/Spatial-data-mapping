import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from '../docs/vendor/three-0.160.0/three.module.min.js';
import {fleetParts,vehicleLampAnchors} from '../docs/city/vehicles.mjs';

function triangle(reversed,mirror=false){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,0,1,0,0,0,1,0],3));g.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));g.setIndex(reversed?[0,2,1]:[0,1,2]);
 const scene=new THREE.Group(),mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({name:'body'}));if(mirror)mesh.scale.x=-1;scene.add(mesh);return{scene,g};
}
test('fleet faces opposite all vertex normals become visible without changing source indices',()=>{
 for(const [back,mirror]of[[false,false],[true,false],[false,true]]){const {scene,g}=triangle(back,mirror),before=[...g.index.array],parts=fleetParts(THREE,{scene});const mesh=new THREE.Mesh(parts[0].geometry,new THREE.MeshBasicMaterial());const ray=new THREE.Raycaster(new THREE.Vector3(0,.3,2),new THREE.Vector3(0,0,-1));assert.equal(ray.intersectObject(mesh).length,1);assert.deepEqual([...g.index.array],before);}
});
test('night lamps sit on the sloped body instead of floating at the nose bounding box',()=>{
 const body=new THREE.BoxGeometry(2,1.5,4).rotateX(.15).translate(0,.75,0);
 const lamps=vehicleLampAnchors(THREE,[body],[2,1.5,5]);assert.equal(lamps.length,4);
 const shell=new THREE.Mesh(body,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 for(const lamp of lamps){const p=new THREE.Vector3().setFromMatrixPosition(lamp.matrix),n=new THREE.Vector3(0,0,1).transformDirection(lamp.matrix);const hit=new THREE.Raycaster(p,n.clone().negate(),0,.02).intersectObject(shell)[0];assert.ok(hit);assert.ok(Math.abs(hit.distance-.005)<1e-5);assert.ok(Math.abs(p.z)<2.4);}
 assert.equal(vehicleLampAnchors(THREE,[],[2,2,4]).length,0);
});
