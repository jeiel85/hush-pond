# Decisions

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
