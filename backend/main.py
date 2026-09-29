from __future__ import annotations
import asyncio
import base64
import csv
import io
import json
import logging
import os
import secrets
import socket
import http.client
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from .controller import Controller, Conflict, HardwareFailure
from .models import Command, Fan, Lights, Oled, Settings, Login, TokenRequest, SceneRequest, HardwareCommand, PeerAddress
from .peers import PeerDirectory, private_address
from .render import render_oled
from .store import Store, check_password, password_hash, hashed
from .api_docs import install_openapi

ROOT=Path(os.getenv('PC_DATA_DIR','/var/lib/pi-control'))
STATIC=Path(__file__).resolve().parent.parent/'frontend/dist'
ALLOWED=set(os.getenv('PC_ALLOWED_HOSTS',f'localhost,127.0.0.1,testserver,{socket.gethostname()},{socket.gethostname()}.local').split(','))
COOKIE='pi_control_session'
DEMO=os.getenv('PC_DEMO')=='1'
store=None
control=None
peers=None
failures=defaultdict(deque)

@asynccontextmanager
async def lifespan(app):
    global store,control,peers
    if DEMO and os.getenv('PC_SIMULATE')!='1':raise RuntimeError('PC_DEMO requires PC_SIMULATE=1; demo authentication cannot control real hardware')
    store=Store(ROOT)
    if not store.get('auth'):
        bootstrap=Path(os.getenv('PC_BOOTSTRAP','/run/secrets/pi-control-bootstrap'))
        if bootstrap.is_file():
            initial=json.loads(bootstrap.read_text())
        elif DEMO:
            initial={'username':'demo','password_hash':password_hash(secrets.token_urlsafe(48))}
        elif os.getenv('PC_SIMULATE')=='1' and os.getenv('PC_DEV_PASSWORD'):
            initial={'username':'pi','password_hash':password_hash(os.environ['PC_DEV_PASSWORD'])}
        else: raise RuntimeError('Initial authentication file is required')
        store.set('auth',{'username':initial['username'],'password_hash':initial['password_hash']})
        if initial.get('cli_token_hash'):
            store.execute('INSERT INTO tokens VALUES (?,?,?,?,?,?,?,?)',('host-cli','Host CLI',initial['cli_token_hash'],'control',time.time(),time.time()+365*86400,None,'api'))
    control=Controller(store,os.getenv('PC_SIMULATE')=='1')
    await control.start()
    peers=PeerDirectory(store,'1.5.0')
    await peers.start()
    yield
    await peers.stop()
    await control.stop()
    store.db.close()

