"""Street paint from a second source, cleaned for the page.

OpenStreetMap says where the streets are and, sometimes, how many lanes they have. It says very
little about what is painted on them: a stop line, STOP written across a lane. The page inferred
those from the map alone, and painted a stop approach only where a crosswalk happened to be
mapped across it -- so half the stop signs in the Marina had bare asphalt in front of them.

:mod:`smc.paint.clean` takes the city's own record (SFMTA's stop signs, one row per governed
approach) and turns it into the short list of facts the page needs, with everything the page
could trip over taken out first: rows without a position or a direction, rows listed twice,
rows for a sign that is no longer there. ``tools/build_street_paint.py`` writes the result as
``docs/street-paint.json``; ``docs/street-paint.mjs`` is the page's half, which matches each
fact to a drawn approach and decides, for every piece of paint from every source, which one is
laid where two would land on the same asphalt.
"""

from smc.paint.clean import SCHEMA, clean_stop_signs, facing_degrees, paint_document, street_key

__all__ = ["SCHEMA", "clean_stop_signs", "facing_degrees", "paint_document", "street_key"]
