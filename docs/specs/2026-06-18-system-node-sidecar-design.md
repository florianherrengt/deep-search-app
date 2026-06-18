# Design Spec: Switch Chrome DevTools MCP Sidecar to System Node

**Date:** 2026-06-18
**Status:** Draft
**Author:** OpenCode Producer

## Summary

Replace the bundled Node binary sidecar (`binaries/node`) with the user's system-installed Node, using Tauri's `Command.create` (system command) instead of `Command.sidecar` (bundled external binary). The app will require Node `^20.19.0 || ^22.12.0 || >=23`, matching chrome-devtools-mcp's engine constraint.

## Motivation

The current approach bundles a Node binary per target triple, requires compilation scripts (`prepare-node-sidecar.mjs`, `build-sidecar-compiled.mjs`), needs macOS code-signing, and adds ~60MB to the app bundle. Since OpenCode users are technical, requiring system Node is acceptable and simplifies the architecture.

## Architecture Change

### Before (current)

```
┌─────────────┐    Command.sidecar("binaries/node")
│ frontend TS │ ──────────────────────────────────►  bundled Node binary
└─────────────┘                                      (copied from node_modules/node
                                                       or compiled via @yao-pkg/pkg)
                                                       ↳ runs chrome-devtools-mcp.js
```

- `tauri.conf.json` declares `externalBin: ["binaries/node"]`
- `capabilities/default.json` allows `shell:allow-spawn` with `sidecar: true`
- `tauri-bridge.ts` exports `createSidecarCommand` which calls `Command.sidecar`
- `prepare-node-sidecar.mjs` copies or compiles Node to `src-tauri/binaries/node-$TARGET_TRIPLE`
- Two modes (`sidecar-mode.json`): `"compiled"` (pkg bundle) and `"node"` (raw Node + entrypoint)
- Rust `SidecarState` tracks PID for cleanup on exit

### After (target)

```
┌─────────────┐    Command.create("system-node")     capability maps
│ frontend TS │ ──────────────────────────────────►  name:"system-node" → cmd:"node"
└─────────────┘                                      (must satisfy ^20.19.0 || ^22.12.0 || >=23)
                                                       ↳ runs chrome-devtools-mcp.js
                                                          (bundled as resource, never a sidecar binary)
```

- Remove `externalBin` entry for Node from `tauri.conf.json`
- Replace `Command.sidecar` with `Command.create` in the tauri-bridge layer
- Use a capability alias (e.g. `"system-node"`) with `cmd: "node"` (system commands omit the `sidecar` key); `Command.create` takes the alias, not the raw binary name
- Keep chrome-devtools-mcp.js bundled as a Tauri resource (already configured under `bundle.resources`)
- Detect system Node at startup via `Command.create("system-node", ["--version"]).execute()` through the shell plugin; show clear error if missing or unsupported
- Rust sidecar PID tracking (kill on exit) should still work since `Command.create` also exposes PID

## Files to Change

| File | Change |
|------|--------|
| `src/lib/tauri-bridge.ts` | Add `createSystemCommand(alias, args)` using `Command.create` (from `@tauri-apps/plugin-shell`). Keep existing `createSidecarCommand` for any future bundled binaries, but chrome-devtools-sidecar must use the new function. The `alias` parameter corresponds to the capability `name` field (e.g. `"system-node"`), not the raw binary. |
| `src/lib/mcp/chrome-devtools-sidecar.ts` | Add `validateSystemNode()` function that calls `Command.create("system-node", ["--version"]).execute()` and checks the semver against `^20.19.0 \|\| ^22.12.0 \|\| >=23`. Call `createSystemCommand("system-node", [entrypoint, ...args])` instead of `createSidecarCommand("binaries/node", ...)`. Remove `CHROME_DEVTOOLS_MCP_SIDECAR` constant and `isCompiledSidecarMode` branching (only system Node path remains). Remove `sidecar-mode.json` import and delete that file. |
| `src-tauri/capabilities/default.json` | Add four permission groups for the `"system-node"` alias with `cmd: "node"` (system commands omit the `sidecar` key). **(1)** `shell:allow-execute` with args `["--version"]` for version validation. **(2)** `shell:allow-spawn` with args matching chrome-devtools-mcp.js resource path + `--auto-connect`/`--browser-url=...` for MCP process launch. **(3)** `shell:allow-stdin-write` and `shell:allow-kill` with the same MCP arg validators. Remove all existing `binaries/node` sidecar entries. |
| `src-tauri/tauri.conf.json` | Remove `"binaries/node"` from `bundle.externalBin`. Remove `"prepare:sidecars &&"` from both `beforeDevCommand` and `beforeBuildCommand`. |
| `package.json` | Remove `"node"` from `devDependencies`. Remove `"@yao-pkg/pkg"` from `devDependencies`. Remove the `"prepare:sidecars": "node scripts/prepare-node-sidecar.mjs"` script entry. |
| `scripts/prepare-node-sidecar.mjs` | Delete (no longer needed). |
| `scripts/build-sidecar-compiled.mjs` | Delete (no longer needed). |
| `scripts/node-sidecar-entitlements.plist` | Delete (no longer needed). |
| `src/lib/mcp/sidecar-mode.json` | Delete (no longer needed). |
| `src-tauri/src/lib.rs` | No Rust changes required for Node validation. The existing `register_sidecar_pid` and `unregister_sidecar_pid` commands and `SidecarState` PID tracking on exit remain unchanged — `Command.create` spawns a child process with a killable PID, so the current cleanup logic works as-is. |
| `src/lib/mcp/__tests__/chrome-devtools-sidecar.test.ts` | Update tests for system Node path. Mock `createSystemCommand` and `validateSystemNode` (which calls `Command.create("system-node", ["--version"]).execute()`). Test valid/invalid/missing version cases. Remove sidecar-mode branching tests. |

