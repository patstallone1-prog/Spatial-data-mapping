"""Water above and below the street: streams, storm drains and sewer lids, the gutters that lead
to them, where the water goes once it is in, treatment plants and water storage tanks.

* :mod:`smc.waterworks.osm` reads OpenStreetMap (a Geofabrik extract) for the streams, tanks,
  treatment plants and manholes, and the street junctions an unpublished sewer has lids at.
* :mod:`smc.waterworks.drains` sorts every published inlet into the form it is built as (a curb
  inlet with a grate, a curb opening, a grate, a trench drain) and traces where its water goes.
* ``renderer.mjs`` draws what is above ground; what is below (pipes, cisterns, buried
  reservoirs) is kept as data only.
"""

SCHEMA = "kerbside.waterworks/1"
MANIFEST_SCHEMA = "kerbside.waterworks_tiles/1"
