# Production Review — 2026-08-23

Answers to the six findings from the external test pass. 354 tests, lint clean.

```bash
make install-dev   # ruff and mypy were missing; this installs them
make check         # lint + tests
```

---

## 1. The vantage break — resolved, with a caveat that only photographs can close

**Confirmed and characterised.** A reference index built from a roadway survey anchors roadway
captures and does not anchor footway captures at all. Isolating the stages showed where it
fails, which the original finding did not:

| Stage | Result |
|---|---|
| Retrieval | **Works** — 6 of 6 frames retrieved the correct reference, similarity 0.47 |
| Surface overlap | **43%** of what the wearer sees, the rig also sees |
| Local feature matching | **1–4 correspondences**, against 10 needed |

So the two cameras genuinely look at the same wall, and retrieval finds it. The descriptors do
not survive the change of viewpoint.

**Two things were built.** `smc/mapping/affine.py` implements ASIFT-style view simulation —
warping reference imagery through tilts and rotations at index-build time so one place carries
descriptors from several directions. It raises features per reference from 248 to 1904 and
lifts cross-vantage matches from ~2 to ~3. **It does not bridge the gap**, and that is reported
rather than buried.

`survey_vantages()` is the answer that works: survey **both** vantage classes into one index.

| Contributor | Index | Anchored | Error |
|---|---|---|---|
| Wearer (footway) | multi-vantage | 6 / 15 | **0.012 m** mean, 0.035 max |
| Vehicle rig (roadway) | multi-vantage | 11 / 15 | **0.057 m** mean, 0.193 max |

One index, both contributor types, real matching. The cost is honest: a corridor must be driven
*and* walked. That is cheaper than one that silently fails half its contributors.

**What simulation cannot settle.** Whether the gap is a property of SIFT or of the renderer's
synthetic texture is undecidable here — the procedural detail is already marginal for
same-vantage matching. Only photographs settle it, and the decision matters: if real surfaces
bridge it, one survey pass per corridor suffices instead of two.

## 2. The oracle is no longer in any default path

`run_pipeline` and `python -m smc.ingest seed` both default to `matcher="opencv"`. The oracle
survives behind `--matcher oracle` for one purpose: running both separates "the geometry is
wrong" from "the matching is wrong", and without that separation a bad number says nothing
about where to look.

A current seed run, real matching: prior 10.44 m → **posterior 0.038 m mean, 0.062 m max**,
3 of 10 anchored. Note the reported sigma is now 0.062 m against an actual 0.038 m error —
conservative, where the earlier oracle run was optimistic.

Yield below 1.0 is the intended trade. Strict ratio, mutual and epipolar filters refuse rather
than guess, because an unanchored frame is withheld while a wrongly anchored one poisons every
fact built on it and nothing downstream can detect that afterwards.

## 3. Learned retrieval — still not present, and here is what it needs

`TinyImageDescriptor` remains the global descriptor. It is a real published baseline, not a
placeholder invented for the gap, and the isolation in §1 shows **retrieval is not currently the
bottleneck** — it found the right reference every time. Replacing it would not have fixed the
vantage failure.

It should still be replaced before any sellable claim. MegaLoc needs PyTorch (~2 GB) and
weights, which is a deliberate dependency decision rather than an oversight. The interface is
one class: implement `FrameDescriptor` and pass it to `seed_index`.

## 4. Integrations

| Integration | State |
|---|---|
| **Mapillary fetch** | **Implemented** — `nearby()` and `fetch_image()` issue real HTTP. Needs a token |
| **GCS upload** | **Implemented** — see §6 |
| Street View fetch | Stub. Internal-build only by the §0.1 licence finding; low value to complete |
| ARCore Geospatial | Resolves on-device through the ARCore SDK; the server class is a relay point |
| Meta camera streams | Blocked on the toolkit; publishing GA still targeted for 2026 |

## 5. Stale documentation — corrected

`docs/07-status.md` is marked superseded; its Part B claimed measurement extraction was
unwritten, which stopped being true two commits later. `docs/08` now points here for measured
figures rather than presenting oracle numbers as current.

## 6. GCS destination — implemented

`smc/ingest/destinations.py`. `--out gs://bucket/prefix` selects it; anything else is a local
folder.

- **Idempotent** — the object name is the frame's content hash, so a retried upload overwrites
  itself instead of creating a duplicate observation. A duplicate would inflate the
  corroboration count, which is the number the confidence model rests on.
- **Confirmed by the server's own size** — `blob.reload()` after upload. Only if that matches
  the payload length is the local copy deletable. `send()` returning True is what authorises
  deletion, so it must never mean "no exception was raised".
- **Checked at setup, not at 02:00** — `check_access()` runs before the batch and reports a
  missing credential with the command that fixes it.

## 7. A bug found while fixing these

`run_pipeline` used one batch-wide profile's intrinsics for every frame, while `FrameRecord`
already carried per-frame `focal_px`. A batch mixing sources — glasses, phone, vehicle rig —
would have solved PnP with the wrong camera and produced a confidently wrong pose. It presented
as the rig failing to anchor against an index that contained rig references. Now taken per frame
from the record.