## Security Constraints

- **No shell strings:** `Command.create("system-node", args)` with string array args — never `Command.create("sh", ["-c", ...])`. The capability maps alias `"system-node"` to `cmd: "node"`, so the actual binary is fixed by configuration, not by caller string.
- **Separate permissions for version check vs. MCP spawn:** The `--version` validation uses `shell:allow-execute` with args `["--version"]` only — it cannot launch arbitrary scripts. The MCP spawn capability uses `shell:allow-spawn` with arg validators that must match both the chrome-devtools-mcp.js resource path pattern and the two connection flags (`--auto-connect` or `--browser-url=https?://...`). Stdin-write and kill entries mirror the spawn arg validators. Both flows go through the Tauri shell plugin, governed by the same permission model.
- **No arbitrary command execution:** Only `node` is allowed as the system command (`cmd: "node"`). The entrypoint is always the bundled chrome-devtools-mcp.js resource, resolved via `resolveResource`. The regex validators ensure no other entrypoint or flag can be passed.
- **Clear error on missing/unsupported Node:** Before MCP spawn, the app calls `validateSystemNode()` which runs `Command.create("system-node", ["--version"]).execute()` via the shell plugin. If Node is missing or the version does not satisfy `^20.19.0 || ^22.12.0 || >=23`, show a user-facing error message with the required version range and instructions to install Node.

## Version Requirement Enforcement

The chrome-devtools-mcp package declares engine constraint `^20.19.0 || ^22.12.0 || >=23` (in its `package.json`). The app must enforce the same range.

**Implementation:** A frontend helper `validateSystemNode()` in `chrome-devtools-sidecar.ts` runs `Command.create("system-node", ["--version"]).execute()` via the Tauri shell plugin, parses the semver output, and checks against the hardcoded range. This uses the `shell:allow-execute` capability entry for the `"system-node"` alias with args `["--version"]`. Called once at startup (or lazily before first MCP spawn). The hardcoded range string lives in a constant exported from `chrome-devtools-sidecar.ts`.

**Non-Tauri (test/mock) fallback:** When running outside Tauri (Vite dev, unit tests), the bridge mock layer provides a fake `createSystemCommand` response. There is no browser-side `process.version` check — the frontend never has access to a Node runtime. Tests inject a mock version string to exercise both the "valid version" and "missing/unsupported version" paths.

## Validation Plan

| Check | Command / Method |
|-------|-----------------|
| TypeScript compiles | `npx tsc --noEmit` |
| Vite builds | `npm run build` |
| Sidecar unit tests pass | `npm run test:unit:focused -- src/lib/mcp/__tests__/chrome-devtools-sidecar.test.ts` |
| Tauri capability schema valid | `cd src-tauri && cargo check` (ensures capabilities JSON matches generated schema) |
| Runtime smoke (manual) | `npm run tauri dev` — verify Chrome DevTools MCP starts without errors; verify error message appears when Node is missing |
| System Node detection | Call `validateSystemNode()` in the running app (or unit-test the semver parsing logic): verify it reports correct version when Node is present, and a clear error when absent or too old |

## Risks and Open Questions

- **macOS code-signing:** Removing the bundled Node binary eliminates the need for the entitlements plist and codesign steps — that is a simplification, but verify there are no other sidecar binaries that still need it.
- **Windows path resolution:** The capability `cmd: "node"` relies on `node` being on the system PATH. The `validateSystemNode()` call will fail with a clear error if `node` cannot be found, which the app surfaces to the user.
- **Dev experience:** In Vite dev mode (non-Tauri), Tauri shell APIs are unavailable. Chrome DevTools MCP spawning is a Tauri-only feature. The frontend code path should skip MCP setup when `isTauri()` returns false. Tests use bridge mocks to inject fake command responses.
- **`node` devDependency:** The `node` npm package in devDependencies was used to vend a Node binary. It can be removed after this change, but verify nothing else depends on it (e.g., CI scripts).
- **`@yao-pkg/pkg` devDependency:** Can be removed — it was only used for `build-sidecar-compiled.mjs`.
- **`sidecar-mode.json` removal:** The `isCompiledSidecarMode` branching in `chrome-devtools-sidecar.ts` is removed entirely. Only the system Node path remains, eliminating the two-mode complexity.
