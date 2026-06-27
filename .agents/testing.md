# Testing Workflow

Use this file for test strategy, verification, failure triage, and expensive command handling.

## Scope

This workflow applies when changing or checking:

- Unit tests
- Integration tests
- Rust tests
- WebdriverIO E2E tests
- Storybook screenshot verification
- Build/typecheck failures
- Runtime regressions
- Tauri command behaviour
- Node sidecar behaviour
- Provider/search/research flows

## Core Rule

Use the narrowest useful verification first.

Do not start with the full E2E suite unless the change directly affects full-app integration or no narrower test can prove the behaviour.

Prefer this order:

1. Static/type-level check
2. Focused unit test
3. Related test file or package
4. Build check
5. Storybook/screenshot check for UI
6. Rust tests for Tauri/backend changes
7. Targeted E2E
8. Full E2E suite

## Commands

Frontend unit tests:

```bash
npm test                       # all unit tests, default reporter
npm run test:unit:quiet        # quiet, minimal reporter, bail on first failure
npm run test:unit:focused -- path/to/test.tsx   # single file, quiet
npm run test:watch             # watch mode
```

Quiet test pattern (for subagents and CI):

```bash
mkdir -p .agent-logs
LOG=.agent-logs/vitest.log
npx vitest run --project unit --reporter=minimal --silent=passed-only --bail=1 > "$LOG" 2>&1
STATUS=$?
tail -n 80 "$LOG"
exit $STATUS
```

Frontend build:

```bash
npm run lint
npm run build
```

Storybook:

```bash
npm run storybook
npm run build-storybook
npm run storybook:screenshots
npm run storybook:screenshots:dev
```

Rust tests:

```bash
cd src-tauri && cargo test
```

E2E tests:

```bash
npm run test:e2e
```

Lint:

```bash
npm run lint
```

## Expensive Command Policy

Never run these directly in the main agent context:

```bash
npm run test:e2e
cd src-tauri && cargo test
```

Always delegate them to a subagent using the Task tool with a `general` subagent.

Reason: these commands are expensive, noisy, and can produce large output that consumes the main context.

The main agent should request a concise result from the subagent, not raw logs unless needed.

## Subagent Testing Protocol

Use subagents for:

- Running E2E tests
- Running Rust tests
- Collecting large failure logs
- Reproducing flaky failures
- Checking test coverage patterns
- Searching for existing related tests
- Inspecting setup/config issues
- Verifying whether a failure is pre-existing
- Running before/after comparison checks

Subagent report format:

```text
Scope checked:
Command(s) run:
Result:
Relevant failures:
Likely root cause:
Files implicated:
Recommended next step:
```

The main agent owns final interpretation and fixes.

## Choosing What to Run

### Small TypeScript logic change

Run:

```bash
npm test
```

If the changed area is imported broadly, also run:

```bash
npm run build
```

### Frontend UI change

Use `.agents/ui.md`.

Usually run:

```bash
npm test
npm run build-storybook
npm run storybook:screenshots
```

Use E2E only if the change affects a real app flow that Storybook cannot cover.

### Tauri command change

Delegate:

```bash
cd src-tauri && cargo test
```

Also run relevant frontend tests if the command has a frontend caller.

### Node sidecar change

Run the narrowest sidecar tests or package-level tests available.

Also check:

- Sidecar startup behaviour
- Request/response contract
- Error handling
- Process lifecycle
- Path resolution
- Packaging implications
- Tauri integration boundary

If the sidecar change affects full-app runtime behaviour, delegate targeted E2E.

### Provider, API key, or settings change

Check:

- Unit tests around settings/provider selection
- Runtime key storage assumptions
- Tool registration behaviour
- Missing/invalid key states
- UI state if settings screens changed

Use targeted E2E if persistence or app startup is involved.

### Search/research flow change

Check:

- Tool unit tests
- Provider-specific edge cases
- Empty result behaviour
- Error result behaviour
- Cancellation/abort behaviour
- Long-running task behaviour
- Guardrail behaviour

Use targeted E2E if the change affects the full prompt-to-results flow.

### CSP or Tauri capability change

Verify both files were updated when adding an external domain:

```text
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
```

Delegate Rust/Tauri verification if behaviour depends on native permissions.

## E2E Policy

E2E tests are for full desktop-app behaviour, not normal component review.

Use E2E when changing:

- App startup
- Tauri shell integration
- Browser tabs or webviews
- Filesystem access
- Node sidecar integration
- Native permissions or capabilities
- Settings persistence
- API key configuration
- Provider selection
- Research flow from prompt to result
- Cross-screen navigation
- Regression bugs only reproducible in the real app

Do not use E2E when Storybook, unit tests, or build checks are enough.

