# AGENTS.md

## Project

Deep Search is a Tauri v2 desktop app for AI-powered research.

- Frontend: React, TypeScript, Vite, Mantine
- Backend: Tauri v2 Rust commands
- Sidecar: chrome-devtools-mcp spawned via tauri-plugin-shell using the host's Node (resolved by the Rust `resolve_node_path` command). No bundled Node runtime.
- No separate hosted server
- LLM calls are made from the frontend through Vercel AI SDK provider packages

## Commands

```bash
npm run dev                    # Vite dev server only
npm run tauri dev              # Full desktop app
npm run lint                   # ESLint hook-order checks
npm run build                  # Typecheck + Vite build
npm test                       # Vitest unit tests
npm run test:watch             # Vitest watch mode
npm run storybook              # Browser-only Storybook
npm run build-storybook        # Static Storybook build
npm run storybook:screenshots  # Capture screenshots for stories
```

Rust tests:

```bash
cd src-tauri && cargo test
```

E2E tests:

```bash
npm run test:e2e
```

## Architecture

```text
src/
  lib/                         # Core frontend logic
    transport/                 # Chat transport, tool registry, guardrails
    mcp/                       # chrome-devtools-mcp sidecar: stdio transport,
                               # node resolution, MCP tool bindings
    system-prompt.md           # Imported as raw prompt text
  tools/                       # AI tool definitions
  components/                  # React UI components

src-tauri/
  src/
    lib.rs                     # Tauri commands
    main.rs                    # Entry point

e2e-tests/                     # WebdriverIO e2e package

.agents/                       # Detailed agent workflows
```

## Key Facts

- Path alias: `@/*` maps to `./src/*`
- UI library is Mantine
- AI providers are configured at runtime, not through `.env`
- API keys are stored with Tauri plugin-store
- Search backends are optional and enabled by configured API keys
- Tool registration lives in `src/lib/transport/tool-registry.ts`
- Guardrails live in `src/lib/agent-guards.ts`
- Guarded streaming is applied in `src/lib/transport/guarded-stream.ts`
- Markdown prompts are imported with `?raw`
- Zod v4 is used for validation
- The chrome-devtools-mcp sidecar runs in-process via the host's Node; do not replace it with a hosted service unless explicitly requested

## External API Domains

When adding a new external API endpoint, update both:

1. `src-tauri/tauri.conf.json`
   - `app.security.csp.connect-src`

2. `src-tauri/capabilities/default.json`
   - relevant HTTP allow lists

Do not add calls to a new external domain without updating Tauri CSP and capabilities.

## Subagent Policy

Use subagents aggressively for discovery, scanning, expensive verification, and high-output tasks.

The main agent owns:

- Final architecture decisions
- Prioritisation
- Risk judgment
- Implementation choices
- Final patch review
- Final response to the user

Use subagents for:

- Broad codebase scans
- Dead code searches
- Duplicate logic searches
- Dependency usage checks
- Test coverage inspection
- Storybook coverage inspection
- E2E flow inspection
- Config and environment inspection
- Security-sensitive path discovery
- Rust/Tauri impact checks
- chrome-devtools-mcp sidecar impact checks
- Expensive test runs
- Large command output collection

Prefer parallel fan-out. For non-trivial work, start multiple subagents at once instead of investigating everything sequentially.

Each subagent should report:

```text
Scope checked:
Files inspected:
Findings:
Risks:
Recommended next step:
```

The main agent should merge findings, decide, then implement.

## Expensive Commands

Never run these directly in the main agent context:

```bash
npm run test:e2e
cd src-tauri && cargo test
```

Always delegate them to a subagent.

Use targeted verification first, then broaden only after the focused check passes.

## Command Output Discipline

Commands are expensive. Do not paste large raw command output into notes, summaries, or responses unless explicitly required. Always summarise.

When running tests, builds, typechecks, linters, or search commands:

- Report only: command run, exit code, failing file/test (if relevant), first unique error message, likely root cause, file/config changed to fix it.
- Deduplicate repeated stack traces. Do not paste full dependency stack traces unless the dependency frame identifies the root cause.
- Never rerun the same failing command without changing code, config, or command arguments.
- Prefer narrow commands before broad commands.
- Prefer quiet/minimal reporters.
- Capture full output to local log files under `.agent-logs/`. Show only the useful tail or summarised failure.

### Vitest Patterns

Prefer these patterns for running Vitest:

```bash
mkdir -p .agent-logs
LOG=.agent-logs/vitest.log
npx vitest run --project unit --reporter=minimal --silent=passed-only --bail=1 > "$LOG" 2>&1
STATUS=$?
tail -n 80 "$LOG"
exit $STATUS
```

For a single test file:

```bash
mkdir -p .agent-logs
LOG=.agent-logs/vitest-focused.log
npx vitest run --project unit path/to/test.tsx --reporter=minimal --silent=passed-only --bail=1 > "$LOG" 2>&1
STATUS=$?
tail -n 80 "$LOG"
exit $STATUS
```

Or use the npm scripts: `npm run test:unit:quiet` and `npm run test:unit:focused -- path/to/test.tsx`.

### Failure Summary Format

For every failed command, report using this format:

```txt
Command failed:
<command>

Exit code:
<n>

Failure:
<first unique error>

Location:
<file/test/component if known>

Likely root cause:
<one short explanation>

Next action:
<code/config change or investigation step>
```

### Example

Bad: pasting repeated `ReferenceError: ResizeObserver is not defined` stack traces from Mantine/React.

Good:

```txt
Command failed:
npx vitest run --project unit src/components/__tests__/settings-fields.test.tsx

Failure:
ReferenceError: ResizeObserver is not defined

Location:
src/components/__tests__/settings-fields.test.tsx
@mantine/core ScrollArea use-resize-observer

Likely root cause:
The jsdom/unit test setup does not provide ResizeObserver.

Next action:
Add a ResizeObserver mock/polyfill in the Vitest setup file.
```

## Detailed Workflows

Load the relevant file from `.agents/` when the task matches:

- `.agents/ui.md` — Mantine, Storybook, screenshots, visual QA
- `.agents/testing.md` — unit, Rust, e2e, verification strategy
- `.agents/sidecar.md` — chrome-devtools-mcp sidecar: spawning, Node resolution, connection modes, lifecycle, shell-scope/security boundaries
- `.agents/research.md` — AI tools, search providers, extraction, research flow

Do not load every workflow by default. Load only what is relevant to the task.

## Implementation Rules

Before editing, inspect existing patterns.

When adding code:

- Reuse existing utilities before creating new ones
- Keep types explicit at module boundaries
- Validate external data with Zod
- Avoid new dependencies unless they clearly reduce code or risk
- Keep provider-specific logic isolated
- Keep Tauri permissions and CSP in sync with network behaviour
- Keep sidecar boundaries clear
- Add or update tests for changed behaviour
- Add or update stories for changed UI states

When fixing bugs:

- Find the root cause before patching symptoms
- Search for the same pattern elsewhere
- Add a regression test when practical
- Verify the narrowest relevant test first
- Broaden verification only after targeted tests pass

## Done Criteria

A task is done when:

- The code change is implemented
- Relevant tests were added or updated where useful
- Relevant verification has run
- Expensive checks were delegated to subagents
- UI changes have Storybook coverage or a clear reason they do not need it
- Tauri CSP/capability changes are included for new external domains
- The final response explains what changed, what was verified, and remaining risk
