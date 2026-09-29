import asyncio
import errno
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.controller import Controller
from backend.devices import DeviceHardware
from backend.models import HardwareConfig
from backend.store import Store

@pytest.fixture
def bus_env(tmp_path,monkeypatch):
    import smbus2
    root=tmp_path/'dev';root.mkdir();(root/'i2c-1').touch()
    monkeypatch.setenv('PC_I2C_ROOT',str(root));monkeypatch.setenv('PC_I2C_BUSES','1')
    present={0x0e,0x3c};writes=[]
    class Bus:
        def __init__(self,path):self.path=path
        def check(self,address):
            if address not in present:raise OSError(errno.ENXIO,'absent')
        def write_byte(self,address,value):self.check(address);writes.append(('probe',address,value))
        def read_byte(self,address):self.check(address);return 1
        def i2c_rdwr(self,msg):self.check(msg.addr);writes.append(('probe',msg.addr))
        def write_byte_data(self,address,reg,value):self.check(address);writes.append(('write',address,reg,value))
        def write_i2c_block_data(self,address,reg,data):self.check(address);writes.append(('block',address,reg))
        def close(self):pass
    monkeypatch.setattr(smbus2,'SMBus',Bus)
    return root,present,writes

def test_optional_hardware_missing_and_reconnect_preserves_native_effect(tmp_path,bus_env):
    root,present,writes=bus_env
    store=Store(tmp_path/'data');control=Controller(store,simulate=True)
    control.hardware=DeviceHardware(store.root/'state')
    control.read_metrics();control.config['lights']['effect']='native_breathe'
    async def scenario():
        await control.scan_hardware();await control.apply_all()
        assert all(control.hardware.available(k) for k in ('fan','lights','oled'))
        writes.clear();await control.scan_hardware();await control.apply_all()
        assert not [w for w in writes if w[0]=='write' and w[1]==0x0e] # no repeated fan/RGB parameters
        present.remove(0x0e)
        await control.scan_hardware();assert not control.hardware.available('fan')
        assert control.hardware.available('oled')
        assert control.hardware_snapshot()['components']['cube']['status']=='disconnected'
        assert control.config['lights']['effect']=='native_breathe'
        present.add(0x0e);writes.clear()
        await control.scan_hardware();await control.apply_all()
        assert ('write',0x0e,4,1) in writes # restores firmware breathing
        assert not control.errors
        await control.configure_hardware({**control.connection,'case_fan':False},0,'test')
        assert not control.hardware.available('fan') and control.hardware.available('lights')
        assert json.loads((store.root/'state/fallback.json').read_text())['enabled'] is False
        writes.clear();await control.apply_fan(force=True);assert not writes
        assert control.config['lights']['effect']=='native_breathe'
    asyncio.run(scenario());control.hardware.close();store.db.close()

def test_oled_alternate_address_and_ambiguous_devices(tmp_path,bus_env):
    root,present,writes=bus_env
    h=DeviceHardware(tmp_path);cfg=HardwareConfig().model_dump()
    present.add(0x3d);report=h.scan(cfg,{})
    assert report['components']['oled']['status']=='ambiguous'
    cfg['oled']='i2c-1@0x3d';h.scan(cfg,{})
    h.oled(bytes(512))
    assert all(w[1]==0x3d for w in writes if w[0] in ('write','block'))
    assert not [w for w in writes if w[0]=='write' and w[1]==0x0e]
    h.close()

def test_no_bus_or_no_peripherals_keeps_service_ready(tmp_path,monkeypatch,bus_env):
    from backend import main
    from backend import controller
    root,present,writes=bus_env
    present.clear()
    real=DeviceHardware
    monkeypatch.setattr(controller,'Hardware',lambda state,simulate:real(state,False))
    monkeypatch.setenv('PC_SIMULATE','1');monkeypatch.setenv('PC_DEV_PASSWORD','fixture-password')
    monkeypatch.setattr(main,'ROOT',tmp_path/'app')
    for no_bus in (False,True):
        if no_bus:(root/'i2c-1').unlink()
        with TestClient(main.app) as client:
            client.headers['X-Pi-Control']='1'
            client.post('/api/v1/auth/login',json={'username':'pi','password':'fixture-password'})
            assert client.get('/healthz').status_code==200
            assert client.get('/readyz').status_code==200
            s=client.get('/api/v1/status').json()
            assert not s['hardware']['errors']
            assert all(s['hardware']['connection']['components'][key]['status']=='not-installed' for key in ('fan','lights','oled'))
            assert all(s['applied'][key] is None for key in ('fan','lights','oled'))
            r=client.put('/api/v1/lights',json={'value':s['config']['lights'],'expected_version':s['version'],'request_id':'unavailable-test-01'})
            assert r.status_code==409
            assert client.get('/api/v1/status').json()['version']==s['version']
            hw=client.get('/api/v1/hardware').json()
            r=client.put('/api/v1/hardware',json={'expected_revision':hw['revision'],'value':{**hw['config'],'cube':'off','oled':'off'}})
            assert r.status_code==200
            assert client.put('/api/v1/hardware',json={'expected_revision':hw['revision'],'value':hw['config']}).status_code==409
            # Return to auto for the next boot; there is no physically connected board.
            newer=r.json()
            client.put('/api/v1/hardware',json={'expected_revision':newer['revision'],'value':HardwareConfig().model_dump()})
    assert not [w for w in writes if w[0] in ('write','block')]

def test_bus_failure_releases_single_owner_lock(tmp_path,monkeypatch):
    from backend.hardware import Hardware
    import smbus2
    def fail(*args,**kwargs):raise OSError('missing bus')
    monkeypatch.setattr(smbus2,'SMBus',fail)
    with pytest.raises(OSError):Hardware(tmp_path)
    h=Hardware(tmp_path,simulate=True);h.close()

def test_disabled_cube_does_not_flag_absent_optional_outputs(tmp_path,bus_env):
    root,present,writes=bus_env
    h=DeviceHardware(tmp_path);present.clear()
    cfg=HardwareConfig(cube='off',screen=False).model_dump()
    h.scan(cfg,{'cube':True,'oled':True})
    assert h.inventory['components']['fan']['status']=='disabled'
    assert h.inventory['components']['lights']['status']=='disabled'
    assert h.inventory['components']['oled']['status']=='disabled'
    h.close()


def test_shutdown_does_not_claim_to_control_an_unmanaged_fan(tmp_path,bus_env):
    root,present,writes=bus_env
    store=Store(tmp_path/'data');control=Controller(store,simulate=True)
    control.hardware=DeviceHardware(store.root/'state')
    control.connection['case_fan']=False
    async def scenario():
        await control.scan_hardware();writes.clear()
        await control.stop()
    asyncio.run(scenario())
    assert not [w for w in writes if w[0]=='write']
    event=store.query("SELECT after_json FROM events WHERE kind='system.stop'")[-1]
    assert json.loads(event['after_json'])['case_fan']=='not managed'
    store.db.close()
