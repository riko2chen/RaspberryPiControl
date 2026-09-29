from __future__ import annotations
import asyncio
import base64
import copy
import hashlib
import json
import logging
import math
import os
import time
from datetime import datetime
from pathlib import Path
from .hardware import FAN_CODES, page_bytes
from .devices import DeviceHardware as Hardware
from .models import Settings, HardwareConfig
from .migrations import migrate_native_breathing
from .render import light_frame, render_oled
from .thermal import cpu_fan_policy,FAN_PRESETS

log=logging.getLogger('pi-control')

class Conflict(Exception): pass
class HardwareFailure(Exception): pass

class Controller:
    def __init__(self, store, simulate=False):
        self.store=store
        self.simulate=simulate
        migrate_native_breathing(store)
        stored=store.get('configuration',{'version':0,'config':Settings().model_dump()})
        self.config=Settings.model_validate(stored['config']).model_dump()
        self.version=stored['version']
        self.lock=asyncio.Lock()
        self.hardware=None
        self.metrics={}
        self.applied={'fan':None,'lights':None,'oled':None}
        self.errors={}
        self.started=time.time()
        self.animation_start=time.monotonic()
        self.last_fan_change=0
        self.last_metrics=0
        self.last_oled=0
        self.last_prune=0
        self.last_cpu=None
        self.safety_override=False
        self.stop_event=asyncio.Event()
        self.task=None
        self.last_retry=0
        self.frame_count=0
        self.operation_times=[]
        self.light_writes=[]
        self.light_write_count=0
        self.cpu_policy={}
        connection=store.get('hardware_connection',{'revision':0,'config':HardwareConfig().model_dump()})
        self.connection=HardwareConfig.model_validate(connection['config']).model_dump()
        self.connection_revision=connection['revision']
        self.hardware_seen=store.get('hardware_seen',{})
        self.last_scan=0
        self._seed_scenes()

    def _seed_scenes(self):
        for ident,name,icon,brightness,effect,fan,oled in [
            ('focus','专注时刻','leaf',35,'static',{'mode':'auto'},'system'),
            ('quiet','安静陪伴','moon',12,'static',{'mode':'auto','curve':[{'temperature':35,'level':1},{'temperature':50,'level':3},{'temperature':60,'level':6},{'temperature':70,'level':10}]},'clock'),
            ('performance','全力运行','sun',55,'static',{'mode':'manual','level':10},'system'),
            ('showcase','流光展示','sparkles',50,'rainbow',{'mode':'auto'},'carousel')]:
            c=Settings().model_dump(); c['lights'].update(brightness=brightness,effect=effect); c['fan'].update(fan); c['oled']['mode']=oled
            if ident=='performance': c['lights']['colors']=['#e7a867']*14
            self.store.execute('INSERT OR IGNORE INTO scenes VALUES (?,?,?,?,1)',(ident,name,icon,json.dumps(c,ensure_ascii=False)))

    async def start(self):
        self.store.event('system.start','system',None,{'version':self.version,'note':'启动后重新应用保存状态；停机期间的外部硬件变化不可回读'})
        self.read_metrics()
        async with self.lock:
            try:
                self.hardware=await asyncio.to_thread(Hardware,self.store.root/'state',self.simulate)
            except Exception as exc: self.errors['hardware']=str(exc)
            if self.hardware:
                await self.scan_hardware()
                try: await self.apply_all(force=True)
                except HardwareFailure: pass
        self.task=asyncio.create_task(self.run())

    async def stop(self):
        self.stop_event.set()
        if self.task: await self.task
        cooling='not managed'
        if self.hardware:
            try:
                if self.hardware.available('fan'):
                    await asyncio.to_thread(self.hardware.fan,10)
                    cooling='full speed command sent'
            except OSError:
                cooling='write failed';log.exception('Failed to set shutdown cooling')
            self.hardware.close()
        self.store.event('system.stop','system',None,{'case_fan':cooling,'cpu_fan':'kernel controlled'})

    def read_metrics(self):
        sysroot=Path(os.getenv('PC_SYS_ROOT','/host/sys'))
        procroot=Path(os.getenv('PC_PROC_ROOT','/host/proc'))
        values={'temperature':None,'cpu_fan_rpm':None,'cpu_fan_pwm':None,'cpu_percent':None,'memory_percent':None,'sampled_at':time.time()}
        if self.simulate:
            temperature=round(53+7*math.sin((time.time()-self.started)/35),1)
            level=sum(temperature>=t for t in [50,60,67.5,75])
            values.update(temperature=temperature,cpu_fan_rpm=[0,1600,2500,3400,4200][level],cpu_fan_pwm=[0,75,125,175,250][level],cpu_percent=round(12+(temperature-45)*2,1),memory_percent=18.4)
        else:
            try: values['temperature']=int((sysroot/'class/thermal/thermal_zone0/temp').read_text())/1000
            except (OSError,ValueError): pass
            for hw in (sysroot/'class/hwmon').glob('hwmon*'):
                # Docker's /sys is read-only; class symlinks resolve within the same host tree.
                try:
                    if (hw/'name').read_text().strip()=='pwmfan':
                        values['cpu_fan_rpm']=int((hw/'fan1_input').read_text())
                        values['cpu_fan_pwm']=int((hw/'pwm1').read_text())
                except (OSError,ValueError): continue
            try:
                parts=[int(x) for x in (procroot/'stat').read_text().splitlines()[0].split()[1:9]]
                total,idle=sum(parts),parts[3]+parts[4]
                if self.last_cpu and total>self.last_cpu[0]: values['cpu_percent']=round(100*(1-(idle-self.last_cpu[1])/(total-self.last_cpu[0])),1)
                self.last_cpu=(total,idle)
                mem={line.split(':')[0]:int(line.split()[1]) for line in (procroot/'meminfo').read_text().splitlines()}
                values['memory_percent']=round(100*(1-mem['MemAvailable']/mem['MemTotal']),1)
                values['memory_total_gb']=round(mem['MemTotal']/1048576,1)
                values['uptime_seconds']=int(float((procroot/'uptime').read_text().split()[0]))
            except (OSError,ValueError,KeyError): pass
        fs=os.statvfs(self.store.root)
        values['storage_used_percent']=round((1-fs.f_bavail/fs.f_blocks)*100,1)
        values['storage_free_gb']=round(fs.f_bavail*fs.f_frsize/1024**3,1)
        self.metrics=values
        self.cpu_policy=cpu_fan_policy(sysroot) if not self.simulate else {'available':True,'steps':[{'temperature':t,'hysteresis':5,'pwm':pwm,'percent':round(pwm/255*100)} for t,pwm in zip([50,60,67.5,75],[75,125,175,250])],'state':level,'max_state':4}

    def fan_level(self):
        temp=self.metrics.get('temperature')
        if temp is None or temp>=75: self.safety_override=True
        elif temp<=70: self.safety_override=False
        if self.safety_override:return 10
        cfg=self.config['fan']
        if cfg['mode']=='manual':return cfg['level']
        def at(t):
            level=cfg['curve'][0]['level']
            for point in cfg['curve']:
                if t>=point['temperature']:level=point['level']
            return level
        wanted=at(temp)
        old=self.applied['fan']
        if old and wanted<old['level']:
            wanted=min(old['level'],at(temp+2))
            if time.monotonic()-self.last_fan_change<10:return old['level']
        return wanted

    async def apply_fan(self, force=False):
        if not self.hardware or not self.hardware.available('fan'): return
        wanted=self.fan_level()
        old=self.applied['fan']
        if not force and old and old['level']==wanted and 'fan' not in self.errors:return
        try:
            await asyncio.to_thread(self.hardware.fan,wanted)
            self.applied['fan']={'level':wanted,'protocol_code':FAN_CODES[wanted],'written_at':time.time(),'rpm':None}
            self.last_fan_change=time.monotonic()
            self.errors.pop('fan',None)
            if not force and old and old['level']!=wanted:
                self.store.event('fan.automatic','temperature-control',old,self.applied['fan'])
        except OSError as exc:
            self.hardware.mark_failed('fan'); self.errors['fan']=str(exc); raise

    async def apply_lights(self, force=False):
        if not self.hardware or not self.hardware.available('lights'): return
        cfg=self.config['lights']
        phase=time.monotonic()-self.animation_start
        colors=light_frame(cfg,phase)
        native=cfg['enabled'] and cfg['effect']=='native_breathe'
        old=self.applied['lights']
        if not force and old and old['colors']==colors and old.get('parameters')==cfg and 'lights' not in self.errors:return
        try:
            if native:await asyncio.to_thread(self.hardware.native_breathe,cfg['native_color'],cfg['native_speed'],force)
            else:await asyncio.to_thread(self.hardware.lights,colors)
            self.light_write_count+=1
            now=time.monotonic()
            self.light_writes=[t for t in self.light_writes if now-t<2]
            self.light_writes.append(now)
            self.applied['lights']={'colors':colors,'written_at':time.time(),'frame':self.light_write_count,'engine':'firmware' if native else 'software','color_source':'firmware-palette' if native else 'written-frame','parameters':copy.deepcopy(cfg),'phase_seconds':phase}
            self.errors.pop('lights',None)
        except OSError as exc:
            self.hardware.mark_failed('lights'); self.errors['lights']=str(exc); raise

    async def apply_oled(self, force=False):
        if not self.hardware or not self.hardware.available('oled'): return
        cfg=self.config['oled']
        rows=render_oled(cfg,self.metrics)
        digest=hashlib.sha256(rows).hexdigest()
        old=self.applied['oled']
        if not force and old and old['pixel_hash']==digest and 'oled' not in self.errors:return
        try:
            page_data=await asyncio.to_thread(self.hardware.oled,rows,cfg['contrast'],cfg['enabled'])
            ident=self.store.execute('INSERT INTO frames(ts,pixel_hash,pixels,mode) VALUES (?,?,?,?)',(time.time(),digest,rows,cfg['mode']))
            self.applied['oled']={'id':ident,'width':128,'height':32,'pixels':base64.b64encode(rows).decode(),'pixel_hash':digest,'hardware_hash':hashlib.sha256(page_data).hexdigest(),'written_at':time.time(),'mode':cfg['mode']}
            self.errors.pop('oled',None)
        except OSError as exc:
            self.hardware.mark_failed('oled'); self.errors['oled']=str(exc); raise

    async def apply_all(self,force=False):
        failures=[]
        for fn,key in [(self.apply_fan,'fan'),(self.apply_lights,'lights'),(self.apply_oled,'oled')]:
            try: await fn(force=force)
            except Exception as exc:
                self.errors[key]=str(exc);failures.append(key)
        if failures:raise HardwareFailure('写入失败：'+', '.join(failures))

    def hardware_snapshot(self):
        inventory=copy.deepcopy(self.hardware.inventory) if self.hardware else {'scanned_at':None,'buses':[],'candidates':[],'components':{},'scan_errors':[]}
        inventory['components']['cpu_fan']={'status':'connected' if self.metrics.get('cpu_fan_rpm') is not None else 'not-installed','physical_feedback':not self.simulate,'device':None}
        return {**inventory,'config':copy.deepcopy(self.connection),'revision':self.connection_revision}

    async def scan_hardware(self):
        if not self.hardware:return
        previous=copy.deepcopy(self.hardware.inventory['components'])
        inventory=await asyncio.to_thread(self.hardware.scan,self.connection,self.hardware_seen)
        self.last_scan=time.monotonic()
        for key in ('fan','lights','oled'):
            item=inventory['components'][key]
            if item['status']=='connected':
                old=previous.get(key,{})
                if old.get('status')!='connected' or old.get('device')!=item.get('device') or key in self.errors:self.applied[key]=None
                self.errors.pop(key,None)
            elif item['status'] in ('disconnected','error'):
                self.errors[key]='连接已中断，将自动重试' if item['status']=='disconnected' else '无法访问 I²C 总线'
            elif item['status']=='ambiguous':self.errors[key]='找到多个兼容部件，请选择连接目标'
            else:self.errors.pop(key,None)
        seen={**self.hardware_seen}
        for key in ('cube','oled'):
            if inventory['components'][key]['status']=='connected':seen[key]=True
        if seen!=self.hardware_seen:
            self.hardware_seen=seen;self.store.set('hardware_seen',seen)
        now={k:v['status'] for k,v in inventory['components'].items()}
        old={k:v['status'] for k,v in previous.items()}
        if now!=old:self.store.event('hardware.discovery','system',old,now)
        target=self.hardware.targets.get('cube')
        fallback={'enabled':self.connection['case_fan'] and self.connection['cube']!='off' and bool(target),'bus':target['bus'] if target else None}
        path=self.store.root/'state/fallback.json';temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(fallback));temporary.replace(path)

    async def configure_hardware(self, config, revision, source):
        async with self.lock:
            if revision!=self.connection_revision:raise Conflict('硬件连接设置已被修改，请刷新后重试')
            before=self.connection
            self.connection=HardwareConfig.model_validate(config).model_dump()
            self.connection_revision+=1
            self.store.set('hardware_connection',{'revision':self.connection_revision,'config':self.connection})
            self.store.event('hardware.configure',source,before,self.connection)
            await self.scan_hardware()
            try:await self.apply_all()
            except HardwareFailure:pass
            return self.hardware_snapshot()

    def snapshot(self):
        times=[t for t in self.light_writes if time.monotonic()-t<2]
        rate=round((len(times)-1)/(times[-1]-times[0]),1) if len(times)>1 else 0
        return {'version':self.version,'config':copy.deepcopy(self.config),'applied':copy.deepcopy(self.applied),'metrics':dict(self.metrics),'cpu_fan_policy':copy.deepcopy(self.cpu_policy),'fan_presets':copy.deepcopy(FAN_PRESETS),'animation':{'write_fps':rate,'target_fps':30},'hardware':{'connected':self.hardware is not None and not self.errors,'errors':dict(self.errors),'simulate':self.simulate,'connection':self.hardware_snapshot(),'rgb_count':14,'oled_size':[128,32]},'safety_override':self.safety_override,'server_time':time.time(),'started_at':self.started,'frames_sent':self.frame_count,'retention':{'metrics_days':7,'oled_max_frames':100000,'oled_max_days':7,'events_max':50000}}

    async def change(self,kind,value,version,request_id,source):
        payload=json.dumps({'kind':kind,'value':value,'source':source},sort_keys=True,ensure_ascii=False)
        digest=hashlib.sha256(payload.encode()).hexdigest()
        async with self.lock:
            previous=self.store.query('SELECT payload_hash,outcome FROM events WHERE request_id=?',(request_id,))
            if previous:
                if previous[0]['payload_hash']!=digest: raise Conflict('请求编号已被其他操作使用')
                if previous[0]['outcome']!='success': raise HardwareFailure('此前操作未完成，请检查设备后使用新的操作编号重试')
                return self.snapshot()
            if version!=self.version:raise Conflict('另一处已修改设置，请刷新后重试')
            now=time.monotonic()
            self.operation_times=[t for t in self.operation_times if now-t<1]
            if len(self.operation_times)>=12:raise Conflict('操作过于频繁，请稍后重试')
            self.operation_times.append(now)
            if kind in ('fan','lights','oled') and (not self.hardware or not self.hardware.available(kind)):
                raise Conflict('该部件未连接或已停用，请先到设备连接页面检查')
            before=copy.deepcopy(self.config)
            new=copy.deepcopy(before)
            if kind=='scene':new=value
            else:new[kind]=value
            new=Settings.model_validate(new).model_dump()
            next_version=self.version+1
            with self.store.lock,self.store.db:
                self.store.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('configuration',json.dumps({'version':next_version,'config':new},ensure_ascii=False)))
                event_id=self.store.db.execute('INSERT INTO events(ts,kind,source,request_id,payload_hash,before_json,after_json,outcome) VALUES (?,?,?,?,?,?,?,?)',(time.time(),kind,source,request_id,digest,json.dumps(before,ensure_ascii=False),json.dumps(new,ensure_ascii=False),'pending')).lastrowid
            self.version=next_version
            self.config=new
            if kind in ('lights','scene'):self.animation_start=time.monotonic()
            try:
                if not self.hardware:raise HardwareFailure('I2C 控制器不可用')
                if kind=='scene':await self.apply_all(force=True)
                elif kind=='fan':await self.apply_fan(force=True)
                elif kind=='lights':await self.apply_lights(force=True)
                elif kind=='oled':await self.apply_oled(force=True)
                self.store.execute('UPDATE events SET outcome=? WHERE id=?',('success',event_id))
            except Exception as exc:
                self.store.execute('UPDATE events SET outcome=?,error=? WHERE id=?',('failed',str(exc),event_id))
                raise HardwareFailure(str(exc)) from exc
            return self.snapshot()

    async def run(self):
        next_metrics=next_oled=next_heartbeat=0
        while not self.stop_event.is_set():
            cycle_start=time.monotonic()
            cfg=self.config['lights']
            animated=self.hardware and self.hardware.available('lights') and cfg['enabled'] and cfg['effect'] in ('rainbow','chase')
            interval=1/30 if animated else .25
            try:
                async with self.lock:
                    self.frame_count+=1
                    if cycle_start>=next_metrics:
                        self.read_metrics();next_metrics=cycle_start+2
                    if not self.hardware and time.monotonic()-self.last_retry>5:
                        self.last_retry=time.monotonic()
                        try:
                            self.hardware=await asyncio.to_thread(Hardware,self.store.root/'state',self.simulate)
                            self.errors.pop('hardware',None)
                        except Exception as exc:self.errors['hardware']=str(exc)
                    if self.hardware:
                        if cycle_start-self.last_scan>=15: await self.scan_hardware()
                        try:await self.apply_fan()
                        except Exception as exc:self.errors['fan']=str(exc)
                        try:await self.apply_lights()
                        except Exception as exc:self.errors['lights']=str(exc)
                        if cycle_start>=next_oled:
                            try:await self.apply_oled()
                            except Exception as exc:self.errors['oled']=str(exc)
                            next_oled=cycle_start+1
                    if time.time()-self.last_metrics>=10:
                        m=self.metrics
                        self.store.execute('INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?)',(time.time(),m.get('temperature'),m.get('cpu_fan_rpm'),m.get('cpu_percent'),m.get('memory_percent'),(self.applied['fan'] or {}).get('level')))
                        self.last_metrics=time.time()
                    if time.time()-self.last_prune>=3600:
                        self.store.prune();self.last_prune=time.time()
                    if cycle_start>=next_heartbeat:
                        (self.store.root/'state/heartbeat').touch();next_heartbeat=cycle_start+1
                    self.errors.pop('controller',None)
            except Exception as exc:
                self.errors['controller']=str(exc)
                log.exception('Controller loop error')
            # Write time is part of the frame budget; never queue old animation frames.
            delay=max(.001,interval-(time.monotonic()-cycle_start))
            try:await asyncio.wait_for(self.stop_event.wait(),timeout=delay)
            except TimeoutError:pass
