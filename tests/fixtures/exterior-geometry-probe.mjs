import {cutExteriorWallBands} from '../../src/smc/exteriors/renderer.mjs';
class Attribute{constructor(a,n){this.array=new Float32Array(a);this.itemSize=n;this.count=a.length/n;}}
class Geometry{constructor(){this.attributes={};this.groups=[];}setAttribute(n,a){this.attributes[n]=a;return this;}
 addGroup(start,count,materialIndex){this.groups.push({start,count,materialIndex});}
 computeBoundingBox(){}computeBoundingSphere(){}dispose(){}}
class Vector3{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
 subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this;}
 cross(b){const {x,y,z}=this;this.x=y*b.z-z*b.y;this.y=z*b.x-x*b.z;this.z=x*b.y-y*b.x;return this;}
 lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}}
const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute,Vector3};
const theta=Number(process.argv[2])*Math.PI/180,[ox,oy,oz]=JSON.parse(process.argv[3]);
const at=(x,y,z)=>[ox+x*Math.cos(theta)+z*Math.sin(theta),oy+y,oz-x*Math.sin(theta)+z*Math.cos(theta)];
const vertices=[...[[0,8,0],[10,8,0],[10,8,-12],[0,8,0],[10,8,-12],[0,8,-12]],
 ...[[0,0,0],[10,0,0],[10,8,0],[0,0,0],[10,8,0],[0,8,0]]];
const g=new Geometry();g.setAttribute('position',new Attribute(vertices.flatMap(v=>at(...v)),3));
g.setAttribute('normal',new Attribute(vertices.flatMap(()=>[0,0,1]),3));
g.setAttribute('uv',new Attribute(vertices.flatMap(v=>[v[0]/10,v[1]/8]),2));
g.addGroup(0,6,0);g.addGroup(6,6,1);const original=Array.from(g.attributes.position.array);
const plan={facades:[{a:[0,0],b:[10*Math.cos(theta),10*Math.sin(theta)],u0:2,u1:8,band_height_m:3.9}]};
const out=cutExteriorWallBands(THREE,g,plan,{x:ox,y:oy,z:oz}),p=out.attributes.position.array;
const area=group=>{let result=0;for(let i=group.start;i<group.start+group.count;i+=3){
 const a=new Vector3(...p.slice(i*3,i*3+3)),b=new Vector3(...p.slice((i+1)*3,(i+1)*3+3)),c=new Vector3(...p.slice((i+2)*3,(i+2)*3+3));
 result+=Math.sqrt(new Vector3().subVectors(b,a).cross(new Vector3().subVectors(c,a)).lengthSq())/2;}return result;};
if(JSON.stringify(original)!==JSON.stringify(Array.from(g.attributes.position.array)))throw Error('source mutated');
for(const group of out.groups.filter(g=>g.materialIndex===1))for(let i=group.start;i<group.start+group.count;i++){
 const x=p[i*3]-ox,z=p[i*3+2]-oz,u=(x*Math.cos(theta)-z*Math.sin(theta))/10,v=(p[i*3+1]-oy)/8;
 if(Math.abs(out.attributes.uv.array[i*2]-u)>.00003||Math.abs(out.attributes.uv.array[i*2+1]-v)>.00003)throw Error('lost UV interpolation');}
console.log(JSON.stringify(out.groups.map(area)));
