import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import test from 'node:test';
import { issueHomeAssistantControlService } from '../calendar/home-assistant-client.ts';

function serverFrame(value:unknown){
  const body=Buffer.from(JSON.stringify(value));
  if(body.length<126)return Buffer.concat([Buffer.from([0x81,body.length]),body]);
  const header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(body.length,2);return Buffer.concat([header,body]);
}

function clientFrames(socket:Duplex,onMessage:(value:any)=>void){
  let buffer=Buffer.alloc(0);
  socket.on('data',(chunk)=>{
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=2){
      const first=buffer[0]!,second=buffer[1]!;let size=second&0x7f,offset=2;
      if(size===126){if(buffer.length<4)return;size=buffer.readUInt16BE(2);offset=4;}
      if(size===127||!(second&0x80))return;
      if(buffer.length<offset+4+size)return;
      const mask=buffer.subarray(offset,offset+4);offset+=4;const body=Buffer.from(buffer.subarray(offset,offset+size));buffer=buffer.subarray(offset+size);
      for(let index=0;index<body.length;index++)body[index]=body[index]!^mask[index%4]!;
      onMessage(JSON.parse(body.toString('utf8')));
    }
  });
}

async function syntheticPeer(authDelayMs:number){
  const frames:Array<Record<string,unknown>>=[];
  const peerSockets=new Set<Duplex>();
  const server=createServer();
  server.on('upgrade',(request:IncomingMessage,socket)=>{
    peerSockets.add(socket);socket.once('close',()=>peerSockets.delete(socket));
    const key=request.headers['sec-websocket-key'];assert.equal(typeof key,'string');
    const accept=createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(serverFrame({type:'auth_required'}));
    clientFrames(socket,(value)=>{
      if(value.type==='auth'){
        frames.push({type:'auth'});
        const timer=setTimeout(()=>{if(!socket.destroyed)socket.write(serverFrame({type:'auth_ok'}));},authDelayMs);socket.once('close',()=>clearTimeout(timer));
      }
      if(value.type==='call_service'){
        frames.push({type:'call_service',domain:value.domain,service:value.service,service_data:value.service_data});
        // HA may include unrelated states in this response. The application
        // control wrapper must discard the whole response.
        socket.write(serverFrame({id:value.id,type:'result',success:true,result:{changed_states:[{entity_id:'lock.private_front_door',state:'unlocked',attributes:{code:'secret'}}]}}));
      }
    });
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address() as AddressInfo;
  return{
    frames,
    config:{provider:'home_assistant' as const,source:'database' as const,revision:1,clientIdHash:'a'.repeat(64),clientId:'synthetic',origin:`http://127.0.0.1:${address.port}`},
    close:()=>new Promise<void>((resolve)=>{for(const socket of peerSockets)socket.destroy();server.close(()=>resolve());}),
  };
}

test('control service frame is not sent when websocket authentication outlives the reserved deadline',async()=>{
  const peer=await syntheticPeer(1500);
  const deadline={epochMs:Date.now()+1000,monotonicMs:performance.now()+1000};
  try{
    await assert.rejects(issueHomeAssistantControlService(peer.config,'synthetic-only-token','light.synthetic_porch','light.turn_on',deadline));
    assert.deepEqual(peer.frames.map((frame)=>frame.type),['auth'],'late auth cannot trigger a call_service frame');
    assert.equal(peer.frames.some((frame)=>frame.type==='call_service'),false);
  }finally{
    await peer.close();
  }
});

test('control transport sends only the fixed allowlisted entity payload and discards unrelated changed states',async()=>{
  const peer=await syntheticPeer(0);
  const deadline={epochMs:Date.now()+5000,monotonicMs:performance.now()+5000};
  try{
    const result=await issueHomeAssistantControlService(peer.config,'synthetic-only-token','light.synthetic_porch','light.turn_on',deadline);
    assert.equal(result,undefined,'HA response is not exposed to application callers');
    assert.deepEqual(peer.frames,[
      {type:'auth'},
      {type:'call_service',domain:'light',service:'turn_on',service_data:{entity_id:'light.synthetic_porch'}},
    ]);
    assert.equal(typeof result,'undefined','untrusted changed-state response is not returned');
    assert.equal(JSON.stringify(peer.frames).includes('lock.private_front_door'),false);
  }finally{
    await peer.close();
  }
});
