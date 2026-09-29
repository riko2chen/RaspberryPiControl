import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {axialBlade,motorCap} from './fan-geometry';
import {adapterPorts,buildAdapterPorts} from './adapter-ports';

// Reference-based reconstruction: official Pi CAD, Yahboom M.2 mechanical drawing,
// assembly video and user photos. Root scale matches the 122.9 x 145 x 83.8 mm case.
// Documented millimetre dimensions are compensated for that scale below.
// +X: I/O side, +Y: top, +Z: clear front panel. RGB strip is at the REAR TOP edge.
export function buildCube(officialPi:T.Group){
 const root=new T.Group(), chassis=new T.Group(),assembly=new T.Group(),glass=new T.Group(),lid=new T.Group(),back=new T.Group(),topFilter=new T.Group(),bottomFilter=new T.Group();
 root.add(chassis,assembly,glass,lid,back,topFilter,bottomFilter);
 root.scale.set(.962,.9352,.8953);
 const resources=new Set<T.Texture>();
 const materials=new Map<string,T.MeshStandardMaterial>();
 const standard=(c:string,metalness=.0,roughness=.5)=>{const key=[c,metalness,roughness].join(':');let m=materials.get(key);if(!m){m=new T.MeshStandardMaterial({color:c,metalness,roughness});materials.set(key,m)}return m};
 const silver=standard('#dce0e1',.65,.28),edge=standard('#9da5af',.83,.23),black=standard('#121820',.03,.72),rubber=standard('#171b23',.05,.8),gold=standard('#b69a55',.8,.27),pcb=standard('#164b39',.18,.6),white=standard('#eeeeea',.18,.5),solder=standard('#aeb8bc',.8,.24),blue=standard('#175588',.1,.4);
 const clear=new T.MeshPhysicalMaterial({color:'#d7edff',transparent:true,opacity:.055,metalness:.1,roughness:.08,envMapIntensity:1.1,depthWrite:false,side:T.DoubleSide});
 const fanClear=new T.MeshPhysicalMaterial({color:'#adcedf',transparent:true,opacity:.38,metalness:.2,roughness:.16,depthWrite:false,side:T.DoubleSide});
 clear.forceSinglePass=true;fanClear.forceSinglePass=true;
 black.envMapIntensity=.13;
 const sheet=standard('#e2e1dc',.27,.46);
 const rearAcrylic=new T.MeshPhysicalMaterial({color:'#59636e',transparent:true,opacity:.24,roughness:.12,metalness:.12,depthWrite:false,side:T.DoubleSide});rearAcrylic.forceSinglePass=true;
 const anodized=new T.MeshPhysicalMaterial({color:'#151a20',metalness:.08,roughness:.78,specularIntensity:.16,envMapIntensity:.12});
 function mesh(g:T.BufferGeometry,m:T.Material,p:T.Group,x=0,y=0,z=0){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=!('transparent' in m&&m.transparent);o.receiveShadow=true;p.add(o);return o}
 function box(p:T.Group,w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material,r=.025){return mesh(r?new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)):new T.BoxGeometry(w,h,d),m,p,x,y,z)}
 function cylinder(p:T.Group,r:number,h:number,x:number,y:number,z:number,m:T.Material,axis:'x'|'y'|'z'='z',sides=24){const o=mesh(new T.CylinderGeometry(r,r,h,sides),m,p,x,y,z);if(axis==='z')o.rotation.x=Math.PI/2;if(axis==='x')o.rotation.z=Math.PI/2;return o}
 function shapeRect(w:number,h:number,r=.1){const s=new T.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s}
 function hole(s:T.Shape,x:number,y:number,w:number,h:number){const p=new T.Path();p.moveTo(x-w/2,y-h/2);p.lineTo(x-w/2,y+h/2);p.lineTo(x+w/2,y+h/2);p.lineTo(x+w/2,y-h/2);p.closePath();s.holes.push(p)}
 function extrude(s:T.Shape,d:number){const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:false,curveSegments:8});g.translate(0,0,-d/2);return g}
 function screw(p:T.Group,x:number,y:number,z:number,axis:'x'|'y'|'z'='z',reverse=false,r=.14){
  const g=new T.Group();g.position.set(x,y,z);if(axis==='x')g.rotation.y=Math.PI/2;if(axis==='y')g.rotation.x=-Math.PI/2;if(reverse)g.rotateY(Math.PI);p.add(g);
  cylinder(g,r*.48,.27,0,0,-.105,edge);
  cylinder(g,r*1.16,.023,0,0,-.008,edge);
  const cap=mesh(new T.SphereGeometry(r,16,8,0,Math.PI*2,0,Math.PI/2),silver,g,0,0,.005);cap.rotation.x=Math.PI/2;cap.scale.y=.40;
  cylinder(g,r*.92,.045,0,0,.02,edge);
  box(g,r*1.32,.028,.009,0,0,.061,black,.004);box(g,.028,r*1.32,.009,0,0,.061,black,.004);
 }
 function roundHole(s:T.Shape,x:number,y:number,r:number){const h=new T.Path();h.absarc(x,y,r,0,Math.PI*2,true);s.holes.push(h)}
 // Brass hex bodies have their own endpoints; no post goes through an intervening PCB.
 function standoff(p:T.Group,x:number,y:number,z0:number,z1:number){
  cylinder(p,.183,z1-z0,x,y,(z0+z1)/2,gold,'z',6);
  for(const z of [z0+.026,z1-.026])cylinder(p,.17,.052,x,y,z,gold,'z',24);
  cylinder(p,.083,.018,x,y,z1+.003,black);
 }
 function label(p:T.Group,text:string,w:number,h:number,x:number,y:number,z:number,color='#bbc7cb',bg:string|null=null,size=48){
  const c=document.createElement('canvas');c.width=512;c.height=Math.max(64,Math.round(512*h/w));const ctx=c.getContext('2d')!;
  if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height)}ctx.fillStyle=color;ctx.font=`${size}px monospace`;const metrics=ctx.measureText(text);const fit=Math.min(1,(c.width-48)/Math.max(1,metrics.width),(c.height-12)/Math.max(1,metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent));ctx.font=`${size*fit}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,c.height/2);
  const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;resources.add(map);
  return mesh(new T.PlaneGeometry(w,h),new T.MeshStandardMaterial({map,transparent:!bg,roughness:.7,metalness:.1,depthWrite:!!bg,polygonOffset:true,polygonOffsetFactor:-1}),p,x,y,z);
 }
 function wire(p:T.Group,points:number[][],radius:number,color:string){const c=new T.CatmullRomCurve3(points.map(v=>new T.Vector3(...v as [number,number,number])));return mesh(new T.TubeGeometry(c,32,radius,6,false),standard(color,.08,.45),p)}
 function perforated(p:T.Group,y:number){
  const s=shapeRect(12.6,9.2,.17);
  for(let row=0;row<13;row++)for(let col=0;col<17;col++){
   const x=-5.65+col*.68+(row%2)*.34,v=-3.7+row*.61;if(x>5.65)continue;
   const path=new T.Path();for(let k=0;k<6;k++){const a=-k*Math.PI/3;const px=x+Math.cos(a)*.27,py=v+Math.sin(a)*.27;k?path.lineTo(px,py):path.moveTo(px,py)}path.closePath();s.holes.push(path);
  }
  const o=mesh(extrude(s,.13),sheet,p,0,y,0);o.rotation.x=-Math.PI/2;
 }
 perforated(chassis,-7.45);perforated(lid,7.45);
 // Folded right-hand metal wall, with actual through-holes for every port.
 const wall=shapeRect(9.2,14.9,.12);
 // Apertures use the CAD's mating FACE, excluding the solder legs behind it.
 // y/z limits are in millimetres; allow 0.25 mm clearance on each edge.
 for(const [y0,y1,z0,z1] of [[39.7497,54.2497,1.911,17.361],[21.7501,36.2501,1.906,17.526],[2.285,18.215,1.336,14.636]]){
  const y=(y0+y1)*.05/.9352-2.04,z=(z0+z1)*.05/.8953+.02;
  hole(wall,-z,y,(z1-z0+.5)*.1/.8953,(y1-y0+.5)*.1/.9352);
 }
 for(const p of adapterPorts)hole(wall,-p.z,p.y,p.width,p.height);
 const side=mesh(extrude(wall,.13),sheet,chassis,6.23,0,0);side.rotation.y=Math.PI/2;
 // Front / rear flanges and corner attachment tabs.
 for(const z of [-4.5,4.5])for(const y of [-7.26,7.26]){
  box(chassis,12.45,.3,.23,0,y,z,sheet,.06);
  for(const x of [-6.03,6.03]){box(chassis,.67,.65,.25,x,y,z,sheet,.08);screw(chassis,x,y,z+(z>0?.17:-.17),'z',z<0)}
 }
 for(const z of [-4.48,4.48])for(const x of [-6.12,6.12])box(chassis,.27,14.9,.3,x,0,z,sheet,.04);
 for(const x of [-5.75,5.7])for(const z of [-3.95,3.95])cylinder(chassis,.4,.37,x,-7.73,z,rubber,'y');
 // Three acrylic faces. Rear tint follows the dark reflections in the user's photos.
 box(back,12.05,14.35,.15,0,0,-4.58,rearAcrylic,.04);
 box(glass,12.12,14.35,.15,0,0,4.64,clear,.03);
 box(glass,.15,14.35,8.65,-6.27,0,0,clear,.03);
 const acrylicEdge=new T.LineBasicMaterial({color:'#c1d2e3',transparent:true,opacity:.42});
 for(const [w,h,d,x,y,z] of [[12.12,14.35,.15,0,0,4.64],[.15,14.35,8.65,-6.27,0,0]]){const o=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(w,h,d)),acrylicEdge);o.position.set(x,y,z);glass.add(o)}
 // Matching removable mesh filters sit OUTSIDE the two honeycomb metal panels.
 const dustCanvas=document.createElement('canvas');dustCanvas.width=dustCanvas.height=32;const dc=dustCanvas.getContext('2d')!;dc.fillStyle='#fff';dc.fillRect(0,0,32,32);dc.fillStyle='#000';dc.fillRect(9,9,14,14);
 const dustMap=new T.CanvasTexture(dustCanvas);dustMap.wrapS=dustMap.wrapT=T.RepeatWrapping;dustMap.repeat.set(54,39);resources.add(dustMap);
 const dust=new T.MeshStandardMaterial({color:'#151b23',alphaMap:dustMap,alphaTest:.5,side:T.DoubleSide,roughness:.8});
 for(const [group,y] of [[topFilter,7.57],[bottomFilter,-7.57]] as const){
  const plane=mesh(new T.PlaneGeometry(11.4,8),dust,group,0,y,0);plane.rotation.x=-Math.PI/2;
  for(const z of [-4.05,4.05])box(group,11.5,.07,.15,0,y,z,black,.02);
  for(const x of [-5.68,5.68])box(group,.15,.07,8,x,y,0,black,.02);
 }
 // One mounting acrylic plate carries both boards. Dimensions follow the official
 // M.2 drawing and the 07:25 hardware list in Yahboom's assembly video.
 const pi=new T.Group(),storage=new T.Group(),cooler=new T.Group(),screen=new T.Group(),adapter=new T.Group(),topFan=new T.Group(),strip=new T.Group();assembly.add(storage,pi,cooler,screen,adapter);lid.add(topFan,strip);
 const mounts=[[-2.569,3.574],[3.46,3.574],[-2.569,-1.666],[3.46,-1.666]];
 const adapterMounts=[[-2.55,-3.24],[4.06,-3.24],[-2.55,-6.03],[4.06,-6.03]];
 const piBottom=.02+.003/.8953, m2Front=piBottom-.5/.8953, m2Rear=m2Front-.17/.8953, carrierFront=m2Rear-1/.8953;
 const adapterRear=carrierFront+1.9/.8953, adapterFace=adapterRear+.15/.8953;
 const carrier=shapeRect(9.7,13.6,.14);
 for(const [x,y] of [...mounts,...adapterMounts])roundHole(carrier,x-1.1,y+.35,.145);
 for(const x of [-2.60,4.78])for(const y of [-7.04,6.21])roundHole(carrier,x-1.1,y+.35,.145);
 mesh(extrude(carrier,.2/.8953),clear,assembly,1.1,-.35,carrierFront-.1/.8953);
 for(const [x,y] of mounts){
  standoff(pi,x,y,m2Front,piBottom); // 5 mm male/female spacer, between the two PCBs.
  standoff(storage,x,y,carrierFront,m2Rear); // separate 10 mm female/female spacer.
  screw(pi,x,y,.02+.1306/.8953,'z',false,.16);
  screw(assembly,x,y,carrierFront-.2/.8953,'z',true,.16);
 }
 for(const [x,y] of adapterMounts){
  standoff(adapter,x,y,carrierFront,adapterRear); // four uninterrupted 19 mm posts.
  screw(assembly,x,y,carrierFront-.2/.8953,'z',true,.16);
 }
 // The M.2 adapter is 88 x 56 mm, 1.7 mm thick, with 58 x 49 mm fixing centres.
 // Its component side faces REAR. The socket/FFC connector are on the left when
 // looking through the front; the SSD securing screw is on the opposite end.
 const storageCx=-2.933+4.4/.962, storageCy=-2.04+2.8/.9352;
 const storageShape=shapeRect(8.8/.962,5.6/.9352,.12);
 for(const [x,y] of mounts)roundHole(storageShape,x-storageCx,y-storageCy,.14);
 const ssdY=1.70;
 for(const x of [5.78,3.70,1.83,.58])roundHole(storageShape,x-storageCx,ssdY-storageCy,.145);
 mesh(extrude(storageShape,.17/.8953),black,storage,storageCx,storageCy,(m2Front+m2Rear)/2);
 for(const [x,y] of mounts){
  const ring=mesh(new T.RingGeometry(.147,.24,24),gold,storage,x,y,m2Rear-.009);ring.rotation.y=Math.PI;
 }
 const socketX=-2.48;
 box(storage,.55,2.42,.4,socketX,ssdY,m2Rear-.2,black,.04);
 box(storage,.07,2.24,.05,socketX+.29,ssdY,m2Rear-.29,edge,.01);
 for(let j=0;j<34;j++)box(storage,.10,.025,.016,socketX+.21,ssdY-1.04+j*.062,m2Rear-.405,gold,0);
 // A 2280 stick, supported at the remote screw, sits parallel to the back PCB.
 const ssdFace=m2Rear-.36, ssdCx=1.77;
 const ssdShape=shapeRect(8/.962,2.2/.9352,.05);roundHole(ssdShape,5.78-ssdCx,0,.15);
 mesh(extrude(ssdShape,.075/.8953),pcb,storage,ssdCx,ssdY,ssdFace);
 for(const x of [-1.10,.65,2.36,4.12])box(storage,1.12,1.28,.095,x,ssdY,ssdFace-.08,black,.025);
 const sticker=label(storage,'NVMe · PCIe · 2280',6.85,1.65,1.48,ssdY,ssdFace-.145,'#a9b1b8','#242a30',40);sticker.rotation.y=Math.PI;
 standoff(storage,5.78,ssdY,ssdFace,m2Rear);screw(storage,5.78,ssdY,ssdFace-.06,'z',true,.14);
 const m2logo=label(storage,'YAHBOOM  YB-EPA01-V1.0',4.65,.27,1.55,-.66,m2Rear-.01,'#bcc2c6',null,41);m2logo.rotation.y=Math.PI;
 // Regulator, controller, passives and the 16-way PCIe FFC latch on the rear face.
 box(storage,.22,1.0,.25,-2.65,-.63,m2Rear-.15,white,.014);
 box(storage,.075,.88,.055,-2.81,-.63,m2Rear-.29,black,.01);
 for(let j=0;j<16;j++)box(storage,.13,.024,.025,-2.5,-1.04+j*.055,m2Rear-.08,solder,0);
 box(storage,.5,.48,.22,-1.02,-.60,m2Rear-.17,standard('#6c7378',.5,.42),.025);
 box(storage,.49,.49,.08,-.22,-.58,m2Rear-.08,black,.01);
 for(let row=0;row<4;row++)for(let col=0;col<6;col++){
  const x=-1.98+col*.34,y=-1.29+row*.35;
  if(x>-.9&&y>-.95)continue;
  box(storage,.13,.075,.065,x,y,m2Rear-.065,row%2?black:standard('#aa9875',.2,.6),.006);
  for(const xx of [-.07,.07])box(storage,.038,.077,.066,x+xx,y,m2Rear-.065,solder,0);
 }
 // Official Raspberry Pi STEP, tessellated offline, including connector internals.
 // The inverse enclosure scale keeps the board exactly 85 x 56 mm in world units.
 officialPi.scale.set(.1/.962,.1/.9352,.1/.8953);
 officialPi.position.set(-2.933,-2.04,.02);
 officialPi.traverse(o=>{if(o instanceof T.Mesh){o.castShadow=true;o.receiveShadow=true}});
 pi.add(officialPi);
 // A flat 16-conductor FFC folds around the board edge. It enters the real
 // PCIe socket above the power button, then drops to the adapter's rear latch.
 const ribbonCenters=[[-2.92,.84,.30],[-3.31,.84,.28],[-3.52,.65,-.18],[-3.52,.12,-.80],[-3.23,-.39,-1.11],[-2.81,-.63,m2Rear-.25]];
 const ribbonCurve=new T.CatmullRomCurve3(ribbonCenters.map(v=>new T.Vector3(...v as [number,number,number])));
 const ribbonVertices:number[]=[],ribbonIndex:number[]=[];
 for(let i=0;i<=48;i++){
  const v=ribbonCurve.getPoint(i/48),t=ribbonCurve.getTangent(i/48);
  const width=new T.Vector3(0,1,0).addScaledVector(t,-t.y).normalize().multiplyScalar(.39);
  for(const sign of [-1,1])ribbonVertices.push(v.x+width.x*sign,v.y+width.y*sign,v.z+width.z*sign);
  if(i<48){const k=i*2;ribbonIndex.push(k,k+1,k+2,k+1,k+3,k+2)}
 }
 const ribbonGeometry=new T.BufferGeometry();ribbonGeometry.setAttribute('position',new T.Float32BufferAttribute(ribbonVertices,3));ribbonGeometry.setIndex(ribbonIndex);ribbonGeometry.computeVertexNormals();
 mesh(ribbonGeometry,new T.MeshStandardMaterial({color:'#21232b',roughness:.54,side:T.DoubleSide}),assembly);
 const ribbonText=label(assembly,'YAHBOOM',1.10,.18,-3.43,.2,-.11,'#c2c6cb',null,66);ribbonText.rotation.y=-Math.PI/2;ribbonText.rotation.z=.57;
 // SW1 is already present in the official STEP at x=-0.45..2.95, y=16.15..20.65 mm.
 // The cable routes above it; the enclosure has no separate power-button cutout.
 // Black anodised fin stack with real gaps, recessed under the front fan.
 const sinkBase=new T.Shape(),sw=6.35/.962,sh=4.2/.9352;
 sinkBase.moveTo(-sw/2,-sh/2);sinkBase.lineTo(1.17,-sh/2);sinkBase.lineTo(1.17,-1.31);sinkBase.lineTo(sw/2,-1.31);sinkBase.lineTo(sw/2,sh/2);sinkBase.lineTo(-sw/2,sh/2);sinkBase.closePath();
 mesh(extrude(sinkBase,.25),anodized,cooler,.58,1.18,.60);
 // The right extension ends above the MIPI sockets, as on the actual casting.
 for(let i=0;i<12;i++){
  const y=-.67+i*.348,w=i<2?4.45:6.35/.962;
  box(cooler,w,.105,.78,i<2?-.50:.58,y,1.10,anodized,.028);
 }
 for(const [x,y] of [[-2.67,-.92],[3.37,3.04]]){
  cylinder(cooler,.26,.3,x,y,.63,anodized);screw(cooler,x,y,.82);
 }
 const fanBody=new T.Group();fanBody.position.set(-.55,1.12,2.05);fanBody.scale.set(1/.962,1/.9352,1/.8953);cooler.add(fanBody);
 function fan(p:T.Group,size:number,depth:number,transparent=false){
  const shellMat=transparent?fanClear:black;
  const frame=shapeRect(size,size,.24);const opening=new T.Path();opening.absarc(0,0,size*.455,0,Math.PI*2,true);frame.holes.push(opening);mesh(extrude(frame,depth),shellMat,p);
  const ring=mesh(new T.TorusGeometry(size*.437,.085,7,48),shellMat,p,0,0,depth/2-.035);
  for(const [x,y] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
   if(!transparent)screw(p,x*size*.414,y*size*.414,depth/2+.035);
   const support=box(p,.11,size*.6,.12,x*size*.13,y*size*.15,-depth/2+.05,shellMat,.02);support.rotation.z=x*y*.7;
  }
  const rotor=new T.Group();p.add(rotor);
  const bladeMat=transparent?new T.MeshPhysicalMaterial({color:'#a1c2d8',metalness:.15,roughness:.22,transparent:true,opacity:.69,side:T.DoubleSide}):new T.MeshPhysicalMaterial({color:'#22262d',metalness:.02,roughness:.53,specularIntensity:.38});
  const count=7;
  for(let i=0;i<count;i++){
   const blade=mesh(axialBlade(size,transparent?1:-1),bladeMat,rotor,0,0,.02);blade.rotation.z=i*Math.PI*2/count+.2;
  }
  // The photographed 4010 axial fan has a broad motor hub and seven wide blades.
  const hub=mesh(motorCap(size),transparent?fanClear:rubber,rotor,0,0,.04);
  cylinder(rotor,size*.035,.012,0,0,.292,transparent?silver:black, 'z',32);
  const seam=mesh(new T.TorusGeometry(size*.267,.012,6,64),transparent?edge:black,rotor,0,0,.267);
  return rotor;
 }
 const cpuRotor=fan(fanBody,4.0,1.0);
 // The independent case fan is horizontal, mounted under the honeycomb roof.
 topFan.position.set(.65,6.78,.40);topFan.rotation.x=-Math.PI/2;topFan.scale.set(1/.962,1/.8953,1/.9352);
 const caseRotor=fan(topFan,5.0,1.0,true);
 // Fixed motor housing and cross braces face down into the case in the install photos.
 cylinder(topFan,.84,.12,0,0,-.48,white);
 const fanBadge=label(topFan,'DC 5V',1.26,.37,0,0,-.55,'#367198','#edf1ee',76);fanBadge.rotation.y=Math.PI;
 for(const [x,z] of [[-1,-1],[-1,1],[1,-1],[1,1]])screw(lid,.65+x*2.07/.962,7.52,.4+z*2.07/.8953,'y',false,.17);
 const fanLightMat=new T.MeshBasicMaterial({color:'#429bff',toneMapped:false});
 for(const x of [-1.88,1.88])for(const y of [-1.88,1.88])cylinder(topFan,.09,.13,x,y,.26,fanLightMat);
 // The OLED carrier plugs into the real 2x20 GPIO header. Its front face is
 // separated from the header by female sockets; the screen is a 0.91" 128x32 OLED.
 const oledZ=1.40, oledY=4.52;
 // The lower-right relief is open to the outside edge, not a drilled square hole.
 const oledShape=new T.Shape();oledShape.moveTo(-3.365,-1.01);oledShape.lineTo(2.91,-1.01);oledShape.lineTo(2.91,-.48);oledShape.lineTo(3.4,-.48);oledShape.lineTo(3.4,.975);oledShape.quadraticCurveTo(3.4,1.01,3.365,1.01);oledShape.lineTo(-3.365,1.01);oledShape.quadraticCurveTo(-3.4,1.01,-3.4,.975);oledShape.lineTo(-3.4,-.975);oledShape.quadraticCurveTo(-3.4,-1.01,-3.365,-1.01);oledShape.closePath();
 mesh(extrude(oledShape,.12),black,screen,.52,oledY,oledZ);
 for(const x of [-1.86,2.58])box(screen,.54,.52,.55,x,3.69,1.065,black,.025);
 for(let col=0;col<20;col++)for(const y of [3.75,4.02]){
  const x=-2.045+col*.254/.962;
  const ring=mesh(new T.RingGeometry(.042,.071,12),solder,screen,x,y,oledZ+.067);
  cylinder(screen,.036,.02,x,y,oledZ+.063,black);
 }
 box(screen,3.8/.962,1.2/.9352,.10,-.16,4.77,oledZ+.13,blue,.025);
 box(screen,3.04,1.02,.045,.03,4.77,oledZ+.205,black,.01);
 const oledCanvas=document.createElement('canvas');oledCanvas.width=128;oledCanvas.height=32;
 const oledTexture=new T.CanvasTexture(oledCanvas);oledTexture.colorSpace=T.SRGBColorSpace;oledTexture.minFilter=oledTexture.magFilter=T.NearestFilter;oledTexture.generateMipmaps=false;resources.add(oledTexture);
 const oledMaterial=new T.MeshBasicMaterial({map:oledTexture,toneMapped:false});mesh(new T.PlaneGeometry(2.2384/.962,.5584/.9352),oledMaterial,screen,-.06,4.79,oledZ+.232);
 for(let j=0;j<4;j++){
  cylinder(screen,.048,.035,-1.95,4.38+j*.245,oledZ+.19,solder);
  label(screen,['GND','VCC','SCL','SDA'][j],.29,.1,-2.23,4.38+j*.245,oledZ+.191,'#d0d5d9',null,230);
 }
 label(screen,'5V',.38,.18,-2.64,4.01,oledZ+.067,'#17202a','#d5dadd',340);label(screen,'3V3',.38,.18,-2.64,3.73,oledZ+.067,'#17202a','#d5dadd',290);
 // Two fan sockets and the three-pin RGB socket are mounted on the BACK face.
 for(const x of [2.55,3.25]){box(screen,.45,.49,.35,x,4.6,oledZ-.24,white,.024);box(screen,.27,.30,.012,x,4.6,oledZ-.425,black,.01)}
 box(screen,.46,.58,.33,-2.62,4.56,oledZ-.23,white,.02);
 for(const x of [-1.45,-.85,.02,.83])box(screen,.28,.24,.075,x,4.51,oledZ-.105,black,.01);
 // White lower interface adapter, slim connectors bridging to the Pi above.
 const adapterShape=shapeRect(9.05,3.6,.13);
 for(const [x,y] of adapterMounts)roundHole(adapterShape,x-1.575,y+4.55,.15);
 mesh(extrude(adapterShape,.15/.8953),white,adapter,1.575,-4.55,(adapterRear+adapterFace)/2);
 for(const [x,title,width,count] of [[-1.769,'POWER',.79,12],[-.251,'HDMI0',.58,10],[1.142,'HDMI1',.58,10]] as const){
  // Separate metal plug, black insert, soldered tail and contact fingers.
  box(adapter,width,.54,.22,x,-2.12,.37,silver,.025);
  box(adapter,width*.90,.15,.18,x,-2.49,.40,black,.012);
  box(adapter,width*.96,.17,.11,x,-2.64,adapterFace+.04,silver,.012);
  for(let k=0;k<count;k++)box(adapter,.028,.18,.024,x-width*.38+k*width*.76/(count-1),-2.77,adapterFace+.014,solder,0);
  for(const xx of [-.23,.23])box(adapter,.065,.13,.009,x+xx,-2.21,.487,black,.005);
  label(adapter,title,1.15,.18,x,-3.08,adapterFace+.012,'#263039',null,55);
 }
 label(adapter,'YAHBOOM',3.15,.5,.35,-4.6,adapterFace+.012,'#48505a',null,59);label(adapter,'YB-EPA03-V1.0',2.65,.24,.35,-5.02,adapterFace+.012,'#616975',null,50);
 for(const [x,y] of adapterMounts){cylinder(adapter,.23,.02,x,y,adapterFace+.012,black);screw(adapter,x,y,adapterFace+.025,'z',false,.17)}
 // Faint circuit traces are geometry, so they remain crisp when orbiting.
 for(let i=0;i<8;i++)wire(adapter,[[-1.8+i*.14,-3.5,adapterFace+.006],[-1.8+i*.14,-3.95-i*.11,adapterFace+.006],[2.4,-3.95-i*.11,adapterFace+.006],[3.5,-3.45-i*.21,adapterFace+.006]],.006,'#bfc7c6');
 adapter.add(buildAdapterPorts());
 // CPU lead mates with the dedicated four-pin JST fan header in the official CAD:
 // x=65.3..68.2, y=49..55, z=1.386..5.636 mm. The plug lifts out with the cooler.
 const fanSocket=new T.Vector3(-2.933+6.67/.962,-2.04+5.2/.9352,.02+.565/.8953);
 box(cooler,.24/.962,.42/.9352,.21/.8953,fanSocket.x,fanSocket.y,fanSocket.z,white,.012);
 box(cooler,.05,.29,.05,fanSocket.x-.13,fanSocket.y,fanSocket.z+.06,white,.006);
 for(const [i,c] of ['#343943','#b94851','#c5a758','#4772a6'].entries()){
  const wireY=fanSocket.y+(i-1.5)*.1/.9352,wireZ=fanSocket.z+.115/.8953;
  wire(cooler,[[1.36,2.50+i*.04,1.92],[2.04,2.25+i*.05,1.94],[3.1,2.55+i*.07,1.53],[3.81,3.10+i*.08,1.10],[fanSocket.x,wireY,wireZ+.10],[fanSocket.x,wireY,wireZ]],.026,c);
 }
 // These leads and their removable plugs travel with the roof assembly when opened.
 wire(lid,[[2.1,6.5,.3],[3.4,6.23,-.2],[4.3,5.1,-.4],[2.55,4.6,1.05]],.045,'#ad4354');
 wire(lid,[[2.2,6.5,.3],[3.52,6.2,-.2],[4.4,5.12,-.4],[2.66,4.6,1.05]],.045,'#282e37');
 for(let i=0;i<3;i++)wire(lid,[[-5.18,6.73,-4.17],[-5.33,5.54,-3.95],[-4.1,4.81,-1.3],[-2.73,4.55,1.0+i*.05]],.045,'#242c35');
 // Bent carrier mounting flanges and the individually fastened acrylic plate.
 for(const y of [-6.75,6.5]){
  const flange=shapeRect(9.7,.86,.09);
  for(let j=0;j<5;j++)hole(flange,-3.5+j*1.75,.03,.40,.31);
  mesh(extrude(flange,.12),sheet,chassis,1.1,y,carrierFront-.31);
  for(const x of [-2.60,4.78]){box(chassis,.64,.85,.14,x,y-.29,carrierFront-.23,sheet,.09);screw(chassis,x,y-.29,carrierFront-.10,'z',false,.16)}
 }
 for(const y of [-7.34,7.34])for(const x of [-2.60,4.78]){
  box(chassis,.64,.13,2.42,x,y,-3.27,sheet,.025);
  box(chassis,.64,1.08,.13,x,y>0?6.88:-6.92,carrierFront-.31,sheet,.025);
 }
 // Single physical RGB strip, at the back and the very top. Emitters face inward.
 strip.position.set(0,6.84,-4.25);strip.rotation.x=-Math.PI*.1;
 box(strip,10.65,.56,.12,0,0,0,white,.05);
 const ledMaterials:T.MeshBasicMaterial[]=[],ledCoreMaterials:T.MeshBasicMaterial[]=[],leds:T.Mesh[]=[],glows:T.Sprite[]=[];
 const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;const gc=glowCanvas.getContext('2d')!;const grad=gc.createRadialGradient(32,32,0,32,32,32);grad.addColorStop(0,'rgba(255,255,255,.6)');grad.addColorStop(.22,'rgba(255,255,255,.22)');grad.addColorStop(1,'rgba(255,255,255,0)');gc.fillStyle=grad;gc.fillRect(0,0,64,64);const glowMap=new T.CanvasTexture(glowCanvas);resources.add(glowMap);
 for(let i=0;i<14;i++){
  const x=-4.95+i*(9.9/13);box(strip,.44,.43,.085,x,0,.085,silver,.025);
  const m=new T.MeshBasicMaterial({color:'#000000',toneMapped:false});ledMaterials.push(m);
  const led=box(strip,.29,.3,.055,x,0,.151,m,.055);led.userData.ledIndex=i;leds.push(led);
  const coreMaterial=new T.MeshBasicMaterial({color:'#000000',toneMapped:false});ledCoreMaterials.push(coreMaterial);const core=box(strip,.095,.095,.012,x-.02,.015,.183,coreMaterial,.018);core.userData.ledIndex=i;
  const g=new T.Sprite(new T.SpriteMaterial({map:glowMap,color:'#000000',transparent:true,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));g.position.set(x,0,.19);g.scale.set(.95,.95,1);strip.add(g);glows.push(g);
  for(const yy of [-.21,.21])box(strip,.17,.04,.016,x,yy,.075,gold,0);
 }
 const rgbLights=[-3.8,0,3.8].map(x=>{const l=new T.PointLight('#000000',0,15,2);l.position.set(x,6.37,-3.6);lid.add(l);return l});
 const blueLight=new T.PointLight('#217eff',24,13,2);blueLight.position.set(.8,6.2,.2);lid.add(blueLight);
 // Preserve movable assemblies, but flatten static screws / sockets before batching.
 const retained=[chassis,assembly,glass,lid,back,topFilter,bottomFilter,pi,storage,cooler,screen,adapter,topFan,strip,cpuRotor,caseRotor];
 retained.forEach(g=>g.userData.keep=true);
 function batch(group:T.Group){
  group.updateWorldMatrix(true,true);
  const inverse=group.matrixWorld.clone().invert();
  const buckets=new Map<T.Material,T.Mesh[]>();
  function collect(node:T.Object3D){
   for(const c of [...node.children]){
    if(c instanceof T.Group&&c.userData.keep){batch(c);continue}
    if(c instanceof T.Mesh&&c.userData.ledIndex===undefined&&!Array.isArray(c.material)&&!c.material.transparent){const list=buckets.get(c.material)||[];list.push(c);buckets.set(c.material,list)}
    else if(c instanceof T.Group)collect(c);
   }
  }
  collect(group);
  for(const [material,items] of buckets){
   if(items.length<2)continue;
   const geometries=items.map(o=>(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));
   const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());if(!geometry)continue;
   mesh(geometry,material,group);
   for(const item of items){item.removeFromParent();item.geometry.dispose()}
  }
 }
 batch(root);
 const explodedGroups=[
  {group:glass,offset:new T.Vector3(0,0,5.5)},
  {group:lid,offset:new T.Vector3(0,3.5,0)},
  {group:topFilter,offset:new T.Vector3(0,7,0)},
  {group:bottomFilter,offset:new T.Vector3(0,-3.2,0)},
  {group:back,offset:new T.Vector3(0,0,-3)},
  {group:cooler,offset:new T.Vector3(-4.6,.4,3.4)},
  {group:storage,offset:new T.Vector3(-2,0,-2)},
  {group:screen,offset:new T.Vector3(0,2,3.4)},
  {group:adapter,offset:new T.Vector3(1.5,-1.3,4.8)},
 ];
 for(const [group,name] of [[topFilter,'top-filter'],[bottomFilter,'bottom-filter'],[screen,'oled-board'],[adapter,'io-adapter'],[lid,'roof-assembly'],[cooler,'cpu-cooler']] as const)group.name=name;
 return {root,cpuRotor,caseRotor,oledCanvas,oledTexture,ledMaterials,ledCoreMaterials,leds,glows,rgbLights,blueLight,fanLightMat,explodedGroups,glass,lid,resources,
  dispose(){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();root.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments||o instanceof T.Sprite){if('geometry'in o)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m)}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());resources.forEach(t=>t.dispose())}};
}
