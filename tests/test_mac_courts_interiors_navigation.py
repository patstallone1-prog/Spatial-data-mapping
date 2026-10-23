"""Mac-only repairs use current world geometry and retain the independent Quest release."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js
from tests.test_pins_and_zoom import run_js

ROOT = Path(__file__).resolve().parents[1]


def test_court_covers_coarse_backdrop_without_raising_its_physical_elevation():
    js = _page_js()
    out = run_js('''
const HEADSET=false, APPROACH_CUTS=[], groups={ground:{add(){}}};
''' + _extract('addGround', js) + '''
const mesh=()=>({userData:{},material:{depthTest:true}});
const court=addGround(mesh(),'court'),paint=addGround(mesh(),'court_line'),park=addGround(mesh(),'park');
console.log(JSON.stringify({court,paint,park}));
''')
    assert out['park']['renderOrder'] < out['court']['renderOrder'] < out['paint']['renderOrder']
    assert not out['court']['material']['depthTest']
    assert not out['paint']['material']['depthTest']
    assert 'position' not in out['court'], 'no invented court elevation'
    assert '.renderOrder = HEADSET ? 0 : -0.6;' in _extract('buildCourts', js)


def test_all_rendered_hard_playing_rectangles_exclude_grass_including_bleed():
    js = _page_js()
    ground = json.loads((ROOT/'docs/app-sf-corridor-ground.json').read_text())
    courts = [c for c in ground['courts'] if -122.432 < c['c'][0] < -122.4315 and 37.8017 < c['c'][1] < 37.8023]
    assert len(courts) >= 3, 'real Moscone basketball and tennis records, not a synthetic substitute'
    result = run_js('''
const xy=(lon,lat)=>[lon*88000,lat*111320], lonLatFromXZ=(x,z)=>[x/88000,-z/111320];
const COURT_STYLE={tennis:{surround:'asphalt'},basketball:{surround:'asphalt'},soccer:{surround:null}};
''' + _extract('courtPainter',js) + _extract('hardCourtFootprints',js) +
        f"console.log(JSON.stringify(hardCourtFootprints({{courts:{json.dumps(courts)}}})));" )
    from shapely.geometry import Point, Polygon
    for c, r in zip(courts,result,strict=True):
        assert Polygon(r['p']).contains(Point(c['c']))
        assert r['p'][0] == r['p'][-1]


def test_far_lawns_use_the_same_texture_scale_as_full_detail_not_plain_green():
    fn = _extract('tileLawns',_page_js())
    assert 'uv.push(p.x / 8, -p.y / 8)' in fn
    assert 'material.map = grassTexture("park", 0)' in fn
    assert 'if (!HEADSET)' in fn


def test_court_dividers_have_terminal_posts_and_continuous_grounded_top_rails():
    fn = _extract('buildCourts',_page_js())
    out = run_js(_extract('courtPostPoints',_page_js()) + '''
console.log(JSON.stringify({mac:courtPostPoints(0,0,10,0,4,false),quest:courtPostPoints(0,0,10,0,4,true)}));
''')
    assert [p[0] for p in out['mac']] == [0,2.5,5,7.5,10]
    assert [p[0] for p in out['quest']] == [0,3,6,9]
    assert 'fenceJoints.set(key,[x,z,h])' in fn
    assert 'groundLiftAt(x,z)+COURT_Y+h' in fn
    assert 'surface:"fence:court",liftedOntoGround:true' in fn


def test_businesses_cannot_get_domestic_interiors_even_when_tagged_as_houses():
    result = run_js(_extract('commercialInterior',_page_js()) + '''
console.log(JSON.stringify([
 {tags:{building:'house'}}, {tags:{building:'house'},shops:[{n:'Pizza Avellino'}]},
 {archetype:'retail'}, {tags:{building:'commercial'}}, {archetype:'residential'}
].map(way=>commercialInterior({way}))));
''')
    assert result == [False,True,True,True,False]
    assert 'if (!HEADSET && commercialInterior(entry)) return;' in _extract('buildInterior',_page_js())


def test_restaurant_index_only_accepts_same_envelope_single_tenant_and_passed_layouts():
    spec = importlib.util.spec_from_file_location('restaurant_publish',ROOT/'scripts/publish_restaurant_interiors.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = module.accepted()['buildings']
    assert data['262397369']['name'] == 'Pizza Avellino'
    assert len(data) >= 3
    for ref in data.values():
        assert ref['kind'] == 'restaurant' and ref['measured'] is False
    assert json.loads((ROOT/'docs/inferred-restaurants/map-overlay.json').read_text())['buildings'] == data


@pytest.mark.parametrize('aspect',[.4,1,2.5])
def test_route_overview_fits_both_axes_and_all_stops(aspect):
    result = run_js(_extract('routeOverviewPlan',_page_js())+
        f'console.log(JSON.stringify(routeOverviewPlan([[-800,-400],[1500,700],[400,1400]],{aspect},55)));')
    import math
    half_height = result['distance']*math.tan(math.radians(55/2))
    assert half_height >= 900 and half_height*aspect >= 1150
    assert result['x'] == 350 and result['z'] == 500


def test_route_start_collapses_controls_and_keeps_chosen_alternate():
    js = _page_js()
    overview = _extract('showRouteOverview',js)
    assert 'hud.dataset.open = "false"' in overview and 'state.pitch = Math.PI/2' in overview
    assert 'avatar.position.set' not in overview and 'goTo(' not in overview
    assert 'route.queryKey === queryKey' in js
    assert '✓ Selected' in js and 'item.setAttribute("role", "option")' in js
    assert 'size: META ? 1 : 0.62' in js
    assert 'const ROUTE_RIBBON_PER_M = META ? 0.007 : 0.009;' in js
    assert 'if (!regionAt(stop.lon,stop.lat)) return;' in js


def test_default_app_build_preserves_the_independently_versioned_quest_consumer():
    build = (ROOT/'tools/build_app_worlds.py').read_text()
    assert 'def main(*, desktop_only: bool = True)' in build
    assert 'main(desktop_only=not parser.parse_args().include_quest)' in build


def test_cloud_interior_job_has_no_machine_specific_path_and_preserves_each_input_version():
    from smc.cloud.stages import interior_batch
    spec = interior_batch('sf-corridor',0,'abc','123',priority=0)
    assert spec.resource == 'cpu' and spec.priority == 0
    assert spec.save == ['build/interior-production/abc/sf-corridor/batch-000-123']
    assert '--marina-first' in spec.command[0] and '--batch-key' in spec.command[0]
    assert not any('/Volumes' in arg or '/Users' in arg for arg in spec.command[0])


def test_local_queue_jobs_are_leased_and_completed_through_the_existing_fencing_contract(tmp_path):
    from smc.cloud.local import LocalQueueTransport
    from smc.cloud.queue import JobSpec, Queue
    queue = Queue(tmp_path/'queue.sqlite')
    queue.submit(JobSpec(id='test',kind='house_batch',subject='marina',stage='interior',resource='cpu'))
    local = LocalQueueTransport(queue,'mac',lambda:False)
    assert local.lease(['cpu'],60) is None
    local.ready = lambda:True
    lease = local.lease(['cpu'],60)
    assert local.heartbeat('test',lease['token'],60)
    assert local.complete('test',lease['token'],{'tree':'checked'}, {})
    assert not local.complete('test',lease['token'],{}, {}), 'late duplicate completion refused'


def _runner(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT/'scripts'))
    spec = importlib.util.spec_from_file_location('interior_jobs',ROOT/'scripts/run_interior_jobs.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_external_checkpoint_store_refuses_disconnected_writes_and_all_deletion(tmp_path,monkeypatch):
    module = _runner(monkeypatch)
    volume = tmp_path/'volume'
    volume.mkdir()
    store = module.VolumeStore(volume,'expected')
    monkeypatch.setattr(module.os.path,'ismount',lambda _:False)
    with pytest.raises(OSError,match='disconnected'):
        store.put('cas/test',b'finished local batch')
    assert not (store.root/'cas/test').exists()
    with pytest.raises(PermissionError,match='disabled'):
        store.delete('anything')


def test_volume_identity_is_required_not_just_a_directory_with_the_right_name(monkeypatch):
    import plistlib
    from types import SimpleNamespace
    module = _runner(monkeypatch)
    monkeypatch.setattr(module.os.path,'ismount',lambda _:True)
    monkeypatch.setattr(module.subprocess,'run',lambda *a,**k:SimpleNamespace(
        returncode=0,stdout=plistlib.dumps({'VolumeUUID':'actual'})))
    assert module.volume_ok(Path('/some/mount'),'actual')
    assert not module.volume_ok(Path('/some/mount'),'different')
