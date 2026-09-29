import {DemoEngine} from './engine';
import {assetUrl} from '../runtime';
import type {OledConfig,State} from '../types';
let engine:Promise<DemoEngine>|undefined;
async function create(){
 const fonts=[new FontFace('PiMono',`url("${assetUrl('assets/fonts/DejaVuSansMono.ttf')}")`),new FontFace('PiChinese',`url("${assetUrl('assets/fonts/NotoSansCJKsc-Regular.otf')}")`)];
 await Promise.all(fonts.map(async f=>{await f.load();document.fonts.add(f)}));
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=32;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 function render(c:OledConfig,m:State['metrics'],now:number){
  const out=new Uint8Array(512);if(!c.enabled)return btoa(String.fromCharCode(...out));
  let mode=c.mode;const date=new Date(now*1000),t=date.toLocaleTimeString('en-GB',{hour12:false,timeZone:'Asia/Shanghai'});
  if(mode==='carousel')mode=(['system','clock','text'] as const)[Math.floor(now/10)%3];
  if(mode==='pixel'){const raw=atob(c.pixels);for(let i=0;i<512;i++)out[i]=raw.charCodeAt(i)}
  else{
   ctx.fillStyle='#000';ctx.fillRect(0,0,128,32);ctx.fillStyle='#fff';ctx.textBaseline='top';
   const text=(s:string,size:number,x:number,y:number)=>{ctx.font=`${size}px ${/[^\x00-\x7f]/.test(s)?'PiChinese':'PiMono'}`;ctx.fillText(s,x,y)};
   if(mode==='text')c.text.split('\n').forEach((line,i)=>text(line,c.font_size,c.x,c.y+i*(c.font_size+1)));
   else if(mode==='clock'){
    ctx.font='22px PiMono';text(t,22,(128-ctx.measureText(t).width)/2,0);
    const d=date.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}).replaceAll('-','.');ctx.font='8px PiMono';text(d,8,(128-ctx.measureText(d).width)/2,23);
   }else{text('PI CONTROL',9,0,0);text(t.slice(0,5),8,86,0);text(`CPU ${m.temperature?.toFixed(1)||'--'} C`,9,0,11);text(`FAN ${m.cpu_fan_rpm||0} RPM`,9,0,22)}
   const pixels=ctx.getImageData(0,0,128,32).data;
   for(let i=0;i<4096;i++)if(pixels[i*4]>=128)out[i>>3]|=1<<(7-i%8);
  }
  if(c.invert)for(let i=0;i<512;i++)out[i]^=255;
  return btoa(String.fromCharCode(...out));
 }
 // Browsers that block storage can still use the demo for the current visit.
 let storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
 try{storage=localStorage}catch{storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable')},removeItem:()=>{}}}
 return new DemoEngine(storage,render);
}
export const getDemo=()=>engine??=(create());
