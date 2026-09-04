# Waymo Open Dataset — provenance of access

**This records a deliberate decision, so that nobody downstream has to reconstruct it.**

## What was decided

On 2026-09-03 the operator of this project directed that Waymo Open Dataset content be obtained
from a **third-party mirror on Hugging Face** rather than from Waymo's own distribution:

    https://huggingface.co/datasets/AnnaZhang/waymo_open_dataset_v_1_4_3

The instruction was explicit and was given after the alternative — registering at
<https://waymo.com/open/> and accepting the licence directly — had been put to them in writing,
along with what follows below. This file exists because that is the kind of decision that should
leave a record rather than be inferred later from a download log.

## What the mirror is

- Ungated and public on Hugging Face: ~29,400 downloads, 2,030 `.tfrecord` files.
- It is **Waymo Open Dataset v1.4.3**, the TFRecord release — not the v2.0.1 Parquet release
  that Waymo's own bucket serves.
- It carries **no licence tag** of its own on Hugging Face.

## What it does and does not change

It changes reachability. Waymo's own bucket refuses anonymous callers — verified directly over
HTTPS, not merely inferred from a local credential error:

```
401  waymo_open_dataset_v_2_0_1     401  waymo_open_dataset_v_1_4_3
401  waymo_open_dataset_v_1_4_2     401  waymo_open_dataset_scene_flow
"Anonymous caller does not have storage.objects.list access"
```

It does **not** change the licence position, and that should be stated plainly:

1. The Waymo Dataset Licence Agreement permits redistribution only to people who have themselves
   registered and accepted its terms. A public re-upload is outside that permission, so the
   mirror's own existence is likely a breach by whoever uploaded it.
2. Obtaining the data this way routes around the registration check. It does not grant rights
   that the licence conditions on registration.
3. The non-commercial restriction is **inherited** regardless of the route taken. It covers
   derivative intellectual property, which includes any curb model trained on this data. Such a
   model is permanently non-commercial, and anyone given it must be given the licence with it.

Point 3 holds whichever source is used, and it is the one with lasting consequences for this
project. This project has accepted a non-commercial footing, which is what makes the restriction
tolerable rather than fatal.

## How to make this clean

Registering at <https://waymo.com/open/> under a Google account and accepting the terms takes a
few minutes and removes item 1 and item 2 entirely, leaving only the inherited non-commercial
restriction — which is unavoidable and already accepted. `scripts/ingest_waymo_sf.py` reports
which step is outstanding at any time. If that registration happens, this file should be updated
to say so, not deleted.
