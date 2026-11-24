# Vendored from Kerbside

`renderer.mjs` is `src/smc/exteriors/renderer.mjs` copied unchanged from Kerbside commit
`e34da831890c6024eb8eede692544c810656f003` (origin/main, 2026-11-24). The studio mounts storefront bands with it exactly as the
app does (`createExteriorRenderer(...).mount(group, plan)`), so a model's storefront looks the
way the app would draw it; everything above and around the band (walls, upper windows, roof,
awnings beyond sign canopies, seating, street) is the studio's own (`../building.mjs`).

To refresh: `git show origin/main:src/smc/exteriors/renderer.mjs > studio/kerbside/renderer.mjs`.
`assets-manifest.json` is the app's brand-artwork manifest; the artwork files themselves are not
copied (chain logos fall back to lettering).
