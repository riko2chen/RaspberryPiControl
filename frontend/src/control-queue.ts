import type {Configuration,State} from './types';
export type ControlKind='fan'|'lights'|'oled'|'labels';
type Value=Record<string,any>;
type Entry={patch:Value;base:Value;due:number;error:string;conflict:boolean};
type Transport={read:()=>Promise<State>;send:(kind:ControlKind,body:{value:Value;expected_version:number;request_id:string})=>Promise<State>};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const valueOf=(state:State,kind:ControlKind):Value=>kind==='labels'?{labels:state.config.labels}:state.config[kind];
export function validateControl(kind:ControlKind,v:Value):string{
 if(kind==='fan'){
  if(!Number.isInteger(v.level)||v.level<0||v.level>10)return '档位需为 0–10。';
  if(v.curve.some((p:any)=>!Number.isInteger(p.temperature)||p.temperature<25||p.temperature>80||!Number.isInteger(p.level)||p.level<1||p.level>10))return '温度需为 25–80°C，档位需为 1–10。';
  if(v.curve.some((p:any,i:number)=>i>0&&(p.temperature<=v.curve[i-1].temperature||p.level<v.curve[i-1].level)))return '请将温度按从低到高排列，档位不能递减。';
 }
 if(kind==='oled')for(const [key,min,max] of [['font_size',8,24],['x',0,127],['y',0,31]] as const){if(!Number.isInteger(v[key])||v[key]<min||v[key]>max)return `${key==='font_size'?'字号':key==='x'?'横坐标':'纵坐标'}需为 ${min}–${max}。`}
 if(kind==='labels'&&v.labels.some((s:string)=>!s.trim()||s.length>24))return '名称需为 1–24 个字符。';
 return '';
}

/** A single writer, shared by all pages. Edits survive page switches and merge by field. */
export class ControlQueue{
 state:State|null=null;
 connected=false;
 private entries=new Map<ControlKind,Entry>();
 private listeners=new Set<()=>void>();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private flight:ControlKind|null=null;
 private epoch=0;
 private transport:Transport;
 constructor(transport:Transport){this.transport=transport}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private notify(){this.listeners.forEach(fn=>fn())}
 accept(next:State){
  if(this.state&&next.version<this.state.version)return;
  this.state={...next,identity:next.identity||this.state?.identity};this.notify();
 }
 clear(){this.epoch++;clearTimeout(this.timer);this.entries.clear();this.state=null;this.connected=false;this.notify()}
 setConnected(connected:boolean){this.connected=connected;this.notify();this.schedule()}
 get active(){return this.entries.size>0||this.flight!==null}
 draft<K extends ControlKind>(kind:K):K extends 'labels'?{labels:string[]}:Configuration[Exclude<K,'labels'>]{
  const confirmed=this.state?valueOf(this.state,kind):{};
  return {...confirmed,...this.entries.get(kind)?.patch} as any;
 }
 status(kind:ControlKind){const e=this.entries.get(kind);return {pending:!!e,error:e?.error||'',conflict:e?.conflict||false,sending:this.flight===kind,offline:!this.connected}}
 edit(kind:ControlKind,value:Value,delay=0){
  if(!this.state)return;
  const view=this.draft(kind) as Value;
  const existing=this.entries.get(kind);
  const e=existing||{patch:{},base:{},due:0,error:'',conflict:false};
  for(const key of Object.keys(value))if(!equal(value[key],view[key])){
   if(!(key in e.patch))e.base[key]=structuredClone(valueOf(this.state,kind)[key]);
   e.patch[key]=structuredClone(value[key]);
  }
  if(!Object.keys(e.patch).length)return;
  e.due=Date.now()+delay;e.error=validateControl(kind,{...valueOf(this.state,kind),...e.patch});e.conflict=false;
  this.entries.set(kind,e);this.notify();this.schedule();
 }
 retry(kind:ControlKind){const e=this.entries.get(kind);if(!e||e.conflict)return;e.error=validateControl(kind,this.draft(kind));e.due=0;this.notify();this.schedule()}
 discard(kind:ControlKind){if(this.flight===kind)return;this.entries.delete(kind);this.notify();this.schedule()}
 private schedule(){
  clearTimeout(this.timer);
  if(this.flight||!this.connected||!this.state)return;
  const candidates=[...this.entries].filter(([,e])=>!e.error).sort((a,b)=>a[1].due-b[1].due);
  if(candidates.length)this.timer=setTimeout(()=>void this.flush(candidates[0][0]),Math.max(0,candidates[0][1].due-Date.now()));
 }
 private async flush(kind:ControlKind){
  const e=this.entries.get(kind);
  if(!e||e.error||!this.state||!this.connected||this.flight)return;
  const current=valueOf(this.state,kind);
  if(Object.keys(e.patch).some(k=>!equal(current[k],e.base[k])&&!equal(current[k],e.patch[k]))){
   e.error='另一处修改了同一项设置，请先使用设备当前设置。';e.conflict=true;this.notify();this.schedule();return;
  }
  const patch=structuredClone(e.patch),sent={...current,...patch},epoch=this.epoch;
  e.error=validateControl(kind,sent);if(e.error){this.notify();this.schedule();return}
  this.flight=kind;this.notify();
  try{
   const result=await this.transport.send(kind,{value:sent,expected_version:this.state.version,request_id:Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')});
   if(epoch!==this.epoch)return;
   // Resolve the sent edit before publishing state so subscribers never see stale drafts.
   for(const k of Object.keys(patch)){
    if(equal(e.patch[k],patch[k])){delete e.patch[k];delete e.base[k]}
    else e.base[k]=structuredClone(valueOf(result,kind)[k]);
   }
   if(!Object.keys(e.patch).length)this.entries.delete(kind);
   else e.error=validateControl(kind,{...valueOf(result,kind),...e.patch});
   this.accept(result);
  }catch(error){
   if(epoch!==this.epoch)return;
   const err=error as Error&{status?:number};
   try{this.accept(await this.transport.read())}catch{}
   if(err.status===409){e.error='设置已在另一处更新，请先使用设备当前设置。';e.conflict=true}
   else e.error=err.message||'暂时无法应用，请重试。';
  }finally{this.flight=null;this.notify();this.schedule()}
 }
}
