# Frontage filter — entrance band, frame share, first floor (13 October 2026)

The filter that picks each house's photographs (`smc.facades.frontage`, `smc.facades.frontage_pixels`,
`scripts/filter_frontage_photos.py`) now prefers the photograph a person would take of the house:
square on, the house filling the frame, the ground floor whole, its entrance and features visible.

## Geometry (before any pixels)

- **Entrance band, 35–40°.** A view up to 35° from square is kept as before. Between 35° and 40°
  (`--entrance-angle`, default 40) it is kept only if its pixels show the entrance (a door in the
  lower part of the frame, steps or a porch canopy); the facade's edge limit widens by the same
  5°. Past 40° a view is too oblique. Such views rank below every square-on view.
- **Frame share.** The house front's angular size over the frame: the photograph's field of
  view for a flat camera, a 90° × 67.5° view aimed at the wall for a panorama. Below 6% the
  house is a speck (`target_too_small_in_frame`); above it, shares rank in bands of 10%.
- **First floor whole.** Every sampled point of the bottom 3.5 m must project into the frame
  (`first_floor_cut_off`), so a bonnet or the image's edge does not clip the entrance.
  Views that see the ground floor from near eye level (pitch ≤ 20°) rank above rooftop and drone
  views.

## Pixels

`detail_measures` reads the segmentation the screen already runs (UperNet, ADE20K labels):

- entrance: a door in the bottom 45% of the frame, or steps or a canopy there with a door or
  railing beside them (so a stair-like shadow is not an entrance);
- detectable features: window and door blobs counted as openings;
- squareness: the rectilinearity heuristic.

`view_gate` then rejects a view in the entrance band that shows no entrance
(`oblique_without_entrance`), a view with no openings at all (`no_detectable_openings`), and one
that does not square up (rectilinearity < 0.30, `not_squared_up`).

## Checks

Four new tests (38° with and without an entrance, 43° rejected; frame share; first-floor
cut-off and aerial pitch; label-derived entrance, features and squareness); the filter suite
passes (30).

The re-scored counts on the overnight candidates are not here: the candidate cache is on the
HP P700, which was unplugged when this was written. The next supervised run uses the new
rules; the HP P700 and battery gating is unchanged.

The blind HABS test of the reconstruction these photographs feed is on the
[validation page](../validation/index.html).
