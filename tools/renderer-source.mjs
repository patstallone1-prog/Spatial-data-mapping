// The renderer's source for Node readers, as smc.renderer.template assembles it for Python:
// the builder's Python and the page's tuning, then the page (src/smc/renderer/page/shell.html with its module parts
// joined in file-name order where the marker stands). Reading the parts here and not a copy keeps
// the two languages on one source.
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const PAGE = new URL('src/smc/renderer/page/', root);
const MARKER = '/*@kerbside-module-parts@*/\n';

export function pageTemplate() {
  const shell = readFileSync(new URL('shell.html', PAGE), 'utf8');
  if (shell.split(MARKER).length !== 2) throw new Error('shell.html must hold the module marker once');
  const parts = readdirSync(new URL('module/', PAGE)).filter((name) => name.endsWith('.js')).sort();
  const module = parts.map((name) => readFileSync(new URL(`module/${name}`, PAGE), 'utf8')).join('');
  return shell.replace(MARKER, () => module);
}

export function rendererSource() {
  return readFileSync(new URL('scripts/build_sf_corridor_3d.py', root), 'utf8') + '\n'
    + readFileSync(new URL('src/smc/renderer/tuning.py', root), 'utf8') + '\n' + pageTemplate();
}
