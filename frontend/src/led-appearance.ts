import type {CSSProperties} from 'react';

// Hardware RGB is linear intensity. CSS expects sRGB; convert exactly once.
const srgb=(v:number)=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
const hex=(rgb:number[])=>'#'+rgb.map(v=>srgb(v).toString(16).padStart(2,'0')).join('');
export function ledAppearance(color:string):CSSProperties{
 const rgb=color.slice(1).match(/../g)!.map(c=>parseInt(c,16)/255);
 const peak=Math.max(...rgb);
 // Small emitters need display exposure to read as luminous on an SDR screen.
 // This monotonic curve keeps zero black and preserves channel proportions.
 const exposed=peak?(1-Math.exp(-3*peak))/(1-Math.exp(-3)):0;
 const visible=rgb.map(v=>peak?v*exposed/peak:0);
 return {
  '--led':hex(visible),
  // A small bright centre suggests an emitter; the perimeter keeps its hue.
  '--led-core':hex(visible.map(v=>v+(Math.min(1,exposed*1.3)-v)*.6)),
  '--led-glow':hex(visible)+Math.round(185*Math.sqrt(exposed)).toString(16).padStart(2,'0'),
  '--led-halo':hex(visible)+Math.round(60*Math.sqrt(exposed)).toString(16).padStart(2,'0'),
 } as CSSProperties;
}
