// Shaders that do not compile, found before they are a hole in the picture.
//
// A material whose fragment shader fails to compile is not drawn at all, and nothing says so (the
// page keeps the renderer's own error check off: it stalls a frame on every new program). In
// November 2026 a patch to the street's lighting declared `vViewPosition` twice; every wall with
// that patch went undrawn, and a house was its windows and a doorway standing in the air.
//
// Two checks, one for each place it can be caught:
//   - `flatten` + `redeclared`: the shader as the driver is given it (includes resolved, the
//     preprocessor run for one set of defines), and every global name declared more than once.
//     No GPU is needed: tests/shader_programs.test.mjs runs it over the page's real hooks.
//   - `failedPrograms`: on a live page, the programs whose shaders the driver refused.

//: `#include <name>` resolved from `chunks` (three.js's ShaderChunk), to any depth.
export function resolveIncludes(source, chunks, depth = 0) {
  if (depth > 12) throw new Error("shader includes nest too deep");
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_, name) => {
    if (typeof chunks[name] !== "string") throw new Error(`no shader chunk <${name}>`);
    return resolveIncludes(chunks[name], chunks, depth + 1);
  });
}

function truth(expression, defines) {
  const js = expression
    .replace(/\/\/.*$/, "")
    .replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a, b) => (defines.has(a || b) ? "1" : "0"))
    .replace(/[A-Za-z_]\w*/g, (name) => { const v = defines.get(name); return v === undefined || v === "" || !/^[-\d.]+$/.test(String(v)) ? "0" : String(v); });
  if (!/^[\d\s().+\-*/<>=!&|%]*$/.test(js)) throw new Error(`cannot read the shader condition: ${expression}`);
  return Boolean(Function(`"use strict"; return (${js});`)());
}

//: The source the compiler sees for `defines` ({ NAME: value }): includes resolved and every
//: #if / #ifdef / #else decided; #define and #undef inside the source are followed.
export function flatten(source, chunks = {}, defines = {}) {
  const D = new Map(Object.entries(defines).map(([k, v]) => [k, v === true ? "1" : String(v)]));
  const out = [], stack = [];   // each: { live (this branch is kept), taken (a branch was), outer }
  const live = () => stack.every((s) => s.live);
  const text = resolveIncludes(source, chunks).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\\n/g, " ");
  for (const line of text.split("\n")) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!m) { if (live()) out.push(line); continue; }
    const [, word, rest] = m;
    if (word === "ifdef" || word === "ifndef" || word === "if") {
      const outer = live();
      const yes = outer && (word === "if" ? truth(rest, D) : D.has(rest.trim().split(/\s/)[0]) === (word === "ifdef"));
      stack.push({ live: yes, taken: yes, outer });
    } else if (word === "elif") {
      const s = stack[stack.length - 1];
      s.live = s.outer && !s.taken && truth(rest, D); s.taken ||= s.live;
    } else if (word === "else") {
      const s = stack[stack.length - 1];
      s.live = s.outer && !s.taken; s.taken = true;
    } else if (word === "endif") {
      stack.pop();
    } else if (live()) {
      if (word === "define") { const d = /^(\w+)(\([^)]*\))?\s*(.*)$/.exec(rest); if (d && !d[2]) D.set(d[1], d[3].replace(/\/\/.*$/, "").trim()); }
      else if (word === "undef") D.delete(rest.trim());
    }
  }
  if (stack.length) throw new Error("shader has an #if with no #endif");
  return out.join("\n");
}

//: Every global name a flattened shader declares more than once: a varying, uniform, attribute,
//: constant or struct of the same name, or a function with the same name and parameter types
//: (overloads with other parameters are GLSL's own and are not counted). Each is a compile error.
export function redeclared(flat) {
  const code = flat.replace(/\/\/.*$/gm, "");
  // Only what stands outside every pair of braces.
  let depth = 0, top = "";
  for (const ch of code) {
    if (ch === "{") { depth += 1; if (depth === 1) top += "{"; continue; }
    if (ch === "}") { depth -= 1; if (depth === 0) top += "}"; continue; }
    if (depth === 0) top += ch;
  }
  const seen = new Map(), add = (key) => seen.set(key, (seen.get(key) || 0) + 1);
  const WORDS = "(?:(?:flat|smooth|centroid|highp|mediump|lowp|const|in|out|inout)\\s+)*";
  for (const m of top.matchAll(new RegExp(`\\b(?:varying|uniform|attribute|const|in|out)\\s+${WORDS}[\\w]+\\s+([^;{}()]+);`, "g"))) {
    for (const name of m[1].split(",")) add(`variable ${name.replace(/\[.*$/, "").replace(/=.*$/, "").trim()}`);
  }
  for (const m of top.matchAll(/\bstruct\s+(\w+)\s*\{/g)) add(`struct ${m[1]}`);
  for (const m of top.matchAll(/\b[\w]+\s+(\w+)\s*\(([^)]*)\)\s*\{/g)) {
    const types = m[2].split(",").map((p) => p.trim().replace(new RegExp(`^${WORDS}`), "").split(/\s+/)[0]).filter((t) => t && t !== "void");
    add(`function ${m[1]}(${types.join(",")})`);
  }
  return [...seen].filter(([, n]) => n > 1).map(([key]) => key).sort();
}

//: On a live page: the programs of `renderer.info.programs` with a shader the driver would not
//: compile, as `{ key, stage, log }`. `skip` (a WeakSet) holds what was already looked at, so a
//: second call costs only the programs made since. A program is only asked about once it has
//: been drawn with, when its status is already known and asking does not wait for the driver;
//: with `met` (a WeakSet) a program is left until the call after the one that first saw it.
export function failedPrograms(renderer, skip = null, met = null) {
  const gl = renderer.getContext(), bad = [];
  for (const p of renderer.info?.programs || []) {
    if (!p.program || !(p.usedTimes > 0) || skip?.has(p)) continue;
    if (met && !met.has(p)) { met.add(p); continue; }
    skip?.add(p);
    for (const shader of gl.getAttachedShaders(p.program) || []) {
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) continue;
      bad.push({ key: String(p.cacheKey || ""), stage: gl.getShaderParameter(shader, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER ? "fragment" : "vertex", log: String(gl.getShaderInfoLog(shader) || "").slice(0, 300) });
    }
  }
  return bad;
}
