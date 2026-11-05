import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_recoverable_geometry_preserves_exact_bits_across_reuploads_and_updates():
    script = r'''
      import assert from 'node:assert/strict';
      import {makeRecoverable, compressPending} from './docs/recoverable-geometry.mjs';
      globalThis.requestIdleCallback = () => 0;   // nothing runs by itself: the test says when
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
          compressPending();
          assert.equal(a.array.constructor,Type);
          assert.equal(a.array.length,view.length);
          assert.deepEqual(bits(a.array),expected);
        }
        a.array[10]=7;a.version++;const edited=Buffer.from(bits(a.array));
        a.onUploadCallback();compressPending();assert.deepEqual(bits(a.array),edited);
        a.array=new Uint32Array(4096).fill(99);a.version++;
        a.onUploadCallback();assert.equal(a.array[0],99);assert.equal(a.array.constructor,Uint32Array);
      }
      const a=new Attribute(new Float32Array(4096).fill(7));
      const original=a.array;
      assert.equal(makeRecoverable(a,null),false);assert.equal(a.array,original);
      assert.equal(makeRecoverable(a,{...codec,deflateSync(){throw Error('codec failed')}}),true);
      a.onUploadCallback();compressPending();assert.equal(a.array,original);
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


def test_compression_waits_for_idle_and_a_release_reads_no_inflated_array():
    """Deflated in the upload callback, a new window's first frame compressed every street
    buffer at once (0.85 s, the walker frozen mid-jump). It waits for idle time now, and a
    released window learns a buffer's type and length without inflating it."""
    script = r'''
      import assert from 'node:assert/strict';
      import {makeRecoverable, compressPending} from './docs/recoverable-geometry.mjs';
      import * as real from './docs/vendor/fflate-0.8.2.mjs';
      const idle = []; globalThis.requestIdleCallback = (fn) => idle.push(fn);
      let deflates = 0, inflates = 0;
      const codec = {deflateSync: (...a) => { deflates++; return real.deflateSync(...a); },
                     inflateSync: (...a) => { inflates++; return real.inflateSync(...a); }};
      class Attribute { constructor(array){this.array=array;this.version=0;} onUpload(fn){this.onUploadCallback=fn;} }
      const a = new Attribute(new Float32Array(50000).fill(3));
      makeRecoverable(a, codec);
      a.onUploadCallback();
      assert.equal(deflates, 0, 'nothing compressed inside the frame');
      assert.equal(idle.length, 1);
      idle.shift()({timeRemaining: () => 10});
      assert.equal(deflates, 1);
      assert.equal(a.recoverableType, Float32Array);
      assert.equal(a.recoverableLength, 50000);
      assert.equal(inflates, 0, 'type and length read without inflating');
      assert.equal(a.array[49999], 3);
      assert.equal(inflates, 1);
      compressPending();
    '''
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, check=True)


def test_buffers_are_deflated_in_a_worker_and_a_stale_answer_is_thrown_away():
    """The deflate runs off the page's thread (recoverable-geometry-worker.mjs): the page copies
    the bytes over and takes the result back. An answer for a version since edited is ignored;
    with no worker the page still compresses, in idle slices."""
    script = r'''
      import assert from 'node:assert/strict';
      import * as real from './docs/vendor/fflate-0.8.2.mjs';
      const sent = [];
      globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 10 }), 0);
      globalThis.Worker = class { constructor(url, opts) { this.url = String(url); this.opts = opts; Worker.made = this; }
        postMessage(m) { sent.push(m); setTimeout(() => this.onmessage({ data: { id: m.id, out: real.deflateSync(m.bytes, { level: 1 }) } }), 5); } };
      const { makeRecoverable, useCompressionWorker } = await import('./docs/recoverable-geometry.mjs');
      useCompressionWorker('https://site.test/recoverable-geometry-worker.mjs');
      let deflates = 0, inflates = 0;
      const codec = { deflateSync: (...a) => { deflates++; return real.deflateSync(...a); },
                      inflateSync: (...a) => { inflates++; return real.inflateSync(...a); } };
      class Attribute { constructor(array){this.array=array;this.version=0;} onUpload(fn){this.onUploadCallback=fn;} }
      const a = new Attribute(new Float32Array(40000).fill(3)), b = new Attribute(new Float32Array(40000).fill(5));
      makeRecoverable(a, codec); makeRecoverable(b, codec);
      a.onUploadCallback(); b.onUploadCallback();
      await new Promise((r) => setTimeout(r, 2));
      assert.equal(Worker.made.url, 'https://site.test/recoverable-geometry-worker.mjs');
      assert.equal(Worker.made.opts.type, 'module');
      assert.equal(sent.length, 2, 'both sent to the worker');
      b.array[0] = 9; b.version++;            // edited while its answer is on the way
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(deflates, 0, 'nothing deflated on the page');
      assert.equal(a.recoverableLength, 40000);
      assert.equal(a.array[39999], 3, 'restored exactly');
      assert.equal(inflates, 1, 'it had been packed: reading it inflated the worker\'s answer');
      assert.equal(b.array[0], 9, 'the edit is kept, the stale answer dropped');
    '''
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, check=True)
