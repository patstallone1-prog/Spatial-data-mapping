import json
import shutil
import subprocess

import pytest

from tests.test_world_object_renderer import _extract, _page_js


@pytest.mark.skipif(not shutil.which("node"), reason="Node required")
def test_late_material_downloads_preserve_each_house_texture_variant():
    code = r"""
      const PHOTO_MATERIAL_IMAGES=new Map(),FACADE_CACHE=new Map(),bareWallMaps=new Map();
      const MATERIAL_VARIANTS=5,MATERIAL_ASSIGNMENTS={assigned:{a:{class:'brick'}}},
        HOME_CLADDING_SHARES=[],FRONTAGE_FITS={buildings:{}};
      const THREE={SRGBColorSpace:'srgb'};
      const sharedAsset=x=>x,nextFrame=async()=>{};
      const rows=[0,1,2].map(i=>({material_class:'brick',license:'CC0-1.0',file:i+'.jpg'}));
      rows.push({material_class:'brick',license:'forbidden',file:'unsafe.jpg'});
      const fetch=async()=>({ok:true,json:async()=>({assets:rows})});
      const loaded=[];
      class Image {async decode(){loaded.push(this.src);}}
      let disposed=0;
      function facadeFor(material,seed,style,variant){
        const photos=PHOTO_MATERIAL_IMAGES.get(material.photoLabel);
        return {image:photos[variant%photos.length].src,dispose(){disposed++;}};
      }
      for(const variant of [0,1,2,4])bareWallMaps.set(variant,{userData:{material:{photoLabel:'brick'},seed:12,style:0,variant,bare:true}});
    """
    code += "async " + _extract("loadPhotoMaterialLibrary", _page_js())
    code += """
      loadPhotoMaterialLibrary().then(()=>console.log(JSON.stringify({
        images:[...bareWallMaps.values()].map(t=>t.image),loaded,disposed
      })));
    """
    result = subprocess.run(["node", "-e", code], text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    value = json.loads(result.stdout)
    assert value["images"] == ["materials/0.jpg", "materials/1.jpg", "materials/2.jpg", "materials/1.jpg"]
    assert "materials/unsafe.jpg" not in value["loaded"]
    assert value["disposed"] == 12


@pytest.mark.skipif(not shutil.which("node"), reason="Node required")
def test_arch_glass_and_wall_corners_partition_the_same_opening_box():
    code = r"""
      class Shape {constructor(){this.points=[];}moveTo(x,y){this.points.push([x,y]);}lineTo(x,y){this.points.push([x,y]);}closePath(){}}
      class Attribute{constructor(a,s){this.array=a;this.itemSize=s;}}
      class Geometry {constructor(){this.a={};}setAttribute(n,a){this.a[n]=a;}computeVertexNormals(){}}
      const THREE={Shape,BufferGeometry:Geometry,Float32BufferAttribute:Attribute};
    """
    code += "\n".join(_extract(name, _page_js()) for name in (
        "homeWindowArchSpring", "homeWindowCrown", "homeWindowShape", "homeWindowArchCorners",
    ))
    code += r"""
      const o={u:2,v:3,w:2,h:3,design:{shape:'arched',arch_spring_fraction:.6}};
      const shape=homeWindowShape(o),points=shape.points;
      const paneArea=Math.abs(points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
      const corners=homeWindowArchCorners([0,0],1,0,o,(u,v)=>[u,v]).a.position.array;
      let cornerArea=0;
      for(let i=0;i<corners.length;i+=9){const [ax,ay,az,bx,by,bz,cx,cy,cz]=corners.slice(i,i+9);cornerArea+=Math.abs((bx-ax)*(cy-ay)-(cx-ax)*(by-ay))/2;}
      if(Math.abs(paneArea+cornerArea-o.w*o.h)>1e-9)throw Error('arch leaves hole or covers pane');
      if(Math.abs(homeWindowCrown(o,0)-1.8)>1e-9 || homeWindowCrown(o,.5)!==3)throw Error('crown not bounded');
      const fragmented={...o,frameLeft:false};
      if(homeWindowArchSpring(fragmented)!==null)throw Error('partial bay fragment got complete arch');
      if(homeWindowArchSpring({...o,design:{shape:'arched',arch_spring_fraction:NaN}})!==null)throw Error('invalid crown');
      console.log(JSON.stringify({paneArea,cornerArea}));
    """
    result = subprocess.run(["node", "-e", code], text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(not shutil.which("node"), reason="Node required")
def test_bare_photographic_wall_does_not_invent_dark_storey_trim():
    code = r"""
      const fills=[],PHOTO_MATERIAL_IMAGES=new Map([['brick',[{}]]]),PAINTABLE_PHOTO_CLASSES=new Set();
      const ctx={scale(){},fillRect(...args){fills.push(args);},drawImage(){}};
      const document={createElement:()=>({getContext:()=>ctx})};
      const THREE={CanvasTexture:class{},RepeatWrapping:1,SRGBColorSpace:2};
    """ + _extract("facadeFor", _page_js()) + r"""
      facadeFor({photoLabel:'brick',name:'brick',grit:0},1,0,0,false);
      if(fills.some(args=>JSON.stringify(args)==='[0,59,64,5]'))throw Error('invented dark floor seam');
    """
    result = subprocess.run(["node", "-e", code], text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
