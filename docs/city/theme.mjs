// One surface for every city panel: the HUD's own dark glass. A panel is part of the view of the
// city, not a page laid over it: it is translucent, it keeps to a side, and it never covers the
// whole map -- on a narrow window it becomes a sheet along the bottom and the street stays in
// sight above it. Appended after the panels' own rules (view.mjs), which it settles.
export const THEME_CSS = `
#city,#city-side{--cp:rgba(17,24,39,.82);--ci:#f1f5f9;--cm:#a9b6c4;--cb:rgba(255,255,255,.09);background:var(--cp);color:var(--ci);
  -webkit-backdrop-filter:blur(12px) saturate(1.15);backdrop-filter:blur(12px) saturate(1.15);border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.32);
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) transparent}
#city-side{width:min(380px,calc(100vw - 24px));max-height:min(calc(100vh - var(--city-under,72px) - 130px),74vh)}
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
@media (max-width:900px){
  #city-side,#city-side.wide{top:auto;bottom:96px;left:8px;right:8px;width:auto;max-height:44vh}
}`;
