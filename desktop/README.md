# Kerbside desktop app

Kerbside in a window of its own (Electron), instead of a browser tab. It loads the live site,
so it is always the current version.

What it changes compared with Chrome:

- **Its own process and memory.** It is kept apart from your other tabs and extensions, so the
  browser can never discard or freeze it.
- **Never throttled.** It keeps full speed in the background or behind another window.
- **The fast GPU.** It asks for the high-performance GPU and gives it a quarter of the machine's
  memory.
- **Recovers from crashes.** A crashed page loads again by itself.

What it does not change: a page's script heap is still capped at about 4 GiB. Electron's V8,
like Chrome's, is built with pointer compression, so `--max-old-space-size` cannot raise the cap
(measured 4.09 GiB). The page's memory governor (module 28) works to that limit.

```bash
cd desktop
npm install && node node_modules/electron/install.js   # npm 11 skips Electron's download step
npm start                                              # the live site
npm run local                                          # http://localhost:8771/app-model.html
npm run package                                        # out/Kerbside-darwin-arm64/Kerbside.app
codesign --force --deep --sign - out/Kerbside-darwin-arm64/Kerbside.app
```

`icon.icns` is made from `docs/icon-512.png` (`sips` + `iconutil`).
