import type {State,Configuration,Scene,Event,Frame,Metric,HardwareConfig,HardwareConnection,OledConfig} from '../types.ts';
import {lightFrame,nativePalette} from '../light-animation.ts';
import {validateControl} from '../control-queue.ts';

export const DEMO_KEY='pi-control-demo-v1';
const copy=<T>(v:T):T=>structuredClone(v);
const fail=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status})};
export const defaultConfig=():Configuration=>({
 fan:{mode:'auto',level:4,curve:[35,45,55,65,75].map((temperature,i)=>({temperature,level:(i+1)*2}))},
 lights:{enabled:true,effect:'rainbow',native_color:2,native_speed:1,brightness:65,speed:1,colors:Array(14).fill('#60a5fa')},
 oled:{enabled:true,mode:'system',text:'你好，树莓派\nPI CONTROL',font_size:12,x:0,y:0,invert:false,contrast:160,pixels:''},
 labels:Array.from({length:14},(_,i)=>`灯珠 ${String(i+1).padStart(2,'0')}`),
});
const hardwareDefault=():HardwareConfig=>({cube:'auto',oled:'auto',case_fan:true,lights:true,screen:true});
const steps=[50,60,67.5,75].map((temperature,i)=>({temperature,hysteresis:5,pwm:[75,125,175,250][i],percent:[29,49,69,98][i]}));
const fanPresets=[['quiet','安静','低温轻转，升温后逐步加强散热',[1,2,4,7,10]],['balanced','均衡','日常使用，兼顾风量与噪声',[2,4,6,8,10]],['cool','散热优先','更早提高风量，适合持续负载',[3,5,7,9,10]]] as const;
function builtins():Scene[]{return ['focus','quiet','performance','showcase'].map((id,i)=>{
 const config=defaultConfig();config.lights.effect=i===3?'rainbow':'static';config.lights.brightness=[35,12,55,65][i];config.oled.mode=(['system','clock','system','carousel'] as const)[i];
 if(i===1)config.fan.curve=[35,50,60,70].map((temperature,j)=>({temperature,level:[1,3,6,10][j]}));
 if(i===2){config.fan.mode='manual';config.fan.level=10;config.lights.colors=Array(14).fill('#e7a867')}
 return {id,name:['专注时刻','安静陪伴','全力运行','流光展示'][i],icon:['leaf','moon','sun','sparkles'][i],builtin:1,config};
})}
export type DemoStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Renderer=(c:OledConfig,m:State['metrics'],now:number)=>string;
type Saved={schema:1;version:number;config:Configuration;hardware:HardwareConfig;revision:number;scenes:Scene[];events:Event[];frames:Frame[];sequence:number;temperature:number};
export class DemoEngine {
 private saved:Saved;
 private started:number;
 private lastMetric=0;
 private lastFanChange=0;
 private fan=4;
 private cpu=0;
 private safety=false;
 private metrics:Metric[]=[];
 private operations=new Map<string,{payload:string;state:State}>();
 private current:State|null=null;
 storageWarning=false;
 private storage:DemoStorage;private render:Renderer;private now:()=>number;
 constructor(storage:DemoStorage,render:Renderer,now=()=>Date.now()/1000){
  this.storage=storage;this.render=render;this.now=now;
  this.started=this.now();this.saved=this.fresh();
  try{const raw=storage.getItem(DEMO_KEY);if(raw){const saved=JSON.parse(raw);this.validateSaved(saved);this.saved=saved}}catch{this.storageWarning=true}
  for(let i=60;i>0;i--)this.metrics.push({ts:this.now()-i*60,temperature:52+Math.sin(i/8)*4,cpu_fan_rpm:1600,case_level:4});
  this.sample();
 }
 private fresh():Saved{return {schema:1,version:0,config:defaultConfig(),hardware:hardwareDefault(),revision:0,scenes:builtins(),events:[],frames:[],sequence:0,temperature:53}}
 private validateSaved(s:Saved){
  if(s.schema!==1||!Number.isInteger(s.version)||s.version<0||!Number.isInteger(s.sequence)||!Number.isInteger(s.revision)||!Array.isArray(s.events)||s.events.length>500||!Array.isArray(s.frames)||s.frames.length>120||!Array.isArray(s.scenes)||s.scenes.length>32)throw Error('Invalid demo data');
  this.validateConfig(s.config);this.validateHardware(s.hardware);
  if(!Number.isFinite(s.temperature)||s.temperature<30||s.temperature>85)throw Error('Invalid temperature');
  for(const scene of s.scenes){if(typeof scene.name!=='string'||typeof scene.id!=='string')throw Error('Invalid scene');this.validateConfig(scene.config)}
 }
 private validateConfig(c:Configuration){
  if(!c?.fan||!c?.lights||!c?.oled||!Array.isArray(c.labels)||c.labels.length!==14)fail(422,'配置不完整');
  if(!['auto','manual'].includes(c.fan.mode)||!Array.isArray(c.fan.curve)||c.fan.curve.length<2||c.fan.curve.length>8)fail(422,'风扇配置无效');
  const l=c.lights,o=c.oled;
  if(!['static','rainbow','chase','native_breathe'].includes(l.effect)||typeof l.enabled!=='boolean'||!Number.isInteger(l.brightness)||l.brightness<0||l.brightness>100||!Number.isFinite(l.speed)||l.speed<.2||l.speed>3||!Number.isInteger(l.native_color)||l.native_color<0||l.native_color>6||![1,2,3].includes(l.native_speed)||!Array.isArray(l.colors)||l.colors.length!==14||l.colors.some(x=>!/^#[a-f\d]{6}$/i.test(x)))fail(422,'灯光配置无效');
  if(!['system','clock','text','pixel','carousel'].includes(o.mode)||typeof o.enabled!=='boolean'||typeof o.invert!=='boolean'||typeof o.text!=='string'||o.text.length>240||!Number.isInteger(o.contrast)||o.contrast<0||o.contrast>255)fail(422,'OLED 配置无效');
  if(o.pixels||o.mode==='pixel'){try{if(atob(o.pixels).length!==512)throw Error()}catch{fail(422,'像素数据需要 512 字节')}}
  for(const kind of ['fan','oled','labels'] as const){const error=validateControl(kind,kind==='labels'?{labels:c.labels}:c[kind]);if(error)fail(422,error)}
 }
 private validateHardware(h:HardwareConfig){if(!h||!['auto','off','i2c-1@0x0e'].includes(h.cube)||!['auto','off','i2c-1@0x3c'].includes(h.oled)||[h.case_fan,h.lights,h.screen].some(v=>typeof v!=='boolean'))fail(422,'连接设置无效')}
 private persist(){try{this.storage.setItem(DEMO_KEY,JSON.stringify(this.saved));this.storageWarning=false}catch{this.storageWarning=true}}
 private event(kind:string,before:unknown,after:unknown){this.saved.events.unshift({id:++this.saved.sequence,ts:this.now(),kind,source:'浏览器演示',outcome:'success',before:copy(before),after:copy(after)});this.saved.events=this.saved.events.slice(0,500)}
 private hardware():HardwareConnection{
  const h=this.saved.hardware,candidates=[{id:'i2c-1@0x0e',bus:1,address:'0x0e',kind:'cube' as const,name:'CUBE 扩展板（模拟）',firmware:5},{id:'i2c-1@0x3c',bus:1,address:'0x3c',kind:'oled' as const,name:'SSD1306 OLED（模拟）'}];
  const part=(enabled:boolean,i:number)=>({status:enabled?'connected' as const:'disabled' as const,device:enabled?candidates[i]:null,physical_feedback:false});
  return {revision:this.saved.revision,config:copy(h),scanned_at:this.now(),buses:[1],candidates,scan_errors:[],components:{cube:part(h.cube!=='off',0),fan:part(h.cube!=='off'&&h.case_fan,0),lights:part(h.cube!=='off'&&h.lights,0),oled:part(h.oled!=='off'&&h.screen,1),cpu_fan:{status:'connected',device:null,physical_feedback:false}}};
 }
 sample():State{
  const ts=this.now(),cfg=this.saved.config,temperature=Math.round((this.saved.temperature+.8*Math.sin((ts-this.started)/16))*10)/10;
  let cpuTarget=steps.filter(p=>temperature>=p.temperature).length;
  if(cpuTarget<this.cpu)cpuTarget=steps.filter(p=>temperature>=p.temperature-p.hysteresis).length;
  this.cpu=cpuTarget;
  if(temperature>=75)this.safety=true;else if(temperature<=70)this.safety=false;
  const at=(t:number)=>cfg.fan.curve.reduce((n,p)=>t>=p.temperature?p.level:n,cfg.fan.curve[0].level);
  let level=this.safety?10:cfg.fan.mode==='manual'?cfg.fan.level:at(temperature);
  if(!this.safety&&cfg.fan.mode==='auto'&&level<this.fan){level=Math.min(this.fan,at(temperature+2));if(ts-this.lastFanChange<10)level=this.fan}
  if(level!==this.fan){this.fan=level;this.lastFanChange=ts}
  const metrics:State['metrics']={temperature,cpu_fan_rpm:[0,1600,2500,3400,4200][this.cpu],cpu_fan_pwm:this.cpu?steps[this.cpu-1].pwm:0,cpu_percent:Math.round(8+(temperature-35)*1.1),memory_percent:18.4,storage_used_percent:24,storage_free_gb:182,sampled_at:ts};
  const h=this.hardware(),pixels=this.render(cfg.oled,metrics,ts),last=this.saved.frames[0];
  const frame=h.components.oled.status==='connected'?{pixels,written_at:ts,mode:cfg.oled.mode}:this.current?.applied.oled||null;
  if(frame&&pixels!==last?.pixels&&h.components.oled.status==='connected'){
   this.saved.frames.unshift({...frame,id:++this.saved.sequence,ts});this.saved.frames=this.saved.frames.slice(0,120);
  }
  if(ts-this.lastMetric>=10){this.metrics.push({ts,temperature,cpu_fan_rpm:metrics.cpu_fan_rpm,case_level:level});this.metrics=this.metrics.slice(-360);this.lastMetric=ts;this.persist()}
  const elapsed=ts-this.started,native=cfg.lights.effect==='native_breathe';
  this.current={version:this.saved.version,config:copy(cfg),device:{id:'pi-control-browser-demo',name:'CUBE · 演示设备',version:'1.5.0',product:'Pi Control',protocol:1},identity:{name:'演示访客',scope:'admin'},
   applied:{fan:h.components.fan.status==='connected'?{level,protocol_code:level===0?0:level===10?1:level+1,written_at:ts}:this.current?.applied.fan||null,
    lights:h.components.lights.status==='connected'?{colors:native&&cfg.lights.enabled?Array(14).fill(nativePalette[cfg.lights.native_color].color):lightFrame(cfg.lights,elapsed),written_at:ts,frame:Math.floor(elapsed*30),engine:native?'firmware':'software',color_source:'simulation',parameters:copy(cfg.lights),phase_seconds:elapsed}:this.current?.applied.lights||null,oled:frame},
   metrics,hardware:{connected:true,simulate:true,errors:{},connection:h},cpu_fan_policy:{available:true,state:this.cpu,max_state:4,steps:copy(steps)},
   fan_presets:fanPresets.map(([id,name,description,levels])=>({id,name,description,config:{mode:'auto',level:4,curve:[35,45,55,65,id==='cool'?70:75].map((temperature,i)=>({temperature,level:levels[i]}))}})),
   animation:{write_fps:30,target_fps:30},safety_override:this.safety,server_time:ts};
  return copy(this.current);
 }
 async request(path:string,options:RequestInit={}):Promise<any>{
  const url=new URL(path,'https://demo.invalid'),p=url.pathname,method=options.method||'GET',q=url.searchParams;
  const body=typeof options.body==='string'?JSON.parse(options.body):{};
  if(p==='/status')return this.sample();
  if(p==='/demo'&&method==='GET')return {temperature:this.saved.temperature,storageWarning:this.storageWarning};
  if(p==='/demo'&&method==='PUT'){if(!Number.isFinite(body.temperature)||body.temperature<30||body.temperature>85)fail(422,'演示温度需为 30–85°C');this.saved.temperature=body.temperature;this.persist();return this.sample()}
  if(p==='/demo/reset'&&method==='POST'){this.saved=this.fresh();this.started=this.now();this.operations.clear();this.cpu=0;this.safety=false;this.fan=4;this.lastFanChange=0;this.current=null;this.metrics=[];this.lastMetric=0;this.event('system.reset',null,{demo:true});this.persist();return this.sample()}
  if(p==='/hardware'&&method==='GET')return this.hardware();
  if(p==='/hardware/scan'&&method==='POST'){this.event('hardware.scan',null,{simulated:true});this.persist();return this.hardware()}
  if(p==='/hardware'&&method==='PUT'){if(body.expected_revision!==this.saved.revision)fail(409,'连接设置已更新，请重试');this.validateHardware(body.value);this.event('hardware.configure',this.saved.hardware,body.value);this.saved.hardware=copy(body.value);this.saved.revision++;this.persist();return this.hardware()}
  if(p==='/devices'||p==='/devices/scan')return {service_mode:'static-demo',current:this.sample().device,items:[],scanned_at:this.now(),discovery_error:'浏览器演示使用虚拟部件，不会扫描局域网。真实设备发现请使用 Docker 完整服务。'};
  if(p.startsWith('/devices/'))fail(422,'演示页面不能连接真实设备，请打开那台树莓派自己的控制台。');
  if(p==='/oled/preview'){this.validateConfig({...this.saved.config,oled:body});return {pixels:this.render(body,this.sample().metrics,this.now()),width:128,height:32,preview:true}}
  if(p==='/oled/frame')return this.sample().applied.oled;
  if(p==='/metrics')return {items:copy(this.metrics.filter(m=>m.ts>=this.now()-Math.max(.05,Math.min(168,Number(q.get('hours')||1)))*3600))};
  const page=<T extends {id?:number}>(rows:T[],defaultLimit:number)=>{const before=Number(q.get('before')||0),limit=Math.min(100,Math.max(1,Number(q.get('limit')||defaultLimit)));const items=rows.filter(r=>!before||(r.id||0)<before).slice(0,limit);return {items:copy(items),next:items.at(-1)?.id||null}};
  if(p==='/events')return page(this.saved.events.filter(e=>e.kind.startsWith(q.get('kind')||'')),30);
  if(p==='/frames')return page(this.saved.frames.map(({pixels,...f})=>f),20);
  if(p.startsWith('/frames/'))return copy(this.saved.frames.find(f=>f.id===Number(p.split('/').pop()))||fail(404,'画面已过演示保留期限'));
  if(p==='/export/events.csv'){
   const safe=(v:unknown)=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
   return '\ufeffid,timestamp,kind,source,outcome,error\r\n'+[...this.saved.events].reverse().map(e=>[e.id,e.ts,e.kind,e.source,e.outcome,e.error].map(safe).join(',')).join('\r\n');
  }
  if(p==='/scenes'&&method==='GET')return {items:copy(this.saved.scenes)};
  if(p==='/scenes'&&method==='POST'){
   if(!body.name?.trim()||body.name.length>30)fail(422,'场景名称需为 1–30 个字');if(this.saved.scenes.length>=32)fail(409,'最多保存 32 个场景');this.validateConfig(body.config);
   const id='custom-'+ ++this.saved.sequence;this.saved.scenes.push({id,name:body.name,icon:body.icon||'custom',config:copy(body.config),builtin:0});this.event('scene.save',null,{id,name:body.name});this.persist();return {id};
  }
  if(p.startsWith('/scenes/')&&method==='DELETE'){
   const s=this.saved.scenes.find(s=>s.id===p.split('/')[2])||fail(404,'场景不存在');if(s.builtin)fail(409,'内置场景保留');this.saved.scenes=this.saved.scenes.filter(x=>x!==s);this.event('scene.delete',s.name,null);this.persist();return {ok:true};
  }
  if(['/fans/case','/lights','/oled','/labels'].includes(p)&&method==='PUT'||/^\/scenes\/[^/]+\/apply$/.test(p)&&method==='POST'){
   const payload=JSON.stringify({p,value:body.value,expected_version:body.expected_version}),previous=this.operations.get(body.request_id);
   if(previous){if(previous.payload!==payload)fail(409,'操作编号已被使用');return copy(previous.state)}
   if(body.expected_version!==this.saved.version)fail(409,'配置已更新，请重试');
   if(typeof body.request_id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(body.request_id))fail(422,'操作编号无效');
   const kind=p==='/fans/case'?'fan':p.startsWith('/scenes/')?'scene':p.slice(1);
   const config=kind==='scene'?copy((this.saved.scenes.find(s=>s.id===p.split('/')[2])||fail(404,'场景不存在')).config):{...copy(this.saved.config),[kind]:kind==='labels'?body.value.labels:copy(body.value)};
   this.validateConfig(config);this.event(kind+'.set',this.saved.config,config);this.saved.config=config;this.saved.version++;this.persist();const state=this.sample();
   this.operations.set(body.request_id,{payload,state:copy(state)});if(this.operations.size>100)this.operations.delete(this.operations.keys().next().value!);return state;
  }
  if(p==='/tokens'&&method==='GET')return {items:[]};
  if(p.startsWith('/tokens')||p.startsWith('/auth'))fail(422,'纯前端演示不提供账号或有效 API 令牌。');
  return fail(404,'演示暂不支持此接口');
 }
}
