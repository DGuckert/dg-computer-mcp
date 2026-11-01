# DG Computer MCP

A Model Context Protocol (MCP) server that exposes Windows desktop-control tools to a trusted MCP client over standard input/output (stdio).

## Features

- Capture screenshots and inspect the active window
- Move, click and scroll the mouse; type text and send key presses
- List and focus application windows
- Open applications and URLs
- Inspect processes and optionally terminate them
- Read and write UTF-8 files
- Run PowerShell and Command Prompt commands when explicitly enabled
- Read and set the clipboard

## Requirements

- Windows 10 or later
- Node.js 20 or later
- An MCP-compatible client

## Setup

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Copy `config.example.json` to `config.json` if you want to change the defaults.
4. Configure your MCP client to launch `node /absolute/path/to/index.mjs` using the stdio transport.

Example MCP client configuration (adjust the path for your machine):

```json
{
  "mcpServers": {
    "dg-computer": {
      "command": "node",
      "args": ["C:/path/to/DGComputerMCP/index.mjs"]
    }
  }
}
```

## Security

**This server can control your Windows session. Only connect it to MCP clients and models you trust.** Mouse and keyboard tools can interact with open applications, and the file, clipboard, process, and command tools can access or change data on the host.

For safety, shell execution, file writing, and process termination are disabled by default. To enable an individual capability, set its corresponding value to `true` in a local `config.json`. Do not commit that local file. For example:

```json
{
  "allowShell": true,
  "allowFileWrite": false,
  "allowProcessKill": false
}
```

This server uses stdio and does not implement its own network listener or authentication layer. Do not expose it through an unauthenticated network bridge.

## License

No license has been specified yet. All rights are reserved by default.
