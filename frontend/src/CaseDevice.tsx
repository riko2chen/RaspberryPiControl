import {useEffect,useRef,useState} from 'react';
import {Box,RotateCcw,Maximize2,Minimize2,Layers,Pause,Play,Fan,Lightbulb,Move3D} from 'lucide-react';
import {CaseFallback} from './CaseFallback';
import {LiveLeds} from './LiveLeds';
import type {State} from './types';
import type {ModelView,Viewer} from './model/cube-viewer';

export function Device({state,onLed}:{state:State;onLed?:(i:number)=>void}){
 const mount=useRef<HTMLDivElement>(null),viewer=useRef<Viewer|null>(null),snapshot=useRef(state),select=useRef(onLed),container=useRef<HTMLDivElement>(null);
 const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[view,setView]=useState<ModelView>('perspective'),[exploded,setExploded]=useState(false),[paused,setPaused]=useState(false),[expanded,setExpanded]=useState(false);
 snapshot.current=state;select.current=onLed;
 useEffect(()=>{let active=true;
  import('./model/cube-viewer').then(async({createCubeViewer})=>{if(!active||!mount.current)return;try{const instance=await createCubeViewer(mount.current,snapshot.current,i=>select.current?.(i),()=>{if(active)setFailed(true)});if(!active){instance.dispose();return}viewer.current=instance;setReady(true)}catch(e){console.warn('3D view unavailable',e);setFailed(true)}}).catch(()=>setFailed(true));
  return()=>{active=false;viewer.current?.dispose();viewer.current=null};
 },[]);
 useEffect(()=>{viewer.current?.update(state)},[state]);
 useEffect(()=>{if(failed){viewer.current?.dispose();viewer.current=null}},[failed]);
 useEffect(()=>{if(!expanded)return;const previous=document.body.style.overflow,focused=document.activeElement as HTMLElement|null;document.body.style.overflow='hidden';
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);if(e.key==='Tab'){const elements=Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),canvas[tabindex]')||[]);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};
  window.addEventListener('keydown',key);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',key);focused?.focus()}
 },[expanded]);
 const changeView=(v:ModelView)=>{setView(v);viewer.current?.view(v)};
 const rpm=state.metrics.cpu_fan_rpm,level=state.applied.fan?.level,start=state.cpu_fan_policy.steps[0]?.temperature;
 const available=(key:string)=>!state.hardware.connection||state.hardware.connection.components[key]?.status==='connected';
 if(failed)return <><div className="model-fallback-note">此浏览器暂时无法显示 3D，已切换到设备示意图。</div><CaseFallback state={state} onLed={onLed}/></>;
 return <div ref={container} className={'cube-experience '+(expanded?'expanded':'')} role={expanded?'dialog':undefined} aria-modal={expanded||undefined} aria-label="CUBE Pi 三维设备实况">
  <div className="cube-toolbar"><div className="cube-view-tabs" aria-label="模型视角">{([['perspective','透视'],['front','正面'],['side','侧面'],['ports','接口'],['rear','背面']] as const).map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>changeView(id)} disabled={!ready}>{label}</button>)}</div><div className="cube-tools">
   <button aria-label={exploded?'合上机箱':'展开部件'} title="展开部件" aria-pressed={exploded} onClick={()=>{setExploded(!exploded);viewer.current?.explode(!exploded)}} disabled={!ready}><Layers size={15}/></button>
   <button aria-label={paused?'播放模型动画':'暂停模型动画'} title={paused?'播放动画':'暂停动画'} aria-pressed={paused} onClick={()=>{setPaused(!paused);viewer.current?.pause(!paused)}} disabled={!ready}>{paused?<Play size={14}/>:<Pause size={14}/>}</button>
   <button aria-label="复位模型视角" title="复位视角" onClick={()=>{setExploded(false);viewer.current?.explode(false);changeView('perspective')}} disabled={!ready}><RotateCcw size={14}/></button>
   <button aria-label={expanded?'退出大图':'放大三维模型'} title={expanded?'退出大图':'放大模型'} onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>
  </div></div>
  <div className="cube-viewport"><div className="cube-scene-title"><span>CUBE / 05</span><small>{exploded?'部件展开视图':'实时设备模型'}</small></div><div ref={mount} className="cube-canvas-host"/>{!ready&&<div className="cube-loading"><Box size={24}/><span>正在构建三维空间…</span></div>}<div className="cube-orbit-hint"><Move3D size={13}/>拖动旋转 · 双指缩放</div><div className="cube-orientation">{view==='ports'?'I/O':view==='rear'?'REAR':view==='side'?'SIDE':view==='front'?'FRONT':'PERSPECTIVE'}</div></div>
  <div className="cube-live-strip"><div><Lightbulb size={13}/><span>后上方灯带</span><small>14 颗</small></div><LiveLeds state={state} onLed={onLed} className="cube-led-controls"/></div>
  <div className="case-status-row"><span><Fan size={13}/><span>CPU 风扇 <b>{!available('cpu_fan')?'未连接':rpm==null?'转速未知':rpm===0?'停转':rpm+' RPM'}</b></span></span><span title="档位动画，无实际转速反馈"><Fan size={13}/><span>顶部风扇 <b>{!available('fan')?'未连接':level==null?'等待状态':level===0?'停转':level+' 档'}</b></span></span></div>
  <div className="case-notes">{available('cpu_fan')&&rpm===0&&start!=null&&<span>CPU 风扇达到 {start}°C 后启动</span>}<span>{state.applied.lights?.engine==='firmware'?'原厂灯效为节奏示意':'灯光随设备更新'} · OLED 使用实际位图</span></div>
 </div>;
}
