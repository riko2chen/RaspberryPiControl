import base64
import hashlib
import json
import time
from pathlib import Path
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from backend.hardware import page_bytes,FAN_CODES
from backend.models import Settings,Oled,Fan
from backend.render import render_oled,light_frame
from backend.store import Store

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('PC_SIMULATE','1')
    monkeypatch.setenv('PC_DEV_PASSWORD','test-password-for-local-tests')
    from backend import main
    monkeypatch.setattr(main,'ROOT',tmp_path)
    main.failures.clear()
    with TestClient(main.app) as c:
        c.headers['X-Pi-Control']='1'
        yield c

def login(client):
    r=client.post('/api/v1/auth/login',json={'username':'pi','password':'test-password-for-local-tests'})
    assert r.status_code==200
    return client.get('/api/v1/status').json()

def command(client,kind,value,version,ident='test-operation-01'):
    path='/fans/case' if kind=='fan' else '/'+kind
    return client.put('/api/v1'+path,json={'value':value,'expected_version':version,'request_id':ident})

def test_ssd1306_pack_roundtrip_all_pixels():
    # Asymmetric bit pattern catches transpose, row/page order and bit reversal.
    rows=bytes((i*71+29)%256 for i in range(512))
    pages=page_bytes(rows)
    for y in range(32):
        for x in range(128):
            assert ((rows[y*16+x//8]>>(7-x%8))&1)==((pages[(y//8)*128+x]>>(y%8))&1)
    assert len(pages)==512

def test_login_and_auth_boundary(client):
    assert client.get('/api/v1/status').status_code==401
    assert client.get('/healthz').status_code==200
    assert client.post('/api/v1/auth/login',json={'username':'pi','password':'wrong'}).status_code==401
    r=client.post('/api/v1/auth/login',json={'username':'pi','password':'test-password-for-local-tests'})
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=strict' in r.headers['set-cookie']
    assert client.get('/api/v1/status').status_code==200
    assert client.get('/api/v1/status',headers={'host':'malicious.invalid'}).status_code==400
    assert client.post('/api/v1/auth/logout',headers={'Origin':'http://evil.invalid'}).status_code==403
    assert client.post('/api/v1/auth/logout',headers={'X-Pi-Control':''}).status_code==403
    assert client.post('/api/v1/auth/logout').status_code==200
    assert client.get('/api/v1/status').status_code==401

def test_read_token_cannot_control_or_mint_tokens(client):
    s=login(client)
    token=client.post('/api/v1/tokens',json={'name':'read-test','scope':'read','days':1}).json()
    headers={'Authorization':'Bearer '+token['token']}
    assert client.get('/api/v1/status',headers=headers).status_code==200
    assert client.put('/api/v1/fans/case',json={'value':s['config']['fan'],'expected_version':s['version'],'request_id':'read-operation-01'},headers=headers).status_code==403
    assert client.post('/api/v1/tokens',json={'name':'bad','scope':'control'},headers=headers).status_code==403
    assert client.delete('/api/v1/tokens/'+token['id']).status_code==200
    assert client.get('/api/v1/status',headers=headers).status_code==401

def test_control_version_idempotence_and_single_color(client):
    s=login(client);value=s['config']['lights'];value['colors'][3]='#ff0000';value['brightness']=100
    r=command(client,'lights',value,s['version'])
    assert r.status_code==200,r.text
    next=r.json();assert next['applied']['lights']['colors'][3]=='#ff0000'
    again=command(client,'lights',value,s['version'])
    assert again.status_code==200 and again.json()['version']==next['version']
    stale=command(client,'lights',value,s['version'],'new-operation-stale')
    assert stale.status_code==409
    conflicting=command(client,'lights',{**value,'brightness':25},next['version'])
    assert conflicting.status_code==409
    assert client.patch('/api/v1/lights/99',json={'value':{'color':'#ff0000'},'expected_version':next['version'],'request_id':'invalid-led-001'}).status_code==422
    events=client.get('/api/v1/events?kind=lights').json()['items'];assert len(events)==1

def test_oled_preview_matches_written_rows_and_frame_history(client):
    s=login(client)
    cfg=Oled(mode='text',text='你好 Pi\n128 × 32',font_size=12,x=1,y=0).model_dump()
    preview=client.post('/api/v1/oled/preview',json=cfg)
    assert preview.status_code==200,preview.text
    r=command(client,'oled',cfg,s['version'])
    assert r.status_code==200,r.text
    frame=r.json()['applied']['oled']
    assert frame['pixels']==preview.json()['pixels']
    raw=base64.b64decode(frame['pixels'])
    assert frame['pixel_hash']==hashlib.sha256(raw).hexdigest()
    assert frame['hardware_hash']==hashlib.sha256(page_bytes(raw)).hexdigest()
    assert client.get('/api/v1/frames/'+str(frame['id'])).json()['pixels']==frame['pixels']
    blank=client.post('/api/v1/oled/preview',json={**cfg,'enabled':False}).json()
    assert base64.b64decode(blank['pixels'])==bytes(512)

def test_hardware_error_does_not_claim_frame_written(client,monkeypatch):
    from backend import main
    s=login(client);old=s['applied']['oled'];value={**s['config']['oled'],'mode':'text','text':'FAILED FRAME'}
    def fail(*a,**kw):raise OSError('I2C device unavailable')
    monkeypatch.setattr(main.control.hardware,'oled',fail)
    r=command(client,'oled',value,s['version'])
    assert r.status_code==503,r.text
    new=client.get('/api/v1/status').json()
    assert new['config']['oled']['text']=='FAILED FRAME'
    assert new['applied']['oled']['id']==old['id']
    assert 'oled' in new['hardware']['errors']
    assert client.get('/api/v1/events?kind=oled').json()['items'][0]['outcome']=='failed'

def test_fan_safety_mapping_hysteresis(client):
    from backend import main
    s=login(client)
    assert FAN_CODES==[0,2,3,4,5,6,7,8,9,10,1]
    c=main.control
    c.config['fan']={'mode':'manual','level':0,'curve':s['config']['fan']['curve']}
    c.metrics['temperature']=76;assert c.fan_level()==10
    c.metrics['temperature']=72;assert c.fan_level()==10
    c.metrics['temperature']=70;assert c.fan_level()==0
    c.metrics['temperature']=None;assert c.fan_level()==10

def test_scene_save_apply_and_labels(client):
    s=login(client);cfg=s['config'];cfg['lights']['brightness']=14
    r=client.post('/api/v1/scenes',json={'name':'自定义测试','config':cfg})
    assert r.status_code==200,r.text
    ident=r.json()['id']
    applied=client.post(f'/api/v1/scenes/{ident}/apply',json={'expected_version':s['version'],'request_id':'scene-operation-01','value':{}})
    assert applied.status_code==200,applied.text
    assert applied.json()['config']['lights']['brightness']==14
    assert client.delete('/api/v1/scenes/focus').status_code==409
    assert client.delete('/api/v1/scenes/'+ident).status_code==200
    labels=cfg['labels'];labels[0]='左前方'
    r=command(client,'labels',{'labels':labels},applied.json()['version'],'label-operation-01')
    assert r.status_code==200,r.text
    assert r.json()['config']['labels'][0]=='左前方'

def test_input_validation_and_light_determinism():
    with pytest.raises(ValueError):Oled(mode='pixel',pixels='bad')
    with pytest.raises(ValueError):Fan(curve=[{'temperature':60,'level':2},{'temperature':40,'level':5}])
    cfg=Settings().model_dump()['lights']
    assert light_frame({**cfg,'enabled':False},12)==['#000000']*14
    rainbow={**cfg,'effect':'rainbow'}
    assert light_frame(rainbow,3)==light_frame(rainbow,3)
    assert light_frame(rainbow,3)!=light_frame(rainbow,4)

def test_database_persistence_and_retention(tmp_path):
    s=Store(tmp_path);s.set('configuration',{'version':9,'config':Settings().model_dump()})
    s.execute('INSERT INTO frames(ts,pixel_hash,pixels,mode) VALUES (?,?,?,?)',(time.time()-8*86400,'old',bytes(512),'clock'))
    s.prune();assert not s.query('SELECT * FROM frames')
    s.backup(tmp_path/'backup.db');s.db.close()
    reopened=Store(tmp_path);assert reopened.get('configuration')['version']==9;reopened.db.close()

def test_websocket_authenticated_snapshot(client):
    login(client)
    with client.websocket_connect('/api/v1/live',headers={'origin':'http://testserver'}) as ws:
        data=ws.receive_json();assert data['hardware']['simulate'];assert data['applied']['oled']['pixels']
    with pytest.raises(Exception):
        with client.websocket_connect('/api/v1/live',headers={'origin':'http://evil.invalid'}) as ws:ws.receive_json()

def test_uniform_lights_broadcast_native_transition_and_retry(tmp_path,monkeypatch):
    from backend.hardware import Hardware
    import backend.hardware as hw
    monkeypatch.setattr(hw.time,'sleep',lambda _:None)
    class Bus:
        def __init__(self):self.writes=[];self.fail=False
        def write_byte_data(self,addr,reg,value):
            if self.fail and reg==3:raise OSError('Interrupted frame')
            self.writes.append((reg,value))
        def close(self):pass
    h=Hardware(tmp_path,simulate=True);h.bus=Bus()
    try:
        h.lights(['#123456']*14)
        assert h.bus.writes==[(4,0),(0,255),(1,18),(2,52),(3,86)]
        h.bus.writes=[];h.lights(['#223456']*14)
        assert h.bus.writes==[(0,255),(1,34),(2,52),(3,86)]
        h.bus.writes=[];h.native_breathe(5,2)
        assert h.bus.writes==[(4,0),(6,5),(5,2),(4,1)]
        h.bus.writes=[];h.native_breathe(5,2);assert not h.bus.writes
        h.lights(['#223456']*14);assert h.bus.writes[0]==(4,0)
        h.bus.fail=True
        with pytest.raises(OSError):h.lights(['#ff0000']*14)
        assert h.last_lights is None and not h.rgb_ready
        h.bus.fail=False;h.bus.writes=[];h.lights(['#ff0000']*14)
        assert h.bus.writes==[(4,0),(0,255),(1,255),(2,0),(3,0)]
    finally:h.close()

def test_clock_visible_glyphs_have_clear_panel_margins():
    from PIL import Image,ImageDraw
    from backend.render import font
    for day in range(1,8):
        for hour in [0,8,12,23]:
            now=datetime(2026,10,day,hour,58,59)
            image=Image.frombytes('1',(128,32),render_oled(Oled(mode='clock').model_dump(),{},now))
            assert image.getbbox()[1]>=2 and image.getbbox()[3]<=31
            assert image.getbbox()[0]>=2 and image.getbbox()[2]<=126
            # Compare all time-glyph pixels against a larger unclipped render.
            reference=Image.new('1',(200,60));ImageDraw.Draw(reference).text((10,10),now.strftime('%H:%M:%S'),font=font(22),fill=1)
            assert sum(bool(v) for v in image.crop((0,0,128,23)).get_flattened_data())==sum(bool(v) for v in reference.get_flattened_data())

def test_native_effect_api_metadata_and_disable(client):
    s=login(client);cfg={**s['config']['lights'],'effect':'native_breathe','native_color':5,'native_speed':2}
    r=command(client,'lights',cfg,s['version'],'native-operation-01');assert r.status_code==200,r.text
    state=r.json();a=state['applied']['lights']
    assert a['engine']=='firmware' and a['color_source']=='firmware-palette'
    assert a['parameters']['native_speed']==2
    assert command(client,'lights',{**cfg,'native_speed':4},state['version'],'native-invalid-01').status_code==422
    r=command(client,'lights',{**cfg,'enabled':False},state['version'],'native-off-operation')
    assert r.json()['applied']['lights']['colors']==['#000000']*14
    assert r.json()['applied']['lights']['engine']=='software'

def test_cpu_fan_policy_uses_kernel_trip_points(tmp_path):
    import struct
    from backend.thermal import cpu_fan_policy
    zone=tmp_path/'class/thermal/thermal_zone0';zone.mkdir(parents=True)
    (zone/'type').write_text('cpu-thermal')
    for i,(temp,kind) in enumerate([(110000,'critical'),(51000,'active'),(61000,'active')]):
        for suffix,value in [('type',kind),('temp',temp),('hyst',4000)]:
            (zone/f'trip_point_{i}_{suffix}').write_text(str(value))
    dev=tmp_path/'class/thermal/cooling_device0';dev.mkdir()
    for name,value in [('type','pwm-fan'),('cur_state',1),('max_state',2)]: (dev/name).write_text(str(value))
    levels=tmp_path/'firmware/devicetree/base/cooling_fan/cooling-levels';levels.parent.mkdir(parents=True);levels.write_bytes(struct.pack('>III',0,80,255))
    p=cpu_fan_policy(tmp_path);assert p['available'] and p['state']==1
    assert p['steps']==[{'temperature':51,'hysteresis':4,'pwm':80,'percent':31},{'temperature':61,'hysteresis':4,'pwm':255,'percent':100}]
    levels.unlink();assert not cpu_fan_policy(tmp_path)['available']

def test_fan_presets_replace_only_fan_and_keep_thermal_override(client):
    from backend import main
    s=login(client)
    assert [p['id'] for p in s['fan_presets']]==['quiet','balanced','cool']
    for preset in s['fan_presets']:
        r=command(client,'fan',preset['config'],s['version'],'preset-test-'+preset['id'])
        assert r.status_code==200,r.text
        new=r.json();assert new['config']['fan']==preset['config']
        assert new['config']['lights']==s['config']['lights'] and new['config']['oled']==s['config']['oled']
        main.control.metrics['temperature']=76;assert main.control.fan_level()==10
        main.control.metrics['temperature']=42
        s=new

def test_retired_breathing_rejected_for_controls_and_new_scenes(client):
    s=login(client)
    lights={**s['config']['lights'],'effect':'breathe'}
    assert command(client,'lights',lights,s['version'],'retired-breathe-01').status_code==422
    config={**s['config'],'lights':lights}
    assert client.post('/api/v1/scenes',json={'name':'Retired','config':config}).status_code==422
    assert client.get('/api/v1/status').json()['version']==s['version']

def test_legacy_breathing_migrates_atomically_and_only_once(tmp_path):
    import copy,json
    from backend.controller import Controller
    store=Store(tmp_path)
    legacy=Settings().model_dump()
    legacy['lights'].update(effect='breathe',enabled=False,native_color=5,native_speed=3)
    store.set('configuration',{'version':9,'config':legacy})
    scene=copy.deepcopy(legacy)
    # Earlier releases did not store firmware options; use model defaults.
    del scene['lights']['native_color'];del scene['lights']['native_speed']
    store.execute('INSERT INTO scenes VALUES (?,?,?,?,0)',('old','Old','leaf',json.dumps(scene)))
    original_event=store.event('lights','test',None,legacy)
    control=Controller(store,simulate=True)
    assert control.version==10
    expected=copy.deepcopy(legacy);expected['lights']['effect']='native_breathe'
    assert control.config==expected
    assert store.get('configuration')=={'version':10,'config':expected}
    upgraded=json.loads(store.query('SELECT config FROM scenes WHERE id=?',('old',))[0]['config'])
    assert upgraded['lights']['effect']=='native_breathe'
    assert (upgraded['lights']['native_color'],upgraded['lights']['native_speed'])==(1,1)
    assert not upgraded['lights']['enabled']
    assert json.loads(store.query('SELECT after_json FROM events WHERE id=?',(original_event,))[0]['after_json'])==legacy
    assert Controller(store,simulate=True).version==10
    assert len(store.query("SELECT * FROM events WHERE kind='system.migrate'"))==1
    store.db.close()

def test_breathing_migration_rolls_back_if_scene_invalid(tmp_path):
    import json
    from backend.migrations import migrate_native_breathing
    store=Store(tmp_path);config=Settings().model_dump();config['lights']['effect']='breathe'
    saved={'version':4,'config':config};store.set('configuration',saved)
    config=json.loads(json.dumps(config));config['lights']['native_speed']=9
    store.execute('INSERT INTO scenes VALUES (?,?,?,?,0)',('invalid','Old','leaf',json.dumps(config)))
    with pytest.raises(ValueError):migrate_native_breathing(store)
    assert store.get('configuration')==saved
    assert not store.query("SELECT * FROM events WHERE kind='system.migrate'")
    store.db.close()

def test_native_breathing_continues_without_software_frames(tmp_path):
    import asyncio
    from unittest.mock import Mock
    from backend.controller import Controller
    store=Store(tmp_path);control=Controller(store,simulate=True)
    control.config['lights'].update(effect='native_breathe',native_color=2,native_speed=1)
    hardware=Mock();control.hardware=hardware
    async def run():
        await control.apply_lights(force=True)
        first=control.applied['lights'].copy()
        for _ in range(40):
            control.animation_start-=.25
            await control.apply_lights()
        assert control.applied['lights']==first
        hardware.native_breathe.assert_called_once_with(2,1,True)
        hardware.lights.assert_not_called()
        control.config['lights']['native_speed']=3
        await control.apply_lights()
        hardware.native_breathe.assert_called_with(2,3,False)
        assert hardware.native_breathe.call_count==2
        hardware.lights.assert_not_called()
    asyncio.run(run());store.db.close()
