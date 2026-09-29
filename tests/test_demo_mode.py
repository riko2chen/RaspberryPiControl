import pytest
from fastapi.testclient import TestClient
from backend import main

def test_demo_requires_simulation(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'ROOT',tmp_path);monkeypatch.setattr(main,'DEMO',True);monkeypatch.setenv('PC_SIMULATE','0')
    with pytest.raises(RuntimeError,match='requires PC_SIMULATE'):
        with TestClient(main.app):pass
    assert not (tmp_path/'state/control.db').exists()

def test_demo_is_anonymous_simulated_and_can_remember_real_devices(tmp_path,monkeypatch):
    monkeypatch.setattr(main,'ROOT',tmp_path);monkeypatch.setattr(main,'DEMO',True);monkeypatch.setenv('PC_SIMULATE','1');monkeypatch.delenv('PC_DEV_PASSWORD',raising=False)
    monkeypatch.setenv('PC_DISCOVERY_FILE',str(tmp_path/'absent'))
    import uuid
    from backend import peers
    identity=str(uuid.uuid4())
    probes=[]
    def probe(url):
        probes.append(url)
        return {'id':identity,'name':'Living room Pi','version':'1.5.0','url':url,'online':True,'last_seen':1}
    monkeypatch.setattr(peers,'probe',probe)
    with TestClient(main.app) as client:
        s=client.get('/api/v1/status').json();assert s['demo'] and s['hardware']['simulate']
        assert s['cpu_fan_policy']['available']
        updated=client.put('/api/v1/lights',json={'value':s['config']['lights'],'expected_version':s['version'],'request_id':'demo-mode-preserved'}).json()
        assert updated['demo'] and updated['hardware']['simulate']
        assert not s['hardware']['connection']['components']['cpu_fan']['physical_feedback']
        assert client.get('/api/v1/devices').json()['service_mode']=='demo'
        assert client.post('/api/v1/devices/connect',json={'url':'http://192.168.1.100:8080'}).status_code==200
        items=client.get('/api/v1/devices').json()['items'];assert len(items)==1 and items[0]['saved']
        assert client.post('/api/v1/devices/scan').json()['items'][0]['online']
        # Remembering a peer never switches this controller or forwards controls to it.
        assert client.get('/api/v1/status').json()['hardware']['simulate']
        with client.websocket_connect('/api/v1/live') as ws:assert ws.receive_json()['demo']
    with TestClient(main.app) as client:
        assert client.get('/api/v1/devices').json()['items'][0]['id']==identity
        assert client.delete('/api/v1/devices/'+identity).status_code==200
        assert client.get('/api/v1/devices').json()['items']==[]
    assert probes and set(probes)=={'http://192.168.1.100:8080'}
