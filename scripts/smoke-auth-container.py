#!/usr/bin/env python3
"""Verify the real service starts securely without any host device mounts."""
import http.cookiejar,json,os,secrets,shlex,socket,subprocess,time,urllib.error,urllib.request,uuid
cli=shlex.split(os.getenv('DOCKER_CLI','docker'));image=os.getenv('PC_TEST_IMAGE','pi-control:1.5.0');name='pi-control-auth-test-'+uuid.uuid4().hex[:8]
def docker(*args,**kw):return subprocess.run([*cli,*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,**kw).stdout.strip()
password=secrets.token_urlsafe(32)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
base=f'http://127.0.0.1:{port}'
try:
    docker('volume','create',name)
    bootstrap="import sys,json;from pathlib import Path;from backend.store import password_hash;p=Path('/var/lib/pi-control/bootstrap.json');p.write_text(json.dumps({'username':'pi','password_hash':password_hash(sys.stdin.read())}));p.chmod(0o600)"
    docker('run','--rm','-i','-v',name+':/var/lib/pi-control',image,'python','-c',bootstrap,input=password)
    docker('run','-d','--name',name,'-p',f'127.0.0.1:{port}:8080','-v',name+':/var/lib/pi-control','-e','PC_BOOTSTRAP=/var/lib/pi-control/bootstrap.json','-e','PC_SIMULATE=0','-e','PC_DEMO=0',image)
    for attempt in range(60):
        try:urllib.request.urlopen(base+'/readyz',timeout=1).read();break
        except (OSError,urllib.error.URLError):time.sleep(.3)
    else:raise RuntimeError('Service failed to become ready')
    try:urllib.request.urlopen(base+'/api/v1/status');raise AssertionError('Real service accepted an unauthenticated request')
    except urllib.error.HTTPError as e:assert e.code==401
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    request=urllib.request.Request(base+'/api/v1/auth/login',data=json.dumps({'username':'pi','password':password}).encode(),headers={'Content-Type':'application/json','X-Pi-Control':'1'})
    opener.open(request).read();password=''
    state=json.load(opener.open(base+'/api/v1/status'));assert not state['hardware']['simulate'] and not state['demo']
    assert state['hardware']['connection']['candidates']==[]
    assert state['hardware']['connection']['components']['cube']['status']=='not-installed'
    assert opener.open(base+'/api/docs').status==200
    print('Real-mode image: authentication required, no-device startup healthy, no simulation fallback, bundled docs available.')
finally:
    subprocess.run([*cli,'rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run([*cli,'volume','rm',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
