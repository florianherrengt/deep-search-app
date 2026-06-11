# Node Sidecar Workflow

Use this file for work involving the Node.js sidecar, local runtime behaviour, sidecar communication, packaging, process lifecycle, and integration with Tauri/frontend code.

## Scope

This workflow applies when changing:

- Node sidecar source code
- Sidecar startup or shutdown behaviour
- Sidecar request/response APIs
- Frontend or Tauri code that calls the sidecar
- Local filesystem/runtime tasks handled by the sidecar
- Sidecar packaging or bundled binaries
- Sidecar logging, errors, timeouts, cancellation, or health checks
- App flows that depend on the sidecar being available

## Core Rule

The sidecar is part of the local desktop runtime.

Do not replace sidecar behaviour with a hosted service unless explicitly requested.

Keep the sidecar boundary clear:

```text id="s82m6r"
React frontend
  -> Tauri command/client boundary
  -> Node sidecar
  -> local runtime work
```

Do not blur responsibilities by duplicating sidecar logic in the frontend or pushing UI concerns into the sidecar.

## Responsibilities

The sidecar may handle local runtime work that is awkward, unsafe, or impractical in the browser/frontend.

Good sidecar responsibilities:

- Local process orchestration
- Local filesystem-heavy operations
- Long-running local jobs
- Local tool execution
- Runtime tasks needing Node APIs
- Streaming local task output
- Normalising local runtime responses
- Isolating platform-specific behaviour

Avoid putting these in the sidecar:

- React state management
- UI formatting
- Mantine/component concerns
- User-facing copy decisions
- Provider settings UI
- Logic that already works cleanly in Tauri Rust
- Logic that belongs in shared TypeScript domain modules

## Before Editing

Inspect the existing sidecar structure first.

Check:

- Where sidecar source lives
- How it is built
- How it is launched
- How requests are sent
- How responses are encoded
- How errors are represented
- How logs are collected
- How paths are resolved
- How shutdown is handled
- How packaging includes the sidecar

Do not assume the sidecar path or command. Verify from the repo.

Likely places to inspect:

```text id="u9qdd4"
package.json
src-tauri/tauri.conf.json
src-tauri/capabilities/
src-tauri/src/
src/lib/
src/sidecar/
sidecar/
node-sidecar/
```

## Interface Contract

Treat the sidecar interface as a real API boundary.

For each sidecar call, understand:

- Request schema
- Response schema
- Error schema
- Timeout behaviour
- Cancellation behaviour
- Streaming behaviour, if any
- File/path handling
- Whether the operation is idempotent
- Whether the operation can run concurrently

Use Zod or existing validation patterns at the boundary when practical.

Do not trust raw sidecar responses without validation.

## Request/Response Rules

Sidecar calls should have predictable behaviour.

Good calls:

- Use explicit operation names
- Have typed request payloads
- Return typed response payloads
- Return structured errors
- Preserve useful diagnostic detail
- Avoid leaking internal stack traces to the UI
- Support cancellation for long-running work where practical
- Avoid ambiguous `success: false` responses without a reason

Avoid:

- Stringly typed ad-hoc commands
- Unstructured JSON blobs
- Silent failure
- Swallowing stderr/stdout
- Returning UI-ready prose from the sidecar
- Mixing multiple unrelated operations in one endpoint

## Process Lifecycle

When touching sidecar lifecycle, check:

- How the sidecar starts
- Whether startup is lazy or eager
- How readiness is detected
- What happens if startup fails
- What happens if the sidecar crashes
- Whether restarts are supported
- How shutdown happens when the app exits
- Whether child processes are cleaned up
- Whether multiple sidecar instances can be started accidentally
- Whether ports, sockets, or handles can collide

A sidecar-dependent feature should have a clear unavailable/error state.

Do not let the UI hang forever waiting for the sidecar.

## Paths and Filesystem

Be careful with paths.

Check:

- App data directory
- Temporary directory
- User-selected paths
- Bundled resource paths
- Development vs production paths
- macOS/Linux/Windows path differences
- Spaces and special characters
- Relative path assumptions
- Symlink behaviour where relevant

Do not hardcode development paths.

Do not assume the current working directory is stable.

Prefer explicit paths passed from Tauri/app configuration.

## Security Rules

