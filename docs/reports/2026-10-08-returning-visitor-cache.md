# Installed-app returning-visitor investigation

## Findings and limits

The installed `Kerbside.app` inspected on this Mac is a Chrome PWA pointing to
`https://spatial-data-mapping.vercel.app/app.html?from=home`. It is not a Safari web app.
Its existing settings were High quality, Unlimited frame rate and Whole region.
Chrome reported approximately 3.8 GB during loading and 5.2 GB after the map became
interactive. This is a page-memory indication, not a measured V8 heap limit or proof
of an out-of-memory crash. No spontaneous restart was reproduced on this visit.
The other Mac's reported restart from 0 remains to be verified after deployment.
Free disk space alone cannot establish or exclude renderer memory pressure.

PR #30 was already merged at `a49b47bb`. The later shell-only worker change was
uncommitted; this pass carried it into a separate worktree and hardened it.

## Changes

- Cache Storage holds only the seven root shell resources. Regional viewers, world
  payloads, cells, tiles and materials do not get duplicate service-worker copies.
- A new shell-cache namespace allows existing populated legacy caches to be retired.
  Deletion is restricted to known legacy runtime names and obsolete shell versions.
  Capture IndexedDB, capture caches, preferences and unrelated caches are preserved.
- Shell URL query variants share one canonical key. Root shell ownership uses exact
  scoped paths rather than suffixes that also matched regional viewers.
- Shell responses are network-first/revalidated. Offline regional viewers never receive
  `app.html` as their HTML fallback: that could instantiate another nested app/model.
  An unavailable regional viewer returns an explicit 503 instead.
- Worker source changes participate in both build paths' cache fingerprints. Shell
  manifest/icon changes also invalidate the app-world worker fingerprint.
- Load markers are per-tab session state, not shared localStorage state. Normal
  pagehide clears the marker; another tab, a future timestamp or a malformed level
  cannot cause false crash recovery or an invalid/NaN window.
- Recovery awaits deletion of obsolete runtime caches before requesting world data.
- A stationary restored spawn cannot repeatedly navigate merely because it is near
  the lighter build's boundary. Movement can still trigger the intended new window.
- An initial frame no longer marks a load as successful while asynchronous ground
  construction is still running. Both street and ground readiness are required.
- Model startup/resource/context failures are surfaced in the app with a manual
  Retry map button. Retrying reloads only the 3D iframe, not capture/upload state.
- Mutable tile/material indexes revalidate HTTP cache instead of forcing stale copies.

These changes do not simplify meshes, reduce triangle counts, change quality defaults,
or alter canonical world geometry. Ordinary HTTP caching remains distinct from the
removed service-worker world cache. The offline guarantee is the shell, not a full world.

## Evidence

Focused verification: 28 pytest cases passed, plus 12 behavioral Node subtests.
Shared-renderer syntax/hash checks cover all eight app consumers. Ruff and diff checks pass.

The persistent-browser fixture at `http://127.0.0.1:8901/__cache_qa__.html` first
registered an old cache-first worker and returned a deliberately stale synthetic world.
After upgrading the actual generated worker and reloading the page, it returned the
network revision, retained exactly seven shell URLs despite query variants, and
preserved a synthetic IndexedDB capture plus unrelated/capture caches.
Screenshot: `build/verification/cache-upgrade.png` (local artifact, not a deployed asset).

The real generated SF viewer also reached an interactive scene under that worker
with `?light=3` and no reported console errors. This checks the new path, not the
friend's particular machine or an unrestricted whole-region peak-memory budget.

Reproduce the focused checks:

```sh
node --test tests/browser_cache.test.mjs
pytest -q tests/test_browser_cache.py tests/test_light_build.py tests/test_pwa_full_3d.py tests/test_renderer_template_sync.py tests/test_rooms_settings_and_pacing.py
python tools/cache_qa_server.py
```

The fixture is localhost-only and uses synthetic data; do not seed a test worker
into a production origin. Production captures were not cleared during this pass.

## Release status at preparation

Direct Vercel project inspection returned a team-scope 403 for `kerbside1`.
No credentials were extracted and no protection or CI checks were bypassed.
Production publication requires approval and successful repository CI; the existing
Git integration can publish a merged change without a direct Vercel API deployment.
