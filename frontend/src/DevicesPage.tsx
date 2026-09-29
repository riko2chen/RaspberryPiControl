import {DEMO,STATIC_DEMO} from './runtime';
import {localDeviceUrl,remoteDeviceUrl} from './device-selection';
import {useEffect,useState} from 'react';
import {Radio,RefreshCw,ArrowUpRight,Server,PlugZap,Search,Trash2,Check,BookOpen,FlaskConical} from 'lucide-react';
import {api,deviceApi,time} from './api';
import {Card,SectionTitle,Switch} from './components';
import type {State,HardwareConnection,HardwareConfig,DeviceDirectory} from './types';
const hardwareDocs:Record<string,{url:string;title:string}>={
 cube:{url:'https://www.yahboom.com/study_module/CUBE_Pi',title:'厂商文档'},
 oled:{url:'https://www.yahboom.net/public/upload/upload-html/1727418616/2.%20OLED%20display.html',title:'屏幕文档'},
 cpu_fan:{url:'https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#raspberry-pi-5-fans',title:'温控说明'},
 case_fan:{url:'https://www.yahboom.net/public/upload/upload-html/1727418627/3.%20Fan%20drive.html',title:'风扇文档'},
 lights:{url:'https://www.yahboom.net/public/upload/upload-html/1727418638/4.%20RGB%20light%20strip%20driver.html',title:'灯条文档'},
};
function HardwareDocLink({kind,name}:{kind:string;name:string}){
 const doc=hardwareDocs[kind==='screen'?'oled':kind];
 if(!doc)return null;
 return <a className="hardware-doc-link" href={doc.url} target="_blank" rel="noopener noreferrer" aria-label={name+' · '+doc.title+'（新标签页）'}><BookOpen size={13}/>{doc.title}<ArrowUpRight size={12}/></a>;
}

export const hardwareStatus:Record<string,string>={connected:'已连接','not-installed':'未检测到',disabled:'已停用',disconnected:'连接中断',ambiguous:'请选择部件',error:'无法访问'};
export function partAvailable(state:State,key:string){return state.hardware.connection?.components[key]?.status==='connected'}
export function MissingPart({state,kind,name}:{state:State;kind:string;name:string}){const status=state.hardware.connection?.components[kind]?.status||'not-installed';return <Card className="missing-part"><PlugZap size={28}/><h2>{name} · {hardwareStatus[status]}</h2><p>其他部件可以继续使用。原有设置已保留，连接后会自动恢复。</p><a className="btn" href="#devices" onClick={()=>window.dispatchEvent(new Event('pi-control:devices'))}>前往设备连接 <ArrowUpRight size={14}/></a></Card>}

