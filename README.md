# DG Computer MCP

Generic Windows desktop-control MCP server with invitation-only customer accounts and per-account device ownership.

## Components

- `index.mjs`: local MCP server. Desktop actions execute on the Windows machine.
- `client/agent.mjs`: outbound authenticated WebSocket client. Reports online status and heartbeats to the gateway.
- `gateway/server.mjs`: account authentication, invitation redemption, device ownership, presence and revocation service.
- `gateway/account.html`: customer account and device-management page.
- `scripts/admin.mjs`: administrator CLI for invitations, account provisioning and device administration.
- `SKILL.md`: generic agent skill and installation instructions.

## Customer workflow

1. Administrator creates a one-time invitation: `node scripts/admin.mjs invite "Customer name"`.
2. Customer visits `https://computer.danielslefhosted.xyz/`, redeems the invitation and creates a username/password.
3. Customer signs in and selects **Add a computer**. The gateway issues a Client ID and one-time Client Secret belonging to that account.
4. Customer runs the PowerShell installer on that Windows PC and enters those device credentials.
5. The account page lists only that account's computers and can revoke only those devices.

Accounts are invitation-only. Do not give customers the global administrator token. Admin operations are separate from customer account APIs.

## Administrator commands

```bash
export DG_ADMIN_TOKEN='the-server-admin-token'
node scripts/admin.mjs invite "Customer label"
node scripts/admin.mjs create-user owner "Account Owner"
node scripts/admin.mjs users
node scripts/admin.mjs clients
node scripts/admin.mjs assign dgc_CLIENTID owner
node scripts/admin.mjs revoke dgc_CLIENTID
```

`invite` returns a one-time code valid for seven days. `create-user` is for bootstrapping or administrator-created accounts and returns a temporary password shown once; the user must change it after signing in. `assign` is for migrating an existing device to an account. `reset-password` revokes the user's sessions and forces a password change. `disable-user` disables login and revokes all of that user's devices. Customer device creation is done from the account page.

## Gateway deployment

Node.js 20+ is required.

```bash
DG_ADMIN_TOKEN="$(openssl rand -hex 32)" DG_PORT=8422 node gateway/server.mjs
```

For production, store `DG_ADMIN_TOKEN` in a protected environment file and run the gateway under systemd behind TLS termination or Cloudflare Tunnel. The gateway binds to `127.0.0.1` by default. The JSON database should be readable only by the gateway service account.

## Windows installation

After signing in and creating a device in the customer account page, run this in PowerShell:

```powershell
curl.exe -fsSL https://computer.danielslefhosted.xyz/install.ps1 | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
```

The installer downloads the source, installs dependencies, writes local device credentials, creates an MCP configuration snippet and registers a per-user scheduled task for the gateway connection.

## Isolation and current limitations

- User-facing device APIs derive the account from its authenticated session; requests cannot specify another user's account ID.
- A customer can list, create and revoke only devices whose `ownerUserId` matches their account.
- Device WebSocket authentication rejects unowned devices.
- The global admin token is not a customer credential.
- The gateway does not currently proxy desktop-control traffic. Screenshots, keystrokes, files, clipboard data and shell commands remain local to each Windows MCP process. Any future command relay must check account ownership before dispatch.

## Safety defaults

Shell execution, file writes and process termination are disabled by default. The local MCP server uses stdio. Never expose it directly to the internet.
