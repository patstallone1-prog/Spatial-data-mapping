"""Exercise scheduling/clock machinery without a GPU or network."""
import json
import subprocess
from pathlib import Path

import pytest

from smc.official.integration import integrate_inventory, road_edge_check
from smc.official.regional_evidence import digest
from smc.regions.gaps import plan_gaps, subtract

ROOT = Path(__file__).resolve().parents[1]


def node(code):
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT,
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def test_cells_start_at_destination_and_include_global_rows():
    result = node("""
      import {windowCells} from './docs/world-streaming.mjs';
      console.log(JSON.stringify(windowCells({origin:[0,0],cell:[1,1],cells:{any:1,'0_0':1,'1_0':1,'2_0':1}},[0,0,3,.9],2.5,.5)));
    """)
    assert result == ["any", "2_0", "1_0", "0_0"]


def test_cache_bounds_concurrency_retries_and_never_shares_mutable_payloads():
    result = node("""
      import {CellCache} from './docs/world-streaming.mjs';
      let active=0,max=0,calls=0;
      const cache=new CellCache({concurrency:2,maxBytes:150,fetcher:async url=>{
        active++;calls++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;
        return {ok:url!=='bad',status:503,text:async()=>JSON.stringify({url,value:'1234567890'})};}});
      const a=await cache.load('a');a.value='corrupted';const b=await cache.load('a');
      await Promise.all(['b','c','d','e'].map(k=>cache.load(k)));
      for(let i=0;i<2;i++)try{await cache.load('bad')}catch{}
      console.log(JSON.stringify({max,calls,value:b.value,...cache.snapshot()}));
    """)
    assert result["max"] <= 2
    assert result["value"] == "1234567890"
    assert result["calls"] == 11  # each persistent 503 gets two bounded retries
    assert result["failed"] == 2
    assert result["residentBytes"] <= 150
    assert result["evicted"] > 0


def test_clock_dst_and_solar_previews_are_real_suncalc_not_fixed_sun():
    result = node("""
      import {solarState,previewTime,WEATHER} from './docs/sky-clock.mjs';
      const now=new Date('2026-07-01T19:00:00Z'),lat=37.77,lon=-122.42;
      console.log(JSON.stringify({winter:solarState(new Date('2026-01-01T20:00:00Z'),lat,lon),
        summer:solarState(now,lat,lon),noon:solarState(previewTime('noon',now,lat,lon),lat,lon),
        night:solarState(previewTime('night',now,lat,lon),lat,lon),live:previewTime('live',now,lat,lon),weather:WEATHER}));
    """)
    assert "PST" in result["winter"]["localTime"]
    assert "PDT" in result["summer"]["localTime"]
    assert result["noon"]["altitude"] > 0.8
    assert result["night"]["altitude"] < 0
    assert sum(x*x for x in result["summer"]["direction"]) == pytest.approx(1)
    assert result["live"] is None
    assert result["weather"]["rain"]["rain"] == 1


def test_default_fetch_keeps_browser_receiver():
    result = node("""
      import {CellCache} from './docs/world-streaming.mjs';
      globalThis.fetch=function(){if(this!==globalThis)throw Error('Illegal invocation');
        return Promise.resolve({ok:true,text:async()=>'{"valid":true}'});};
      console.log(JSON.stringify(await new CellCache().load('https://example.test/cell')));
    """)
    assert result["valid"]


def test_gap_plans_subtract_existing_coverage_and_never_activate():
    assert subtract([0, 0, 1, 1], [0, 0, 1, 1]) == []
    plan = plan_gaps({"intake_enabled": False, "regions": [{"name": "test", "adapter": "san-francisco",
                     "bbox": [37, -122, 37.02, -121.98], "reason": "test"}]},
                     [{"built": True, "bbox": [37, -122, 37.01, -121.98]}])
    assert not plan["intake_started"]
    assert plan["jobs"]
    assert all(j["bbox"][0] >= 37.01 for j in plan["jobs"])
    with pytest.raises(ValueError):
        plan_gaps({"intake_enabled": True}, [])


