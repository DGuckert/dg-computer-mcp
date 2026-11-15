import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configPath=path.join(root,'client.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let cfg; try{cfg=JSON.parse(await fs.readFile(configPath,'utf8'));}catch{console.error('[DG Computer] client.json missing; gateway registration disabled');process.exit(0);}
if(!cfg.serverUrl||!cfg.clientId||!cfg.clientSecret){console.error('[DG Computer] incomplete client.json');process.exit(1);}
let stopping=false, activeSocket=null;
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stopping=true;activeSocket?.close();});
let delay=1000;
while(!stopping){
  try{
    await new Promise((resolve,reject)=>{
      const ws=new WebSocket(cfg.serverUrl,{handshakeTimeout:10000});activeSocket=ws;let authed=false,heartbeat;
      const done=()=>{clearInterval(heartbeat);resolve();};
      ws.on('open',()=>ws.send(JSON.stringify({type:'auth',clientId:cfg.clientId,clientSecret:cfg.clientSecret,hostname:os.hostname(),platform:`${os.platform()} ${os.release()}`,version:'2.1.0'})));
      ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return;}
        if(m.type==='authenticated'){authed=true;delay=1000;console.error(`[DG Computer] authenticated with gateway as ${m.clientId}`);heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'heartbeat'}));},(m.heartbeatSeconds||30)*1000);}
      });
      ws.on('error',e=>{if(!authed)reject(e);});
      ws.on('close',()=>{if(!authed)reject(new Error('gateway connection closed before authentication'));else done();});
    });
  }catch(e){console.error(`[DG Computer] gateway unavailable: ${e.message}`);}
  activeSocket=null;
  if(!stopping){await sleep(delay);delay=Math.min(delay*2,60000);}
}
