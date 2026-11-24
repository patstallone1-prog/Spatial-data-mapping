from kerbfront.faces import _simplified_ring
from kerbfront.handoff import program


def test_program_follows_the_exteriors_contract(block, a_front):
    bd = block["buildings"]["A"]
    ring = _simplified_ring(bd.poly)
    z = {"id": "mb-1", "fields": {"name": {"value": "Pacific Catch", "confidence": 0.98},
                                  "category": {"value": "seafood_restaurant", "confidence": 0.7}},
         "face": {"id": a_front.id, "length_m": 10.0, "tenant_span_m": [1.0, 9.0], "span_inferred": True},
         "outdoor": {"kinds": ["sidewalk"], "confidence": 0.9}, "osm_tags": {"amenity": "restaurant"}}
    p = program(bd, ring, [z], {"mb-1": [{"frame_id": "123"}]})
    coords = p["footprint"]["coordinates"][0]
    assert coords[0] == [0.0, 0.0] and coords[0] == coords[-1]        # closed, local origin
    fr = p["frontages"][0]
    assert fr["edge"] == a_front.edge and (fr["u0"], fr["u1"]) == (1.0, 9.0)
    # the frontage edge in the emitted footprint is the face the lab measured
    (x0, y0), (x1, y1) = coords[fr["edge"]], coords[fr["edge"] + 1]
    ox, oy = ring[0]
    assert (x0 + ox, y0 + oy) == a_front.p0 and (x1 + ox, y1 + oy) == a_front.p1
    assert p["tenants"][0] == {"id": "T1", "name": "Pacific Catch", "category": "seafood restaurant",
                               "tags": {"amenity": "restaurant"}}
    assert fr["openings_complete"] is False and fr["signs_complete"] is False
    assert p["kerbfront"]["tenants"]["T1"]["photos"] == ["123"]


def test_spans_are_clamped_to_the_emitted_edge(block, a_front):
    bd = block["buildings"]["A"]
    z = {"id": "mb-2", "fields": {"name": {"value": "Two Skirts", "confidence": 0.9}},
         "face": {"id": a_front.id, "length_m": 10.0, "tenant_span_m": [9.0, 10.004]}}
    fr = program(bd, _simplified_ring(bd.poly), [z], {})["frontages"][0]
    assert fr["u1"] <= 10.0 and fr["u0"] == 9.0
