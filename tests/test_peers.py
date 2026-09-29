import asyncio
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import pytest
from backend.peers import PeerDirectory,normalize_url,probe
from backend.store import Store

@pytest.fixture
def peer_server():
    identity={'product':'pi-control','protocol':1,'id':str(uuid.uuid4()),'name':'Test Pi','version':'1.4.0'}
    received=[];mode={'status':200}
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            received.append((self.path,dict(self.headers)))
            body=json.dumps(identity).encode()
            self.send_response(mode['status'])
            if mode['status']==302:self.send_header('Location','http://192.168.10.10/')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    yield 'http://127.0.0.1:'+str(server.server_port),identity,received,mode
    server.shutdown();server.server_close();thread.join()

def test_discovery_no_credentials_or_redirects_and_identity_persistence(tmp_path,monkeypatch,peer_server):
    url,identity,received,mode=peer_server
    discovery=tmp_path/'peers.json'
    discovery.write_text(json.dumps({'scanned_at':time.time(),'items':[{'address':'127.0.0.1','port':int(url.rsplit(':',1)[1])}]}))
    monkeypatch.setenv('PC_DISCOVERY_FILE',str(discovery))
    monkeypatch.setenv('HTTP_PROXY','http://invalid.example:9999')
    store=Store(tmp_path/'state');directory=PeerDirectory(store,'1.4.0')
    async def scenario():
        scan=await directory.scan();assert len(scan['items'])==1
        assert scan['items'][0]['online'] and not scan['items'][0]['saved']
        connected=await directory.connect(url);assert connected['saved']
        restarted=PeerDirectory(store,'1.4.0')
        assert restarted.identity==directory.identity
        assert len(restarted.items)==1
        mode['status']=503
        assert (await restarted.scan())['items'][0]['online'] is False
        mode['status']=200
        assert (await restarted.scan())['items'][0]['online'] is True
        old_id=identity['id'];identity['id']=str(uuid.uuid4())
        with pytest.raises(ValueError,match='身份已改变'):await restarted.connect(url)
        identity['id']=old_id
        await restarted.forget(old_id)
        assert store.get('known_devices')==[]
    asyncio.run(scenario())
    for path,headers in received:
        assert path=='/api/v1/device'
        assert not any(key.lower() in ('authorization','cookie') for key in headers)
    mode['status']=302
    with pytest.raises(ValueError):probe(url)
    store.db.close()

@pytest.mark.parametrize('url',['https://example.com/secret','http://user:password@192.168.1.1','http://192.168.1.1/?x=1','file:///etc/passwd','http://192.168.1.1/#x'])
def test_peer_url_rejects_non_origins(url):
    with pytest.raises(ValueError):normalize_url(url)

def test_peer_rejects_public_metadata_and_non_pi_endpoints(monkeypatch,peer_server):
    import socket
    url,identity,received,mode=peer_server
    identity['product']='something-else'
    with pytest.raises(ValueError):probe(url)
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('169.254.169.254',80))])
    with pytest.raises(ValueError,match='只支持'):probe('http://metadata.test')
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',80))])
    with pytest.raises(ValueError,match='只支持'):probe('http://public.test')

def test_network_discovery_identity_and_auth_boundaries(tmp_path,monkeypatch,peer_server):
    from backend import main
    from fastapi.testclient import TestClient
    url,identity,received,mode=peer_server
    monkeypatch.setenv('PC_SIMULATE','1');monkeypatch.setenv('PC_DEV_PASSWORD','fixture-password')
    monkeypatch.setenv('PC_DISCOVERY_FILE',str(tmp_path/'absent'))
    monkeypatch.setattr(main,'ROOT',tmp_path/'api')
    with TestClient(main.app) as client:
        client.headers['X-Pi-Control']='1'
        assert set(client.get('/api/v1/device').json())=={'id','name','product','protocol','version'}
        assert client.get('/api/v1/devices').status_code==401
        assert client.post('/api/v1/devices/connect',json={'url':url}).status_code==401
        client.post('/api/v1/auth/login',json={'username':'pi','password':'fixture-password'})
        token=client.post('/api/v1/tokens',json={'name':'read-only','scope':'read','days':1}).json()['token']
        assert client.post('/api/v1/devices/connect',json={'url':url},headers={'Authorization':'Bearer '+token}).status_code==403
        assert client.post('/api/v1/hardware/scan',headers={'Authorization':'Bearer '+token}).status_code==403
        assert client.post('/api/v1/devices/connect',json={'url':url}).status_code==200
        directory=client.get('/api/v1/devices').json();assert directory['service_mode']=='hardware'
        items=directory['items'];assert items[0]['saved']
        assert client.delete('/api/v1/devices/'+identity['id']).status_code==200
