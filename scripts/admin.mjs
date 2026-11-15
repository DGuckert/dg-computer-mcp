import crypto from 'node:crypto';
const base=process.env.DG_GATEWAY_URL||'http://127.0.0.1:8422';
const token=process.env.DG_ADMIN_TOKEN;
if(!token){console.error('Set DG_ADMIN_TOKEN first');process.exit(1);}
const [cmd,arg]=process.argv.slice(2);
async function req(path,method='GET',body){const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;}
try{
 if(cmd==='create'){const d=await req('/v1/clients','POST',{label:arg||'Client'});console.log(JSON.stringify(d,null,2));}
 else if(cmd==='list')console.log(JSON.stringify(await req('/v1/clients'),null,2));
 else if(cmd==='revoke'&&arg)console.log(JSON.stringify(await req(`/v1/clients/${encodeURIComponent(arg)}/revoke`,'POST',{}),null,2));
 else {console.log('Usage: node scripts/admin.mjs create <label> | list | revoke <clientId>');process.exit(2);}
}catch(e){console.error(e.message);process.exit(1);}
