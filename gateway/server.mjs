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
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
if (!adminToken || adminToken.length < 32) throw new Error('DG_ADMIN_TOKEN must be set to a random value of at least 32 characters');
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
let saveQueue = Promise.resolve();
let db;
try { db = JSON.parse(await fs.readFile(dbFile, 'utf8')); } catch { db = {}; }
db.clients ||= {};
db.users ||= {};
db.invitations ||= {};
db.sessions ||= {};
const online = new Map();
const loginAttempts = new Map();
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const passwordHash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(obj)); };
const publicUser = u => ({ userId: u.userId, username: u.username, displayName: u.displayName, createdAt: u.createdAt, mustChangePassword: !!u.mustChangePassword, disabled: !!u.disabled });
function save() {
  const snapshot = JSON.stringify(db, null, 2);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const tmp = dbFile + '.tmp';
    await fs.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.rename(tmp, dbFile);
  });
  return saveQueue;
}
async function bodyJson(req, limit = 16384) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > limit) throw Object.assign(new Error('too_large'), { status: 413 }); }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function adminAuth(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') && safeEqual(hash(h.slice(7)), hash(adminToken));
}
function sessionUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const tokenHash = hash(h.slice(7));
  const session = db.sessions[tokenHash];
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  const user = db.users[session.userId];
  return user && !user.disabled ? user : null;
}
function createSession(user) {
  const token = randomToken();
  db.sessions[hash(token)] = { userId: user.userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
  return token;
}
function clientSummary(c) {
  const owner = c.ownerUserId ? db.users[c.ownerUserId] : null;
  return { clientId: c.clientId, label: c.label, createdAt: c.createdAt, revoked: !!c.revoked, online: online.has(c.clientId), lastSeen: c.lastSeen || null, platform: c.platform || null, hostname: c.hostname || null, version: c.version || null, ownerUsername: owner?.username || null, ownerUserId: c.ownerUserId || null };
}
function createClient(ownerUserId, label) {
  const clientId = 'dgc_' + crypto.randomBytes(12).toString('hex');
  const clientSecret = randomToken(32);
  db.clients[clientId] = { clientId, secretHash: hash(clientSecret), ownerUserId, label: String(label || 'Windows PC').slice(0, 80), createdAt: new Date().toISOString(), revoked: false };
  return { clientId, clientSecret, note: 'Save the secret now. It cannot be retrieved later.' };
}
function validPassword(p) { return typeof p === 'string' && p.length >= 12 && p.length <= 1024; }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, service: 'dg-computer-gateway', version: '2.1.0', online: online.size });
    if (req.method === 'GET' && u.pathname === '/install.ps1') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return res.end(await fs.readFile(path.join(projectRoot, 'install.ps1'))); }
    if (req.method === 'GET' && u.pathname === '/SKILL.md') { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); return res.end(await fs.readFile(path.join(projectRoot, 'SKILL.md'))); }
    if (req.method === 'GET' && u.pathname === '/source.zip') { res.writeHead(200, { 'content-type': 'application/zip', 'cache-control': 'no-store', 'content-disposition': 'attachment; filename=dg-computer-mcp.zip', 'x-content-type-options': 'nosniff' }); return res.end(await fs.readFile(path.join(root, 'releases', 'source.zip'))); }
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/account')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" }); return res.end(await fs.readFile(path.join(projectRoot, 'gateway', 'account.html'))); }

    // Account creation is invitation-only. There is intentionally no public open signup.
    if (req.method === 'POST' && u.pathname === '/v1/auth/register') {
      const input = await bodyJson(req);
      const username = String(input.username || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) return json(res, 400, { error: 'username must be 3-32 characters: letters, numbers, dot, dash or underscore' });
      if (!validPassword(input.password)) return json(res, 400, { error: 'password must be 12-1024 characters' });
      const invitation = db.invitations[hash(String(input.inviteCode || ''))];
      if (!invitation || invitation.usedAt || Date.parse(invitation.expiresAt) <= Date.now()) return json(res, 403, { error: 'invalid_or_expired_invitation' });
      if (Object.values(db.users).some(x => x.username === username)) return json(res, 409, { error: 'username_unavailable' });
      const userId = 'dgu_' + crypto.randomBytes(12).toString('hex');
      const salt = randomToken(16);
      const user = { userId, username, displayName: String(input.displayName || invitation.label || username).slice(0, 80), salt, passwordHash: passwordHash(input.password, salt), createdAt: new Date().toISOString(), mustChangePassword: false };
      db.users[userId] = user; invitation.usedAt = new Date().toISOString(); invitation.usedBy = userId;
      const token = createSession(user); await save();
      return json(res, 201, { token, expiresInSeconds: SESSION_TTL_MS / 1000, user: publicUser(user) });
    }
    if (req.method === 'POST' && u.pathname === '/v1/auth/login') {
      const forwardedIp = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ip = forwardedIp || req.socket.remoteAddress || 'unknown';
      const attempt = loginAttempts.get(ip) || { count: 0, start: Date.now() };
      if (Date.now() - attempt.start > 15 * 60 * 1000) { attempt.count = 0; attempt.start = Date.now(); }
      if (attempt.count >= 10) return json(res, 429, { error: 'too_many_attempts_try_again_later' });
      const input = await bodyJson(req);
      const username = String(input.username || '').trim().toLowerCase();
      const user = Object.values(db.users).find(x => x.username === username);
      const suppliedPassword = typeof input.password === 'string' ? input.password : '';
      const usablePassword = suppliedPassword.length <= 1024 ? suppliedPassword : 'invalid-overlong-password';
      const candidate = user ? passwordHash(usablePassword, user.salt) : passwordHash(usablePassword, 'fixed-invalid-user-salt');
      if (!user || user.disabled || suppliedPassword.length > 1024 || !safeEqual(candidate, user.passwordHash)) {
        attempt.count++; loginAttempts.set(ip, attempt);
        return json(res, 401, { error: 'invalid_credentials' });
      }
      loginAttempts.delete(ip);
      const token = createSession(user); await save();
      return json(res, 200, { token, expiresInSeconds: SESSION_TTL_MS / 1000, user: publicUser(user) });
    }

    // Admin-only management API. Never expose the admin token to customer browsers.
    if (u.pathname.startsWith('/v1/admin/')) {
      if (!adminAuth(req)) return json(res, 401, { error: 'admin_unauthorized' });
      if (req.method === 'POST' && u.pathname === '/v1/admin/invitations') {
        const input = await bodyJson(req);
        const code = randomToken(24);
        db.invitations[hash(code)] = { label: String(input.label || 'Customer').slice(0, 80), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(), usedAt: null };
        await save(); return json(res, 201, { inviteCode: code, expiresAt: db.invitations[hash(code)].expiresAt, note: 'Send this one-time code privately. It is shown only once.' });
      }
      if (req.method === 'POST' && u.pathname === '/v1/admin/users') {
        const input = await bodyJson(req);
        const username = String(input.username || '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) return json(res, 400, { error: 'invalid_username' });
        if (Object.values(db.users).some(x => x.username === username)) return json(res, 409, { error: 'username_unavailable' });
        const initialPassword = randomToken(18); const salt = randomToken(16); const userId = 'dgu_' + crypto.randomBytes(12).toString('hex');
        const user = { userId, username, displayName: String(input.displayName || username).slice(0, 80), salt, passwordHash: passwordHash(initialPassword, salt), createdAt: new Date().toISOString(), mustChangePassword: true };
        db.users[userId] = user; await save(); return json(res, 201, { user: publicUser(user), initialPassword, note: 'Password is shown once. The user must change it at first sign-in.' });
      }
      const userAction = u.pathname.match(/^\/v1\/admin\/users\/([A-Za-z0-9_.-]+)\/(reset-password|disable)$/);
      if (req.method === 'POST' && userAction) {
        const user = Object.values(db.users).find(x => x.username === userAction[1].toLowerCase());
        if (!user) return json(res, 404, { error: 'user_not_found' });
        if (userAction[2] === 'reset-password') {
          if (user.disabled) return json(res, 403, { error: 'account_disabled' });
          const initialPassword = randomToken(18); const salt = randomToken(16);
          user.salt = salt; user.passwordHash = passwordHash(initialPassword, salt); user.mustChangePassword = true;
          for (const [k, session] of Object.entries(db.sessions)) if (session.userId === user.userId) delete db.sessions[k];
          await save(); return json(res, 200, { username: user.username, initialPassword, note: 'Password is shown once. Existing sessions were revoked; the user must change it at next sign-in.' });
        }
        user.disabled = true;
        for (const c of Object.values(db.clients)) if (c.ownerUserId === user.userId) { c.revoked = true; online.get(c.clientId)?.close(4003, 'account_disabled'); online.delete(c.clientId); }
        for (const [k, session] of Object.entries(db.sessions)) if (session.userId === user.userId) delete db.sessions[k];
        await save(); return json(res, 200, { ok: true, username: user.username, disabled: true, devicesRevoked: true });
      }
      if (req.method === 'GET' && u.pathname === '/v1/admin/users') return json(res, 200, { users: Object.values(db.users).map(publicUser) });
      if (req.method === 'GET' && u.pathname === '/v1/admin/clients') return json(res, 200, { clients: Object.values(db.clients).map(clientSummary) });
      const assign = u.pathname.match(/^\/v1\/admin\/clients\/([A-Za-z0-9_-]+)\/assign$/);
      if (req.method === 'POST' && assign) {
        const c = db.clients[assign[1]]; if (!c) return json(res, 404, { error: 'not_found' });
        const input = await bodyJson(req); const owner = Object.values(db.users).find(x => x.username === String(input.username || '').toLowerCase());
        if (!owner) return json(res, 404, { error: 'user_not_found' });
        c.ownerUserId = owner.userId; await save(); return json(res, 200, { client: clientSummary(c) });
      }
      const adminRevoke = u.pathname.match(/^\/v1\/admin\/clients\/([A-Za-z0-9_-]+)\/revoke$/);
      if (req.method === 'POST' && adminRevoke) {
        const c = db.clients[adminRevoke[1]]; if (!c) return json(res, 404, { error: 'not_found' });
        c.revoked = true; online.get(c.clientId)?.close(4003, 'revoked'); online.delete(c.clientId); await save(); return json(res, 200, { ok: true, clientId: c.clientId, revoked: true });
      }
      return json(res, 404, { error: 'not_found' });
    }

    // Customer routes always derive identity from the account session, never from a supplied user ID.
    if (u.pathname.startsWith('/v1/me/')) {
      const user = sessionUser(req); if (!user) return json(res, 401, { error: 'account_authentication_required' });
      if (user.mustChangePassword && u.pathname !== '/v1/me/password') return json(res, 403, { error: 'password_change_required' });
      if (req.method === 'GET' && u.pathname === '/v1/me/clients') return json(res, 200, { clients: Object.values(db.clients).filter(c => c.ownerUserId === user.userId).map(clientSummary) });
      if (req.method === 'POST' && u.pathname === '/v1/me/clients') {
        const input = await bodyJson(req); const created = createClient(user.userId, input.label); await save(); return json(res, 201, created);
      }
      const revoke = u.pathname.match(/^\/v1\/me\/clients\/([A-Za-z0-9_-]+)\/revoke$/);
      if (req.method === 'POST' && revoke) {
        const c = db.clients[revoke[1]];
        if (!c || c.ownerUserId !== user.userId) return json(res, 404, { error: 'not_found' });
        c.revoked = true; online.get(c.clientId)?.close(4003, 'revoked'); online.delete(c.clientId); await save(); return json(res, 200, { ok: true, clientId: c.clientId, revoked: true });
      }
      if (req.method === 'POST' && u.pathname === '/v1/me/password') {
        const input = await bodyJson(req);
        if (!safeEqual(passwordHash(String(input.currentPassword || ''), user.salt), user.passwordHash)) return json(res, 403, { error: 'current_password_incorrect' });
        if (!validPassword(input.newPassword)) return json(res, 400, { error: 'new_password_must_be_12_to_1024_characters' });
        const salt = randomToken(16); user.salt = salt; user.passwordHash = passwordHash(input.newPassword, salt); user.mustChangePassword = false;
        for (const [k, s] of Object.entries(db.sessions)) if (s.userId === user.userId) delete db.sessions[k];
        const token = createSession(user); await save(); return json(res, 200, { token, expiresInSeconds: SESSION_TTL_MS / 1000, user: publicUser(user) });
      }
      return json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'POST' && u.pathname === '/v1/auth/logout') {
      const h = req.headers.authorization || ''; if (h.startsWith('Bearer ')) delete db.sessions[hash(h.slice(7))]; await save(); return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && u.pathname === '/v1/me') {
      const user = sessionUser(req); if (!user) return json(res, 401, { error: 'account_authentication_required' });
      return json(res, 200, { user: publicUser(user) });
    }
    // Legacy global client listing is now explicitly admin-only.
    if (u.pathname === '/v1/clients') {
      if (!adminAuth(req)) return json(res, 401, { error: 'admin_unauthorized' });
      if (req.method === 'GET') return json(res, 200, { clients: Object.values(db.clients).map(clientSummary) });
      return json(res, 405, { error: 'method_not_allowed_use_account_dashboard' });
    }
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.status ? e.message : 'internal_error' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/v1/connect') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  let clientId = null, authenticated = false;
  const timer = setTimeout(() => { if (!authenticated) ws.close(4001, 'auth_timeout'); }, 8000);
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { ws.close(4002, 'invalid_json'); return; }
    if (!authenticated) {
      if (msg.type !== 'auth' || typeof msg.clientId !== 'string' || typeof msg.clientSecret !== 'string') { ws.close(4001, 'auth_required'); return; }
      const c = db.clients[msg.clientId];
      if (!c || c.revoked || !c.ownerUserId || !db.users[c.ownerUserId] || db.users[c.ownerUserId].disabled || !safeEqual(c.secretHash, hash(msg.clientSecret))) { ws.close(4003, 'invalid_credentials_or_unowned_device'); return; }
      clientId = c.clientId; authenticated = true; clearTimeout(timer);
      const previous = online.get(clientId); if (previous && previous !== ws) previous.close(4004, 'replaced');
      online.set(clientId, ws); c.lastSeen = new Date().toISOString(); c.hostname = String(msg.hostname || '').slice(0, 128); c.platform = String(msg.platform || '').slice(0, 64); c.version = String(msg.version || '').slice(0, 32); await save();
      ws.send(JSON.stringify({ type: 'authenticated', clientId, heartbeatSeconds: 30 })); return;
    }
    if (msg.type === 'heartbeat') { const c = db.clients[clientId]; if (c) { c.lastSeen = new Date().toISOString(); await save(); } ws.send(JSON.stringify({ type: 'heartbeat_ack', at: Date.now() })); }
  });
  ws.on('close', () => { clearTimeout(timer); if (clientId && online.get(clientId) === ws) online.delete(clientId); });
  ws.on('error', () => {});
});
server.listen(port, '127.0.0.1', () => console.log(`DG Computer gateway listening on 127.0.0.1:${port}`));
