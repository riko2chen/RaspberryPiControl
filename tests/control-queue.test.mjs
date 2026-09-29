import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlQueue} from '../frontend/src/control-queue.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const initial=()=>({version:1,config:{lights:{enabled:true,effect:'static',brightness:35,speed:1,colors:Array(14).fill('#8cbaa8'),native_color:1,native_speed:1},fan:{mode:'auto',level:4,curve:[{temperature:35,level:2},{temperature:75,level:10}]},oled:{mode:'text',text:'hello',font_size:12,x:0,y:0,enabled:true,contrast:160,invert:false,pixels:''},labels:Array.from({length:14},(_,i)=>'LED '+i)}});
function setup({latency=15,sendError=null}={}){
 let state=initial(),calls=[],active=0,max=0;
 const q=new ControlQueue({read:async()=>structuredClone(state),send:async(kind,body)=>{
  active++;max=Math.max(active,max);calls.push({kind,body});
  await sleep(latency);
  try{
   if(sendError)throw Object.assign(new Error(sendError),{status:503});
   assert.equal(body.expected_version,state.version);
   state.config[kind]=structuredClone(kind==='labels'?body.value.labels:body.value);state.version++;
   return structuredClone(state);
  }finally{active--}
 }});q.accept(structuredClone(state));q.setConnected(true);
 return {q,calls,get max(){return max},get state(){return state},external(kind,value){state.config[kind]={...state.config[kind],...value};state.version++;q.accept(structuredClone(state))}};
}
async function idle(q){for(let i=0;i<150&&q.active;i++)await sleep(5);assert.equal(q.active,false,'queue failed to drain')}
test('rapid slider edits coalesce and send the final setting once',async()=>{
 const {q,calls,state}=setup();for(let i=40;i<=70;i++)q.edit('lights',{...q.draft('lights'),brightness:i},30);
 await idle(q);assert.equal(calls.length,1);assert.equal(calls[0].body.value.brightness,70);q.clear();
});
test('in-flight edits survive their response; different devices serialize',async()=>{
 const t=setup({latency:40}),q=t.q;q.edit('lights',{...q.draft('lights'),brightness:60});await sleep(10);
 q.edit('lights',{...q.draft('lights'),brightness:35}); // Reverting during flight must still send the revert.
 q.edit('oled',{...q.draft('oled'),text:'final text'});await idle(q);
 assert.equal(t.max,1);assert.equal(t.state.config.lights.brightness,35);assert.equal(t.state.config.oled.text,'final text');
 assert.deepEqual(t.calls.map(x=>x.body.expected_version),[1,2,3]);q.clear();
});
test('WebSocket echo before response does not lose a subsequent edit',async()=>{
 const t=setup({latency:50}),q=t.q;q.edit('lights',{...q.draft('lights'),brightness:60});await sleep(10);
 const echo=structuredClone(t.state);echo.version=2;echo.config.lights.brightness=60;q.accept(echo);
 q.edit('lights',{...q.draft('lights'),speed:2});await idle(q);
 assert.equal(t.state.config.lights.brightness,60);assert.equal(t.state.config.lights.speed,2);q.clear();
});
test('pending edits merge unrelated external fields but stop on a conflict',async()=>{
 const t=setup(),q=t.q;q.edit('lights',{...q.draft('lights'),brightness:50},30);t.external('lights',{speed:2});await idle(q);
 assert.equal(t.state.config.lights.speed,2);
 q.edit('lights',{...q.draft('lights'),brightness:60},30);t.external('lights',{brightness:10});await sleep(70);
 assert.equal(q.status('lights').conflict,true);assert.equal(t.state.config.lights.brightness,10);assert.equal(t.calls.length,1);q.discard('lights');q.clear();
});
test('invalid intermediate typing stays local; a valid preset resumes automatically',async()=>{
 const t=setup(),q=t.q;q.edit('fan',{...q.draft('fan'),curve:[{temperature:0,level:2},{temperature:75,level:10}]},10);await sleep(25);
 assert.ok(q.status('fan').error);assert.equal(t.calls.length,0);
 q.edit('fan',initial().config.fan);await idle(q);assert.equal(t.calls.length,1);q.clear();
});
test('server failure is visible without a retry loop and edits persist across subscribers',async()=>{
 const t=setup({sendError:'I2C unavailable'}),q=t.q;const unsubscribe=q.subscribe(()=>{});
 q.edit('oled',{...q.draft('oled'),text:'queued'},20);unsubscribe();await sleep(80);
 assert.match(q.status('oled').error,/I2C/);assert.equal(t.calls.length,1);assert.equal(q.draft('oled').text,'queued');q.clear();
});
test('offline changes wait and apply once reconnected; stale snapshots are ignored',async()=>{
 const t=setup(),q=t.q;q.setConnected(false);q.edit('lights',{...q.draft('lights'),brightness:80});await sleep(25);assert.equal(t.calls.length,0);
 q.setConnected(true);await idle(q);q.accept(initial());assert.equal(q.state.version,2);assert.equal(q.draft('lights').brightness,80);q.clear();
});
