const base = process.env.DG_GATEWAY_URL || 'http://127.0.0.1:8422';
const token = process.env.DG_ADMIN_TOKEN;
if (!token) { console.error('Set DG_ADMIN_TOKEN first'); process.exit(1); }
const [cmd, arg1, arg2] = process.argv.slice(2);
async function req(path, method = 'GET', body) {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); if (!r.ok) throw Error(JSON.stringify(d)); return d;
}
try {
  if (cmd === 'invite') console.log(JSON.stringify(await req('/v1/admin/invitations', 'POST', { label: arg1 || 'Customer' }), null, 2));
  else if (cmd === 'create-user' && arg1) console.log(JSON.stringify(await req('/v1/admin/users', 'POST', { username: arg1, displayName: arg2 || arg1 }), null, 2));
  else if (cmd === 'reset-password' && arg1) console.log(JSON.stringify(await req(`/v1/admin/users/${encodeURIComponent(arg1)}/reset-password`, 'POST', {}), null, 2));
  else if (cmd === 'disable-user' && arg1) console.log(JSON.stringify(await req(`/v1/admin/users/${encodeURIComponent(arg1)}/disable`, 'POST', {}), null, 2));
  else if (cmd === 'users') console.log(JSON.stringify(await req('/v1/admin/users'), null, 2));
  else if (cmd === 'clients') console.log(JSON.stringify(await req('/v1/admin/clients'), null, 2));
  else if (cmd === 'assign' && arg1 && arg2) console.log(JSON.stringify(await req(`/v1/admin/clients/${encodeURIComponent(arg1)}/assign`, 'POST', { username: arg2 }), null, 2));
  else if (cmd === 'revoke' && arg1) console.log(JSON.stringify(await req(`/v1/admin/clients/${encodeURIComponent(arg1)}/revoke`, 'POST', {}), null, 2));
  else {
    console.log('Usage:');
    console.log('  node scripts/admin.mjs invite <label>');
    console.log('  node scripts/admin.mjs create-user <username> [displayName]');
    console.log('  node scripts/admin.mjs reset-password <username>');
    console.log('  node scripts/admin.mjs disable-user <username>');
    console.log('  node scripts/admin.mjs users');
    console.log('  node scripts/admin.mjs clients');
    console.log('  node scripts/admin.mjs assign <clientId> <username>');
    console.log('  node scripts/admin.mjs revoke <clientId>');
    process.exit(2);
  }
} catch (e) { console.error(e.message); process.exit(1); }
