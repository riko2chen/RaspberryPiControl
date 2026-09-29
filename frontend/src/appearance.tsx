import {useEffect,useLayoutEffect,useState,type CSSProperties} from 'react';
import {Check,Monitor,Moon,Palette,Sun} from 'lucide-react';
import {Card,SectionTitle} from './components';

export const palettes=[
 {id:'blue',name:'经典蓝',light:'#2563eb',dark:'#93b4ff',soft:'#eff4ff'},
 {id:'violet',name:'鸢尾紫',light:'#7c3aed',dark:'#c4a7ff',soft:'#f5f0ff'},
 {id:'teal',name:'青色',light:'#0f766e',dark:'#65d7c6',soft:'#eef9f7'},
 {id:'rose',name:'玫瑰红',light:'#be185d',dark:'#f9a8cc',soft:'#fff0f5'},
 {id:'amber',name:'琥珀橙',light:'#b45309',dark:'#f6c371',soft:'#fff7ed'},
 {id:'slate',name:'石墨灰',light:'#475569',dark:'#cbd5e1',soft:'#f1f5f9'},
 {id:'green',name:'森林绿',light:'#15803d',dark:'#86d9a2',soft:'#effaf2'},
] as const;
type PaletteId=typeof palettes[number]['id'];
type Mode='light'|'dark'|'system';
function readPreference(key:string){try{return localStorage.getItem(key)}catch{return null}}
function writePreference(key:string,value:string){try{localStorage.setItem(key,value)}catch{/* In-memory appearance still works. */}}
export function useAppearance(){
 const [palette,setPalette]=useState<PaletteId>(()=>palettes.find(p=>p.id===readPreference('pi-control-accent'))?.id||'blue');
 const [mode,setMode]=useState<Mode>(()=>{const saved=readPreference('pi-control-theme');return saved==='dark'||saved==='system'?saved:'light'});
 const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const update=()=>setSystemDark(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 const resolved=mode==='system'?(systemDark?'dark':'light'):mode;
 useLayoutEffect(()=>{
  const p=palettes.find(p=>p.id===palette)!;const dark=resolved==='dark';const root=document.documentElement;
  root.dataset.theme=resolved;root.dataset.accent=palette;
  const tokens={accent:dark?p.dark:p.light,'accent-solid':p.light,'on-accent':'#ffffff',soft:dark?`color-mix(in srgb, ${p.dark} 13%, #151920)`:p.soft,bg:dark?'#101318':`color-mix(in srgb, ${p.soft} 32%, #f8fafc)`,surface:dark?'#191e26':'#ffffff',sidebar:dark?'#14181f':`color-mix(in srgb, ${p.soft} 55%, #f5f7fa)`,text:dark?'#e7edf5':'#202a3b',muted:dark?'#a1adbf':'#637085',line:dark?'#303946':'#e2e7ef',input:dark?'#12171e':'#f8fafc',shadow:dark?'0 4px 26px #00000016':'0 4px 26px #24324d05'};
  Object.entries(tokens).forEach(([key,value])=>root.style.setProperty('--'+key,value));
  root.style.colorScheme=resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#101318':'#f8fafc');
  writePreference('pi-control-accent',palette);writePreference('pi-control-theme',mode);
 },[palette,mode,resolved]);
 return {palette,setPalette,mode,setMode,resolved};
}
export type Appearance=ReturnType<typeof useAppearance>;
export function AppearanceSettings({appearance}:{appearance:Appearance}){
 const {palette,setPalette,mode,setMode}=appearance;
 return <Card className="appearance-card">
  <SectionTitle eyebrow="MAKE IT YOURS" title="外观与主题" aside={<Palette size={20}/>}/>
  <p className="subtle line-height">选一个喜欢的颜色，让整个控制台跟随你的风格。</p>
  <div className="theme-colors" role="group" aria-label="主题色">{palettes.map(p=><button key={p.id} className={'theme-color '+(palette===p.id?'selected':'')} aria-pressed={palette===p.id} aria-label={'主题色：'+p.name} onClick={()=>setPalette(p.id)} style={{'--swatch':p.light} as CSSProperties}><span className="theme-color-swatch">{palette===p.id&&<Check size={17}/>}</span><span>{p.name}</span></button>)}</div>
  <div className="field"><label>显示模式</label><div className="segmented appearance-modes" role="group" aria-label="显示模式">{([['light','浅色',Sun],['dark','深色',Moon],['system','跟随系统',Monitor]] as const).map(([id,label,Icon])=><button key={id} className={mode===id?'active':''} aria-pressed={mode===id} onClick={()=>setMode(id)}><Icon size={15}/>{label}</button>)}</div></div>
  <p className="connection-foot"><Check size={13}/>选择后立即生效，偏好保存在当前浏览器。</p>
 </Card>;
}
