import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const dataDir = process.env.DG_DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataDir, 'clients.json');
const port = Number(process.env.DG_PORT || 8422);
const adminToken = process.env.DG_ADMIN_TOKEN;
if (!adminToken || adminToken.length < 32) throw new Error('DG_ADMIN_TOKEN must be set to a random value of at least 32 characters');
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
let db;
try { db = JSON.parse(await fs.readFile(dbFile, 'utf8')); } catch { db = { clients: {} }; }
const online = new Map();
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && crypto.timingSafeEqual(x,y); };
async function save(){ const tmp=dbFile+'.tmp'; await fs.writeFile(tmp, JSON.stringify(db,null,2), {mode:0o600}); await fs.rename(tmp,dbFile); }
function json(res, code, obj){ res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(obj)); }
function auth(req){ const h=req.headers.authorization||''; return h.startsWith('Bearer ') && safeEqual(hash(h.slice(7)), hash(adminToken)); }
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET' && u.pathname==='/health'){ return json(res,200,{ok:true,service:'dg-computer-gateway',version:'2.0.0',online:online.size}); }
  if(req.method==='GET' && u.pathname==='/install.ps1'){res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});return res.end(await fs.readFile(path.join(projectRoot,'install.ps1')));}
  if(req.method==='GET' && u.pathname==='/SKILL.md'){res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','cache-control':'no-store'});return res.end(await fs.readFile(path.join(projectRoot,'SKILL.md')));}
  if(req.method==='GET' && u.pathname==='/source.zip'){res.writeHead(200,{'content-type':'application/zip','cache-control':'no-store','content-disposition':'attachment; filename=dg-computer-mcp.zip'});return res.end(await fs.readFile(path.join(root,'releases','source.zip')));}
  if(req.method==='GET' && u.pathname==='/'){return json(res,200,{name:'DG Computer Gateway',version:'2.0.0',health:'/health',installer:'/install.ps1',skill:'/SKILL.md'});}
  if(!auth(req)) return json(res,401,{error:'unauthorized'});
  if(req.method==='GET' && u.pathname==='/v1/clients'){
    return json(res,200,{clients:Object.values(db.clients).map(c=>({clientId:c.clientId,label:c.label,createdAt:c.createdAt,revoked:c.revoked,online:online.has(c.clientId),lastSeen:c.lastSeen||null,platform:c.platform||null,hostname:c.hostname||null,version:c.version||null}))});
  }
  if(req.method==='POST' && u.pathname==='/v1/clients'){
    let body=''; for await(const chunk of req){body+=chunk;if(body.length>8192) return json(res,413,{error:'too_large'});}
    let input; try{input=JSON.parse(body||'{}')}catch{return json(res,400,{error:'invalid_json'});}
    const clientId='dgc_'+crypto.randomBytes(12).toString('hex');
    const clientSecret=crypto.randomBytes(32).toString('base64url');
    db.clients[clientId]={clientId,secretHash:hash(clientSecret),label:String(input.label||'').slice(0,80),createdAt:new Date().toISOString(),revoked:false};
    await save(); return json(res,201,{clientId,clientSecret,note:'Save the secret now. It cannot be retrieved later.'});
  }
  const m=u.pathname.match(/^\/v1\/clients\/([A-Za-z0-9_-]+)\/revoke$/);
  if(req.method==='POST' && m){const c=db.clients[m[1]];if(!c)return json(res,404,{error:'not_found'});c.revoked=true;online.get(m[1])?.close(4003,'revoked');online.delete(m[1]);await save();return json(res,200,{ok:true,clientId:m[1],revoked:true});}
  return json(res,404,{error:'not_found'});
});
const wss=new WebSocketServer({noServer:true,maxPayload:16*1024});
server.on('upgrade',(req,socket,head)=>{if(new URL(req.url,'http://localhost').pathname!=='/v1/connect'){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',(ws)=>{
  let clientId=null, authenticated=false;
  const timer=setTimeout(()=>{if(!authenticated)ws.close(4001,'auth_timeout');},8000);
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(raw.toString())}catch{ws.close(4002,'invalid_json');return;}
    if(!authenticated){
      if(msg.type!=='auth'||typeof msg.clientId!=='string'||typeof msg.clientSecret!=='string'){ws.close(4001,'auth_required');return;}
      const c=db.clients[msg.clientId];
      if(!c||c.revoked||!safeEqual(c.secretHash,hash(msg.clientSecret))){ws.close(4003,'invalid_credentials');return;}
      clientId=c.clientId; authenticated=true;clearTimeout(timer);
      const previous=online.get(clientId); if(previous&&previous!==ws)previous.close(4004,'replaced');
      online.set(clientId,ws); c.lastSeen=new Date().toISOString(); c.hostname=String(msg.hostname||'').slice(0,128); c.platform=String(msg.platform||'').slice(0,64); c.version=String(msg.version||'').slice(0,32); await save();
      ws.send(JSON.stringify({type:'authenticated',clientId,heartbeatSeconds:30})); return;
    }
    if(msg.type==='heartbeat'){const c=db.clients[clientId];if(c){c.lastSeen=new Date().toISOString();await save();}ws.send(JSON.stringify({type:'heartbeat_ack',at:Date.now()}));}
  });
  ws.on('close',()=>{clearTimeout(timer);if(clientId&&online.get(clientId)===ws)online.delete(clientId);});
  ws.on('error',()=>{});
});
server.listen(port,'127.0.0.1',()=>console.log(`DG Computer gateway listening on 127.0.0.1:${port}`));
