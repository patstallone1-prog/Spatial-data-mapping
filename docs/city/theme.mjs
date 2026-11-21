// One surface for every city panel: the HUD's own dark glass. A panel is part of the view of the
// city, not a page laid over it: it is translucent, it keeps to a side, and it never covers the
// whole map -- on a narrow window it becomes a sheet along the bottom and the street stays in
// sight above it. Appended after the panels' own rules (view.mjs), which it settles.
export const THEME_CSS = `
#city,#city-side{--cp:rgba(17,24,39,.9);--ci:#f1f5f9;--cm:#a9b6c4;--cb:rgba(255,255,255,.09);background:var(--cp);color:var(--ci);
  border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.32);
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}
#city-side{width:min(380px,calc(100vw - 24px));max-height:min(calc(100vh - var(--city-under,72px) - 130px),74vh)}
#city-clerk{position:fixed;left:50%;bottom:calc(var(--city-under,72px) + 64px);transform:translateX(-50%);z-index:40;width:min(520px,calc(100vw - 32px));
  background:rgba(17,24,39,.92);color:#f1f5f9;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 40px 12px 16px;box-shadow:0 8px 28px rgba(0,0,0,.35);font:14px/1.45 system-ui,sans-serif}
#city-clerk b{display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#a9b6c4;margin-bottom:4px}
#city-clerk p{margin:0}
#city-clerk a{color:#7cc4ff;font-weight:600;text-decoration:underline;cursor:pointer}
#city-clerk button{position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:12px;border:0;background:rgba(255,255,255,.1);color:inherit;cursor:pointer}
#city-side.wide{width:min(460px,calc(100vw - 24px))}
#city-side select{max-width:100%}
#city-side button,#city button{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.09);color:inherit}
#city-side button:hover:not(:disabled),#city button:hover:not(:disabled){background:rgba(255,255,255,.17)}
#city-side button:disabled,#city button:disabled{opacity:.5;cursor:default}
#city-side button.primary,#city button.primary,#city-side .tabs button[aria-pressed=true],#city .tabs button[aria-pressed=true]{background:#2f6fe4;border-color:#2f6fe4;color:#fff}
#city-side select,#city-side input,#city select,#city input{border-color:rgba(255,255,255,.2);background:rgba(0,0,0,.28);color:inherit}
#city-side input::placeholder,#city input::placeholder{color:rgba(255,255,255,.5)}
#city-side option,#city option{color:#111;background:#fff}
#city-side td,#city td{border-top-color:rgba(255,255,255,.1)}
#city-side a,#city a{color:#8ab4ff}
/* ("body" in front: these come before the profile's own rules in the page and must outrank them.)
   The profile: as big as what is in it, centred, with the city left in sight round it (no dimmed
   screen behind, no empty panel below the last tile). */
body #city.pop{left:50%;right:auto;transform:translateX(-50%);top:max(12px,4vh);bottom:auto;width:min(900px,calc(100vw - 32px));max-height:calc(100vh - max(12px,4vh) - 110px);padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
body #city.pop .me{gap:12px;margin-bottom:8px}body #city.pop .me .face{width:72px;height:72px}
body #city.pop .me h2{font-size:18px}body #city.pop .me .worth{font-size:22px}
body #city.pop .tiles{grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:8px;margin-bottom:8px;align-items:start}
body #city.pop .tile{padding:8px 10px}body #city.pop .tile h4{margin-bottom:4px}
@media (max-width:900px){
  #city-side,#city-side.wide{top:auto;bottom:96px;left:8px;right:8px;width:auto;max-height:44vh}
}`;