def inventory(features):
    return {"features": features, "sha256": digest(features), "horizontal_crs": "EPSG:4326",
            "source": {"url": "https://city.test", "attribution": "City"}, "retrieved_at": "2026-10-16"}


def test_municipal_roles_never_convert_projects_or_unknown_datums_to_physical_truth():
    feature = {"id": 1, "properties": {"ELEVATIONFT": 86.49, "EMAIL": "private@example.test"},
               "geometry": {"type": "Point", "coordinates": [-121.89, 37.33]}}
    controls = integrate_inventory("san-jose-survey-controls", inventory([feature]))
    assert not controls["references"][0]["eligible_as_fit_control"]
    assert "EMAIL" not in controls["references"][0]["attributes"]
    projects = integrate_inventory("san-jose-project-lines", inventory([feature]))
    assert not projects["sidewalks"] and not projects["curb_colours"]
    assert not projects["references"][0]["physical_rendering"]
    bad = inventory([feature])
    bad["sha256"] = "0"*64
    with pytest.raises(ValueError, match="checksum"):
        integrate_inventory("san-jose-survey-controls", bad)


def test_pavement_keeps_holes_and_curb_colours_do_not_invent_policy():
    ring = [[-121.9,37.33],[-121.89,37.33],[-121.89,37.34],[-121.9,37.33]]
    f = {"id":1,"properties":{},"geometry":{"type":"Polygon","coordinates":[ring,ring]}}
    out = integrate_inventory("san-jose-sidewalks", inventory([f]))
    assert not out["sidewalks"] and out["excluded"]["polygon_with_holes"] == 1
    f["geometry"] = {"type":"LineString","coordinates":ring}
    f["properties"] = {"CURBCOLOR":"Red"}
    out = integrate_inventory("san-jose-curbfaces", inventory([f]))
    assert out["curb_colours"][0]["curb_color"] == "red"
    assert not out["curb_colours"][0]["legal_restriction_claim"]


def test_stream_handoff_keeps_old_world_until_ready_and_updates_all_search_regions():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    attach = source.split("async function attachRegion(")[1].split("window.kerbsideAttachRegion")[0]
    assert attach.index("await api.ready()") < attach.index("releaseHostWorld()")
    assert "TILE_OWN_BOXES = holder.windowBoxes.map((b) => b.slice())" in attach
    assert "detailWindow:{...centre,radius:holder.detailRadius,strip:holder.strip}" in attach
    assert "avatar.visible = !on && !ATTACH" in source
    assert 'query.has("fps") && FPS_CHOICES.includes(Number(query.get("fps")))' in source
    assert 'throw Error("Destination ground unavailable; previous window retained")' in source
    assert "centre.lon<rw || centre.lon>re || centre.lat<rs || centre.lat>rn" in attach
    expansion=source.split("function checkDetailExpansion(now)")[1].split("window.kerbsideStreamDetail")[0]
    assert "const focus=state.firstPerson ? avatar.position : state.target" in expansion
    assert "if (!state.firstPerson && state.dist > REGION_ENTER_DIST_M) return" in source
    opener = source.split("window.kerbsideOpenFullRegionAt =")[1].split("for (const region of list)")[0]
    assert "location.assign" not in opener and "openFullRegion(destination" not in opener
    index = json.loads((ROOT / "docs/search-index.json").read_text())
    assert len(index["regions"]) >= 8 and len(index["addresses"]) > 50000


def test_edge_check_keeps_failures_in_denominator_and_is_not_survey_accuracy():
    # Coordinates at the equator make the synthetic metres unambiguous.
    payload = {"bbox": {"west": 0, "east": .001, "south": 0, "north": .001},
               "ways": [{"kind": "street", "road_m": 10,
                         "points": [[0, 0], [.001, 0]]}]}
    edge = {"geometry": {"type": "LineString", "coordinates": [[.0001, 5/111320], [.0005, 5/111320], [.0009, 5/111320]]}}
    invalid = {"geometry": {"type": "Point", "coordinates": [0, 0]}}
    out = road_edge_check([edge, invalid], payload)
    assert out["attempted"] == 2 and out["supported"] == 1
    assert out["median_discrepancy_m"] == pytest.approx(0)
    assert not out["independent_accuracy_claim"]


