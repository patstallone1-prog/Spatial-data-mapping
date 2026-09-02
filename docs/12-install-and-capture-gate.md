# 12 · Installing it, and what the shutter refuses

## What a "download" is here

There is no `.apk` and no `.ipa`. Kerbside is a web app, and the thing that puts an icon on a
phone's home screen is an install, not a file transfer. The three platforms differ, and the
buttons are built around the difference rather than around a shared pretence:

| Platform | What the button does | Why |
|---|---|---|
| Samsung / Android | Fires the browser's own install prompt | Chrome and Samsung Internet raise `beforeinstallprompt` on an installable page; holding that event lets a button perform the install |
| iPhone | Shows the three taps | Apple routes every install through the Share menu and exposes no API to any site. A button that claimed to install would be lying |
| Desktop | Opens the app; install from the address bar | The field tool is a phone |

Alongside them, **Save the file** is a genuine download of `app.html`. It is deliberately
secondary and it says why: a file opened from Downloads or Files runs on `file://`, and every
browser refuses both the camera and geolocation there. A saved copy can show the map and read
imported photographs. It cannot capture.

Installability is not a claim, it is a checklist, and all of it now ships in `docs/`:

- served over https (GitHub Pages)
- `manifest.webmanifest` with `start_url`, `scope`, and 192/512/maskable icons
- `sw.js` with a `fetch` handler — Chrome will not offer an install prompt without one
- both `index.html` and `app.html` link the manifest and register the worker, so the prompt is
  available on the page the person is actually standing on

The service-worker cache name carries a digest of the built app. Without that, a phone that has
already installed keeps opening the previous build out of its own cache — a deploy that silently
did not happen, which looks exactly like a working app.

## The shutter refuses two things

### A frame with no position

Every photograph the camera takes is stamped with the fix that was current when the shutter
fired. If there is no fix, there is no photograph.

This is not caution, it is the lesson of 132 real captures. Every one of them came back with
Location Services off, so not one could be placed, and no amount of work afterwards recovers a
position that was never recorded — it is not in the pixels. Location is now requested before the
camera opens, and the shutter stays locked until a fix arrives that is under 20 seconds old and
better than 65 m. Both readouts are on the capture screen, so the state is visible before the
walk rather than discovered after it.

A refusal is explained rather than merely shown: *allow it While Using the App* is the exact
phrase the phone offers, and it is the setting that makes this work.

Two related rules:

- The automatic trigger honours the same gate as the shutter, so nothing slips through the
  distance path that the manual path would have refused.
- An imported photograph keeps only the position it carries itself. It no longer inherits the
  phone's current fix — a picture taken yesterday across town would otherwise arrive stamped
  with where you are standing now, and downstream nothing can tell that from a measurement.

### A frame off the narrow lens

The app opens the wide lens — what the camera UI calls 0.5× — and refuses the main one.

Measured on 328 pairs from this project's own capture sets, degraded to the 1440×1080 the Meta
toolkit actually delivers:

| Lens | Field of view | Pairs | Usable (≥15 inliers) | Median inliers |
|---|---|---|---|---|
| Main | 69° | 138 | 20% | 8 |
| Wide (0.5×) | 104° | 190 | **51%** | **16** |

The wider frame carries more of the kerb line into the overlap, so there is something to match
on. Half the frames anchoring against a fifth is the difference between a corridor that
reconstructs and one that does not.

Two mechanisms find it, because the platforms expose it differently:

1. **A separate device.** iOS and Chrome both enumerate `Back Ultra Wide Camera`, but only once
   camera permission has been granted at least once — before that every label is empty. So the
   app opens a stream first and re-opens on the wide device second. The match is on `ultra`
   specifically: `Back Dual Wide Camera` is a virtual device that starts at 1×, and a looser
   pattern would pick the wrong lens on every iPhone.
2. **Minimum zoom.** Android usually exposes one logical back camera that zooms out past 1×
   instead of a second device. Its minimum zoom is the same optics the camera app labels 0.5×.

Where neither works the shutter stays locked and says so. An override exists for that case, one
tap, clearly labelled — and frames taken through it are stored as `lens: "main"` so the dataset
can always separate them from the wide ones rather than quietly mixing two fields of view.

Each stored frame now records `lens`, `zoom`, and `fixAgeMs` alongside its position.