Prefer targeted E2E over the full suite when possible.

Run the full E2E suite only when:

- Shared app infrastructure changed
- Navigation or app shell changed
- Tauri-side permissions changed broadly
- Sidecar startup/runtime changed broadly
- The targeted failure is unclear
- The user explicitly asked for full verification

E2E runs must be delegated to a subagent.

## Failure Triage

When a test fails:

1. Read the first meaningful failure, not just the final summary.
2. Identify whether the failure is from code, test setup, environment, timing, or stale expectations.
3. Reproduce with the narrowest command (prefer `test:unit:focused` or the quiet pattern).
4. Inspect the implicated code and nearby tests.
5. Fix the root cause, not the symptom.
6. Add a regression test when practical.
7. Re-run the narrowest failing check.
8. Broaden verification only after the focused check passes.

Do not blindly update snapshots or expectations unless the new behaviour is intentional.

### Command Output Discipline

Do not paste large raw command output into notes or responses. Always summarise.

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

Deduplicate repeated stack traces. Do not paste full dependency stack traces unless the dependency frame identifies the root cause. Never rerun the same failing command without changing code, config, or command arguments. Capture full output to `.agent-logs/` when needed.

## Flaky Tests

For suspected flakes:

- Re-run the narrow failing test.
- Check timing assumptions.
- Check async waits.
- Check external dependency usage.
- Check shared mutable state.
- Check test order coupling.
- Check filesystem or port collisions.
- Prefer deterministic waits over arbitrary sleeps.

Do not hide flaky tests by skipping them unless explicitly justified.

If a test must be skipped, leave a clear reason and, where practical, a follow-up note.

## Unit Test Guidelines

Add or update unit tests when changing:

- Data transforms
- Provider selection
- Tool registration
- Guardrails
- Settings logic
- Search/extraction logic
- Error handling
- Retry/cancellation behaviour
- Sidecar client contracts
- Tauri command callers

Good unit tests should cover:

- Normal path
- Empty input
- Invalid input
- Error path
- Edge case
- Regression case

Avoid over-testing implementation details.

Prefer testing observable behaviour.

## UI Verification

For UI changes, use `.agents/ui.md`.

Testing should usually include:

- Relevant Storybook stories
- Light/dark mode where relevant
- Responsive states where relevant
- Empty/loading/error states
- Screenshot review for visual changes

Only use E2E for UI changes when the behaviour depends on the real desktop app.

## Rust/Tauri Verification

For Rust or Tauri command changes:

- Inspect existing inline `#[cfg(test)]` patterns.
- Add focused Rust tests where practical.
- Delegate `cargo test` to a subagent.
- Check frontend caller assumptions.
- Check serialization/deserialization boundaries.
- Check Tauri permissions/capabilities if network or filesystem access changed.

## Node Sidecar Verification

For sidecar changes, verify the contract between frontend/Tauri and sidecar.

Check:

- Startup command
- Process lifecycle
- Error handling
- Request schema
- Response schema
- Logging
- Timeouts
- Cancellation
- Packaging path assumptions
- Platform-specific path assumptions
- Behaviour when the sidecar is missing or crashes

Add tests around sidecar client code where practical.

Use E2E only for real runtime integration.

## Build Failures

For build/typecheck failures:

1. Run or inspect `npm run build`.
2. Identify the first real TypeScript error.
3. Check whether generated files or stale build output are involved.
4. Fix types at the source.
5. Avoid `any` unless it is deliberately contained at a boundary.
6. Re-run the build after the focused fix.

Do not silence TypeScript with broad casts unless the runtime shape is already validated.

## Snapshot and Screenshot Changes

Snapshots and screenshots should only change when UI output intentionally changed.

Before accepting screenshot changes:

- Compare before/after.
- Check both light and dark mode if relevant.
- Check responsive states if relevant.
- Confirm content is deterministic.
- Confirm the change matches the intended UI behaviour.

Do not accept screenshot changes caused by timing, animation, live data, or nondeterministic content.

## Regression Tests

Add a regression test when:

- Fixing a bug with a clear reproduction
- Changing guardrails
- Changing provider selection
- Changing search/extraction behaviour
- Changing sidecar contracts
- Changing Tauri commands
- Fixing a previously broken E2E flow

A good regression test should fail before the fix and pass after the fix.

## Done Criteria

Testing work is done when:

- The narrowest relevant verification has passed
- Broader verification ran when risk justified it
- Expensive checks were delegated to subagents
- Failures were triaged to root cause
- Intentional snapshot/screenshot changes were reviewed
- New or changed behaviour has tests where useful
- Known remaining failures are documented as pre-existing or out of scope
- The final response says what was run, what passed, what failed, and what risk remains
