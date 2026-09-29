import * as T from 'three';

// Right-wall connectors on the Yahboom adapter. +X points out of the enclosure.
export const adapterPorts=[
 {kind:'hdmi',y:-3.45,z:1.34,width:1.58,height:.66},
 {kind:'hdmi',y:-4.65,z:1.34,width:1.58,height:.66},
 {kind:'power',y:-5.88,z:.63,width:.52,height:1.02},
] as const;
function outline(points:number[][]){const s=new T.Shape();points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath();return s}
function rounded(w:number,h:number,r:number){const s=new T.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);return s}
export function buildAdapterPorts(){
 const group=new T.Group();
 const metal=new T.MeshStandardMaterial({color:'#b7bec5',metalness:.82,roughness:.29});
 const cavity=new T.MeshStandardMaterial({color:'#080b0f',roughness:.9});
 const plastic=new T.MeshStandardMaterial({color:'#222730',roughness:.72});
 const gold=new T.MeshStandardMaterial({color:'#c6a861',metalness:.77,roughness:.25});
 const add=(g:T.BufferGeometry,m:T.Material,x:number,y:number,z:number)=>{const mesh=new T.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);return mesh};
 const box=(w:number,h:number,d:number,x:number,y:number,z:number,m:T.Material)=>add(new T.BoxGeometry(w,h,d),m,x,y,z);
 function face(s:T.Shape,length:number,x:number,y:number,z:number,m:T.Material){const g=new T.ExtrudeGeometry(s,{depth:length,bevelEnabled:false,curveSegments:12});g.translate(0,0,-length/2);const o=add(g,m,x,y,z);o.rotation.y=Math.PI/2;return o}
 for(const spec of adapterPorts){
  const {y,z}=spec;
  if(spec.kind==='hdmi'){
   const outer=outline([[-.74,.285],[.74,.285],[.74,-.035],[.51,-.285],[-.51,-.285],[-.74,-.035]]);
   const inner=outline([[-.68,.228],[.68,.228],[.68,-.013],[.475,-.23],[-.475,-.23],[-.68,-.013]]);
   outer.holes.push(new T.Path(inner.getPoints(1).reverse()));
   face(outer,1.17,5.65,y,z,metal);
   // Recessed aperture, tongue and 19 contacts; the tip is open to the eye.
   face(inner,.025,5.37,y,z,cavity);
   box(.55,.115,1.15,5.91,y+.035,z,plastic);
   for(let i=0;i<10;i++)box(.39,.019,.037,5.99,y+.1,z-.48+i*.107,gold);
   for(let i=0;i<9;i++)box(.39,.019,.037,5.99,y-.03,z-.427+i*.107,gold);
   for(const zz of [-.58,.58])box(.2,.04,.12,6.17,y+.2,z+zz,metal);
   // Fold seams and retention lances on the visible top of the shield.
   for(const xx of [5.34,5.68,6.04])box(.055,.012,.23,xx,y+.293,z,metal);
  }else{
   const outer=rounded(.38,.93,.175),inner=rounded(.30,.83,.14);
   outer.holes.push(new T.Path(inner.getPoints(16).reverse()));face(outer,.91,5.78,y,z,metal);
   face(inner,.02,5.36,y,z,cavity);
   box(.56,.62,.06,5.9,y,z,plastic);
   for(let i=0;i<12;i++)for(const zz of [-.034,.034])box(.30,.025,.012,6.06,y-.274+i*.05,z+zz,gold);
   for(const yy of [-.32,.32])box(.18,.08,.023,6.17,y+yy,z+.15,metal);
  }
 }
 return group;
}
