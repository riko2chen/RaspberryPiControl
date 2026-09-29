#!/usr/bin/env python3
"""Exercise only the explicitly labelled Docker simulator."""
import json,sys,urllib.request,uuid
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8080'
def request(path,body=None,method=None):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json','X-Pi-Control':'1'})
    with urllib.request.urlopen(req,timeout=10) as r:return json.load(r)
s=request('/api/v1/status');assert s['hardware']['simulate'] and s.get('demo'), 'Refusing to test a real device'
original=s['config']['lights']
try:
    value={**original,'effect':'static','brightness':37,'colors':['#3366ff']*14}
    result=request('/api/v1/lights',{'value':value,'expected_version':s['version'],'request_id':uuid.uuid4().hex},'PUT')
    assert result['config']['lights']==value
    preview=request('/api/v1/oled/preview',{**s['config']['oled'],'mode':'text','text':'Docker OK'},'POST')
    import base64
    assert len(base64.b64decode(preview['pixels']))==512
    assert request('/api/v1/events')['items']
    assert request('/readyz')['status']=='ready'
finally:
    s=request('/api/v1/status');request('/api/v1/lights',{'value':original,'expected_version':s['version'],'request_id':uuid.uuid4().hex},'PUT')
print('Docker API, OLED preview, history and readiness passed.')
