# Kerbside on the system's WebKit

This is Kerbside as a macOS app, built from one AppKit file (`Kerbside.swift`) with a WKWebView inside one window. It loads https://spatial-data-mapping.vercel.app/app-model.html. It bundles no Chromium: the page runs in the WebKit that ships with macOS, the same engine Safari uses. There is no Xcode project and there are no packages.

## Build

```sh
./build.sh          # swiftc -O → out/Kerbside.app (bundle id app.kerbside.webkit), ad-hoc signed
```

It needs only `/usr/bin/swiftc`. The build takes about 30 s and produces a **240 KB** app. `desktop/icon.icns` is copied in as the app's icon.

## Run

```sh
open out/Kerbside.app                                    # the live site
out/Kerbside.app/Contents/MacOS/Kerbside --url=http://localhost:8771/app-model.html
KERBSIDE_URL=<page> out/Kerbside.app/Contents/MacOS/Kerbside
```

What the app does, mirroring `desktop/main.js`:

- **Website data persists.** It uses `WKWebsiteDataStore.default()`. Site data goes in `~/Library/WebKit/app.kerbside.webkit`, and the HTTP cache in `~/Library/Caches/app.kerbside.webkit/WebKit/NetworkCache`.
- **Only trusted hosts stay in the app.** These are `spatial-data-mapping.vercel.app`, `djllcgon03ax2.cloudfront.net`, the start URL's origin, and localhost. Any other http(s) link, or `window.open`, goes to the default browser.
- **Media permissions:** camera and microphone requests are granted for the trusted origins and denied elsewhere. Geolocation uses the system prompt (the Info.plist has the usage strings).
- **JS panels:** alert, confirm and prompt are shown as sheets.
- **Crash reload:** if the web content process dies, the app prints `kerbside: {"kind":"terminated",...}` and reloads the page.
- **Menus:**
  - Quit (⌘Q)
  - Edit: Copy, Paste, Select All, Undo/Redo
  - View:
    - Reload (⌘R)
    - Toggle Full Screen (⌃⌘F)
    - Open the live site, Open in the browser
    - Open Web Inspector (⌥⌘I). Developer extras are on and `isInspectable` is set, so right-click → Inspect Element also works, and Safari's Develop menu can attach.
- **No throttling behind other windows.** WebKit's window-occlusion detection is turned off with SPI, used only if present. Without it, a covered or locked window makes the page `document.hidden`, and rAF stops.
- **Errors reach stdout.** `window.onerror`, `unhandledrejection`, `console.error` and `console.warn` are forwarded through the `kerbsideLog` message handler and printed as `kerbside: {"kind":"page-log",...}`.

## Measure

```sh
python3 measure.py --smoke           # 40 s check: renders, polling works
python3 measure.py --cold            # clear only this app's own data dirs, then a full run
python3 measure.py                   # warm run   (--seconds 300 --after-lobby 90 --interval 2)
python3 report.py measure-<stamp>-<mode> [notes.md]   # (re)write REPORT.md from the run's files
```

### What `--measure` makes the app do

- It sets `localStorage['kerbside:mode'] = 'city'` at document start.
- Every second it polls the page and prints one `sample` JSON line. A sample holds:
  - load state, load fraction, and the load screen's line
  - people and vehicles
  - `renderer.info` memory and render figures
  - fps from requestAnimationFrame
  - `performance.memory`, if present
- It presses Enter when the lobby is up, and again once loading has finished.
- It prints the available APIs once.

### What `measure.py` does

1. Launches the app under `caffeinate -i -d`.
2. Every 2 s, samples the app and its own WebKit XPC helpers: WebContent, GPU and Networking.
   - The helpers are children of launchd, not of the app, so `pgrep -P` cannot find them. The WebContent and GPU pids come from the app itself, through WebKit SPI.
   - The Networking pid is the one WebKit helper that is new in the first 15 s after launch.
3. Records, for each process:
   - `footprint -p`: physical footprint, plus the memory categories every 30 s. It needs no sudo for our own processes.
   - RSS from `ps`.
   - CPU, computed from deltas of `ps` cumulative CPU time.
4. Stops the run if free disk falls below 700 MB.
5. After 90 s in the city, quits the app with SIGTERM.
6. Writes `measure-<stamp>-<mode>/`:
   - `timeline.csv`
   - `page.jsonl`
   - `summary.json`
   - `REPORT.md`
   - `stderr.log`

## Measured (2026-11-18, macOS 15.7.3, Apple silicon, 16 GiB)

Full figures are in `measure-20261118-202924-cold/REPORT.md` and `measure-20261118-203510-warm/REPORT.md`.

| | WebKit app (this) | Electron app (desktop/) |
|---|---|---|
| bundle on disk | 240 KB | 289 MB (`~/Applications/Kerbside.app`, not rebuilt) |
| website data after a cold City load | 186 MB HTTP cache + 1.5 MB site data | not measured |
| time to the city, cold / warm | 145 s / 137 s | brief says 80 to 120 s in Chrome (not measured here) |
| page heap ceiling | none hit: WebContent footprint reached ~10 GB, with no crash | ~4 GiB (V8 pointer compression) |
| `performance.memory` | absent, so the page's desktop memory governor never runs | present, so the governor trims at 3.1 GiB |
| fps in the City (Marina) | 4.7 median (frames 200 to 270 ms) | 24 to 42 fps in earlier notes (not re-measured) |

Steady footprint in the city was 5.8 GB (warm) to 7.4 GB (cold) for WebContent, plus about 650 MB for the GPU process. Peaks came while the people and traffic were spawning.

### What it gives over the Electron app

- 289 MB less on disk, and no Chromium to update.
- No 4 GiB script-heap ceiling.
- The system's WebKit security updates.

### What it does not give

- **Frame rate.** The City ran at about 5 fps here, while the main thread was mostly idle. Something in WebKit's out-of-process WebGL path, or the GPU, is the limit; it has not been profiled.
- **The page's memory governor.** It is off because there is no `performance.memory`, so nothing holds the page to a budget, and the excess goes to compression and swap.
- **Performance APIs.** There is no `measureUserAgentSpecificMemory`, no `navigator.deviceMemory` and no WebGPU in this WKWebView.
- **Chrome DevTools/CDP.** You debug with Safari's Web Inspector instead.

Until the frame rate is understood, the Electron app remains the faster way to play.