export function DevicesPage({state,notice}:{state:State;notice:(s:string)=>void}){
 const [hardware,setHardware]=useState<HardwareConnection|null>(state.hardware.connection||null);
 const [directory,setDirectory]=useState<DeviceDirectory|null>(null);
 const [hardwareBusy,setHardwareBusy]=useState(false);const [networkBusy,setNetworkBusy]=useState(false);
 const [address,setAddress]=useState('');const [error,setError]=useState('');
 const [directoryLogin,setDirectoryLogin]=useState(false);
 const virtual=DEMO||!!state.demo;
 const hasLocal=!STATIC_DEMO&&directory&&directory.service_mode!=='demo';
 const saved=directory?.items.filter(peer=>peer.saved)||[];
 const nearby=directory?.items.filter(peer=>!peer.saved)||[];
 const refresh=()=>deviceApi<DeviceDirectory>('/devices').then(d=>{setDirectory(d);setDirectoryLogin(false)}).catch(e=>{setDirectoryLogin(e.status===401);setError(e.message)});
 useEffect(()=>{if(!hardwareBusy&&state.hardware.connection)setHardware(current=>!current||state.hardware.connection!.revision>=current.revision?state.hardware.connection!:current)},[state.hardware.connection,hardwareBusy]);
 useEffect(()=>{refresh();const timer=setInterval(refresh,15000);return()=>clearInterval(timer)},[]);
 const configure=async(patch:Partial<HardwareConfig>)=>{if(!hardware||hardwareBusy)return;setHardwareBusy(true);setError('');try{setHardware(await api('/hardware',{method:'PUT',body:JSON.stringify({expected_revision:hardware.revision,value:{...hardware.config,...patch}})}));notice('连接设置已生效')}catch(e){setError((e as Error).message);try{setHardware(await api('/hardware'))}catch{}}finally{setHardwareBusy(false)}};
 const connect=async(url:string,open=true)=>{
  setNetworkBusy(true);setError('');
  try{
   const result=await deviceApi('/devices/connect',{method:'POST',body:JSON.stringify({url})});
   if(result.current){notice('这是当前服务');refresh();if(open&&DEMO)location.assign(localDeviceUrl(location.href,false))}
   else if(open)location.assign(remoteDeviceUrl(result.url,location.href));
   else{setAddress('');await refresh();notice('设备已保存，可在上方选择连接')}
  }catch(e){setError((e as Error).message)}finally{setNetworkBusy(false)}
 };
 const forget=async(id:string)=>{setNetworkBusy(true);setError('');try{await deviceApi('/devices/'+id,{method:'DELETE'});await refresh();notice('已移除保存的设备')}catch(e){setError((e as Error).message)}finally{setNetworkBusy(false)}};
 const selectDemo=()=>{
  if(virtual)return;
  location.assign(localDeviceUrl(location.href,true));
 };
 return <div className="connections-page">
  {error&&<div className="warning" role="alert">{error}{directoryLogin&&<a className="btn small" href={localDeviceUrl(location.href,false)}>登录本机服务</a>}</div>}
  <Card className="current-device"><div className="connection-icon">{virtual?<FlaskConical size={26}/>:<Server size={26}/>}</div><div><span className="eyebrow">CURRENT DEVICE</span><h2>{virtual?'演示设备':state.device?.name||directory?.current.name||'当前树莓派'}</h2><p>{virtual?'灯光、风扇和 OLED 使用模拟数据':'当前控制台 · '+location.host}</p></div><span className="connection-badge connected"><span/>{virtual?'正在演示':'服务在线'}</span></Card>
  <Card className="saved-devices">
   <SectionTitle eyebrow="YOUR DEVICES" title="已保存设备"/>
   <p className="subtle line-height">{STATIC_DEMO?'当前为纯前端演示。部署 Docker 服务后可以保存并连接真实树莓派。':'选择演示设备体验功能，或进入已保存树莓派的控制台。真实设备使用各自的账号登录。'}</p>
   <div className="saved-device-grid">
    <article className={'saved-device '+(virtual?'selected':'')}>
     <div className="saved-device-title"><span className="peer-icon online"><FlaskConical size={22}/></span><div><h3>演示设备</h3><small>内置 · 随时可用</small></div></div>
     <p>体验 3D 模型、灯效、风扇和 OLED，无需连接硬件。</p>
     <button className={'btn '+(virtual?'':'primary')} aria-label="选择演示设备" disabled={virtual||networkBusy} onClick={selectDemo}>{virtual?<><Check size={14}/>当前设备</>:'开始演示'}</button>
    </article>
    {hasLocal&&<article className={'saved-device '+(!virtual?'selected':'')}>
     <div className="saved-device-title"><span className="peer-icon online"><Server size={22}/></span><div><h3>{directory.current.name}</h3><small>本机服务 · 真实硬件</small></div></div>
     <p>{location.host}</p><button className={'btn '+(!virtual?'':'primary')} aria-label="选择本机真实设备" disabled={!virtual||networkBusy} onClick={()=>location.assign(localDeviceUrl(location.href,false))}>{!virtual?<><Check size={14}/>当前设备</>:'连接设备'}</button>
    </article>}
    {saved.map(peer=><article className="saved-device" key={peer.id}>
     <div className="saved-device-title"><span className={'peer-icon '+(peer.online?'online':'')}><Server size={22}/></span><div><h3>{peer.name}</h3><small>{peer.online?'在线':'暂时离线 · 可重试连接'}</small></div><button className="icon-btn" aria-label={'移除 '+peer.name} disabled={networkBusy} onClick={()=>forget(peer.id)}><Trash2 size={14}/></button></div>
     <p>{peer.url}</p><button className="btn primary" aria-label={'连接 '+peer.name} disabled={networkBusy} onClick={()=>connect(peer.url)}>连接设备 <ArrowUpRight size={14}/></button>
    </article>)}
   </div>
   {!STATIC_DEMO&&<p className="connection-foot">已保存设备保留在此服务中，重启后仍可选择。切换到演示设备后，真实设备继续按原有配置运行。</p>}
  </Card>
  <div className="connections-grid"><div className="stack"><Card>
   <SectionTitle eyebrow="ADD A DEVICE" title="添加树莓派" aside={<button className="btn" disabled={STATIC_DEMO||networkBusy||directoryLogin} onClick={async()=>{setNetworkBusy(true);setError('');try{setDirectory(await deviceApi('/devices/scan',{method:'POST'}))}catch(e){setError((e as Error).message)}finally{setNetworkBusy(false)}}}><Search size={15} className={networkBusy?'spin':''}/>{networkBusy?'正在检查…':'扫描局域网'}</button>}/>
   <p className="subtle line-height">自动发现装有 Pi Control 的设备，也可以输入局域网或 Tailscale 地址加入。</p>
   {directory?.discovery_error&&<p className="connection-note">{directory.discovery_error}</p>}
   <div className="peer-list">{nearby.map(peer=><article key={peer.id} className="peer-row"><span className={'peer-icon '+(peer.online?'online':'')}><Server size={20}/></span><div><h3>{peer.name}</h3><p>{peer.url}</p><small>{peer.online?'在线':'暂时离线 · 最后在线 '+time(peer.last_seen)}</small></div><button className="btn small" disabled={networkBusy} onClick={()=>connect(peer.url,false)}>保存设备</button></article>)}</div>
   {!nearby.length&&<div className="discovery-empty"><Radio size={29}/><h3>暂无新发现的设备</h3><p>{STATIC_DEMO?'静态演示只提供虚拟设备。':'扫描后可保存新设备；已保存设备显示在上方。'}</p></div>}
   <div className="manual-connect"><h3>通过地址添加</h3><p>{STATIC_DEMO?'真实设备连接请使用 Docker 完整服务。':'支持局域网 IP、Tailscale IP 和域名。'}</p><form onSubmit={e=>{e.preventDefault();connect(address,false)}}><input aria-label="树莓派地址" placeholder="192.168.1.100:8080" value={address} onChange={e=>setAddress(e.target.value)} maxLength={255} disabled={STATIC_DEMO||directoryLogin} required/><button className="btn primary" disabled={STATIC_DEMO||directoryLogin||networkBusy||!address.trim()}>添加设备</button></form></div>
   <p className="connection-foot">{directory?.scanned_at?'发现列表更新于 '+time(directory.scanned_at)+' · ':''}已保存设备会定期重新检查。无法自动发现时，可以手动添加地址。</p>
  </Card><Card><SectionTitle title="新树莓派如何接入？"/><p className="subtle line-height">先在那台树莓派上安装 Pi Control，并完成 I²C 启用和硬件权限设置。镜像已包含 CUBE 灯条、顶部风扇和 OLED 的控制程序，无需另装厂商驱动库。CPU 风扇由树莓派系统管理。</p></Card></div>
  <div className="stack"><Card><SectionTitle eyebrow="LOCAL HARDWARE" title={virtual?'演示部件':'本机硬件'} aside={<button className="btn" disabled={hardwareBusy} onClick={async()=>{setHardwareBusy(true);setError('');try{setHardware(await api('/hardware/scan',{method:'POST'}));notice(virtual?'演示部件扫描完成':'硬件扫描完成')}catch(e){setError((e as Error).message)}finally{setHardwareBusy(false)}}}><RefreshCw size={15} className={hardwareBusy?'spin':''}/>重新扫描</button>}/>
   <p className="subtle line-height">{virtual?'这里展示虚拟部件，可尝试停用、扫描和重新连接。':'启动时自动识别兼容部件，连接中断后自动重试。未安装的部件不影响其他功能。'}</p>
   {hardware&&<><div className="hardware-parts">{[['cube','CUBE 扩展板'],['oled','OLED 屏幕'],['cpu_fan','CPU 风扇接口']].map(([key,label])=>{const part=hardware.components[key];return <div className="hardware-part" key={key}><div><b>{label}</b><small>{part?.device?part.device.id+(part.device.firmware!==undefined?' · 固件 '+part.device.firmware:''):key==='cpu_fan'?'由系统管理':key==='cube'?'提供顶部风扇与灯条控制':'SSD1306 · 128 × 32'}</small><HardwareDocLink kind={key} name={label}/></div><span className={'connection-badge '+(part?.status||'not-installed')}><span/>{hardwareStatus[part?.status||'not-installed']}</span></div>})}</div>
   {(['cube','oled'] as const).map(key=><label className="connection-select" key={key}><span>{key==='cube'?'扩展板连接':'屏幕连接'}</span><select aria-label={key==='cube'?'扩展板连接':'屏幕连接'} value={hardware.config[key]} disabled={hardwareBusy} onChange={e=>configure({[key]:e.target.value})}><option value="auto">自动连接兼容部件</option><option value="off">不连接</option>{hardware.candidates.filter(c=>c.kind===key).map(c=><option value={c.id} key={c.id}>{c.name} · {c.id}</option>)}{!['auto','off',...hardware.candidates.map(c=>c.id)].includes(hardware.config[key])&&<option value={hardware.config[key]}>{hardware.config[key]} · 等待重连</option>}</select></label>)}
   {hardware.scan_errors.length>0&&<p className="error-text">无法访问部分总线，请检查系统 I²C 设置和设备权限。</p>}
   <p className="connection-foot">{hardware.buses.length?'已检查 I²C 总线 '+hardware.buses.join('、'):'未检测到可用 I²C 总线，服务继续运行'} · {hardware.scanned_at?time(hardware.scanned_at):'等待扫描'}</p></>}
  </Card><Card><SectionTitle title="已安装的部件"/><p className="subtle line-height">拓展板无法确认风扇或灯条实际是否接好了，没有安装的部件可在这里停用。</p>{hardware&&<div className="module-switches">{[['case_fan','顶部风扇','风扇调速与自动温控'],['lights','RGB 灯条','灯效、颜色和灯珠控制'],['screen','OLED 屏幕','画面与屏幕控制']].map(([key,label,detail])=><div key={key}><div><b>{label}</b><small>{detail}</small><HardwareDocLink kind={key} name={label}/></div><Switch label={'管理'+label} checked={hardware.config[key as 'case_fan'|'lights'|'screen']} disabled={hardwareBusy} onChange={v=>configure({[key]:v})}/></div>)}</div>}<p className="connection-foot"><Check size={13}/>修改立即生效。停用后停止管理该部件，保留它当前的物理状态。</p></Card></div></div>
 </div>;
}
