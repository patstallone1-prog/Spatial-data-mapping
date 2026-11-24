from kerbfront.merge import fuse, merge
from kerbfront.normalize import parse_address
from kerbfront.sweep import refine_storefronts


def ob(source, sid, name, addr, lat=37.8004, lon=-122.4370, **attrs):
    return {"source": source, "source_id": sid, "name": name, "alt_names": [],
            "address": parse_address(addr), "lat": lat, "lon": lon, "attrs": attrs,
            "retrieved_at": "2026-11-23"}


def test_one_business_from_four_sources():
    obs = [ob("osm", "node/1", "Pacific Catch", "2027 Chestnut Street", osm_kind="amenity=restaurant",
              outdoor_seating="yes"),
           ob("overture", "o1", "Pacific Catch", "2027 Chestnut St", lat=37.80045,
              category="seafood_restaurant", category_path=["food_and_drink", "restaurant"],
              confidence=0.97),
           ob("registry", "r1", "PACIFIC CATCH, INC.", "2027 Chestnut St", naics="722511",
              legal_name="Pacific Catch Inc", location_start_date="2009-05-01"),
           ob("shared_spaces", "s1", "PACIFIC CATCH", "2027   CHESTNUT ST", sidewalk_tables=True),
           ob("overture", "o2", "Williams-Sonoma", "2000 Chestnut St", lat=37.8010,
              category="kitchen_supply_store", category_path=["shopping"], confidence=0.6)]
    out = merge(obs)
    assert len(out) == 2
    pc = next(z for z in out if len(z["sources"]) == 4)
    assert pc["fields"]["name"]["confidence"] > 0.9
    assert pc["fields"]["sidewalk_tables"]["value"] is True
    assert pc["fields"]["location_start_date"]["sources"][0]["source"] == "registry"
    assert pc["storefront_likelihood"] >= 0.9
    assert {"osm_storefront_poi", "sidewalk_or_parklet_permit", "storefront_naics"} <= set(pc["storefront_evidence"])


def test_same_source_tenants_at_one_address_stay_apart():
    obs = [ob("registry", "r1", "Matterhorn Plumbing", "2040 Chestnut St"),
           ob("registry", "r2", "Americo Builders LLC", "2040 Chestnut St"),
           ob("overture", "o1", "Sweetgreen", "2040 Chestnut St")]
    assert len(merge(obs)) == 3


def test_conflicting_values_are_kept_and_lower_confidence():
    agree = fuse("cuisine", [("pizza", "osm", "n1", None), ("pizza", "overture", "o1", None)])
    split = fuse("cuisine", [("pizza", "osm", "n1", None), ("burger", "overture", "o1", None)])
    assert agree["confidence"] > split["confidence"]
    assert split["value"] == "pizza"
    assert split["conflicts"][0]["value"] == "burger"


def test_one_occupant_per_shopfront_address():
    def biz(i, sources, lik=0.8):
        return {"id": f"b{i}", "sources": sources, "observations": [{"source": s} for s in sources],
                "fields": {"name": {"confidence": 0.9}}, "storefront_likelihood": lik,
                "storefront_evidence": [], "building": {"id": "B"},
                "address": {"street": "CHESTNUT ST", "number": 2031, "unit": None},
                "face": {"id": "B:3"}}
    now = biz(1, ["osm", "overture", "registry", "shared_spaces"])
    stale = biz(2, ["overture"])
    refine_storefronts([now, stale], {"B": {"parcel": {"zoning": "NC-2"}}})
    assert now["occupancy"]["role"] == "occupant"
    assert stale["occupancy"]["role"] == "previous_or_upstairs"
    assert stale["storefront_likelihood"] < 0.5


def test_occupancy_runs_from_the_earliest_registration():
    f = fuse("location_start_date", [("2025-10-09", "registry", "r2", None),
                                     ("1998-05-15", "registry", "r1", None)])
    assert f["value"] == "1998-05-15"
    assert f["conflicts"][0]["value"] == "2025-10-09"
