// Builds the GitHub Pages artifact.
//
// Pages serves every file with `Cache-Control: max-age=600` and ignores query strings, so right
// after a deploy a browser can pair a freshly fetched module with a stale cached one (say, a new
// main.js calling a method an old audio.js doesn't have yet). The artifact gives the stylesheet and
// every module a content-hashed URL — the entry script and stylesheet directly, the other modules
// through an import map — so one page load always runs one consistent set of files.
//
// It also turns sw.js into the offline worker for this exact release: the list of files to keep,
// each with its content hash, plus a <meta name="hush-build"> that tells the page to register it.
//
// The source tree stays plain: `python -m http.server` on the repo still works for development,
// and without the build stamp no service worker is registered there.
//
// Usage: node scripts/build-pages.mjs [outDir]   (default: _site)

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.argv[2] ?? '_site');
const PUBLISH = ['index.html', 'favicon.svg', 'manifest.webmanifest', 'css', 'js', 'icons', 'docs'];
// Never wiped: the published sources, the build itself, and git's data.
const PROTECTED = new Set([...PUBLISH, 'sw.js', 'scripts', '.github', '.git'].map((p) => p.toLowerCase()));

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

const hashOf = (data) => createHash('sha256').update(data).digest('hex').slice(0, 10);
const fileHash = (path) => hashOf(readFileSync(join(root, path)));
const versioned = (path) => `${path}?v=${fileHash(path)}`;

function swap(text, file, from, to) {
  const parts = text.split(from);
  if (parts.length !== 2) fail(`expected exactly one ${from} in ${file}, found ${parts.length - 1}`);
  return parts.join(to);
}

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
html = swap(html, 'index.html', '<link rel="stylesheet" href="css/style.css">', `<link rel="stylesheet" href="${versioned('css/style.css')}">`);
html = swap(
  html,
  'index.html',
  '<script type="module" src="js/main.js"></script>',
  `<script type="importmap">${JSON.stringify({ imports })}</script>\n  <script type="module" src="${versioned('js/main.js')}"></script>`,
);

// Everything the page and its install need offline, each with the hash the worker checks it against.
const icons = readdirSync(join(root, 'icons')).filter((f) => f.endsWith('.png')).sort();
const hashedFiles = ['css/style.css', ...modules.map((name) => `js/${name}`)];
const plainFiles = ['manifest.webmanifest', 'favicon.svg', ...icons.map((name) => `icons/${name}`)];
const precache = [
  ...hashedFiles.map((path) => ({ url: `./${versioned(path)}`, hash: fileHash(path) })),
  ...plainFiles.map((path) => ({ url: `./${path}`, hash: fileHash(path) })),
];
const version = hashOf(precache.map((e) => `${e.url} ${e.hash}`).join('\n'));
html = swap(html, 'index.html', '<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="hush-build" content="${version}">`);
precache.unshift({ url: './', hash: hashOf(html) });

let worker = readFileSync(join(root, 'sw.js'), 'utf8');
worker = swap(worker, 'sw.js', "const VERSION = 'dev';", `const VERSION = '${version}';`);
worker = swap(worker, 'sw.js', 'const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(precache)};`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of PUBLISH) {
  if (!existsSync(join(root, item))) fail(`missing ${item}`);
  cpSync(join(root, item), join(out, item), { recursive: true });
}
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'sw.js'), worker);

// Install prompts quietly fail on a missing icon or screenshot, so check every file the manifest names.
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
// The app id resolves against the origin (jeiel85.github.io), not the manifest's folder: "./" would be the same
// app as every other project on that origin, and Chrome would offer no install while one of them is installed.
if (manifest.id !== '/hush-pond/') fail(`manifest.webmanifest id must be "/hush-pond/", not ${JSON.stringify(manifest.id)} (see DECISIONS.md)`);
const named = [
  ...(manifest.icons ?? []),
  ...(manifest.screenshots ?? []),
  ...(manifest.shortcuts ?? []).flatMap((s) => s.icons ?? []),
].map((entry) => entry.src);
for (const src of named) {
  if (!existsSync(join(out, src))) fail(`manifest.webmanifest names ${src}, which is not in the build`);
}

console.log(
  `build-pages: release ${version} — ${modules.length} modules hashed, ${precache.length} files precached → ${relative(root, out) || out}`,
);
