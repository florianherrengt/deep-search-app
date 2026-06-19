Your job is to find and fix real bugs in this codebase. Do not perform a shallow audit. Do not merely report recommendations. Work directly in the code.

This prompt is intended to be run regularly, so you must build on previous runs, rotate focus areas, avoid repeating shallow checks, and maintain a compact bug-hunt memory file.

# Mission

Relentlessly hunt for:

- Runtime crashes
- Broken user flows
- Race conditions
- Async cancellation bugs
- State bugs
- Incorrect persistence
- Filesystem/path bugs
- Invalid generated names, IDs, folders, or artifacts
- Silent failures
- Bad error handling
- Missing guards
- Incorrect assumptions
- UI states that lie to the user
- Tests that pass while the product is broken
- Tests that fail for the wrong reason
- Missing regression coverage
- Cross-boundary bugs between frontend, backend, sidecar, tools, storage, and sub-agents

Do not stop after finding the first issue. Bugs often cluster around the same code path.
YOU ARE NOT DONE UNTIL ALL THE TESTS ARE PASSING. I REPEAT ALL TESTS MUST PASS.

# Core rule

Fix real bugs only.

A finding must have at least one of:

- A reproducible failure
- A failing test
- A concrete code path proving the bug
- A violated invariant
- A user-visible incorrect state
- A missing guard around known invalid input
- A mismatch between tests and real product behavior

If evidence is weak, list it as a risk. Do not invent bugs to satisfy the prompt.

# Persistent bug-hunt memory

Maintain a single bounded file at:

`.agents/bug-hunts.md`

This file is operational memory for recurring bug hunts. It must stay concise and useful. Do not let it grow indefinitely.

At the start of each run:

1. Read `.agents/bug-hunts.md` and `.agents/invariants.md`
2. Use it to understand:
   - Recently inspected areas
   - Recurring bug patterns
   - Fragile files or systems
   - Weak test coverage
   - Remaining risks
   - Suggested focus from the previous run

3. Avoid repeating the same shallow checks unless recent code changes justify it.

At the end of each run, update `.agents/bug-hunts.md`.

Do not simply append forever. Rewrite and compact the file so it stays under 250 lines.

The file should contain these sections:

```md
# Bug Hunt Memory

## Current status

- Last run:
- Last inspected commit:
- Suggested next focus:

## Recent runs

Keep only the last 3 runs.

Each run should include:

- Date
- Commit/hash
- Focus areas
- Bugs fixed
- Tests added
- Verification run
- Remaining risks

## Recurring patterns

Stable lessons from previous runs:

- Bug classes that keep appearing
- Fragile areas
- Common failure modes
- Test gaps

## Recently inspected areas

Areas checked recently with no major findings:

- Area:
- Date:
- Confidence:
- When to revisit:

## Open risks

Known risks that were not fixed yet:

- Risk:
- Files/flows:
- Why it matters:
- Suggested follow-up:
```

Rules for the memory file:

- Keep the file under 250 lines.
- Keep only the last 3 detailed runs.
- Merge older details into `Recurring patterns`, `Recently inspected areas`, or `Open risks`.
- Delete stale details that no longer help future runs.
- Do not preserve chronological history for its own sake.
- Prefer durable lessons over verbose logs.

# Recurring run strategy

At the start of every run:

1. Inspect recent code changes:
   - Current git status
   - Current branch
   - Recent commits
   - Git diff
   - Recently modified files
   - Recently added or changed tests

2. Read the bug-hunt memory file.

3. Choose 2–4 high-risk focus areas for this run.

Prefer areas with:

- Recent changes
- Previous bug history
- Weak tests
- Complex async behavior
- Persistence or filesystem writes
- Generated names, paths, IDs, folders, or artifacts
- User-visible state transitions
- Error handling
- Cross-boundary logic between frontend, backend, sidecar, tools, storage, and sub-agents

Do not inspect the entire codebase equally every time. Pick focused areas and go deep.

# Rotation requirement

Pick a different primary focus each run unless recent changes clearly justify revisiting the same area.

Possible rotations:

- Research lifecycle
- Folder and artifact naming
- Tool result parsing
- Sub-agent result parsing
- Error reporting
- Crash boundaries
- Persistence and filesystem writes
- UI state correctness
- Async queues
- Cancellation and re-entrancy
- E2E user flows
- Test reliability
- Sidecar/backend integration
- Settings and configuration
- Import/export flows
- Saved output flows
- Storybook/UI coverage
- Empty/loading/error states

