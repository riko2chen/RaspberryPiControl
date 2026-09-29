import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localDeviceUrl} from '../frontend/src/device-selection.ts';

test('switching to demo keeps the host and unrelated parameters, and returns to device selection',()=>{
 const url=localDeviceUrl('https://pi.local:8443/?theme=dark#overview',true);
 assert.equal(url,'https://pi.local:8443/?theme=dark&device=demo#devices');
 assert.equal(localDeviceUrl(url,false),'https://pi.local:8443/?theme=dark#devices');
});
test('selecting a local device never carries an earlier page or remote address into navigation',()=>{
 assert.equal(localDeviceUrl('http://localhost:8080/?device=demo#oled',false),'http://localhost:8080/#devices');
 assert.equal(localDeviceUrl('http://localhost:8080/?device=demo#devices',true),'http://localhost:8080/?device=demo#devices');
});

test('remote connection retains the original console through reload, demo mode and another device',async()=>{
 const {remoteDeviceUrl,controllerUrl}=await import('../frontend/src/device-selection.ts');
 const hub='http://127.0.0.1:8080/#devices';
 const real=remoteDeviceUrl('http://192.168.1.50:8080',hub);
 assert.equal(new URL(real).origin,'http://192.168.1.50:8080');
 assert.equal(controllerUrl(real),hub);
 assert.equal(controllerUrl(localDeviceUrl(real,true)),hub);
 assert.equal(controllerUrl(localDeviceUrl(localDeviceUrl(real,true),false)),hub);
 assert.equal(controllerUrl(remoteDeviceUrl('http://100.100.1.2:8080',real)),hub);
 assert.equal(controllerUrl(remoteDeviceUrl(hub,real)),null);
});
test('return navigation rejects public sites, credentials, executable URLs, paths and self loops',async()=>{
 const {controllerUrl}=await import('../frontend/src/device-selection.ts');
 for(const unsafe of ['https://example.com','javascript:alert(1)','http://user:pass@localhost:8080','http://localhost:8080/admin','http://localhost:8080/?token=secret','http://192.168.1.50:8080']){
  assert.equal(controllerUrl('http://192.168.1.50:8080/?controller='+encodeURIComponent(unsafe)),null);
 }
});
