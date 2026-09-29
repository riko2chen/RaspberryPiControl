import {useId} from 'react';
import {Fan,Lightbulb} from 'lucide-react';
import {FanVisual,OledCanvas} from './components';
import {LiveLeds} from './LiveLeds';
import type {State} from './types';

/** CUBE Pi: vertical Pi, top exhaust fan, and one 14-pixel strip. */
export function CaseFallback({state,onLed}:{state:State;onLed?:(n:number)=>void}){
 const id=useId().replace(/:/g,'');
 const level=state.applied.fan?.level??0,rpm=state.metrics.cpu_fan_rpm;
 const parts=state.hardware.connection?.components;
 const present=(key:string)=>!parts||parts[key]?.status==='connected';
 const cpuPresent=present('cpu_fan'),casePresent=present('fan');
 const cpuStatus=!cpuPresent?'未连接':rpm==null?'转速未知':rpm===0?'停转':`${rpm} RPM`;
 const caseStatus=!casePresent?'未连接':!state.applied.fan?'等待状态':level===0?'停转':`${level} 档`;
 const start=state.cpu_fan_policy.steps[0]?.temperature;
 return <div className="case-stage">
  <div className="case-view-label"><span>CUBE Pi</span><span>透明机箱 · 布局示意</span></div>
  <svg className="case-drawing" viewBox="0 0 520 408" aria-label="透明机箱内部布局：顶部风扇和灯条，竖直主板上方是 OLED，中间是 CPU 风扇，右侧为接口，下方是接口转接板">
   <defs>
    <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f0f3f7"/><stop offset=".5" stopColor="#cbd4df"/><stop offset="1" stopColor="#93a1b3"/></linearGradient>
    <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#dae2ec" stopOpacity=".35"/><stop offset="1" stopColor="#a9b8ca" stopOpacity=".28"/></linearGradient>
    <pattern id={`${id}-vents`} width="14" height="11" patternUnits="userSpaceOnUse" patternTransform="matrix(1 0 -1.3 .7 0 0)"><path d="M3 1h5l2 3-2 3H3L1 4Z" fill="#617287" opacity=".38"/></pattern>
   </defs>
   <ellipse cx="265" cy="389" rx="164" ry="10" className="case-ground"/>
   {/* Rear panel and floor establish depth; no glass overlay covers the emitters. */}
   <path d="M154 34H436V329H154Z" className="case-glass rear"/>
   <path d="M96 78L154 34H436L378 78Z" className="case-glass roof"/>
   <path d="M378 78L436 34V329L378 373Z" className="case-glass side"/>
   <path d="M96 373L154 329H436L378 373Z" fill={`url(#${id}-floor)`}/>
   <path d="M111 365L159 335H420L373 365Z" fill={`url(#${id}-vents)`}/>
   <path d="M154 34H436V329M154 34V329H436" className="case-frame rear"/>
   <path d="M96 78L154 34M378 78L436 34M96 373L154 329M378 373L436 329" className="case-frame depth"/>
   {/* Case fan lies horizontally under the top ventilation panel. */}
   <g transform="matrix(1 0 -.8 .55 267 39)" className={casePresent?'':'case-part-unavailable'}>
    <title>{`顶部风扇 · ${caseStatus}（档位动画）`}</title>
    <foreignObject width="80" height="80"><div className="case-fan-top"><FanVisual level={casePresent?level:0} size={80}/></div></foreignObject>
   </g>
   <path d="M304 81C345 87 357 99 347 118" className="case-wire red"/>
   <path d="M302 82C341 89 354 101 345 118" className="case-wire black"/>
   {/* NVMe carrier behind the Pi, mounted on standoffs. */}
   <g aria-label="NVMe 扩展板位于主板背面">
    <rect x="195" y="126" width="195" height="133" rx="6" fill="#424c5c" stroke="#687589"/>
    <rect x="226" y="132" width="133" height="22" rx="3" fill="#1c2533"/>
    <text x="239" y="147" className="case-pcb-text">NVMe</text>
    {[[184,147],[184,248],[371,147],[371,248]].map(([x,y])=><path key={x+','+y} d={`M${x} ${y}l15 -11`} stroke="#b5a481" strokeWidth="6" strokeLinecap="round"/>)}
    <path d="M382 172q23 22 0 60" fill="none" stroke="#273241" strokeWidth="11"/>
   </g>
   {/* Front-facing assembly keeps the OLED's actual bitmap legible. */}
   <rect x="174" y="138" width="201" height="122" rx="7" fill="#325950" stroke="#54796d"/>
   <path d="M184 147h178M184 251h176" stroke="#86a797" strokeWidth="1" opacity=".5"/>
   <rect x="181" y="143" width="153" height="112" rx="5" fill="#171e28" stroke="#445061"/>
   {Array.from({length:11},(_,i)=><path key={i} d={`M286 ${151+i*9}h47`} stroke="#566170" strokeWidth="3"/>)}
   <foreignObject x="183" y="145" width="106" height="106" className={cpuPresent?'':'case-part-unavailable'}>
    <div className="case-fan-cpu" title={`CPU 散热风扇 · ${cpuStatus}`}><FanVisual level={0} real rpm={cpuPresent?(rpm??0):0} size={106}/></div>
   </foreignObject>
   <path d="M285 187C316 196 326 181 342 175" className="case-wire yellow"/>
   <path d="M285 190C316 199 329 183 342 178" className="case-wire blue"/>
   {[148,190,232].map((y,i)=><g key={y} aria-label={i===2?'以太网口':'USB 接口'}>
    <path d={`M341 ${y}l13 -7h32v33l-13 7h-32Z`} fill={`url(#${id}-metal)`} stroke="#7d8b9c"/>
    <path d={`M373 ${y}l13 -7v33l-13 7Z`} fill="#677689"/>
    <path d={i===2?`M377 ${y+5}l6 -3v18l-6 3Z`:`M377 ${y+3}l6 -3v9l-6 3Zm0 15l6 -3v9l-6 3Z`} fill={i===1?'#273f70':'#1d2734'}/>
   </g>)}
   <rect x="174" y="98" width="200" height="44" rx="4" fill="#232d3b" stroke="#556174"/>
   <rect x="190" y="102" width="146" height="36" rx="3" fill="#225367" stroke="#4e8b9e"/>
   <foreignObject x="196" y="104" width="128" height="32"><div className="case-oled" title="OLED · 与设备相同的 128 × 32 位图"><OledCanvas frame={state.applied.oled}/></div></foreignObject>
   <g fill="#92a3b8">{[110,118,126].map(y=><circle cx="184" cy={y} r="1.4" key={y}/>)}</g>
   {/* Lower USB-C / HDMI adapter plate and right-facing sockets. */}
   {[191,230,268].map(x=><rect key={x} x={x} y="258" width="14" height="16" rx="2" fill={`url(#${id}-metal)`} stroke="#8f9eaf"/>)}
   <rect x="174" y="273" width="201" height="63" rx="5" fill={`url(#${id}-metal)`} stroke="#92a0b3"/>
   <text x="212" y="309" className="case-adapter-text">CUBE Pi</text>
   <g fill="#55677c" fontSize="5" fontFamily="monospace"><text x="188" y="284">POWER</text><text x="228" y="284">HDMI0</text><text x="266" y="284">HDMI1</text></g>
   {[279,299,319].map((y,i)=><g key={y}><path d={`M341 ${y}l14 -7h31v10l-14 7h-31Z`} fill="#8c9daf" stroke="#64748a"/><path d={`M373 ${y}l13 -7v8l-13 7Z`} fill="#273242"/>{i<2&&<path d={`M376 ${y+2}l7 -4`} stroke="#aab8c8"/>}</g>)}
   {[[182,281],[182,328],[330,281],[330,328]].map(([x,y])=><circle key={x+','+y} cx={x} cy={y} r="3" fill="#596779" stroke="#e8edf3" strokeWidth="1"/>)}
   {/* One strip: don't turn its reflection into a second set of LEDs. */}
   <path d="M163 54V100Q163 126 174 124" className="case-wire black"/>
   <foreignObject x="158" y="27" width="271" height="30" overflow="visible" className="case-strip-object"><LiveLeds state={state} onLed={present('lights')?onLed:undefined} className="case-rgb-strip"/></foreignObject>
   <path d="M96 78V373H378V78" className="case-frame front"/>
   {[[96,78],[378,78],[96,373],[378,373],[436,34],[436,329]].map(([x,y])=><g key={x+','+y}><rect x={x-6} y={y-6} width="12" height="12" rx="3" fill={`url(#${id}-metal)`}/><circle cx={x} cy={y} r="2.2" fill="#738297"/><path d={`M${x-1.6} ${y}h3.2`} stroke="#dbe2eb" strokeWidth=".8"/></g>)}
   <path d="M101 92V357M384 91l47 -35v258" className="case-glass-edge"/>
   <g className="case-callout"><path d="M292 50h97l29 -23h37"/><text x="457" y="31">顶部风扇</text><path d="M344 117h57l24 -20h30"/><text x="457" y="101">OLED</text><path d="M202 193H116l-24 -18H58"/><text x="56" y="179" textAnchor="end">CPU 风扇</text><path d="M177 314h-47l-23 23H58"/><text x="56" y="341" textAnchor="end">接口板</text></g>
  </svg>
  <div className="case-status-row">
   <span title="CPU 风扇使用系统实际转速"><Fan size={13}/><span>CPU 风扇 <b>{cpuStatus}</b></span></span>
   <span title="顶部风扇按控制档位模拟，无转速反馈"><Fan size={13}/><span>顶部风扇 <b>{caseStatus}</b></span></span>
  </div>
  <div className="case-notes">
   {cpuPresent&&rpm===0&&start!=null&&<span>CPU 风扇达到 {start}°C 后启动</span>}
   <span><Lightbulb size={11}/>点击灯珠调整 · {state.applied.lights?.engine==='firmware'?'原厂灯效为节奏示意':'显示已写入的灯光状态'}</span>
  </div>
 </div>;
}