def test_vendored_sky_assets_have_checked_licenses_and_hashes():
    import hashlib
    manifest = json.loads((ROOT / "docs/vendor/manifest.json").read_text())
    for name in ("three-sky", "suncalc"):
        entry = manifest[name]
        assert hashlib.sha256((ROOT / "docs/vendor" / entry["file"]).read_bytes()).hexdigest() == entry["sha256"]
        assert (ROOT / "docs/vendor" / entry["license_file"]).stat().st_size > 500


def test_moved_sun_takes_observed_weather_and_a_future_hour_the_day_befores():
    result = node("""
      import {conditionsOf,observedInstant,createWeatherHistory} from './docs/sky-history.mjs';
      const now=Date.parse('2026-10-18T07:00:00Z'), urls=[];
      const obs=(t,amount,text,kmh,dir)=>({properties:{timestamp:t,textDescription:text,cloudLayers:[{amount}],
        windSpeed:{value:kmh},windDirection:{value:dir},precipitationLastHour:{value:null}}});
      const fetcher=async url=>{urls.push(url);return {ok:true,json:async()=>
        url.includes('/points/')?{properties:{observationStations:'https://api.weather.gov/x/stations'}}
        :url.endsWith('/stations')?{features:[{properties:{stationIdentifier:'SFOC1'}},{properties:{stationIdentifier:'KSFO'}}]}
        :{features:[obs('2026-10-17T21:56:00Z','OVC','Light Rain',36,200),obs('2026-10-17T19:00:00Z','CLR','Clear',10,290)]}};};
      const history=createWeatherHistory(37.8,-122.43,fetcher);
      const future=await history.at(new Date('2026-10-18T22:00:00Z'),now);
      console.log(JSON.stringify({future,urls,
        fog:conditionsOf({textDescription:'Fog/Mist',cloudLayers:[]}).preset,
        broken:conditionsOf({textDescription:'Mostly Cloudy',cloudLayers:[{amount:'BKN'}]}).preset,
        scattered:conditionsOf({textDescription:'Partly Cloudy',cloudLayers:[{amount:'SCT'}]}).preset,
        none:conditionsOf({textDescription:'',cloudLayers:[]}),
        past:observedInstant(new Date('2026-10-16T12:00:00Z'),now)===Date.parse('2026-10-16T12:00:00Z')}));
    """)
    future = result["future"]
    assert future["standsIn"] is True and future["station"] == "KSFO"  # an airport, for its cloud layers
    assert future["preset"] == "rain" and future["wind"] == pytest.approx(10)
    assert future["observed"] == "2026-10-17T21:56:00Z"  # the day before, at that hour
    assert "start=2026-10-17T20:30:00Z" in result["urls"][-1]
    assert (result["fog"], result["broken"], result["scattered"]) == ("cloudy", "cloudy", "partly_cloudy")
    assert result["none"] is None and result["past"] is True


def test_directions_build_a_full_detail_strip_along_the_route():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    strip = source.split("const ROUTE_STRIP = {")[1].split("window.kerbsideRouteStrip")[0]
    # A few blocks wide, cut into pieces each a box, within a bounded area beside the core.
    assert "halfM: 100" in strip and "maxBoxes: BOX_SET_MAX - 1" in strip and "km2:" in strip
    expansion = source.split("function checkDetailExpansion(now)")[1].split("window.kerbsideStreamDetail")[0]
    # New directions rebuild the window with the strip; the core leads along the route.
    assert "routeStripKey()" in expansion and "routeAheadOf(" in expansion
    attach = source.split("async function attachRegion(")[1].split("window.kerbsideAttachRegion")[0]
    assert "activeGuest.stripKey" in attach and "strip, stripKey" in attach and "strip:holder.strip" in attach
    spec = source.split("function windowSpec(")[1].split("\nfunction ")[0]
    assert "detailWindow?.strip" in spec and "const boxes = [core, ...strip];" in spec
