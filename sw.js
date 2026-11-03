// Service worker: keeps the pond working offline once it has been opened.
//
// The deploy build (scripts/build-pages.mjs) writes VERSION and PRECACHE: every file of the release
// with its content hash. The page registers this worker only on that build, so the plain source
// tree (empty list below) never caches anything during development.
const VERSION = 'dev';
const PRECACHE = [];
const CACHE = `hush-pond-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;

async function digest(buffer) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Fetch and check every file before storing any. Right after a deploy a CDN edge can still
      // serve an older copy of some file; a release is only cached whole and exactly as built,
      // otherwise installing fails and the browser retries on a later visit.
      const responses = await Promise.all(
        PRECACHE.map(async ({ url, hash }) => {
          const res = await fetch(url, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`precache ${url}: HTTP ${res.status}`);
          if ((await digest(await res.clone().arrayBuffer())) !== hash) {
            throw new Error(`precache ${url}: content is not from release ${VERSION}`);
          }
          return [url, res];
        }),
      );
      const cache = await caches.open(CACHE);
      await Promise.all(responses.map(([url, res]) => cache.put(url, res)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('hush-pond-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? page(request) : asset(request));
});

// Pages: always ask the network first so a new release shows up as soon as it is deployed. Offline,
// fall back to this release's own copy of the page, whose module URLs all point into the same cache.
// Network responses are deliberately not stored: a newer page must not be paired with older modules.
async function page(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const path = new URL(request.url).pathname;
    if (path === SCOPE || path === `${SCOPE}index.html`) {
      const shell = await (await caches.open(CACHE)).match('./');
      if (shell) return shell;
    }
    throw err;
  }
}

// Everything else is content-addressed or rarely changes: serve this release's copy, else the network.
async function asset(request) {
  const hit = await (await caches.open(CACHE)).match(request);
  return hit ?? fetch(request);
}
