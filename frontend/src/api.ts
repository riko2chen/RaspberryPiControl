import {DEMO,STATIC_DEMO} from './runtime';
import type {State} from './types';
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 if(DEMO){const {getDemo}=await import('./demo/browser');return (await getDemo()).request(path,options)}
 return serverApi<T>(path,options);
}
async function serverApi<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/api/v1'+path,{...options,headers:{'Content-Type':'application/json','X-Pi-Control':'1',...options.headers},credentials:'same-origin'});
 const data=await response.json().catch(()=>({detail:'服务器未返回有效结果'}));
 if(!response.ok){const e=new Error(typeof data.detail==='string'?data.detail:'请检查输入内容') as Error&{status:number};e.status=response.status;throw e;}
 return data;
}
// The device directory belongs to the Docker service, even while viewing a virtual device.
// Pages uses its local fixture and never contacts a backend.
export async function deviceApi<T=any>(path:string,options:RequestInit={}):Promise<T>{
 if(!/^\/devices(?:\/|$)/.test(path))throw Error('设备目录只接受设备连接请求');
 return STATIC_DEMO?api<T>(path,options):serverApi<T>(path,options);
}
export function watchState(update:(s:State)=>void,connection:(v:boolean)=>void,unauthorized:()=>void){
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,interval:ReturnType<typeof setInterval>|undefined,ws:WebSocket|undefined;
 if(DEMO){
  import('./demo/browser').then(m=>m.getDemo()).then(engine=>{if(stopped)return;connection(true);update(engine.sample());interval=setInterval(()=>{if(!document.hidden)update(engine.sample())},500)}).catch(()=>connection(false));
 }else{
  const connect=()=>{if(stopped)return;ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/v1/live`);ws.onopen=()=>connection(true);ws.onmessage=e=>{try{update(JSON.parse(e.data))}catch{connection(false)}};ws.onclose=e=>{connection(false);if(e.code===1008){unauthorized();return}if(!stopped)timer=setTimeout(connect,2500)};ws.onerror=()=>connection(false)};connect();
 }
 return()=>{stopped=true;clearTimeout(timer);clearInterval(interval);if(ws){ws.onclose=null;ws.close()}};
}
export async function downloadEvents(){
 const text=DEMO?await api<string>('/export/events.csv'):await fetch('/api/v1/export/events.csv',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('导出失败');return r.text()});
 const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='pi-control-events.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function requestId(){const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const time=(n?:number)=>n?new Date(n*1000).toLocaleTimeString('zh-CN',{hour12:false}):'尚未写入';
export const dateTime=(n:number)=>new Date(n*1000).toLocaleString('zh-CN',{hour12:false});
