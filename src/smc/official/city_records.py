"""Where each city publishes the records the renderer wants, and how to read them.

San Francisco's are in :mod:`smc.official.datasf`, which knows its Socrata tables by id. The
other cities were treated as having nothing, which was wrong about all three of them:

* **Berkeley** publishes parcels, its street network and its streetlight and signal
  inventories on Socrata, and the reason they read as empty is not permission. A Socrata
  *geospatial* dataset -- a map layer rather than a table -- answers ``/resource/<id>.json``
  with a row of nothing per feature: ``[{}, {}, {}]``. The geometry is only served from
  ``/api/geospatial/<id>?method=export&format=GeoJSON``. The catalogue was readable the whole
  time; the wrong endpoint was being asked.

* **Oakland** publishes curb ramps, a surveyed curb-ramp characteristics table, and -- for
  exactly the blocks this project has built -- a downtown on-street parking and curb
  inventory.

* **Palo Alto** publishes a surveyed ``Road Edge`` line layer on its own ArcGIS organisation:
  1,441 of them inside the downtown box. That is a kerb line, the same class of record as San
  Francisco's Curbs and Islands, and it is the only non-SF city here with one.

Bus stops, benches, street lamps and signs are not in this module. Those come from
OpenStreetMap, which has them for every one of these cities and in one shape, and asking four
city portals for four dialects of the same fact would be worse data for more work.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Record:
    """One published layer, and what it is."""

    key: str                      #: what the renderer calls it
    title: str                    #: what the city calls it
    api: str                      #: "socrata_table" | "socrata_geospatial" | "arcgis"
    locator: str                  #: dataset id, or service URL
    host: str = ""                #: Socrata host, where that is how it is served
    layer: int = 0                #: ArcGIS layer id
    geometry: str = ""            #: the geometry column, for a Socrata table
    note: str = ""


#: What each city has, as verified by fetching it. A city with nothing for a key has nothing
#: recorded for it, rather than an empty answer dressed up as a measurement. The counts in the
#: notes are what came back for the region this project has built, not what the city claims.
CITY_RECORDS: dict[str, list[Record]] = {
    # Berkeley publishes none of this, and it took three endpoints to be sure of it.
    #
    # Its Socrata catalogue lists Parcels, Streets Network, Streetlights and Traffic Signals
    # and every one of them is a shell: /resource/<id>.json answers a row of nothing per
    # feature, and the full export behind /api/views/<id>/rows.json?accessType=DOWNLOAD --
    # which is 3.29 MB and does come down -- carries 29,024 rows with zero data columns. Not
    # a permission problem and not the wrong endpoint. There is nothing in them.
    #
    # Its real GIS is an ArcGIS organisation (services1.arcgis.com/IYiCpZoSIq9lAxi8) of 470
    # services, but they are analysis snapshots rather than the fabric: the parcel layer is
    # "Parcels2020city3000sqft", filtered to lots over 3,000 square feet, and it has six
    # features inside this region. Alameda County's own parcel service does not answer.
    #
    # So Berkeley's ground is OpenStreetMap's and the lidar's, and that is why it is the
    # region with a quarter of its area drawn as bare plane. Recorded here rather than left
    # as an empty list, so the next person does not spend the afternoon finding it out again.
    "berkeley": [],
    "oakland": [
        Record("parcels", "Parcels", "socrata_table", "c3xp-qcgn",
               host="data.oaklandca.gov", geometry="the_geom"),
        Record("curb_ramps", "Curb Ramps", "socrata_table", "uq94-uqnq",
               host="data.oaklandca.gov"),
        Record("curb_ramp_survey", "Characteristics of Surveyed Curb Ramps",
               "socrata_geospatial", "bxep-iu9u", host="data.oaklandca.gov",
               note="a map layer, not a table: the row interface answers empty"),
        Record("curb_inventory", "Downtown Oakland On-street Parking Inventory",
               "socrata_table", "87ce-u2wf", host="data.oaklandca.gov",
               note="the kerb use of every downtown block face -- this region exactly"),
    ],
    "palo-alto": [
        Record("curb_line", "Road Edge", "arcgis",
               "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services/"
               "RoadEdges/FeatureServer", layer=0,
               note="surveyed kerb line: 1,441 in the downtown box"),
        Record("parcels", "Assessor's Parcels", "arcgis",
               "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services/"
               "AssessorsParcels/FeatureServer", layer=0),
        Record("centrelines", "Road Centerline", "arcgis",
               "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services/"
               "RoadCenterlineData/FeatureServer", layer=0),
        Record("building_roofs", "Building Roof Outline", "arcgis",
               "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services/"
               "BuildingRoofOutLine/FeatureServer", layer=0),
    ],
    # San Francisco's are in smc.official.datasf, which is older than this module and knows
    # more about each table than a row here could carry. sf-haight-castro reads from it like
    # every other San Francisco region.
    "san-francisco": [],
}


def records_for(city: str, key: str) -> list[Record]:
    return [r for r in CITY_RECORDS.get(city, ()) if r.key == key]


def cities_with(key: str) -> list[str]:
    return sorted(c for c, rows in CITY_RECORDS.items() if any(r.key == key for r in rows))