# Use subagents aggressively

You are the main agent. You own final judgment, prioritisation, architecture decisions, and implementation choices.

Use subagents for discovery, scanning, verification, and evidence gathering.

Delegate broad or mechanical work such as:

- Codebase scanning
- Reference searches
- Dead code checks
- Duplicate logic searches
- Test coverage inspection
- E2E flow inspection
- Storybook coverage inspection
- Dependency usage checks
- Config/env inspection
- Error-handling pattern searches
- Logging/observability inspection
- Security-sensitive path discovery
- Existing convention discovery
- Risk evidence gathering
- Verification of whether a symbol, file, route, or component is used

Subagents are scouts, not decision-makers.

When a subagent reports a finding, verify important claims yourself before changing code.

# Bug-hunting method

For every suspicious area:

1. Identify the intended invariant.
2. Trace the actual code path.
3. Find where the invariant can be violated.
4. Reproduce or reason through the failure.
5. Fix the root cause, not just the symptom.
6. Add or update regression tests.
7. Run the smallest useful verification command.
8. Continue searching adjacent code paths.

Assume there may be more bugs nearby after every bug you find.

# Critical failure policy

If a prerequisite is required for the app to behave correctly, failure must be explicit.

For example:

- If a research folder name cannot be generated, the research must not continue.
- If required metadata is missing, do not create partial corrupt state.
- If persistence fails, do not show success.
- If a tool result cannot be parsed, surface a real error.
- If a generated ID/path/name is invalid, stop before doing downstream work.
- If a sub-agent returns malformed output, preserve enough diagnostics to understand why it was rejected.
- If an operation fails before the main flow starts, stop and show a clear error.

The app must not silently continue into broken state.

# Error reporting requirement

When fixing or inspecting failures, check whether the error would be debuggable.

A good error path should include:

- What failed
- Which step failed
- The invalid input or rejected output when safe to log
- The expected shape or invariant
- The actual received shape or value
- Whether the app stopped or recovered
- A user-visible message when the user needs to know
- A developer-facing diagnostic when debugging is needed

Do not swallow errors with broad `try/catch`.

Do not replace real errors with generic messages unless detailed diagnostics are preserved somewhere appropriate.

# Testing expectations

Add targeted regression tests for every fixed bug.

Prefer tests that verify user-visible behavior and durable invariants over implementation details.

Include tests for:

- Success path
- Failure path
- Empty/null/malformed input
- Duplicate or repeated actions
- Re-entrancy
- Async timing where relevant
- Error display
- Crash prevention
- Persistence side effects
- Invalid generated names, paths, IDs, folders, or artifacts

If a bug involves naming, paths, generated folders, or saved files, write multiple tests around:

- Empty names
- Whitespace-only names
- Invalid characters
- Duplicate names
- Very long names
- Reserved names
- Failed generation
- Failed validation
- Failed write after validation

If a bug involves UI rendering, test that the user sees the correct thing and does not see internal implementation noise.

If a bug involves a sub-agent or tool result, test malformed, missing, partial, and unexpected result shapes.

# Verification discipline

Run the smallest useful verification command first.

Use focused commands rather than dumping huge output.

Prefer targeted tests around the changed area before wider test suites.

Do not paste long command output into your final response. Summarize the relevant result.

If a command produces too much noise, rerun it with a narrower filter or summarize only the failure.

# Constraints

Do not rewrite large unrelated areas unless necessary.
Do not hide failures behind broad fallback behavior.
Do not delete tests to make the suite pass.
Do not weaken assertions.
Do not mock away the actual bug.
Do not change product behavior without understanding the intended invariant.
Do not make speculative refactors.
Do not mark the task complete while known related bugs remain unfixed.

# Final output

At the end of the run, produce a concise report:

## Focus areas inspected

- List the 2–4 areas inspected.

## Bugs fixed

For each bug:

- Bug:
- Root cause:
- Fix:
- Tests added:
- Files changed:

## Verification

List commands run and whether they passed.

## Memory updated

State that `.agents/bug-hunts.md` was updated and kept under the size limit.

## Remaining risks

List only concrete risks, with file paths or flows where possible.

## Suggested next focus

Recommend the best focus area for the next recurring bug-hunt run.

If no bugs were found, do not pretend otherwise. Explain what was inspected, what evidence improved confidence, and what should be inspected next in `.agents/bug-hunts.md`.
