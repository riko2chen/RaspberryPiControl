import {useEffect,useRef,useState} from 'react';
import type {State} from './types';
import {lightFrame} from './light-animation';
import {ledAppearance} from './led-appearance';
export function LiveLeds({state,onLed,className}:{state:State;onLed?:(i:number)=>void;className:string}){
 const applied=state.applied.lights;
 const [colors,setColors]=useState(applied?.colors||Array(14).fill('#000000'));
 const snapshot=useRef({applied,time:performance.now(),server:state.server_time,error:!!state.hardware.errors.lights});
 useEffect(()=>{snapshot.current={applied,time:performance.now(),server:state.server_time,error:!!state.hardware.errors.lights}},[applied,state.server_time,state.hardware.errors.lights]);
 useEffect(()=>{
  let frame=0,paint=0;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const draw=(now:number)=>{
   const s=snapshot.current,a=s.applied,elapsed=(now-s.time)/1000;
   if(now-paint>=1000/30){
    if(a?.parameters?.enabled&&a.parameters.effect!=='static'&&!s.error&&elapsed<2&&!reduced.matches){
     const phase=a.engine==='firmware'?s.server-a.written_at+elapsed:a.phase_seconds+Math.max(0,s.server-a.written_at)+elapsed;
     setColors(lightFrame(a.parameters,Math.max(0,phase)));
    }else setColors(a?.colors||Array(14).fill('#000000'));
    paint=now;
   }
   frame=requestAnimationFrame(draw);
  };
  frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
 },[]);
 return <div className={className} aria-label={applied?.engine==='firmware'?'灯光效果示意':'灯光状态'}>{colors.map((c,i)=>{const style=ledAppearance(c);return onLed?<button className="led-cell" key={i} title={state.config.labels[i]} aria-label={`选择灯珠 ${i+1}`} onClick={()=>onLed(i)} style={style} data-off={c==='#000000'}><i className="led-emitter"/></button>:<span className="led-cell" key={i} title={state.config.labels[i]} style={style} data-off={c==='#000000'}><i className="led-emitter"/></span>})}</div>;
}
