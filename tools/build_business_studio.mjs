import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {businessStarter} from '../docs/interior-lab/business-starter.mjs';
import {PROGRAMS,businessKind,businessLabel} from '../docs/interior-lab/profiles.mjs';
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const root=new URL('../',import.meta.url),folder=option('--out')?pathToFileURL(path.resolve(option('--out'))+path.sep):new URL('docs/interior-lab/businesses/',root);
const assets=JSON.parse(await fs.readFile(new URL('docs/interior-assets/manifest.json',root))).assets;
const rules=JSON.parse(await fs.readFile(new URL('docs/city/rules.json',root)));
const kinds=option('--kinds')?option('--kinds').split(','):[...new Set([...Object.keys(PROGRAMS),...Object.keys(rules.stores.kinds)])];
await fs.mkdir(folder,{recursive:true});const houses=[];
for(const [i,kind] of kinds.entries()){
 const p=PROGRAMS[businessKind(kind)];if(!p)throw Error('Missing editor program: '+kind);
 const w=['grocery','hospital','car_dealership','industrial'].includes(kind)?22:12,h=kind==='grocery'?28:18;
 const ring=i%3===0?[[0,0],[w,0],[w,h],[0,h],[0,0]]:i%3===1?[[0,0],[w,0],[w-2,h],[0,h],[0,0]]:[[0,0],[w,0],[w,h*.64],[w*.7,h*.64],[w*.7,h],[0,h],[0,0]];
 const id=`studio-${kind}`,windowWidth=Math.min(2,w/5),windows=['Food & drink','Retail','Personal services'].includes(p.group)?[{edge:0,u:1,v:.9,w:windowWidth,h:1.5},{edge:0,u:w-1-windowWidth,v:.9,w:windowWidth,h:1.5}]:[];
 const entrances=[{id:id+':entrance',segment:{type:'LineString',coordinates:[[w/2-.8,0],[w/2+.8,0]]},width_m:1.6,height_m:2.3,leaf_count:2,type:kind==='grocery'?'automatic_sliding':'double_door'}];
 const house=businessStarter({id,kind,name:businessLabel(kind),footprint:{type:'Polygon',coordinates:[ring]},height:3.2,entrances,windows,assets});
 if(!house.validation.passed)throw Error(`${kind}: ${JSON.stringify(house.validation.issues)}`);
 house.provenance.geometry='Synthetic practice tenancy; not a real-world survey';
 const file=id+'.json';await fs.writeFile(new URL(file,folder),JSON.stringify(house,null,2)+'\n');houses.push({id,name:businessLabel(kind)+' · practice',kind,group:p.group,file,passed:true});
}
for(const file of (await fs.readdir(folder)).filter(x=>/^engine-.*\.json$/.test(x))){const h=JSON.parse(await fs.readFile(new URL(file,folder)));houses.push({id:h.id,name:h.kind[0].toUpperCase()+h.kind.slice(1)+' · detailed engine example',kind:h.kind,group:PROGRAMS[h.kind].group,file,passed:h.validation.passed});}
await fs.writeFile(new URL('manifest.json',folder),JSON.stringify({schema:'kerbside.studio_business_library/1',measured:false,description:'Editable practice programs; supplied map geometry is used separately for owned world businesses.',houses},null,2)+'\n');console.log('Built',houses.length,'business programs');
