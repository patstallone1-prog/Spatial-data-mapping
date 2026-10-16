import runpy
from pathlib import Path


def test_raw_purge_is_narrow_and_preserves_facts_models_and_flight_manifests(tmp_path):
    tool = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/purge_run_raw.py'))
    names = ['frontage-live/review/a.jpg', 'frontage-live/review/a.labels.png',
             'frontage-live/pixel-store/pixels/v1/sha256/aa/a.zlib',
             'frontage-live/review/a.json', 'facade-match/facts/a.json',
             'frontage-live/aliases/a.json', 'frontage-live/flight.json',
             'frontage-pilot-v2/model-cache/model.png', 'material-library/wall.jpg',
             'private-datasets/3d-street-view/SanFrancisco.obj']
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture')
    (tmp_path / 'frontage-live/review/linked.jpg').symlink_to(tmp_path / names[0])
    rows = tool['inventory'](tmp_path)
    assert {r['path'] for r in rows} == set(names[:3])