The sidecar runs locally and may have more power than the frontend.

Be conservative.

Check for:

- Command injection
- Unsafe shell interpolation
- Arbitrary file reads
- Arbitrary file writes
- Path traversal
- Leaking API keys into logs
- Leaking local paths into user-visible errors unnecessarily
- Executing untrusted input
- Over-broad filesystem access
- Network calls that bypass Tauri policy expectations

Prefer `spawn`/argument arrays over shell strings.

Validate all user-controlled inputs before they reach process execution or filesystem operations.

Never log secrets.

## Concurrency

For sidecar jobs, check whether multiple requests can run at once.

Consider:

- Shared mutable state
- File write conflicts
- Temp directory collisions
- Duplicate job starts
- Cancellation races
- Shutdown during active work
- Streaming output from concurrent jobs
- Resource exhaustion

If adding long-running jobs, consider job IDs and explicit lifecycle state.

## Errors and Logging

Sidecar errors should be useful to developers and safe for users.

Good error shape:

```ts id="xxo5qg"
type SidecarError = {
  code: string;
  message: string;
  details?: unknown;
};
```

UI-facing messages should be clear but not overly internal.

Developer logs may include more detail, but must not include secrets.

When changing errors, check:

- Frontend display behaviour
- Tests expecting error codes/messages
- Retry behaviour
- Whether logs include enough debugging context
- Whether sensitive details are excluded

## Streaming and Long-Running Tasks

For streaming sidecar work, check:

- Start event
- Progress events
- Output events
- Error event
- Completion event
- Cancellation event
- Cleanup after completion
- Cleanup after cancellation
- Backpressure or large output handling

Do not buffer unlimited output in memory.

Do not make the frontend infer completion from silence.

## Integration With Tauri

When sidecar changes affect Tauri integration, inspect:

```text id="ky5h4p"
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/src/
```

Check whether the change affects:

- Bundled sidecar configuration
- Permissions/capabilities
- Resource paths
- App startup
- Native commands
- Development vs production behaviour
- Platform packaging

If external domains are added, update both CSP and capabilities as described in root `AGENTS.md`.

## Testing

Use `.agents/testing.md` for full testing strategy.

For sidecar changes, verify the narrowest useful layer first:

1. Pure function/unit tests
2. Sidecar API/client contract tests
3. Frontend/Tauri caller tests
4. Build/typecheck
5. Targeted E2E only if real app runtime is involved

Check sidecar-specific cases:

- Sidecar unavailable
- Sidecar startup failure
- Sidecar crash mid-request
- Invalid request
- Invalid response
- Timeout
- Cancellation
- Large output
- Missing files
- Permission denied
- Platform path differences

If the change affects real runtime startup or desktop integration, delegate targeted E2E to a subagent.

Do not run E2E directly in the main agent context.

## Subagent Usage

Use subagents for broad sidecar discovery and expensive verification.

Delegate:

- Finding all sidecar callers
- Inspecting packaging configuration
- Searching for lifecycle handling
- Searching for path assumptions
- Checking process-spawn usage
- Checking security-sensitive command execution
- Running sidecar-related tests
- Running targeted E2E
- Comparing dev vs production config

Subagent report format:

```text id="t04985"
Scope checked:
Files inspected:
Commands run:
Findings:
Risks:
Recommended next step:
```

The main agent owns final implementation and risk judgment.

## Common Change Checklist

When changing sidecar behaviour, check:

- Does the request/response contract change?
- Are all callers updated?
- Are types updated?
- Is runtime validation updated?
- Are errors still structured?
- Is cancellation still correct?
- Are logs useful and safe?
- Are secrets excluded from logs?
- Does the change work in dev and production?
- Does packaging still include the sidecar?
- Are platform-specific paths handled?
- Are tests updated?
- Is E2E needed?

## Done Criteria

Sidecar work is done when:

- The sidecar change is implemented
- The sidecar boundary remains clear
- Request/response types are updated
- Runtime validation is updated where useful
- Errors are structured and safe
- Startup, crash, timeout, and unavailable states are considered
- Paths work in dev and production
- Packaging impact was checked
- Security-sensitive inputs were validated
- Relevant tests passed
- Targeted E2E was delegated if real runtime behaviour changed
- The final summary says what changed, what was verified, and what risk remains
