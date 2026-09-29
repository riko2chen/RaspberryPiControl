import * as T from 'three';

/** A swept, pitched axial blade. Both skins and the thin perimeter are real geometry. */
export function axialBlade(size:number,handedness:1|-1=1){
 const rows=15,cols=13,positions:number[]=[],indices:number[]=[];
 for(let side=0;side<2;side++)for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){
  const t=r/rows,u=c/cols-.5;
  const radius=size*(.238+.207*t);
  const sweep=-.28*t+.06*Math.sin(Math.PI*t);
  const width=.73-.12*t+.06*Math.sin(Math.PI*t);
  const angle=sweep+u*width;
  // The leading edge rises and the trailing edge falls; camber softens the surface.
  const z=size*(u*.105*(.5+.5*t)+.019*Math.cos(u*Math.PI*2)*Math.sin(t*Math.PI))+(side?-.022:.022);
  positions.push(radius*Math.cos(angle),handedness*radius*Math.sin(angle),z);
 }
 const layer=(rows+1)*(cols+1);
 for(let side=0;side<2;side++)for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const a=side*layer+r*(cols+1)+c,b=a+cols+1;
  side?indices.push(a,b+1,b,a,a+1,b+1):indices.push(a,b,b+1,a,b+1,a+1);
 }
 const rim:number[]=[];
 for(let c=0;c<=cols;c++)rim.push(c);
 for(let r=1;r<=rows;r++)rim.push(r*(cols+1)+cols);
 for(let c=cols-1;c>=0;c--)rim.push(rows*(cols+1)+c);
 for(let r=rows-1;r>0;r--)rim.push(r*(cols+1));
 for(let i=0;i<rim.length;i++){const a=rim[i],b=rim[(i+1)%rim.length];indices.push(a,a+layer,b+layer,a,b+layer,b)}
 // Reflection reverses triangle winding; retain outward-facing normals.
 if(handedness===-1)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

/** Rounded central motor cap, axis along +Z, with a broad shallow crown. */
export function motorCap(size:number){
 const r=size*.282,profile=[new T.Vector2(0,-.10),new T.Vector2(r*.94,-.10),new T.Vector2(r,-.06),new T.Vector2(r,.16),new T.Vector2(r*.99,.19),new T.Vector2(r*.94,.22),new T.Vector2(r*.68,.238),new T.Vector2(0,.245)];
 const g=new T.LatheGeometry(profile,64);g.rotateX(Math.PI/2);return g;
}
