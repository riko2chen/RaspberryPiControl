"""A device directory, not a credential proxy. Each Pi keeps its own login."""
import asyncio
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

NETWORKS = tuple(ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10','127.0.0.0/8'))


def private_address(value):
    try:
        address = ipaddress.ip_address(value)
        return address.version == 4 and any(address in n for n in NETWORKS)
    except (ValueError,TypeError): return False


def normalize_url(value):
    value = value.strip()
    if '://' not in value:
        value = 'http://' + value
        if ':' not in urlsplit(value).netloc: value += ':8080'
    parsed = urlsplit(value)
    if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
        raise ValueError('请输入树莓派地址，例如 192.168.1.100:8080 或设备的 Tailscale 域名')
    host = parsed.hostname or ''
    if not re.fullmatch(r'[A-Za-z0-9.-]{1,253}',host) or '..' in host:
        raise ValueError('地址格式不正确')
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    if not 1 <= port <= 65535: raise ValueError('端口范围为 1–65535')
    return f'{parsed.scheme}://{host.lower()}:{port}'


def probe(value):
    url = normalize_url(value); parsed = urlsplit(url)
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(parsed.hostname,parsed.port,socket.AF_INET,socket.SOCK_STREAM)})
    if not addresses or any(not private_address(a) for a in addresses):
        raise ValueError('只支持局域网、Tailscale 或本机地址')
    # Pin the validated address. No proxy environment, DNS rebinding, redirects,
    # cookies, bearer tokens or arbitrary paths are involved in discovery.
    conn = http.client.HTTPConnection(parsed.hostname,parsed.port,timeout=2)
    try:
        conn.sock = socket.create_connection((addresses[0],parsed.port),timeout=2)
        if parsed.scheme == 'https':
            conn.sock = ssl.create_default_context().wrap_socket(conn.sock,server_hostname=parsed.hostname)
        conn.request('GET','/api/v1/device',headers={'Accept':'application/json'})
        response=conn.getresponse();raw=response.read(16385)
        if response.status!=200 or len(raw)>16384:raise ValueError('目标没有提供兼容的 Pi Control 服务')
        data=json.loads(raw)
        if not isinstance(data,dict) or data.get('product')!='pi-control' or data.get('protocol')!=1:raise ValueError('目标不是兼容的 Pi Control 服务')
        ident=str(uuid.UUID(data['id']))
        name=data.get('name','树莓派')
        if not isinstance(name,str) or not 1<=len(name)<=64:raise ValueError('设备名称无效')
        return {'id':ident,'name':name,'version':str(data.get('version',''))[:32],'url':url,'online':True,'last_seen':time.time()}
    except (KeyError,TypeError,json.JSONDecodeError) as exc:
        raise ValueError('目标没有返回有效设备信息') from exc
    finally:conn.close()


class PeerDirectory:
    def __init__(self,store,version):
        self.store=store
        identity=store.get('device_identity')
        if not identity:
            identity={'id':str(uuid.uuid4()),'name':os.getenv('PC_DEVICE_NAME',socket.gethostname())[:64] or '树莓派'}
            store.set('device_identity',identity)
        self.identity={**identity,'product':'pi-control','protocol':1,'version':version}
        self.items={x['id']:{**x,'online':False,'saved':True} for x in store.get('known_devices',[])}
        self.lock=asyncio.Lock();self.task=None;self.scanned_at=None;self.discovery_error=None

    def snapshot(self):
        return {'current':self.identity,'items':sorted(self.items.values(),key=lambda x:(not x.get('saved',False),x['name'])),
                'scanned_at':self.scanned_at,'discovery_error':self.discovery_error}

    def persist(self):
        self.store.set('known_devices',[{k:v for k,v in row.items() if k in ('id','name','url','version','last_seen')} for row in self.items.values() if row.get('saved')])

    async def scan(self):
        async with self.lock:
            urls={row['url'] for row in self.items.values() if row.get('saved')}
            self.discovery_error=None
            try:
                path=Path(os.getenv('PC_DISCOVERY_FILE','/run/pi-control-discovery/peers.json'))
                if path.stat().st_size>65536:raise ValueError('发现列表过大')
                data=json.loads(path.read_text())
                if time.time()-data['scanned_at']>60:raise ValueError('局域网发现暂未更新')
                if data.get('error'):raise ValueError(data['error'])
                for row in data.get('items',[])[:64]:
                    if private_address(row['address']) and isinstance(row['port'],int):
                        urls.add(normalize_url(f"http://{row['address']}:{row['port']}"))
            except (OSError,ValueError,KeyError,TypeError) as exc:
                self.discovery_error='局域网发现暂不可用，可手动输入设备地址'
            semaphore=asyncio.Semaphore(6)
            async def check(url):
                async with semaphore:
                    try:return await asyncio.wait_for(asyncio.to_thread(probe,url),5)
                    except (OSError,ValueError,TimeoutError,http.client.HTTPException):return None
            results=await asyncio.gather(*(check(url) for url in sorted(urls)[:64]))
            old=self.items;self.items={k:{**v,'online':False} for k,v in old.items() if v.get('saved')}
            for row in results:
                if not row or row['id']==self.identity['id']:continue
                # Never silently replace a remembered identity at the same URL.
                previous=old.get(row['id'],{})
                if row['id'] in self.items and self.items[row['id']].get('online'):continue
                row['saved']=previous.get('saved',False)
                self.items[row['id']]=row
            self.scanned_at=time.time();self.persist()
            return self.snapshot()

    async def connect(self,url):
        async with self.lock:
            row=await asyncio.wait_for(asyncio.to_thread(probe,url),5)
            for old in self.items.values():
                if old.get('saved') and old['url']==row['url'] and old['id']!=row['id']:
                    raise ValueError('这个地址的设备身份已改变，请先移除原记录再连接')
            if row['id']==self.identity['id']:return {**row,'current':True}
            if row['id'] not in self.items and sum(bool(x.get('saved')) for x in self.items.values())>=32:raise ValueError('最多记住 32 台设备')
            row['saved']=True;self.items[row['id']]=row;self.persist()
            return row

    async def forget(self,ident):
        async with self.lock:
            self.items.pop(ident,None);self.persist()

    async def run(self):
        while True:
            try:await self.scan()
            except Exception: self.discovery_error='局域网发现暂不可用，可手动输入设备地址'
            await asyncio.sleep(30)

    async def start(self):self.task=asyncio.create_task(self.run())
    async def stop(self):
        if self.task:
            self.task.cancel()
            try:await self.task
            except asyncio.CancelledError:pass
