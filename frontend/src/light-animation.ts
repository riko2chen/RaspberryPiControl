import type {LightsConfig} from './types';
export const nativePalette=[{name:'红',color:'#ff0000'},{name:'绿',color:'#00ff00'},{name:'蓝',color:'#0000ff'},{name:'黄',color:'#ffff00'},{name:'紫',color:'#ff00ff'},{name:'青',color:'#00ffff'},{name:'白',color:'#ffffff'}];
export const effectNames={static:'常亮',native_breathe:'原厂呼吸',rainbow:'彩虹流动',chase:'追光'};
export function lightSummary(c:LightsConfig){return !c.enabled?'灯光已关闭':c.effect==='native_breathe'?`原厂呼吸 · ${['慢速','中速','快速'][c.native_speed-1]}`:`${effectNames[c.effect]} · ${c.brightness}% 亮度`}
function hsv(h:number,s:number,v:number){const n=Math.floor(h*6),f=h*6-n,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);return [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][n%6]}
// Python round uses ties-to-even. Match the backend at quantization boundaries.
const round=(n:number)=>{const f=Math.floor(n);return n-f===.5?(f%2?f+1:f):Math.round(n)};
export function lightFrame(c:LightsConfig,elapsed:number):string[]{
 if(!c.enabled)return Array(14).fill('#000000');
 const native=c.effect==='native_breathe';
 const phase=elapsed*c.speed;
 return c.colors.map((color,i)=>{
  let rgb=(native?nativePalette[c.native_color].color:color).match(/[a-f\d]{2}/gi)!.map(x=>parseInt(x,16)/255);
  let gain=native?1:c.brightness/100;
  // Display-only approximation: firmware controls physical breathing independently.
  if(native){gain=.04+.96*(.5-.5*Math.cos(elapsed*2*Math.PI/[6,4,2][c.native_speed-1]));}
  else if(c.effect==='rainbow')rgb=hsv((i/14+phase/12)%1,.75,1);
  else if(c.effect==='chase')gain*=Math.max(.025,1-(((phase*3-i)%14+14)%14)/4);
  return '#'+rgb.map(v=>Math.max(0,Math.min(255,round(v*gain*255))).toString(16).padStart(2,'0')).join('');
 });
}
