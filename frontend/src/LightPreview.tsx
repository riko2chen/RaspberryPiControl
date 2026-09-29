import {useEffect,useRef,useState} from 'react';
import {Pause,Play} from 'lucide-react';
import {ledAppearance} from './led-appearance';
import type {LightsConfig} from './types';
import {lightFrame,effectNames} from './light-animation';
export function LightPreview({config,dirty,selected,onSelect}:{config:LightsConfig;dirty:boolean;selected:number[];onSelect:(i:number)=>void}){
 const [paused,setPaused]=useState(false);
 const [colors,setColors]=useState(()=>lightFrame(config,2));
 const elapsed=useRef(2);
 const native=config.effect==='native_breathe';
 const animated=config.enabled&&config.effect!=='static';
 useEffect(()=>{
  let frame=0,last=performance.now(),paint=0;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const draw=(now:number)=>{
   if(!paused&&!motion.matches)elapsed.current+=(now-last)/1000;
   last=now;
   if(now-paint>=1000/30){setColors(lightFrame(config,elapsed.current));paint=now}
   if(animated&&!paused&&!motion.matches)frame=requestAnimationFrame(draw);
  };
  setColors(lightFrame(config,elapsed.current));
  if(animated&&!paused&&!motion.matches)frame=requestAnimationFrame(draw);
  return()=>cancelAnimationFrame(frame);
 },[config,paused,animated]);
 return <section className="light-preview" aria-label="灯光动态编辑预览">
  <div className="light-preview-heading"><div><span>效果预览</span><strong>{config.enabled?effectNames[config.effect]:'灯光关闭'}</strong></div><span className="preview-draft-tag">{dirty?'正在生效':'实时生效'}</span>{animated&&<button className="preview-pause" aria-label={paused?'播放灯效预览':'暂停灯效预览'} onClick={()=>setPaused(!paused)}>{paused?<Play size={15}/>:<Pause size={15}/>}</button>}</div>
  <div className="light-preview-strip">{colors.map((c,i)=><button key={i} className={selected.includes(i)?'selected':''} aria-label={`预览灯珠 ${i+1}`} aria-pressed={selected.includes(i)} onClick={()=>onSelect(i)} style={ledAppearance(c)} data-off={c==='#000000'}><i className="led-emitter"/><span>{String(i+1).padStart(2,'0')}</span></button>)}</div>
  <p>{native?'原厂模式的颜色与节奏示意；实际相位由灯板运行。':'调整颜色、亮度和速度，效果自动同步到设备。'}</p>
 </section>;
}
