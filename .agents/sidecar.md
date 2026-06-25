# chrome-devtools-mcp Sidecar Workflow

Use this file for work involving the **chrome-devtools-mcp** sidecar: spawning it,
talking to it over stdio, Node resolution, connection modes, lifecycle, and the
Tauri shell-scope/security boundaries around it.

## What the sidecar is

The only sidecar in this app is **chrome-devtools-mcp**, an MCP server bundled as
a JS resource and run with the **host's Node**. There is no separate Node runtime,
no bundled Node binary, and no custom request/response API — the sidecar speaks
[MCP](https://modelcontextprotocol.io) JSON-RPC over stdio.

It is used as a `WebExtractionBackend` option (`"chrome-mcp"` vs `"tauri-webview"`,
see `src/lib/settings-store.ts`) and exposes Chrome DevTools tools to the model.
It is intentionally a **last-resort** tool (see `describeMcpTool` in
`chrome-devtools-tools.ts`); ordinary research uses the internal webview/extraction
path.

```text
React frontend
  -> tauri-plugin-shell (scoped "system-node" alias)
  -> host `node chrome-devtools-mcp.js`
  -> attaches to an already-running Chrome over CDP
```

## Core rules

- **Do not replace the sidecar with a hosted service** unless explicitly requested.
- **chrome-devtools-mcp attaches to an existing Chrome.** Both connection modes
  (`--auto-connect`, `--browser-url`) connect to a browser that is already running.
  It never spawns its own Chrome, so there is no child process tree to clean up —
  the single-PID kill on app exit is sufficient and correct.
- **`resolve_node_path` must stay in Rust.** It runs an arbitrary user-supplied
  Node path and probes login shells. The Tauri shell scope uses a fixed `cmd`
  string and deliberately forbids wildcards (tauri-apps/tauri#5910), so this
  discovery cannot move to the renderer without a functionality regression
  (losing the user override) or a security regression (wildcard scope).
- **Keep the boundary clear.** Do not duplicate sidecar/MCP logic in the frontend,
  and do not push UI concerns into the sidecar.

## Where things live

```text
src/lib/mcp/
  chrome-devtools-sidecar.ts   # Entrypoint resolution, Node env, connection args,
                               # Command creation. REQUIRED_NODE_RANGE +
                               # parseNodeVersion/checkNodeVersion (TS re-check).
  chrome-devtools-tools.ts     # MCP Client, tool discovery, ToolSet wiring,
                               # lazy lifecycle, reconnect-on-config-change.
  tauri-stdio-transport.ts     # TauriStdioTransport: MCP over stdio, PID
                               # register/unregister, stderr tail + crash logging.

src/lib/tauri-bridge.ts        # resolveNodePath, createSystemCommand,
                               # registerSidecarPid/unregisterSidecarPid,
                               # SidecarCommand / SidecarChild types.

src/lib/settings-store.ts      # chromeMcpConnectionModeSchema (auto|browser-url),
                               # webExtractionBackendSchema (tauri-webview|chrome-mcp).

src-tauri/src/lib.rs           # resolve_node_path command, SidecarState PID,
                               # RunEvent::Exit kill (SIGTERM unix / taskkill windows).
src-tauri/capabilities/default.json  # shell scope: "system-node" alias + arg validators.
src-tauri/tauri.conf.json      # resources: node_modules/chrome-devtools-mcp -> mcp/...
```

## Spawning and Node resolution

1. `createChromeDevToolsMcpCommand` (`chrome-devtools-sidecar.ts`) calls
   `getNodeEnvironment(nodePath)`, which calls Rust `resolve_node_path`.
2. Rust (`lib.rs:resolve_node_path`) probes, in order: a user override path,
   the login shell (`/bin/zsh -lic "command -v node"`, then `/bin/bash -lc`),
   then common install locations (`/opt/homebrew/bin/node`, `/usr/local/bin/node`,
   `Program Files\nodejs`, …). Each candidate is validated by running
   `<node> --version` and checking `^20.19.0 || ^22.12.0 || >=23`.
3. It returns `{ path, dir, version, env_path }`; `env_path` is a `PATH` that
   makes a bare `node` resolve regardless of the GUI app's minimal PATH.
4. The TS side re-checks the version (`checkNodeVersion`) defensively.
5. The command is created via `createSystemCommand("system-node",
   [entrypoint, ...connectionArgs], { env: { PATH: envPath } })`.

**Required Node range is duplicated in Rust and TS on purpose.** If you change it,
update both: `REQUIRED_NODE_RANGE` in `chrome-devtools-sidecar.ts` and
`lib.rs` (`REQUIRED_NODE_RANGE` + `node_version_satisfies`).

## Connection modes

`resolveChromeDevToolsConnectionArgs` (`chrome-devtools-sidecar.ts`) emits exactly
one flag:

- `"auto"` (default) → `--auto-connect`. Attaches to a Chrome whose remote
  debugging was enabled from `chrome://inspect/#remote-debugging` (Chrome 144+),
  discovered via the default profile's `DevToolsActivePort` file. Ignores any
  browser URL.
- `"browser-url"` → `--browser-url=<url>`. Connects over CDP to an already
  debuggable instance (e.g. Chrome started with `--remote-debugging-port=9222`).
  Requires a configured, valid browser URL.

If you add a mode or change the flag format, **update the arg validators** in
`src-tauri/capabilities/default.json` (`shell:allow-spawn`, `shell:allow-stdin-write`,
`shell:allow-kill`) — args are regex-checked and a mismatch silently blocks spawn.

## Lifecycle

- **Lazy start.** The client and ToolSet are created on first use and cached
  (`clientPromise`/`toolsPromise` in `chrome-devtools-tools.ts`). MCP request
  timeout is 30s (`MCP_REQUEST_TIMEOUT_MS`).
- **Reconnect on config change.** A `connectionKey` (mode + browserUrl + nodePath)
  is tracked; changing it triggers `shutdownChromeDevToolsMcp()` before re-spawn.
- **PID tracking.** On spawn, `TauriStdioTransport` registers the PID via the
  `register_sidecar_pid` Rust command; it unregisters on close/exit. Rust stores
  it in `SidecarState`.
- **Exit cleanup.** In `RunEvent::Exit`, Rust SIGTERMs (unix) / taskkills
  (windows) the registered PID. This is the one lifecycle piece that must run in
  Rust — the renderer is torn down before exit, so JS cannot reliably clean up.
- **beforeunload** also calls `shutdownChromeDevToolsMcp()` for normal closes.
- **Crash logging.** `TauriStdioTransport` keeps an 8KB stderr tail and, on
  unexpected exit, writes it to `<appData>/sidecar-logs/sidecar-stderr-<ts>.log`.

A sidecar-dependent feature must have a clear unavailable/error state. Do not let
the UI hang waiting for it.

## Interface contract

The boundary is MCP JSON-RPC over stdio, wrapped by `@modelcontextprotocol/sdk`.

- Tool input schemas are normalized (`normalizeInputSchema`) and exposed as AI SDK
  tools with `source: "chrome-devtools-mcp"` metadata.
- Tool results are normalized (`normalizeToolCallResult`); on error the current
  stderr tail is appended to the message to aid debugging.
- Do not trust raw MCP output — keep the existing normalization/validation.

## Security

- The shell scope is the primary guard. The renderer can only spawn the scoped
  `system-node` alias with regex-validated args. Do **not** loosen it to allow
  arbitrary binaries.
- Never log secrets. Stderr is tailed and may be written to disk.
- `resolve_node_path` executing a user-supplied path is intentional and validated
  (existence + version range); do not remove that validation.
- If a new external domain is needed, update both Tauri CSP
  (`src-tauri/tauri.conf.json`) and capabilities per root `AGENTS.md`.

## Testing

See `.agents/testing.md` for the full strategy. Verify the narrowest layer first:

1. Unit tests — `src/lib/mcp/__tests__/chrome-devtools-sidecar.test.ts` (command
   building, connection args) and the Rust unit tests in `lib.rs`
   (`node_version_parser_and_range`, content-type, IP blocking).
2. Build/typecheck (`npm run build`).
3. Targeted E2E **only** if real runtime startup/desktop integration changed —
   delegate it to a subagent; never run E2E in the main agent context.

Sidecar-specific cases to cover: Node not found / wrong version, startup failure,
crash mid-call, config-change reconnect, missing browser URL for `browser-url`
mode.

## Done criteria

Sidecar work is done when:

- The change is implemented and the Rust↔TS contract stays consistent.
- Connection-mode/arg changes are reflected in `capabilities/default.json`.
- Required-Node-range changes are mirrored in Rust and TS.
- Lifecycle (lazy start, reconnect, exit kill) still holds.
- Relevant unit tests pass; E2E delegated if real runtime behaviour changed.
- The final summary states what changed, what was verified, and remaining risk.
