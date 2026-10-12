# Production billboard implementation

The shared app renderer now draws billboard-sized, framed structures instead of
rendering every advertising record as a 1.2 × 1.8 m bus-shelter panel. The same
implementation is generated into all eight regional app consumers. Other furniture,
canonical buildings, roads and pedestrian geometry remain unchanged.

## Inventory and geometry

The existing inventory contains **59 distinct billboards**: SF corridor 25,
Mission 7, Haight–Castro 1, Sunset 2, Oakland 22 and San Jose 2. Berkeley and Palo
Alto have no billboard records in this inventory; they are not filled with invented
ones. Oakland's two served/reference sidecars contain duplicate records of the same
22 billboards, not 44 distinct structures.

Fresh OSM API tag reads recovered 126 advertising records, including smaller panels
and columns. Billboard dimensions, support, roof/wall mounting, facing, sidedness,
links and provenance are retained. The documentation distinguishes display `size`
from total device `height`, including supports:
[OSM advertising examples](https://wiki.openstreetmap.org/wiki/Advertising_devices_examples).

Only one billboard has explicit face dimensions. The remaining 58 use labelled
inferred standard poster proportions (about 7.62 × 3.66 m), not claimed measured
sizes. These are based on the familiar approximately 25 × 12 ft poster format:
[OAAA billboard formats](https://oaaa.org/wp-content/uploads/2022/09/VTTI-Billboard-Safety-Study-2003.pdf).
Obtaining every structure's actual dimensions still requires further source evidence.

Mapped billboard anchors are not snapped into sidewalks like small traffic signs.
Roof-mounted devices stand above the canonical building roof; wall-mounted devices
can resolve against a nearby footprint wall, without adding ground poles. Explicit
facing follows clockwise-from-north azimuth; otherwise facing remains inferred.
Two-sided boards have independently oriented faces, so rear lettering is not mirrored.
Single-sided boards have a plain rear rather than an advertisement visible through it.

## Images and links

Campaign registration is `data/billboard-creatives.json`, keyed by stable OSM asset ID:

```json
{
  "image": "billboards/example.webp",
  "href": "https://advertiser.example/landing",
  "license": "your documented image rights",
  "attribution": "image owner",
  "approved": true,
  "fit": "contain",
  "label": "campaign description"
}
```

Place the image under `docs/billboards/`, add the entry under `boards`, then run
`PYTHONPATH=src python scripts/build_billboards.py` and `tools/build_app_worlds.py`.
The build checks local asset containment, approval, rights metadata and a safe target,
then records the asset SHA-256 in `docs/billboard-creatives.json`. Approved images load
on first visible render and are shared by hash/aspect, not fetched every frame. Image
aspect is preserved with `contain`; explicit `cover` crops without stretching.

Only HTTP(S) destinations without embedded credentials are accepted. A click opens
a new external tab with `noopener,noreferrer` and does not move the avatar. Hidden,
detached or building-occluded faces cannot activate. Active attached regions expose
their billboard faces to the same host picking logic. Region release clears face and
texture references.

No real advertising images or advertiser destinations were supplied. Unconfigured
boards therefore link to their mapped OSM source page, not a guessed advertiser.
One project-owned, clearly labelled Kerbside demo overlay is registered at
OSM node 6970578437, above **500 Presidio Avenue, San Francisco**. It is illustrative
artwork, not a claim about the actual advertisement currently on that roof.

## Verification

- Focused tests cover metre/foot conversion, total versus display height, explicit
  ground level, default uncertainty, facing/sides, unsafe links, aspect-preserving
  image placement, occlusion, detached/hidden objects and attached-region picking.
- Shared-renderer equality and module syntax are checked across all eight consumers.
- An isolated WebGL preview uses the actual production functions. Its front image,
  single-sided plain rear and external click were visually verified.
- In the full SF viewer, the board stands above the roof at 500 Presidio Avenue, the
  image renders without distortion, and clicking its face opens the correct OSM page
  without changing the view or moving the walker.
- Published sidecars and their window cells are upgraded together, so streaming does
  not discard dimensions or links. Unrelated furniture arrays are preserved.

Deployment uses the existing protected-main CI/Vercel release path. No gate is bypassed.
