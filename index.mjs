import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

const server = new McpServer({ name: "dg-computer", version: "1.0.0" });
const root = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
let cfg = { allowShell: false, allowFileWrite: false, allowProcessKill: false };
try {
  cfg = {
    ...cfg,
    ...JSON.parse(fsSync.readFileSync(path.join(root, "config.json"), "utf8")),
  };
} catch {}

const run = (exe, args, timeout = 20000) =>
  new Promise((res, rej) => {
    const p = spawn(exe, args, { windowsHide: true });
    let out = "",
      err = "";
    const t = setTimeout(() => {
      p.kill();
      rej(new Error(`timeout ${timeout}ms`));
    }, timeout);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(t);
      rej(e);
    });
    p.on("close", (c) => {
      clearTimeout(t);
      c === 0 ? res(out.trim()) : rej(new Error(err.trim() || `exit ${c}`));
    });
  });
const ps = (s, t = 20000, sta = false) =>
  run(
    "powershell.exe",
    [
      "-NoProfile",
      ...(sta ? ["-STA"] : []),
      "-EncodedCommand",
      Buffer.from(s, "utf16le").toString("base64"),
    ],
    t,
  );
const ok = (x) => ({
  content: [
    {
      type: "text",
      text: typeof x === "string" ? x : JSON.stringify(x, null, 2),
    },
  ],
});
const bad = (e) => ({
  isError: true,
  content: [{ type: "text", text: String(e?.message || e) }],
});
async function shot() {
  const f = path.join(os.tmpdir(), `dgmcp-${Date.now()}.png`);
  const s = `Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;$i=New-Object Drawing.Bitmap $b.Width,$b.Height;$g=[Drawing.Graphics]::FromImage($i);$g.CopyFromScreen($b.Left,$b.Top,0,0,$i.Size);$i.Save('${f.replace(/'/g, "''")}',[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$i.Dispose();Write-Output ($b.Left.ToString()+','+$b.Top.ToString()+','+$b.Width.ToString()+','+$b.Height.ToString())`;
  const m = (await ps(s, 30000)).split(",").map(Number),
    data = (await fs.readFile(f)).toString("base64");
  await fs.unlink(f).catch(() => {});
  return { left: m[0], top: m[1], width: m[2], height: m[3], data };
}
server.registerTool(
  "computer_screenshot",
  { description: "Capture the full Windows virtual desktop.", inputSchema: {} },
  async () => {
    try {
      let s = await shot();
      return {
        content: [
          {
            type: "text",
            text: `${s.width}x${s.height} origin ${s.left},${s.top}`,
          },
          { type: "image", data: s.data, mimeType: "image/png" },
        ],
      };
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_get_state",
  {
    description:
      "Active window, cursor, windows, screen geometry and screenshot.",
    inputSchema: {},
  },
  async () => {
    try {
      const s = `Add-Type @"\nusing System;using System.Text;using System.Runtime.InteropServices;public class U{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern bool GetCursorPos(out P p);public struct P{public int X;public int Y;}}\n"@;Add-Type -AssemblyName System.Windows.Forms;$h=[U]::GetForegroundWindow();$b=New-Object Text.StringBuilder 1024;[void][U]::GetWindowText($h,$b,1024);$p=New-Object U+P;[void][U]::GetCursorPos([ref]$p);$v=[Windows.Forms.SystemInformation]::VirtualScreen;$w=Get-Process|?{$_.MainWindowHandle-ne 0}|select -First 60 Id,ProcessName,MainWindowTitle;[pscustomobject]@{activeWindow=$b.ToString();cursor=@($p.X,$p.Y);screen=@{left=$v.Left;top=$v.Top;width=$v.Width;height=$v.Height};windows=$w}|ConvertTo-Json -Depth 4 -Compress`;
      const state = JSON.parse(await ps(s)),
        im = await shot();
      return {
        content: [
          { type: "text", text: JSON.stringify(state, null, 2) },
          { type: "image", data: im.data, mimeType: "image/png" },
        ],
      };
    } catch (e) {
      return bad(e);
    }
  },
);
const XY = { x: z.number().int(), y: z.number().int() };
server.registerTool(
  "computer_move_mouse",
  { description: "Move mouse to absolute coordinates.", inputSchema: XY },
  async ({ x, y }) => {
    try {
      await ps(
        `Add-Type 'using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);}';[M]::SetCursorPos(${x},${y})|Out-Null`,
      );
      return ok(`moved ${x},${y}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_click",
  {
    description: "Click at absolute coordinates.",
    inputSchema: {
      ...XY,
      button: z.enum(["left", "right", "middle"]).default("left"),
      clicks: z.number().int().min(1).max(5).default(1),
    },
  },
  async ({ x, y, button, clicks }) => {
    try {
      const f = { left: [2, 4], right: [8, 16], middle: [32, 64] }[button];
      await ps(
        `Add-Type 'using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,uint e);}';[M]::SetCursorPos(${x},${y})|Out-Null;1..${clicks}|%{[M]::mouse_event(${f[0]},0,0,0,0);[M]::mouse_event(${f[1]},0,0,0,0);Start-Sleep -Milliseconds 80}`,
      );
      return ok(`${button} click ${x},${y} x${clicks}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_scroll",
  {
    description: "Mouse wheel; positive up, negative down.",
    inputSchema: { amount: z.number().int().min(-100).max(100) },
  },
  async ({ amount }) => {
    try {
      await ps(
        `Add-Type 'using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,uint e);}';[M]::mouse_event(2048,0,0,[uint32]([int32](${amount}*120)),0)`,
      );
      return ok(`scrolled ${amount}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_type",
  {
    description: "Paste arbitrary Unicode text into focused app.",
    inputSchema: { text: z.string(), enter: z.boolean().default(false) },
  },
  async ({ text, enter }) => {
    try {
      const b = Buffer.from(text, "utf16le").toString("base64");
      await ps(
        `Add-Type -AssemblyName System.Windows.Forms;$t=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b}'));[Windows.Forms.Clipboard]::SetText($t);$w=New-Object -ComObject WScript.Shell;Start-Sleep -Milliseconds 80;$w.SendKeys('^v');${enter ? "$w.SendKeys('{ENTER}')" : ""}`,
        20000,
        true,
      );
      return ok(`typed ${text.length} chars`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_keypress",
  {
    description:
      "Send shortcuts: CTRL+L, ALT+TAB, CTRL+SHIFT+ESC, ENTER, ESC, F5.",
    inputSchema: { keys: z.string() },
  },
  async ({ keys }) => {
    try {
      const a = keys
          .toUpperCase()
          .split("+")
          .map((x) => x.trim()),
        k = a.pop();
      let p = "";
      if (a.includes("CTRL")) p += "^";
      if (a.includes("SHIFT")) p += "+";
      if (a.includes("ALT")) p += "%";
      const sp = new Set([
        "ENTER",
        "ESC",
        "TAB",
        "BACKSPACE",
        "DELETE",
        "HOME",
        "END",
        "PGUP",
        "PGDN",
        "UP",
        "DOWN",
        "LEFT",
        "RIGHT",
        "SPACE",
        "INSERT",
        "F1",
        "F2",
        "F3",
        "F4",
        "F5",
        "F6",
        "F7",
        "F8",
        "F9",
        "F10",
        "F11",
        "F12",
      ]);
      const send = p + (sp.has(k) ? `{${k}}` : k.toLowerCase());
      await ps(
        `$w=New-Object -ComObject WScript.Shell;$w.SendKeys('${send.replace(/'/g, "''")}')`,
      );
      return ok(`pressed ${keys}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_list_windows",
  { description: "List application windows.", inputSchema: {} },
  async () => {
    try {
      return ok(
        JSON.parse(
          (await ps(
            `Get-Process|?{$_.MainWindowHandle-ne 0}|select Id,ProcessName,MainWindowTitle|ConvertTo-Json -Compress`,
          )) || "[]",
        ),
      );
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_focus_window",
  {
    description: "Focus by title substring or PID.",
    inputSchema: {
      title: z.string().optional(),
      pid: z.number().int().positive().optional(),
    },
  },
  async ({ title, pid }) => {
    try {
      if (!title && !pid) throw Error("title or pid required");
      const q = pid ? pid : `'${title.replace(/'/g, "''")}'`;
      await ps(
        `$w=New-Object -ComObject WScript.Shell;if(-not $w.AppActivate(${q})){exit 2}`,
      );
      return ok("focused");
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_open_app",
  {
    description: "Open an app/document.",
    inputSchema: { target: z.string(), args: z.array(z.string()).default([]) },
  },
  async ({ target, args }) => {
    try {
      let al = args.map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
      await ps(
        `Start-Process '${target.replace(/'/g, "''")}' ${args.length ? `-ArgumentList @(${al})` : ""}`,
      );
      return ok(`started ${target}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_processes",
  {
    description: "List processes sorted by CPU.",
    inputSchema: { limit: z.number().int().min(1).max(200).default(80) },
  },
  async ({ limit }) => {
    try {
      return ok(
        JSON.parse(
          (await ps(
            `Get-Process|sort CPU -Descending|select -First ${limit} Id,ProcessName,CPU,@{n='MemoryMB';e={[math]::Round($_.WorkingSet64/1MB,1)}}|ConvertTo-Json -Compress`,
          )) || "[]",
        ),
      );
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_kill_process",
  {
    description: "Terminate a process by PID.",
    inputSchema: {
      pid: z.number().int().positive(),
      force: z.boolean().default(false),
    },
  },
  async ({ pid, force }) => {
    try {
      if (!cfg.allowProcessKill) throw Error("disabled");
      await ps(`Stop-Process -Id ${pid} ${force ? "-Force" : ""}`);
      return ok(`stopped ${pid}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_powershell",
  {
    description: "Run PowerShell on this PC.",
    inputSchema: {
      command: z.string(),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000),
    },
  },
  async ({ command, timeout_ms }) => {
    try {
      if (!cfg.allowShell) throw Error("disabled");
      return ok(await ps(command, timeout_ms));
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_cmd",
  {
    description: "Run cmd.exe on this PC.",
    inputSchema: {
      command: z.string(),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000),
    },
  },
  async ({ command, timeout_ms }) => {
    try {
      if (!cfg.allowShell) throw Error("disabled");
      return ok(await run("cmd.exe", ["/d", "/s", "/c", command], timeout_ms));
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_read_file",
  {
    description: "Read UTF-8 text file.",
    inputSchema: {
      path: z.string(),
      max_bytes: z.number().int().min(1).max(5000000).default(1000000),
    },
  },
  async ({ path: p, max_bytes }) => {
    try {
      let s = await fs.stat(p);
      if (s.size > max_bytes) throw Error(`file ${s.size} bytes`);
      return ok(await fs.readFile(p, "utf8"));
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_write_file",
  {
    description: "Write UTF-8 text file.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
      append: z.boolean().default(false),
    },
  },
  async ({ path: p, content, append }) => {
    try {
      if (!cfg.allowFileWrite) throw Error("disabled");
      await fs.mkdir(path.dirname(p), { recursive: true });
      append ? await fs.appendFile(p, content) : await fs.writeFile(p, content);
      return ok(`wrote ${Buffer.byteLength(content)} bytes`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_list_dir",
  { description: "List directory.", inputSchema: { path: z.string() } },
  async ({ path: p }) => {
    try {
      let a = await fs.readdir(p, { withFileTypes: true });
      return ok(
        a.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
        })),
      );
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_clipboard_get",
  { description: "Get clipboard text.", inputSchema: {} },
  async () => {
    try {
      return ok(await ps("Get-Clipboard -Raw", 10000, true));
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "computer_clipboard_set",
  { description: "Set clipboard text.", inputSchema: { text: z.string() } },
  async ({ text }) => {
    try {
      let b = Buffer.from(text, "utf16le").toString("base64");
      await ps(
        `$t=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b}'));Set-Clipboard -Value $t`,
        10000,
        true,
      );
      return ok("clipboard set");
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "browser_open",
  {
    description: "Open URL in default browser.",
    inputSchema: { url: z.string().url() },
  },
  async ({ url }) => {
    try {
      await ps(`Start-Process '${url.replace(/'/g, "''")}'`);
      return ok(`opened ${url}`);
    } catch (e) {
      return bad(e);
    }
  },
);
server.registerTool(
  "browser_recent_downloads",
  {
    description: "List newest Downloads files.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
  },
  async ({ limit }) => {
    try {
      let d = path.join(os.homedir(), "Downloads"),
        n = await fs.readdir(d),
        r = [];
      for (let x of n) {
        try {
          let s = await fs.stat(path.join(d, x));
          r.push({
            name: x,
            size: s.size,
            modified: s.mtime.toISOString(),
            path: path.join(d, x),
          });
        } catch {}
      }
      r.sort((a, b) => b.modified.localeCompare(a.modified));
      return ok(r.slice(0, limit));
    } catch (e) {
      return bad(e);
    }
  },
);
await server.connect(new StdioServerTransport());