app=FastAPI(title='Pi Control',version='1.5.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

@app.middleware('http')
async def boundary(request:Request,call_next):
    if request.url.hostname not in ALLOWED and not private_address(request.url.hostname):return JSONResponse({'detail':'Host not allowed'},status_code=400)
    if int(request.headers.get('content-length','0') or 0)>32768:return JSONResponse({'detail':'Request too large'},status_code=413)
    origin=request.headers.get('origin')
    if request.method not in ('GET','HEAD','OPTIONS') and origin and urlparse(origin).netloc!=request.url.netloc:
        return JSONResponse({'detail':'Origin not allowed'},status_code=403)
    if request.method not in ('GET','HEAD','OPTIONS') and request.cookies.get(COOKIE) and request.headers.get('X-Pi-Control')!='1':
        return JSONResponse({'detail':'Missing request verification header'},status_code=403)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'"
    if request.url.path.startswith('/api/'):response.headers['Cache-Control']='no-store'
    return response

def auth(request,required='read'):
    if DEMO:return {'id':'docker-demo','name':'Docker 演示','scope':'admin','kind':'demo'}
    header=request.headers.get('authorization','')
    raw=header[7:] if header.lower().startswith('bearer ') else request.cookies.get(COOKIE)
    identity=store.authenticate(raw)
    if not identity:raise HTTPException(401,'请先登录')
    levels={'read':0,'control':1,'admin':2}
    if levels.get(identity['scope'],-1)<levels[required]:raise HTTPException(403,'权限不足')
    return identity

@app.get('/healthz')
async def health():return {'status':'ok','version':'1.5.0'}

@app.get('/readyz')
async def ready():
    healthy=control.hardware is not None and not control.errors
    return JSONResponse({'status':'ready' if healthy else 'hardware-unavailable'},status_code=200 if healthy else 503)

@app.get('/api/v1/device')
async def device_identity():
    # Public discovery metadata contains no settings, addresses or credentials.
    return peers.identity

@app.get('/api/v1/hardware')
async def hardware_status(request:Request):
    auth(request);return control.hardware_snapshot()

@app.post('/api/v1/hardware/scan')
async def hardware_scan(request:Request):
    auth(request,'control')
    async with control.lock:
        await control.scan_hardware()
        try:await control.apply_all()
        except HardwareFailure:pass
        return control.hardware_snapshot()

@app.put('/api/v1/hardware')
async def hardware_config(body:HardwareCommand,request:Request):
    who=auth(request,'control')
    try:return await control.configure_hardware(body.value.model_dump(),body.expected_revision,who['name'])
    except Conflict as exc:raise HTTPException(409,str(exc))

@app.get('/api/v1/devices')
async def devices(request:Request):
    auth(request)
    return {**peers.snapshot(),'service_mode':'demo' if DEMO else 'hardware'}

@app.post('/api/v1/devices/scan')
async def scan_devices(request:Request):
    auth(request,'admin')
    if peers.lock.locked():raise HTTPException(409,'正在扫描，请稍后查看结果')
    await peers.scan()
    return await devices(request)

@app.post('/api/v1/devices/connect')
async def connect_device(body:PeerAddress,request:Request):
    who=auth(request,'admin')
    try:
        result=await peers.connect(body.url)
        store.event('device.connect',who['name'],None,{'id':result['id'],'name':result['name'],'url':result['url']})
        return result
    except (OSError,ValueError,TimeoutError,http.client.HTTPException) as exc:
        raise HTTPException(422,str(exc) if isinstance(exc,ValueError) else '无法连接这台设备，请检查地址和网络')

@app.delete('/api/v1/devices/{ident}')
async def forget_device(ident:str,request:Request):
    who=auth(request,'admin');await peers.forget(ident)
    store.event('device.forget',who['name'],{'id':ident},None)
    return {'ok':True}

@app.post('/api/v1/auth/login')
async def login(body:Login,request:Request):
    ip=request.client.host
    recent=failures[ip]
    while recent and recent[0]<time.time()-300:recent.popleft()
    if len(recent)>=8:raise HTTPException(429,'尝试过于频繁，五分钟后重试')
    recent.append(time.time())
    credentials=store.get('auth')
    valid=await asyncio.to_thread(check_password,body.password,credentials['password_hash'])
    if not valid or not secrets.compare_digest(body.username,credentials['username']):raise HTTPException(401,'用户名或密码不正确')
    recent.clear()
    _,token=store.token(body.username,'admin',7,'session')
    response=JSONResponse({'username':body.username})
    response.set_cookie(COOKIE,token,httponly=True,samesite='strict',secure=request.url.scheme=='https',max_age=7*86400,path='/')
    return response

@app.post('/api/v1/auth/logout')
async def logout(request:Request):
    user=auth(request)
    if user['kind']=='session':store.execute('DELETE FROM tokens WHERE id=?',(user['id'],))
    response=JSONResponse({'ok':True});response.delete_cookie(COOKIE);return response

@app.get('/api/v1/status')
async def status(request:Request):
    user=auth(request)
    result=control.snapshot();result['demo']=DEMO;result['device']=peers.identity;result['identity']={'name':user['name'],'scope':user['scope']};return result

async def change(request,kind,body,model):
    who=auth(request,'control')
    try:
        value=model.model_validate(body.value).model_dump() if model else body.value
        result=await control.change(kind,value,body.expected_version,body.request_id,who['name'])
        result['device']=peers.identity
        result['demo']=DEMO
        result['identity']={'name':who['name'],'scope':who['scope']}
        return result
    except ValidationError as exc:raise HTTPException(422,str(exc))
    except Conflict as exc:raise HTTPException(409,str(exc))
    except HardwareFailure as exc:return JSONResponse({'detail':str(exc),'state':control.snapshot()},status_code=503)

@app.put('/api/v1/fans/case')
async def fan(body:Command,request:Request):return await change(request,'fan',body,Fan)

@app.put('/api/v1/lights')
async def lights(body:Command,request:Request):return await change(request,'lights',body,Lights)

@app.patch('/api/v1/lights/{index}')
async def one_light(index:int,body:Command,request:Request):
    if not 0<=index<14:raise HTTPException(422,'灯珠编号范围为 0–13')
    if set(body.value)!={'color'}:raise HTTPException(422,'需要 color 字段')
    value=dict(control.config['lights']);value['colors']=list(value['colors']);value['colors'][index]=body.value['color'];value['effect']='static'
    return await change(request,'lights',body.model_copy(update={'value':value}),Lights)

@app.put('/api/v1/oled')
async def oled(body:Command,request:Request):return await change(request,'oled',body,Oled)

@app.put('/api/v1/labels')
async def labels(body:Command,request:Request):
    if set(body.value)!={'labels'}:raise HTTPException(422,'需要 labels 字段')
    try:checked=Settings.model_validate({**control.config,'labels':body.value['labels']}).model_dump()
    except ValidationError as exc:raise HTTPException(422,str(exc))
    who=auth(request,'control')
    try:return await control.change('labels',checked['labels'],body.expected_version,body.request_id,who['name'])
    except Conflict as exc:raise HTTPException(409,str(exc))

@app.post('/api/v1/oled/preview')
async def preview(body:Oled,request:Request):
    auth(request)
    rows=render_oled(body.model_dump(),control.metrics)
    return {'pixels':base64.b64encode(rows).decode(),'width':128,'height':32,'preview':True}

@app.get('/api/v1/oled/frame')
async def frame(request:Request):
    auth(request);return control.applied['oled']

@app.get('/api/v1/events')
async def events(request:Request,before:int=0,limit:int=30,kind:str=''):
    auth(request)
    rows=store.query('SELECT id,ts,kind,source,outcome,error,before_json,after_json FROM events WHERE (?=0 OR id<?) AND (?=\'\' OR kind LIKE ?) ORDER BY id DESC LIMIT ?',(before,before,kind,kind+'%',max(1,min(limit,100))))
    for row in rows:
        row['before']=json.loads(row.pop('before_json'));row['after']=json.loads(row.pop('after_json'))
    return {'items':rows,'next':rows[-1]['id'] if rows else None}

@app.get('/api/v1/metrics')
async def metrics(request:Request,hours:float=1):
    auth(request)
    rows=store.query('SELECT * FROM metrics WHERE ts>? ORDER BY ts',(time.time()-max(0.05,min(hours,168))*3600,))
    step=max(1,len(rows)//360)
    return {'items':rows[::step]}

@app.get('/api/v1/frames')
async def frames(request:Request,before:int=0,limit:int=20):
    auth(request)
    rows=store.query('SELECT id,ts,pixel_hash,mode FROM frames WHERE (?=0 OR id<?) ORDER BY id DESC LIMIT ?',(before,before,max(1,min(limit,100))))
    return {'items':rows,'next':rows[-1]['id'] if rows else None}

@app.get('/api/v1/frames/{frame_id}')
async def historical_frame(frame_id:int,request:Request):
    auth(request)
    rows=store.query('SELECT * FROM frames WHERE id=?',(frame_id,))
    if not rows:raise HTTPException(404,'记录已过保留期限')
    r=rows[0];r['pixels']=base64.b64encode(r['pixels']).decode();return r

@app.get('/api/v1/scenes')
async def scenes(request:Request):
    auth(request)
    rows=store.query('SELECT * FROM scenes ORDER BY builtin DESC,rowid')
    for row in rows:row['config']=Settings.model_validate(json.loads(row['config'])).model_dump()
    return {'items':rows}

@app.post('/api/v1/scenes')
async def save_scene(body:SceneRequest,request:Request):
    who=auth(request,'control')
    if store.query('SELECT count(*) n FROM scenes')[0]['n']>=32:raise HTTPException(409,'最多保存 32 个场景')
    ident=secrets.token_hex(6)
    store.execute('INSERT INTO scenes VALUES (?,?,?,?,0)',(ident,body.name,body.icon,json.dumps(body.config.model_dump(),ensure_ascii=False)))
    store.event('scene.save',who['name'],None,{'id':ident,'name':body.name})
    return {'id':ident}

@app.post('/api/v1/scenes/{scene_id}/apply')
async def apply_scene(scene_id:str,body:Command,request:Request):
    auth(request,'control')
    rows=store.query('SELECT config FROM scenes WHERE id=?',(scene_id,))
    if not rows:raise HTTPException(404,'场景不存在')
    return await change(request,'scene',body.model_copy(update={'value':json.loads(rows[0]['config'])}),Settings)

@app.delete('/api/v1/scenes/{scene_id}')
async def delete_scene(scene_id:str,request:Request):
    who=auth(request,'control')
    rows=store.query('SELECT builtin,name FROM scenes WHERE id=?',(scene_id,))
    if not rows:raise HTTPException(404,'场景不存在')
    if rows[0]['builtin']:raise HTTPException(409,'内置场景保留')
    store.execute('DELETE FROM scenes WHERE id=?',(scene_id,));store.event('scene.delete',who['name'],rows[0],None)
    return {'ok':True}

@app.get('/api/v1/tokens')
async def tokens(request:Request):
    auth(request,'admin')
    return {'items':store.query('SELECT id,name,scope,created,expires,last_used FROM tokens WHERE kind=\'api\' ORDER BY created DESC')}

@app.post('/api/v1/tokens')
async def create_token(body:TokenRequest,request:Request):
    who=auth(request,'admin')
    if store.query('SELECT count(*) n FROM tokens WHERE kind=\'api\'')[0]['n']>=32:raise HTTPException(409,'令牌数量已达上限')
    ident,token=store.token(body.name,body.scope,body.days)
    store.event('token.create',who['name'],None,{'id':ident,'name':body.name,'scope':body.scope})
    return {'id':ident,'token':token}

@app.delete('/api/v1/tokens/{token_id}')
async def revoke_token(token_id:str,request:Request):
    who=auth(request,'admin')
    store.execute('DELETE FROM tokens WHERE id=? AND kind=\'api\'',(token_id,))
    store.event('token.revoke',who['name'],None,{'id':token_id})
    return {'ok':True}

@app.get('/api/v1/export/events.csv')
async def export(request:Request):
    auth(request)
    rows=store.query('SELECT id,ts,kind,source,outcome,error FROM events ORDER BY id')
    output=io.StringIO();writer=csv.writer(output);writer.writerow(['id','timestamp','kind','source','outcome','error'])
    def safe(v):
        s='' if v is None else str(v)
        return "'"+s if s.startswith(('=','+','-','@')) else s
    writer.writerows([[safe(x) for x in r.values()] for r in rows])
    return Response('\ufeff'+output.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="pi-control-events.csv"'})

@app.websocket('/api/v1/live')
async def live(ws:WebSocket):
    if (ws.url.hostname not in ALLOWED and not private_address(ws.url.hostname)) or (ws.headers.get('origin') and urlparse(ws.headers['origin']).netloc!=ws.url.netloc):
        await ws.close(code=1008);return
    raw=ws.cookies.get(COOKIE)
    header=ws.headers.get('authorization','')
    if header.lower().startswith('bearer '):raw=header[7:]
    if not DEMO and not store.authenticate(raw):await ws.close(code=1008);return
    await ws.accept()
    try:
        count=0
        while True:
            if not DEMO and count%20==0 and not store.authenticate(raw):await ws.close(code=1008);return
            await asyncio.wait_for(ws.send_json({**control.snapshot(),'device':peers.identity,'demo':DEMO}),timeout=3)
            count+=1;await asyncio.sleep(0.5)
    except (WebSocketDisconnect,RuntimeError,TimeoutError):pass

@app.get('/api/v1/openapi.json',include_in_schema=False)
async def schema(request:Request):auth(request);return app.openapi()

@app.get('/api/docs',include_in_schema=False)
async def api_documentation(request:Request):
    auth(request)
    return FileResponse(STATIC/'api-docs.html',headers={'Cache-Control':'no-store'})

if STATIC.exists(): app.mount('/assets',StaticFiles(directory=STATIC/'assets'),name='assets')

@app.get('/',include_in_schema=False)
async def index():
    if not (STATIC/'index.html').exists():return JSONResponse({'detail':'Frontend is not built'},status_code=503)
    return FileResponse(STATIC/'index.html',headers={'Cache-Control':'no-cache'})

install_openapi(app)
