// Builds the GitHub Pages artifact.
//
// Pages serves every file with `Cache-Control: max-age=600` and ignores query strings, so right
// after a deploy a browser can pair a freshly fetched module with a stale cached one (say, a new
// main.js calling a method an old audio.js doesn't have yet). The artifact gives the stylesheet and
// every module a content-hashed URL — the entry script and stylesheet directly, the other modules
// through an import map — so one page load always runs one consistent set of files.
//
// The source tree stays plain: `python -m http.server` on the repo still works for development.
//
// Usage: node scripts/build-pages.mjs [outDir]   (default: _site)

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.argv[2] ?? '_site');
const PUBLISH = ['index.html', 'favicon.svg', 'css', 'js', 'docs'];
// Never wiped: the published sources, the build itself, and git's data.
const PROTECTED = new Set([...PUBLISH, 'scripts', '.github', '.git'].map((p) => p.toLowerCase()));

function fail(message) {
  console.error(`build-pages: ${message}`);
  process.exit(1);
}

// The output folder is deleted before every build, so it must be a fresh subfolder of the repo:
// not the repo, not one of its ancestors (`..`), not elsewhere on disk, not a source folder.
const rel = relative(root, out);
const top = rel.split(sep)[0].toLowerCase();
if (!rel || rel.startsWith('..') || isAbsolute(rel) || PROTECTED.has(top)) {
  fail(`refusing to build into ${out} — use a new folder inside the repository, e.g. _site`);
}

const versioned = (path) => {
  const digest = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  return `${path}?v=${digest.slice(0, 10)}`;
};

// Every module must be a sibling in js/ imported by a plain relative path, or the map can't cover it.
const modules = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).sort();
const IMPORT = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
for (const name of modules) {
  const source = readFileSync(join(root, 'js', name), 'utf8');
  for (const [, from, bare] of source.matchAll(IMPORT)) {
    const spec = from ?? bare;
    if (!/^\.\/[\w.-]+\.js$/.test(spec) || !modules.includes(spec.slice(2))) {
      fail(`js/${name} imports "${spec}", which is not a module in js/ — the import map would not cover it`);
    }
  }
}

const imports = Object.fromEntries(modules.map((name) => [`./js/${name}`, `./${versioned(`js/${name}`)}`]));

let html = readFileSync(join(root, 'index.html'), 'utf8');
function swap(from, to) {
  const parts = html.split(from);
  if (parts.length !== 2) fail(`expected exactly one ${from} in index.html, found ${parts.length - 1}`);
  html = parts.join(to);
}
swap('<link rel="stylesheet" href="css/style.css">', `<link rel="stylesheet" href="${versioned('css/style.css')}">`);
swap(
  '<script type="module" src="js/main.js"></script>',
  `<script type="importmap">${JSON.stringify({ imports })}</script>\n  <script type="module" src="${versioned('js/main.js')}"></script>`,
);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of PUBLISH) {
  if (!existsSync(join(root, item))) fail(`missing ${item}`);
  cpSync(join(root, item), join(out, item), { recursive: true });
}
writeFileSync(join(out, 'index.html'), html);
console.log(`build-pages: stamped ${modules.length} modules and the stylesheet → ${relative(root, out) || out}`);
