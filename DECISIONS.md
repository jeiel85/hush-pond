# Decisions

## 2026-11-03 · Offline PWA: a service worker that caches one verified release

**Context.** The pond should install as an app and open without a network (it is often left
running as a wallpaper). That needs a service worker. The previous decision rejected a service
worker *as the cache-busting mechanism*; here it is for offline use, and it builds on the hashed
release instead of replacing it.

**Decision.** `sw.js` precaches exactly the files of the release it was built with. The build
writes that list into the worker together with each file's content hash, and the worker checks
every response against its hash before storing anything: a release is cached whole or not at all,
so a CDN edge still serving an older file right after a deploy can't produce a mixed offline copy
(the install fails and the browser retries later). Pages are network-first and never written to
the cache, so a newer page is never paired with older cached modules; offline, the release's own
page is served. The page registers the worker only when the build stamp
(`<meta name="hush-build">`) is present, so development servers never cache anything.

**Alternatives considered.**
- *Workbox* — mature, but a dependency and a build step for ~80 lines of worker logic.
- *Stale-while-revalidate for everything* — simpler, but can serve and store files from two
  releases at once, which is exactly the bug the hashed build exists to prevent.
- *Installable without offline (manifest only)* — meets install criteria in current Chromium,
  but a wallpaper or a phone in airplane mode would show an error page.

**Reversal.** Ship a `sw.js` that unregisters itself and clears `hush-pond-*` caches, then remove
the registration call; deleting the file alone would leave installed workers running.

## 2026-11-03 · Deploy Pages from a workflow that hashes module URLs

**Context.** GitHub Pages serves every file with `Cache-Control: max-age=600` and ignores query
strings. The app is plain ES modules with relative imports, so right after a deploy a browser can
run a freshly fetched module next to a stale cached one — e.g. a new `main.js` calling
`audio.resume()` on an old `audio.js` that doesn't have it. (Tracked in #1.)

**Decision.** Switch the Pages source from "deploy from branch" to a GitHub Actions workflow
(`.github/workflows/pages.yml`). It runs `scripts/build-pages.mjs`, which copies the site to
`_site/`, gives the stylesheet and entry script a `?v=<content hash>` URL, and adds an import map
that maps every module in `js/` to its hashed URL. The source tree is unchanged and still runs
from any static server.

**Alternatives considered.**
- *Hash-stamp `index.html` by hand before each commit* — no infrastructure, but relies on
  remembering; a forgotten stamp silently brings the bug back.
- *Versioned paths (`/assets/<hash>/…`)* — fully immune to Pages ignoring query strings, but needs
  import rewriting inside every module: a real build step for a no-build project.
- *Service worker that pins a release* — strongest control, but adds an update lifecycle and its
  own staleness bugs; far more than the problem needs.

**Trade-off accepted.** A page whose `index.html` is itself stale and whose old module URLs were
evicted from the cache can still receive new module contents (Pages ignores `?v=`). That needs a
stale document *and* a partial cache within ten minutes of a deploy — much narrower than before,
where any mix of cache ages could pair files. Browsers without import-map support (Safari < 16.4)
fall back to plain URLs, i.e. today's behaviour.

**Reversal.** Set Pages back to "Deploy from a branch" (`main`, `/`) and delete the workflow; the
source tree needs no change.
