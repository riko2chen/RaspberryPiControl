import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {assetUrl} from '../runtime';
import {buildCube} from './cube-model';
import {lightFrame} from '../light-animation';
import type {State} from '../types';
export type ModelView='perspective'|'front'|'side'|'ports'|'rear';
export type Viewer={update:(state:State)=>void;view:(view:ModelView)=>void;explode:(v:boolean)=>void;pause:(v:boolean)=>void;dispose:()=>void};
export async function createCubeViewer(host:HTMLDivElement,initial:State,onLed:(i:number)=>void,onFailure:()=>void):Promise<Viewer>{
 // Native gzip decoding works with script-src 'self'; no WASM/eval permission needed.
 const compressed=typeof DecompressionStream!=='undefined';
 const response=await fetch(assetUrl('assets/model/raspberry-pi-5.glb'+(compressed?'.gz':'')));
 if(!response.ok)throw new Error('Unable to load the Raspberry Pi model');
 const buffer=compressed&&response.body&&!response.headers.get('content-encoding')
  ?await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  :await response.arrayBuffer();
 const cad=await new GLTFLoader().parseAsync(buffer,'');
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 const canvas=renderer.domElement;canvas.className='cube-webgl';canvas.setAttribute('aria-label','CUBE Pi 三维模型，拖动旋转，双指缩放；也可使用上方视角按钮');canvas.setAttribute('role','img');canvas.tabIndex=0;host.appendChild(canvas);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.1,160);
 const model=buildCube(cad.scene);scene.add(model.root);
 const environment=new RoomEnvironment();const pmrem=new T.PMREMGenerator(renderer);const env=pmrem.fromScene(environment,.04);scene.environment=env.texture;scene.environmentIntensity=.4;environment.dispose();pmrem.dispose();
 const hemi=new T.HemisphereLight('#eef5ff','#5a6271',.95);scene.add(hemi);
 const key=new T.DirectionalLight('#fff2e1',2.5);key.position.set(-7,25,12);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-13;key.shadow.camera.right=13;key.shadow.camera.top=13;key.shadow.camera.bottom=-13;key.shadow.camera.far=65;key.shadow.bias=-.0003;key.shadow.normalBias=.045;scene.add(key);
 const fill=new T.DirectionalLight('#c0d7ff',1.15);fill.position.set(15,10,4);scene.add(fill);
 const rim=new T.DirectionalLight('#f1f5ff',1.6);rim.position.set(-6,7,-15);scene.add(rim);
 const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.ShadowMaterial({opacity:.045}));ground.rotation.x=-Math.PI/2;ground.position.y=-7.94*.9352;ground.receiveShadow=true;scene.add(ground);
 const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=128;const contactContext=contactCanvas.getContext('2d')!;const contactGradient=contactContext.createRadialGradient(64,64,9,64,64,64);contactGradient.addColorStop(0,'rgba(17,25,37,.28)');contactGradient.addColorStop(.55,'rgba(17,25,37,.12)');contactGradient.addColorStop(1,'rgba(17,25,37,0)');contactContext.fillStyle=contactGradient;contactContext.fillRect(0,0,128,128);
 const contactTexture=new T.CanvasTexture(contactCanvas),contactMaterial=new T.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false});const contact=new T.Mesh(new T.PlaneGeometry(18,13),contactMaterial);contact.rotation.x=-Math.PI/2;contact.position.y=ground.position.y+.006;scene.add(contact);
 const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=false;controls.minDistance=21;controls.maxDistance=65;controls.minPolarAngle=.13;controls.maxPolarAngle=Math.PI*.82;controls.target.set(0,0,0);controls.enableZoom=true;
 // Wheel scrolling belongs to the page; pinch and keyboard provide zoom.
 controls.touches.TWO=T.TOUCH.DOLLY_ROTATE;
 const wheel=(e:WheelEvent)=>{if(!e.ctrlKey)e.stopImmediatePropagation()};canvas.addEventListener('wheel',wheel,{capture:true,passive:true});
 let state=initial,stateAt=performance.now(),frame=0,disposed=false,visible=true,paint=0,paused=false,exploded=0,explodeTarget=0;
 let targetPosition:T.Vector3|null=null,viewName:ModelView='perspective';
 let lastPixels='',dark=false,lastShadow=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function setView(name:ModelView,immediate=false){
  viewName=name;const positions={perspective:[18,9,31],front:[0,1,34],side:[-31,8,20],ports:[35,1,0],rear:[-20,9,-32]};
  const p=new T.Vector3(...positions[name] as [number,number,number]);if(host.clientWidth<420)p.multiplyScalar(1.13);if(explodeTarget)p.multiplyScalar(1.38);
  if(immediate||reduced.matches){camera.position.copy(p);targetPosition=null;controls.update()}else targetPosition=p;
 }
 setView('perspective',true);
 function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
 const ro=new ResizeObserver(resize);ro.observe(host);resize();
 const io=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true},{rootMargin:'100px'});io.observe(host);
 const updateTheme=()=>{dark=document.documentElement.dataset.theme==='dark';key.intensity=dark?2.2:2.5;hemi.intensity=dark?.75:.95};
 const observer=new MutationObserver(updateTheme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});updateTheme();
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down={x:0,y:0};
 const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};targetPosition=null};
 const pointerUp=(e:PointerEvent)=>{
  if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
  const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(model.root.children,true).find(h=>h.object instanceof T.Mesh&&!((h.object as T.Mesh).material as T.Material).transparent);
  if(hit?.object.userData.ledIndex!==undefined)onLed(hit.object.userData.ledIndex);
 };
 canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);
 const lost=(e:Event)=>{e.preventDefault();onFailure()};canvas.addEventListener('webglcontextlost',lost);
 const keydown=(e:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','-'].includes(e.key)){e.preventDefault();targetPosition=null;const sph=new T.Spherical().setFromVector3(camera.position.clone().sub(controls.target));if(e.key==='ArrowLeft')sph.theta-=.16;if(e.key==='ArrowRight')sph.theta+=.16;if(e.key==='ArrowUp')sph.phi=Math.max(.15,sph.phi-.12);if(e.key==='ArrowDown')sph.phi=Math.min(Math.PI*.8,sph.phi+.12);if(e.key==='+')sph.radius=Math.max(21,sph.radius-2);if(e.key==='-')sph.radius=Math.min(65,sph.radius+2);camera.position.setFromSpherical(sph).add(controls.target);if(e.key==='Home')setView('perspective');controls.update()}};canvas.addEventListener('keydown',keydown);
 const color=new T.Color();
 function updatePixels(){const pixels=state.applied.oled?.pixels||'';if(pixels===lastPixels)return;lastPixels=pixels;let bytes='';try{bytes=atob(pixels)}catch{}
  const ctx=model.oledCanvas.getContext('2d')!,data=ctx.createImageData(128,32);
  for(let y=0;y<32;y++)for(let x=0;x<128;x++){const bit=((bytes.charCodeAt(y*16+(x>>3))||0)>>(7-(x%8)))&1,p=(y*128+x)*4;data.data[p]=bit?213:4;data.data[p+1]=bit?239:9;data.data[p+2]=bit?231:12;data.data[p+3]=255}ctx.putImageData(data,0,0);model.oledTexture.needsUpdate=true;
 }
 function tick(now:number){
  if(disposed)return;frame=requestAnimationFrame(tick);
  if(!visible||document.hidden||now-paint<1000/30)return;const step=Math.min((now-paint)/1000,.08);paint=now;
  const fresh=now-stateAt<3000,connected=(key:string)=>!state.hardware.connection||state.hardware.connection.components[key]?.status==='connected';
  if(!paused&&!reduced.matches&&fresh){
   if(connected('cpu_fan')&&(state.metrics.cpu_fan_rpm??0)>0)model.cpuRotor.rotation.z-=step*Math.min(18,2+(state.metrics.cpu_fan_rpm??0)/350);
   if(connected('fan'))model.caseRotor.rotation.z+=step*(state.applied.fan?.level?2+state.applied.fan.level*.75:0);
  }
  if(targetPosition){camera.position.lerp(targetPosition,.14);if(camera.position.distanceTo(targetPosition)<.015)targetPosition=null}
  controls.update();
  exploded=reduced.matches?explodeTarget:T.MathUtils.lerp(exploded,explodeTarget,.12);
  for(const {group,offset} of model.explodedGroups)group.position.copy(offset).multiplyScalar(exploded);
  // Lower the shadow catcher while the underside filter is separated.
  ground.position.y=-7.94*.9352-exploded*3.3;contact.position.y=ground.position.y+.006;contactMaterial.opacity=1-exploded*.75;
  updatePixels();
  const a=state.applied.lights,elapsed=(now-stateAt)/1000;
  let colors:string[]=a?.colors||Array(14).fill('#000000');
  if(a?.parameters.enabled&&a.parameters.effect!=='static'&&fresh&&!state.hardware.errors.lights&&!paused&&!reduced.matches){const phase=a.engine==='firmware'?state.server_time-a.written_at+elapsed:a.phase_seconds+Math.max(0,state.server_time-a.written_at)+elapsed;colors=lightFrame(a.parameters,Math.max(0,phase))}
  const sums=[new T.Color(0,0,0),new T.Color(0,0,0),new T.Color(0,0,0)];
  colors.forEach((hex,i)=>{
   const rgb=hex.slice(1).match(/../g)?.map(v=>parseInt(v,16)/255)||[0,0,0];const peak=Math.max(...rgb);const gain=peak?(1-Math.exp(-3*peak))/(1-Math.exp(-3))/peak:0;
   color.setRGB(rgb[0]*gain,rgb[1]*gain,rgb[2]*gain,T.LinearSRGBColorSpace);
   model.ledMaterials[i]?.color.copy(color);model.ledCoreMaterials[i]?.color.copy(color).lerp(new T.Color().setRGB(Math.min(1,peak*gain*1.3),Math.min(1,peak*gain*1.3),Math.min(1,peak*gain*1.3),T.LinearSRGBColorSpace),.32);const glow=model.glows[i];if(glow){glow.material.color.copy(color);glow.material.opacity=peak?Math.min(.8,Math.sqrt(peak)):0}
   sums[Math.min(2,Math.floor(i/5))].add(color);
  });
  sums.forEach((sum,i)=>{sum.multiplyScalar(1/(i===2?4:5));model.rgbLights[i].color.copy(sum);model.rgbLights[i].intensity=connected('lights')?95:0});
  const powered=connected('fan')&&(state.applied.fan?.level??0)>0;model.blueLight.intensity=powered?90:0;model.fanLightMat.color.set(powered?'#439eff':'#263343');
  if(Math.abs(exploded-explodeTarget)>.002||now-lastShadow>1500){renderer.shadowMap.needsUpdate=true;lastShadow=now}
  renderer.render(scene,camera);
  // Read-only diagnostics make rendering regressions observable without exposing controls.
  if(now%2000<40){host.dataset.drawCalls=String(renderer.info.render.calls);host.dataset.triangles=String(renderer.info.render.triangles);host.dataset.modelView=viewName;host.dataset.camera=camera.position.toArray().map(v=>v.toFixed(2)).join(',');host.dataset.fanRpm=String(state.metrics.cpu_fan_rpm??'unknown');host.dataset.caseLevel=String(state.applied.fan?.level??'unknown');host.dataset.exploded=exploded.toFixed(3);host.dataset.parts=JSON.stringify(model.explodedGroups.filter(p=>p.group.name).map(p=>({name:p.group.name,position:p.group.position.toArray()})))}
 }
 frame=requestAnimationFrame(tick);
 return {update(next){state=next;stateAt=performance.now()},view:setView,explode(value){explodeTarget=value?1:0;setView(viewName)},pause(value){paused=value},dispose(){disposed=true;cancelAnimationFrame(frame);ro.disconnect();io.disconnect();observer.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('keydown',keydown);canvas.removeEventListener('wheel',wheel,true);canvas.removeEventListener('webglcontextlost',lost);model.dispose();env.dispose();contactTexture.dispose();contactMaterial.dispose();contact.geometry.dispose();ground.geometry.dispose();(ground.material as T.Material).dispose();renderer.dispose();canvas.remove()}};
}
