// node prepare.mjs jobs.json output-directory; optional shared dependency cache in KERBSIDE_ASSET_NODE_MODULES.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const checking=process.argv[2]==='--validate-jobs',jobFile=checking?process.argv[3]:process.argv[2];
if(!jobFile)throw Error('Pass a jobs.json file and output directory, or --validate-jobs jobs.json');
const jobs=JSON.parse(await fs.readFile(jobFile));
if(!Array.isArray(jobs)||jobs.length>500)throw Error('Expected at most 500 reviewed jobs');
const identities=new Set();
for(const job of jobs){if(!/^[a-z0-9_-]{1,100}$/.test(job.id)||identities.has(job.id))throw Error('Asset IDs must be unique safe names');identities.add(job.id);
 if(job.license!=='CC0-1.0'||!/^https:\/\//.test(job.source)||!Number.isFinite(job.longest_m)||job.longest_m<=0||job.longest_m>30||!job.role||!job.input)throw Error('Each reviewed asset needs CC0 provenance, a role and finite physical size');
 const stat=await fs.stat(job.input);if(!stat.isFile()||stat.size>30000000)throw Error('Source is not a bounded model file');}
if(checking){console.log('Validated',jobs.length,'reviewed job descriptions');process.exit(0);}
const modules=process.env.KERBSIDE_ASSET_NODE_MODULES||path.join(path.dirname(fileURLToPath(import.meta.url)),'node_modules');
const pkg=async(name,entry)=>import(pathToFileURL(path.join(modules,name,entry)).href);
const {NodeIO,Logger}=await pkg('@gltf-transform/core','dist/index.js');
const {ALL_EXTENSIONS}=await pkg('@gltf-transform/extensions','dist/index.js');
const {dedup,prune,weld,simplify,textureCompress,getBounds}=await pkg('@gltf-transform/functions','dist/index.js');
const {MeshoptSimplifier,MeshoptDecoder}=await pkg('meshoptimizer','index.js');
const {default:sharp}=await pkg('sharp','dist/index.mjs');
const {default:validator}=await pkg('gltf-validator','index.js');
await MeshoptSimplifier.ready;await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const out=process.argv[3],results=[],failures=[];
const triangles=doc=>doc.getRoot().listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()||p.getAttribute('POSITION').getCount())/3,0),0);
for(const job of jobs){try{
 const doc=await io.read(job.input);doc.setLogger(new Logger(Logger.Verbosity.ERROR));
 if(doc.getRoot().listSkins().length||doc.getRoot().listAnimations().length)throw Error('Animated source needs separate review');
 const sourceTriangles=triangles(doc);await doc.transform(dedup(),prune(),weld());
 if(sourceTriangles>8000)await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:7800/sourceTriangles,error:.035,lockBorder:false}),prune());
 if(triangles(doc)>8500)throw Error('Source did not meet the 8,500 triangle limit without excess simplification');
 await doc.transform(textureCompress({encoder:sharp,resize:[512,512]}));
 const scene=doc.getRoot().getDefaultScene()||doc.getRoot().listScenes()[0],b=getBounds(scene),extent=b.max.map((v,i)=>v-b.min[i]),scale=job.longest_m/Math.max(...extent);
 const node=doc.createNode('Kerbside_metres_ground_pivot').setScale([scale,scale,scale]).setTranslation([-(b.min[0]+b.max[0])/2*scale,-b.min[1]*scale,-(b.min[2]+b.max[2])/2*scale]);
 for(const child of scene.listChildren())node.addChild(child);scene.addChild(node);
 const bytes=await io.writeBinary(doc),report=await validator.validateBytes(bytes,{maxIssues:50});if(report.issues.numErrors)throw Error(JSON.stringify(report.issues.messages.filter(x=>x.severity===0)));
 const model=`business-lowpoly/${job.id}.glb`;await fs.mkdir(path.join(out,'business-lowpoly'),{recursive:true});await fs.writeFile(path.join(out,model),bytes);
 const after=getBounds(scene),dimensions=after.max.map((v,i)=>v-after.min[i]);
 const row={id:job.id,name:job.name,role:job.role,license:'CC0-1.0',source:job.source,attribution:job.author,model,detail:'low_poly',dimensions_m:dimensions,units:'metres',pivot:'bottom-centre',scale_basis:'Representative game dimensions, not a measured map object',source_triangles:Math.round(sourceTriangles),triangles:Math.round(triangles(doc)),validation_errors:0,validation_warnings:report.issues.numWarnings,files:[{path:model,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),url:job.download}],source_files:job.source_files};
 results.push(row);console.log(job.id,row.triangles,bytes.length);
 }catch(error){failures.push({id:job.id,error:String(error)});console.error(job.id,error.message);}}
await fs.writeFile(process.argv[2]+'.results.json',JSON.stringify({assets:results,failures},null,2)+'\n');if(failures.length)process.exitCode=1;
