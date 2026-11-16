---
name: dg-computer
description: Control a Windows desktop through the DG Computer MCP server. Use only after the administrator has provisioned an account and device for the customer.
---

# DG Computer MCP

DG Computer MCP provides desktop-control tools to an MCP-compatible agent. The customer runs the MCP server locally on their Windows machine. A separate authenticated gateway client makes an outbound WebSocket connection to the DG Computer gateway for registration and online status.

## Customer onboarding

Customers do not need a website or web dashboard. The administrator creates an account and a device from the server CLI, then privately provides the customer with:

- Their account username and password
- Their device Client ID and Client Secret
- The PowerShell installer command below

Each device is assigned to exactly one account. Device credentials authenticate only that installation. They are not administrator credentials and do not grant access to other users' devices.

Run this on the customer's Windows PC in PowerShell and enter the supplied Client ID and Client Secret when prompted:

```powershell
curl.exe -fsSL https://computer.danielslefhosted.xyz/install.ps1 | powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -
```

The installer stores the device secret in a local `client.json` file with restricted user-level access and registers an automatic gateway connection at Windows logon.

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

## Security model and current limitations

Each device has a unique revocable identity and exactly one account owner. The gateway stores one-way hashes of account passwords and device secrets. The global administrator token is not a customer credential. Customer-facing account creation and device provisioning are not public; only the administrator can provision accounts and devices.

The gateway is currently an account, device-registration, authentication and presence service, not a remote desktop relay. It does not receive screenshots, keystrokes, file contents, shell commands or desktop-control requests; tool execution remains local. Any future remote-control endpoint must authenticate the requesting account and verify that the target device belongs to it before sending commands. Never expose the local stdio MCP server directly to the public internet.
