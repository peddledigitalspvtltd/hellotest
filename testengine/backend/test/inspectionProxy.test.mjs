import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createInspectionProxy } from '../dist/lib/inspectionProxy.js';

test('inspection proxy reuses keepalive sockets without accumulating listeners and closes tracked connections', {timeout:15000},async t=>{
 const previous=process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;process.env.RECORDER_ALLOWED_PRIVATE_HOSTS='127.0.0.1';
 const warnings=[],originSockets=new Set(),originPorts=new Set(),upstreamTimeouts=[];let requests=0,proxyClosed=false;
 const onWarning=warning=>{if(warning.name==='MaxListenersExceededWarning')warnings.push(warning);};process.on('warning',onWarning);
 const origin=http.createServer((request,response)=>{requests++;originPorts.add(request.socket.remotePort);for(const socket of Object.values(http.globalAgent.sockets).flat())if(socket.remotePort===origin.address().port)upstreamTimeouts.push(socket.timeout);assert.equal(request.headers['proxy-authorization'],undefined);response.setHeader('content-type','application/json');response.end(JSON.stringify({path:request.url}));});
 origin.on('connection',socket=>{originSockets.add(socket);socket.once('close',()=>originSockets.delete(socket));});
 await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
 const proxy=await createInspectionProxy(),proxyUrl=new URL(proxy.server),client=new http.Agent({keepAlive:true,maxSockets:1});
 t.after(async()=>{process.off('warning',onWarning);client.destroy();if(!proxyClosed)await proxy.close();for(const socket of originSockets)socket.destroy();await new Promise(resolve=>origin.close(resolve));if(previous===undefined)delete process.env.RECORDER_ALLOWED_PRIVATE_HOSTS;else process.env.RECORDER_ALLOWED_PRIVATE_HOSTS=previous;});
 const request=index=>new Promise((resolve,reject)=>{
  const target=`http://127.0.0.1:${origin.address().port}/resource?index=${index}`;
  const pending=http.get({host:proxyUrl.hostname,port:proxyUrl.port,path:target,agent:client,headers:{'proxy-authorization':'Bearer disposable-fixture'}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.once('end',()=>{try{assert.equal(response.statusCode,200);resolve(JSON.parse(body));}catch(error){reject(error);}});response.once('error',reject);});
  pending.once('error',reject);pending.setTimeout(3000,()=>pending.destroy(new Error('Fixture proxy request timed out')));
 });
 for(let index=0;index<28;index++){assert.deepEqual(await request(index),{path:`/resource?index=${index}`});await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(requests,28);assert.ok(originPorts.size<4,`The regression must exercise reused upstream sockets; observed ${originPorts.size} connections`);
 assert.equal(warnings.length,0,'tracking a reused socket must not add another timeout/close listener');
 assert.equal(upstreamTimeouts.length,28);assert.ok(upstreamTimeouts.every(timeout=>timeout===60000),'reuse must rearm the existing60s timeout without adding listeners; the keepalive pool otherwise lowers it to a few seconds');
 const idleClientSockets=Object.values(client.freeSockets).flat(),idleOriginSockets=[...originSockets];assert.ok(idleClientSockets.length>0);assert.ok(idleOriginSockets.length>0);
 const closed=Promise.all([...idleClientSockets,...idleOriginSockets].map(socket=>socket.destroyed?Promise.resolve():once(socket,'close')));
 await proxy.close();proxyClosed=true;await closed;
 assert.ok(idleClientSockets.every(socket=>socket.destroyed));assert.ok(idleOriginSockets.every(socket=>socket.destroyed));
 await assert.rejects(request('after-close'),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code));
});
