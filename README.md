# DG Computer MCP

Generic Windows desktop-control MCP server with administrator-provisioned accounts and per-account device ownership. Customers do not need an account website or dashboard.

## Components

- `index.mjs`: original local MCP server. Desktop actions execute on the Windows machine.
- `client/agent.mjs`: outbound authenticated WebSocket client. Reports online status and heartbeats to the gateway.
- `gateway/server.mjs`: account authentication, device ownership, presence and revocation service.
- `scripts/admin.mjs`: administrator CLI for account and device provisioning.
- `SKILL.md`: generic agent skill and installation instructions.

## Customer onboarding (no customer website)

The administrator creates an account and one or more devices from DGSERVER. The customer receives their account username/password, device Client ID/Secret, and the one-line Windows installer command. They do not visit a website, create their own account, or access the administrator API.

```bash
export DG_ADMIN_TOKEN='the-server-admin-token'
node scripts/admin.mjs create-user customer01 "Customer Name"
node scripts/admin.mjs create-device customer01 "Customer Windows PC"
```

Both commands print generated credentials once. Send account and device credentials privately. The device Client ID/Secret is entered into the installer on the Windows PC. The account is the ownership boundary recorded by the gateway; the device credential authenticates only that one installation.

## Administrator commands

```bash
node scripts/admin.mjs users
node scripts/admin.mjs clients
node scripts/admin.mjs reset-password customer01
node scripts/admin.mjs disable-user customer01
node scripts/admin.mjs assign dgc_CLIENTID customer01
node scripts/admin.mjs revoke dgc_CLIENTID
```

`reset-password` rotates the account password and invalidates its sessions. `disable-user` prevents account login, invalidates sessions and revokes every device belonging to the account. `assign` transfers an existing device to an account. `revoke` disables one device credential.

## Windows installation

Send the customer this command. They run it in PowerShell and enter the Client ID and Client Secret supplied by the administrator:

```powershell
curl.exe -fsSL https://computer.danielslefhosted.xyz/install.ps1 | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
```

The installer downloads the source bundle, installs dependencies, writes local device credentials, creates an MCP configuration snippet and registers a per-user scheduled task for the gateway connection. They then merge the generated MCP configuration into their MCP application's configuration.

## Isolation and current limitations

- Every account owns its own registered devices.
- The administrator is the only party who can create accounts and provision devices.
- Customer device credentials are unique per installation; they do not grant access to other devices.
- The global administrator token is never given to customers.
- Public signup and the customer account website/dashboard are not provided.
- The gateway currently handles account identity, device authentication, presence and revocation. It does not yet proxy desktop-control traffic. Any future command relay must authenticate the requesting account and verify that the target device belongs to it before dispatch.
- Screenshots, keystrokes, files, clipboard data and shell commands remain local to each Windows MCP process. Never expose the local stdio MCP server directly to the public internet.

## Gateway deployment

Node.js 20+ is required. The gateway binds to `127.0.0.1` by default and should run under systemd behind TLS termination or Cloudflare Tunnel. Store `DG_ADMIN_TOKEN` in a protected environment file. The JSON database should be readable only by the gateway service account.

```bash
DG_ADMIN_TOKEN="$(openssl rand -hex 32)" DG_PORT=8422 node gateway/server.mjs
```

## Safety defaults

Shell execution, file writes and process termination are disabled by default. The local MCP server uses stdio. Never expose it directly to the internet.
