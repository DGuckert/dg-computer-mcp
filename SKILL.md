---
name: dg-computer
description: Control a Windows desktop through the DG Computer MCP server. Use only after the user has installed and authenticated their own client.
---

# DG Computer MCP

DG Computer MCP provides desktop-control tools to an MCP-compatible agent. The customer runs the MCP server locally on their Windows machine. A separate authenticated gateway client makes an outbound WebSocket connection to the DG Computer gateway for registration and online status.

## Accounts and ownership

- Every person signs in with an individual account. Accounts are created only from administrator-issued, one-time invitations.
- Each computer is registered to exactly one account. A user can list or revoke only computers owned by their account.
- The gateway derives the account identity from the authenticated account session; customer API requests cannot select another user's identity.
- Administrators have a separate management API and must never give customers the administrator token.
- Future remote command routing must authenticate the requesting account and verify that the target computer's `ownerUserId` matches that account before dispatch. A client ID or device secret alone must never grant an account permission to control a computer through a user-facing command API.

## Installation

Requirements: Windows 10/11, Node.js 20+, and an MCP-compatible client.

1. Sign in to https://computer.danielslefhosted.xyz/ using your individual account.
2. Select **Add a computer** and save the Client ID and Client Secret shown. The secret is shown once.
3. On the Windows computer being registered, run this in PowerShell and enter those credentials when prompted:

```powershell
curl.exe -fsSL https://computer.danielslefhosted.xyz/install.ps1 | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
```

The installer stores the client secret in a local `client.json` file with restricted user-level access and registers an automatic gateway connection at Windows logon.

After installation, merge the `mcpServers.dg-computer` entry from `%LOCALAPPDATA%\DGComputerMCP\mcp-config.json` into the MCP client's configuration, then restart that MCP client.

## Usage

Use the MCP tools exposed by the local server:

- `computer_get_state`, `computer_screenshot`
- `computer_move_mouse`, `computer_click`, `computer_scroll`
- `computer_type`, `computer_keypress`
- `computer_list_windows`, `computer_focus_window`, `computer_open_app`
- `computer_processes`, `computer_kill_process`
- `computer_read_file`, `computer_write_file`, `computer_list_dir`
- `computer_clipboard_get`, `computer_clipboard_set`
- `computer_powershell`, `computer_cmd`, `browser_open`, `browser_recent_downloads`

Shell execution, file writing, and process termination are disabled by default. Only enable these capabilities when the user explicitly requests them and understands the effect. Do not assume that access to the desktop grants permission to perform destructive actions, send messages, make purchases, or disclose private information.

## Connection and troubleshooting

The gateway client connects outbound to `wss://computer.danielslefhosted.xyz/v1/connect` using the device's Client ID and Secret. It reconnects automatically if the connection drops. The local MCP server continues to work when the gateway is temporarily unavailable. If authentication fails, sign in to the account and provision a replacement device credential; never attempt to bypass authentication.

## Security model and current limitations

Each device has a unique revocable identity and exactly one account owner. The gateway stores one-way hashes of account passwords and device secrets. Customer account sessions expire after eight hours. Account APIs scope device listing and revocation to the authenticated owner.

The gateway is currently an account, registration, authentication and presence service, not a remote desktop relay. It does not receive screenshots, keystrokes, file contents, shell commands or desktop-control requests; tool execution remains local. Never expose the local stdio MCP server directly to the public internet. Any future remote-control endpoint must enforce the same account-to-device ownership check before sending commands.
