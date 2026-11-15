# DG Computer MCP

Generic Windows desktop-control MCP server with per-installation authenticated gateway registration.

## Components

- `index.mjs`: local MCP server. Desktop actions execute on the Windows machine.
- `client/agent.mjs`: outbound authenticated WebSocket client. Reports online status and heartbeats to the gateway.
- `gateway/server.mjs`: central registration, authentication, presence, and revocation service.
- `scripts/admin.mjs`: administrator CLI for provisioning and revoking client credentials.
- `SKILL.md`: generic agent skill and installation instructions.

The gateway does not proxy desktop-control traffic. Screenshots, keystrokes, files, clipboard data, and shell commands remain local to the Windows client.

## Gateway deployment

Node.js 20+ is required.

```bash
cd gateway
DG_ADMIN_TOKEN="$(openssl rand -hex 32)" DG_PORT=8422 node server.mjs
```

For production, store `DG_ADMIN_TOKEN` in a root-readable environment file and run the gateway under systemd behind a TLS reverse proxy or Cloudflare Tunnel. The gateway binds to `127.0.0.1` by default.

Set `DG_ADMIN_TOKEN` when using the admin CLI:

```bash
export DG_ADMIN_TOKEN='the-same-admin-token'
node scripts/admin.mjs create "Customer or installation label"
node scripts/admin.mjs list
node scripts/admin.mjs revoke dgc_CLIENTID
```

Creation returns a Client ID and a one-time Client Secret. Deliver these to the client securely. Secrets are stored only as SHA-256 hashes on the gateway.

## Windows client installation

Use PowerShell and provide the client credentials when prompted:

```powershell
curl.exe -fsSL https://computer.danielslefhosted.xyz/install.ps1 | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
```

The installer downloads the repository, installs dependencies, writes local client credentials, creates an MCP configuration snippet, and registers a per-user scheduled task for the gateway connection.

## Local development

```bash
npm ci
npm start
```

## Safety defaults

Shell execution, file writes, and process termination are disabled by default. The local MCP server uses stdio. Never expose it directly to the internet.
