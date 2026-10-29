import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_recoverable_geometry_preserves_exact_bits_across_reuploads_and_updates():
    script = r'''
      import assert from 'node:assert/strict';
      import {makeRecoverable} from './docs/recoverable-geometry.mjs';
      import * as codec from './docs/vendor/fflate-0.8.2.mjs';
      class Attribute {
        constructor(array){this.array=array;this.version=0;this.onUploadCallback=()=>{};}
        onUpload(fn){this.onUploadCallback=fn;return this;}
      }
      const bits=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
      for(const Type of [Float32Array,Uint16Array,Uint32Array,Int16Array]){
        const backing=new Type(4100); const view=backing.subarray(2,4098);
        for(let i=0;i<view.length;i++)view[i]=i%17;
        if(Type===Float32Array){view[1]=-0;view[2]=NaN;view[3]=Infinity;}
        const expected=Buffer.from(bits(view)); const a=new Attribute(view);
        assert.equal(makeRecoverable(a,codec),true);
        assert.equal(makeRecoverable(a,codec),false); // shared attributes wrap only once
        for(let upload=0;upload<4;upload++){
          a.onUploadCallback(); // static upload, and subsequent context restoration
          assert.equal(a.array.constructor,Type);
          assert.equal(a.array.length,view.length);
          assert.deepEqual(bits(a.array),expected);
        }
        a.array[10]=7;a.version++;const edited=Buffer.from(bits(a.array));
        a.onUploadCallback();assert.deepEqual(bits(a.array),edited);
        a.array=new Uint32Array(4096).fill(99);a.version++;
        a.onUploadCallback();assert.equal(a.array[0],99);assert.equal(a.array.constructor,Uint32Array);
      }
      const a=new Attribute(new Float32Array(4096).fill(7));
      const original=a.array;
      assert.equal(makeRecoverable(a,null),false);assert.equal(a.array,original);
      assert.equal(makeRecoverable(a,{...codec,deflateSync(){throw Error('codec failed')}}),true);
      a.onUploadCallback();assert.equal(a.array,original);
      const interleaved=new Attribute(original);interleaved.isInterleavedBufferAttribute=true;
      assert.equal(makeRecoverable(interleaved,codec),false);
      assert.throws(()=>{a.array=null},TypeError);
    '''
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, check=True)


def test_vendored_codec_hash_and_all_region_recovery_assets():
    manifest = json.loads((ROOT / "docs/vendor/manifest.json").read_text())["fflate"]
    assert hashlib.sha256((ROOT / "docs/vendor" / manifest["file"]).read_bytes()).hexdigest() == manifest["sha256"]
    assert "MIT" in (ROOT / "docs/vendor" / manifest["license_file"]).read_text()
    viewers = [ROOT / "docs/app-model.html", *sorted((ROOT / "docs/app-regions").glob("*/app-model.html"))]
    # One viewer per built region; cloud releases add regions (docs/app-regions.json).
    built = [r for r in json.loads((ROOT / "docs/app-regions.json").read_text())["regions"] if r.get("built")]
    assert {ROOT / "docs" / r["path"] for r in built} == set(viewers)
    for path in viewers:
        source = path.read_text()
        assert 'import(sharedAsset("recoverable-geometry.mjs"))' in source
        assert 'function releaseArray()' not in source
        assert 'makeRecoverable(a, geometryRecovery[1])' in source
    release = json.loads((ROOT / "docs/runtime-release.json").read_text())
    for name, digest in release["runtime_assets_sha256"].items():
        assert hashlib.sha256((ROOT / "docs" / name).read_bytes()).hexdigest() == digest
