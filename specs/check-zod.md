# Specification: Zod-Based Validation for Memory Extraction LLM Output

**GitHub Issue:** Follow-up to #2 (memory-extraction-ask-questions)

**Status:** Draft

**Date:** 2026-06-17

---

## 1. System Overview

`extractAndStoreMemories` (in `src/lib/memory-agent.ts`) receives LLM-generated text, strips markdown fences, parses it as JSON, then validates the parsed value with hand-written `Array.isArray` and `typeof f !== "string"` checks. The validated strings are normalized (newlines replaced with spaces, trimmed) and filtered to non-empty, then written to `memories.md`.

The hand-written checks are correct and tested — they catch three distinct failure classes (invalid JSON, non-array JSON, non-string array entries) with three distinct error messages. However, they diverge from the project's AGENTS.md rule:

> **Validate external data with Zod**

LLM output is untrusted external data — the canonical Zod use case. This specification proposes adopting Zod for the validation step while preserving (or consciously updating) the external contract.

---

## 2. Problem Statement

| ID | Problem | Impact |
|----|---------|--------|
| P1 | The validation pipeline in `extractAndStoreMemories` uses hand-rolled `Array.isArray` + `typeof` checks instead of Zod, the project's standard validation library (Zod v4.4.3). | Diverges from AGENTS.md rule "Validate external data with Zod." |
| P2 | The hand-rolled checks are ad-hoc and not reusable. A future LLM output parser for a different prompt would re-implement the same pattern. | Maintenance cost accumulates with each new LLM output format. |
| P3 | Error messages are bespoke strings (`"LLM returned non-array JSON"`, `"LLM returned non-string entry in array"`) rather than structured Zod errors with issue paths and codes. | Callers cannot programmatically distinguish "non-array" from "non-string entry" without string-matching. |
| P4 | The validator does not reject `null`, `undefined`, `boolean`, or nested object entries — they happen to be caught by `typeof f !== "string"`, but the code gives no guarantee about the parsed value's top-level shape before iterating. | A future maintainer could accidentally reorder or remove the `Array.isArray` guard and iterate over a non-array without error. |

**Honest acknowledgement:** The current code is correct, tested, and small (lines 134–156 in `memory-agent.ts`). This is a maintainability/consistency proposal, not a bug fix. The primary benefit is alignment with the AGENTS.md rule; any LOC reduction is modest.

---

## 3. Goals

| ID | Goal | Priority |
|----|------|----------|
| G1 | Replace the hand-rolled `Array.isArray` + `typeof` checks with a Zod schema. | P0 |
| G2 | Preserve the external contract: throw on invalid/non-array/non-string entries; return `{ memoriesStored: 0 }` for empty/all-trivial arrays; do NOT write to disk on empty output. | P0 |
| G3 | Retain `stripMarkdownJsonFence` and `JSON.parse` — Zod validates the parsed value, not raw JSON strings. | P0 |
| G4 | Introduce no new runtime dependencies (Zod v4.4.3 is already in the project). | P0 |
| G5 | Keep or consciously update the exact error messages thrown. | P1 |
| G6 | Provide structured error data (Zod issues) for programmatic callers when useful. | P2 |

---

## 4. Non-Goals

- Changing the memory extraction flow, prompt, or `collectMemoryCandidates`.
- Changing `formatMemoriesContent`, `serializedWrite`, or `buildMemoryExtractionPrompt`.
- Persisting processed memory IDs across browser sessions.
- Validating anything other than the parsed LLM output array inside `extractAndStoreMemories`.
- Retroactively converting other LLM-output parsing sites in the codebase to Zod (see §12 Open Questions).
- Changing the trim/normalize/filter pipeline (those are transformations, not validations).

---

## 5. Scope Boundaries

### In Scope

- The validation pipeline inside `serializedWrite`'s callback in `extractAndStoreMemories` (lines 134–156 of `memory-agent.ts`).
- The unit tests in `src/lib/__tests__/memory-agent.test.ts` that assert on validation behavior: AT-10 (invalid JSON), AT-11 (non-array), AT-19 (non-string entries), AT-15 (empty array returns 0), AT-16 (all-trivial returns 0).
- Addition of new tests for Zod-specific rejections (e.g., number in array, boolean in array, nested object entry).

### Out of Scope

- `memory-agent-prompt.md` (no change).
- The trigger block in `DirectTransport.sendMessages()`.
- `collectMemoryCandidates` and candidate collection.
- `serializedWrite` folder-queue mechanism.
- `formatMemoriesContent`.
- Any other file.

---

## 6. Validation Pipeline (Current vs. Proposed)

### 6.1 Current Code (`memory-agent.ts` lines 134–156)

```ts
// Parse LLM output
const stripped = stripMarkdownJsonFence(text);
let parsed: unknown;
try {
  parsed = JSON.parse(stripped);
} catch (parseError) {
  throw new Error(
    `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : "unknown parse error"}`,
  );
}

if (!Array.isArray(parsed)) {
  throw new Error("LLM returned non-array JSON");
}

const facts = parsed
  .map((f) => {
    if (typeof f !== "string") {
      throw new Error("LLM returned non-string entry in array");
    }
    return f;
  })
  .map((f) => f.replace(/\n/g, " ").trim())
  .filter((f) => f.length > 0);
```

Two validation checks on the parsed value:
1. `Array.isArray(parsed)` — guards against objects, numbers, strings, null.
2. `typeof f !== "string"` on each element — guards against numbers, booleans, nulls, objects, arrays.

### 6.2 Proposed Schema

```ts
import { z } from "zod";

const MergedMemoriesSchema = z.array(z.string());
```

This single schema replaces both checks: it rejects non-arrays and rejects any non-string element. Zod also rejects `null` and `undefined` by default. The schema is intentionally simple — one line.

**Why `z.array(z.string())` and not something more complex:**
- The LLM output is expected to be exactly an array of strings. Any deviation is a model-format failure and should throw.
- `z.array(z.string())` rejects: non-arrays, arrays containing `null`, `number`, `boolean`, `object`, `undefined`, `bigint`, `symbol`.
- It does NOT enforce non-empty strings (that's a transformation step, not a validation concern) or trim whitespace (also a transformation).

---

## 7. Design Options

### Option A: Pure Zod, Change Error Messages

**Implementation:**
```ts
const MergedMemoriesSchema = z.array(z.string());
const parsed = MergedMemoriesSchema.parse(JSON.parse(stripped));
// If it reaches here, parsed is typed as string[]
```

**Pros:**
- Most idiomatic. Single line of validation.
- Least code (removes ~8 lines of hand-rolled checks).
- `z.array(z.string()).parse()` throws `ZodError` with structured issues including `.issues[].path` (e.g., `[3]` for the 4th element).
- Type narrowing: after `parse()`, TypeScript knows the value is `string[]`.

**Cons:**
- **Breaks the original spec §11.4's exact-message contract.** The thrown `ZodError` messages are like:
  - Non-array: `"Expected array, received object"` (instead of `"LLM returned non-array JSON"`)
  - Non-string entry: `"Expected string, received number"` at `path: [2]` (instead of `"LLM returned non-string entry in array"`)
- The two distinct failure classes (non-array vs. non-string) collapse into one `ZodError` error type. Callers or tests that need to distinguish them must inspect `ZodError.issues[].code`.
- Tests AT-10 (`toThrow("invalid JSON")`) still pass (it's caught at `JSON.parse`). But AT-11 and AT-19 would need assertion updates.
- Requires amending the original spec §11.4 to document the new error behavior.

### Option B: Zod + Message-Preserving Wrapper (RECOMMENDED)

**Implementation:**
```ts
import { z } from "zod";

const MergedMemoriesSchema = z.array(z.string());

// ... after JSON.parse ...
const result = MergedMemoriesSchema.safeParse(parsed);
if (!result.success) {
  const firstIssue = result.error.issues[0];
  if (firstIssue?.code === "invalid_type" && firstIssue.received !== "array") {
    throw new Error("LLM returned non-array JSON");
  }
  // Otherwise: element-level invalid_type (non-string entry)
  throw new Error("LLM returned non-string entry in array");
}
const facts: string[] = result.data
  .map((f) => f.replace(/\n/g, " ").trim())
  .filter((f) => f.length > 0);
```

**Pros:**
- Preserves the exact external contract and existing error messages.
- Satisfies the AGENTS.md Zod rule — the schema IS a Zod schema.
- Tests AT-10, AT-11, AT-19 all pass **without modification** (same error substrings).
- Structured Zod error info (`result.error.issues`) is available if future callers want it.
- The `safeParse` approach is already used elsewhere in the codebase (e.g., `SafePathSegmentSchema.safeParse(segment)` in `app-file-storage.ts` line 43).

**Cons:**
- The wrapper is roughly as much code as the current hand-rolled checks (~8 lines of if/throw). The win is mostly "uses the project's library" rather than fewer lines.
- Still arguably ad-hoc: the mapping from `ZodIssue` to error messages is custom logic.
- Future maintainers might ask "why not just `.parse()`?"

**Justification for recommendation:** Option B delivers the primary goal (Zod validation) without breaking the external contract. The preserved error messages mean no downstream changes in tests, error handlers, or spec documentation. The AGENTS.md rule is satisfied. The modest wrapper cost is acceptable for the contract stability it buys.

### Option C: Zod with refine/superRefine for Distinct Messages

**Implementation:**
```ts
const MergedMemoriesSchema = z.array(z.string()).superRefine((val, ctx) => {
  // Validation is already done by z.array(z.string()) — nothing extra to refine.
  // The challenge is customizing the error MESSAGE, not the validation.
  // This would require overriding issue messages at parse time.
});
```

**Pros:**
- Declarative approach would be elegant IF it worked cleanly.

**Cons:**
- Zod v4's error-mapping API is not designed for this use case. `.superRefine` adds issues AFTER base validation; it doesn't replace the base validation's own issues. Overriding individual issue messages requires iterating `ZodError.issues` post-hoc, which is equivalent to Option B but less explicit.
- Risk of subtle behavior change: Zod v4 error shapes differ from v3, and `superRefine` can interact unexpectedly with the base schema's type refinements.
- More complex than both Options A and B with no clear benefit.

**Verdict: Not recommended.** This is over-engineered for three error classes.

### Decision Table

| Criterion | Option A (Pure Zod) | Option B (Zod + Wrapper) | Option C (superRefine) |
|-----------|---------------------|-------------------------|------------------------|
| Uses Zod? | Yes | Yes | Yes |
| Preserves exact error messages? | No | Yes | Partially (complex) |
| Preserves existing test assertions? | AT-10 ok, AT-11/AT-19 need change | All pass as-is | Unclear |
| Type narrowing after validation? | Automatic (`string[]`) | Manual (`result.data as string[]`) | Automatic |
| LOC vs current? | -8 lines | ~0 change | +lines |
| AGENTS.md compliant? | Yes | Yes | Yes |
| Risk of behavior change? | Medium (error messages) | Low | High |
| **Recommended?** | No | **Yes** | No |

---

## 8. Error-Handling Contract (Updated)

Under Option B, the error-handling contract from `memory-extraction-ask-questions.md` §14.4 is preserved exactly. No error message changes. The Zod schema adds structured error data internally, but the thrown errors are the same strings.

| Scenario | Current behavior | Option B behavior | Change? |
|----------|-----------------|-------------------|---------|
| LLM returns invalid JSON (unparseable) | Throws `"LLM returned invalid JSON: ..."` | Same (JSON.parse still runs first) | None |
| LLM returns non-array JSON (`{}`, `"string"`, `42`) | Throws `"LLM returned non-array JSON"` | Same (wrapped safeParse) | None |
| LLM array contains non-string entries (`42`, `null`, `true`, `{}`) | Throws `"LLM returned non-string entry in array"` | Same (wrapped safeParse) | None |
| LLM returns `[]` (empty array) | Returns `{ memoriesStored: 0 }` | Same | None |
| All entries are empty after trim | Returns `{ memoriesStored: 0 }` | Same | None |
| LLM returns valid string array | Returns `{ memoriesStored: N }` | Same | None |

**Additional rejected inputs (under Zod):** `parsed` value is `null` (Zod rejects null for `z.array(z.string())`), `undefined` (Zod rejects), `bigint`, `symbol` — all map to `"LLM returned non-array JSON"`.

---

## 9. The Proposed Schema and Integration Point

### 9.1 Schema Definition

```ts
import { z } from "zod";

/**
 * Validates the LLM's merged memory output.
 * Expected format: JSON array of strings, e.g. `["Fact one.", "Fact two."]`
 *
 * Rejects: non-arrays, arrays containing non-string entries (number, boolean,
 * null, object, array, undefined).
 * Does NOT reject: empty arrays `[]` or empty strings (those are handled by
 * the trim/filter pipeline downstream).
 */
const MergedMemoriesSchema = z.array(z.string());
```

**Placement:** Define at module scope in `src/lib/memory-agent.ts`, near the top with other `const` declarations (e.g., after `LOG_PREFIX` on line 12). It is used only inside `extractAndStoreMemories` and does not need to be exported.

### 9.2 Integration Point (lines 133–156 of memory-agent.ts)

Before (`parse` + `Array.isArray` + `typeof`):

```ts
// Parse LLM output
const stripped = stripMarkdownJsonFence(text);
let parsed: unknown;
try {
  parsed = JSON.parse(stripped);
} catch (parseError) {
  throw new Error(
    `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : "unknown parse error"}`,
  );
}

if (!Array.isArray(parsed)) {
  throw new Error("LLM returned non-array JSON");
}

const facts = parsed
  .map((f) => {
    if (typeof f !== "string") {
      throw new Error("LLM returned non-string entry in array");
    }
    return f;
  })
  .map((f) => f.replace(/\n/g, " ").trim())
  .filter((f) => f.length > 0);
```

After (Option B):

```ts
// Parse LLM output
const stripped = stripMarkdownJsonFence(text);
let parsed: unknown;
try {
  parsed = JSON.parse(stripped);
} catch (parseError) {
  throw new Error(
    `LLM returned invalid JSON: ${parseError instanceof Error ? parseError.message : "unknown parse error"}`,
  );
}

// Validate with Zod schema (preserves exact error messages for existing contract)
const parsedResult = MergedMemoriesSchema.safeParse(parsed);
if (!parsedResult.success) {
  const firstIssue = parsedResult.error.issues[0];
  if (firstIssue?.code === "invalid_type" && firstIssue.received !== "array") {
    throw new Error("LLM returned non-array JSON");
  }
  throw new Error("LLM returned non-string entry in array");
}
const validatedFacts: string[] = parsedResult.data;

const facts = validatedFacts
  .map((f) => f.replace(/\n/g, " ").trim())
  .filter((f) => f.length > 0);
```

**Changes from current:**
1. New import: `import { z } from "zod"` at the top of the file.
2. `Array.isArray` check replaced by `safeParse` + issue inspection.
3. `typeof f !== "string"` guard removed — Zod catches non-string entries before iteration.
4. New intermediate variable `validatedFacts: string[]` with explicit type — the type is now `string[]` after Zod validation, eliminating the need for the `(f) => { ... return f }` casting pattern.

### 9.3 What Does NOT Change

| Element | Status |
|---------|--------|
| `stripMarkdownJsonFence(text)` call | **Unchanged** — Zod validates parsed values, not raw JSON strings |
| `JSON.parse(stripped)` in try/catch | **Unchanged** — Zod cannot parse JSON; must still catch `SyntaxError` |
| Error message for invalid JSON | **Unchanged** — `"LLM returned invalid JSON: ..."` |
| Error message for non-array | **Unchanged** — `"LLM returned non-array JSON"` |
| Error message for non-string entry | **Unchanged** — `"LLM returned non-string entry in array"` |
| `.replace(/\n/g, " ").trim()` pipeline | **Unchanged** — transformations, not validations |
| `.filter(f => f.length > 0)` | **Unchanged** |
| Empty-array early return: `if (facts.length === 0) return 0` | **Unchanged** |
| `formatMemoriesContent(facts)` | **Unchanged** |

---

## 10. Test Changes Required

### 10.1 Tests That Pass Without Modification (Option B)

| Test ID | Test name (line) | Assertion | Why unchanged? |
|---------|-----------------|-----------|---------------|
| AT-10 | `"throws on invalid JSON from LLM"` (line 169) | `.rejects.toThrow("invalid JSON")` | `JSON.parse` still throws `SyntaxError`; the wrapper is never reached |
| AT-11 | `"throws on non-array JSON from LLM"` (line 199) | `.rejects.toThrow("non-array")` | The wrapper re-throws `"LLM returned non-array JSON"` |
| AT-19 | `"throws when LLM array contains non-string entries"` (line 184) | `.rejects.toThrow("non-string entry")` | The wrapper re-throws `"LLM returned non-string entry in array"` |
| AT-15 | `"returns memoriesStored: 0 for empty LLM array"` (line 494) | `.toEqual({ memoriesStored: 0 })` | Empty array passes Zod validation; trim/filter still returns empty |
| AT-16 | `"returns memoriesStored: 0 when all entries are empty after trim"` (line 511) | `.toEqual({ memoriesStored: 0 })` | String array passes Zod; only trim/filter determines emptiness |

**Note on `toThrow()` semantics:** Vitest's `toThrow("substring")` matches if the error message **contains** the substring. The three `toThrow` assertions on error messages check for `"invalid JSON"`, `"non-array"`, and `"non-string entry"` respectively. As long as the thrown `Error` message includes these substrings, the tests pass. Option B preserves all three exact messages, so these assertions continue to match.

### 10.2 New Tests (Recommended)

| ID | Test Name | Objective |
|----|-----------|-----------|
| AT-21 | `"throws when LLM array contains a number (Zod-validated)"` | Mock LLM returns `["valid", 42]`. Verify throws with `"non-string entry"`. |
| AT-22 | `"throws when LLM array contains a boolean (Zod-validated)"` | Mock LLM returns `["valid", true]`. Verify throws with `"non-string entry"`. |
| AT-23 | `"throws when LLM array contains a nested object"` | Mock LLM returns `["valid", {"key": "value"}]`. Verify throws with `"non-string entry"`. |
| AT-24 | `"throws when LLM array contains a nested array"` | Mock LLM returns `["valid", ["nested"]]`. Verify throws with `"non-string entry"`. |
| AT-25 | `"throws when LLM array contains null"` | Mock LLM returns `["valid", null]`. Verify throws with `"non-string entry"`. |

These tests directly verify that Zod rejects specific types that the old code also rejected, but each test isolates one rejection case. AT-19 already covers mixed types (`"valid", 42, null`), but the new tests provide more precise coverage.

### 10.3 Tests That Should NOT Be Added

- **Do NOT test ZodError shape directly** — the wrapper is an implementation detail. Tests should assert on the thrown `Error` message, not on `ZodError.issues[0].code`. If the implementation switches to Option A later, the tests should still pass.
- **Do NOT test `safeParse` called vs `parse`** — again, an implementation detail.

---

## 11. Acceptance Criteria

| ID | Criterion | Pass Condition |
|----|-----------|---------------|
| AC-1 | `extractAndStoreMemories` uses a Zod schema to validate the parsed LLM output | Code review: `MergedMemoriesSchema.safeParse(parsed)` is present |
| AC-2 | Invalid JSON still throws with `"LLM returned invalid JSON"` message | AT-10 passes without modification |
| AC-3 | Non-array JSON still throws with `"LLM returned non-array JSON"` message | AT-11 passes without modification |
| AC-4 | Non-string array entries still throw with `"LLM returned non-string entry in array"` message | AT-19 passes without modification |
| AC-5 | Empty array `[]` returns `{ memoriesStored: 0 }` without writing to disk | AT-15, AT-18 pass without modification |
| AC-6 | All-trivial entries return `{ memoriesStored: 0 }` | AT-16 passes without modification |
| AC-7 | No new npm dependencies | `npm ls zod` shows only existing `zod@4.4.3` |
| AC-8 | `stripMarkdownJsonFence` and `JSON.parse` retained | Code review |
| AC-9 | `import { z } from "zod"` added to `memory-agent.ts` | Code review |
| AC-10 | All existing memory-agent tests pass | `npx vitest run --project unit src/lib/__tests__/memory-agent.test.ts` exits 0 |
| AC-11 | No other files changed | `git diff --name-only` shows only `src/lib/memory-agent.ts` and possibly `src/lib/__tests__/memory-agent.test.ts` |
| AC-12 | New Zod-specific rejection tests pass (AT-21 through AT-25) | Tests pass |

---

## 12. Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Zod v4 API differences from v3: `safeParse` return shape (`{success, data, error}`) is stable across v4, but `.issues[]` shapes have minor v4 changes. | Verify against Zod v4.4.3 specifically during implementation. The issues inspected in Option B (`issue.code === "invalid_type"`, `issue.received`) are unchanged between v3 and v4. |
| R2 | The wrapper code is roughly the same LOC as the current code. The win is mostly consistency. | Honest about this in the spec. The value is AGENTS.md compliance, not LOC reduction. |
| R3 | The distinction between "non-array" and "non-string entry" relies on inspecting `firstIssue.code === "invalid_type" && firstIssue.received !== "array"`. If Zod changes its issue shape in a future version, this mapping could break. | Unit tests AT-11 and AT-19 serve as regression guards. A Zod major version bump would trigger test failures before any production issue. |
| R4 | The empty-array "return 0, don't write" semantics could accidentally change if the schema is moved or the validation order changes. | AT-15 and AT-16 are regression guards. The empty-array check is after validation + trim/filter, which is far from the schema. |
| R5 | Option B's use of `safeParse` + manual error mapping is still ad-hoc. It satisfies the Zod rule but doesn't deliver "pure Zod". | Accepted tradeoff. The wrapper is explicit, small, and well-tested. Option A is available as a future upgrade if the error contract is relaxed. |

---

## 13. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | Should the non-array vs. non-string distinction be preserved as two distinct error messages, or collapsed into one? | **Open for user decision.** The current spec preserves both for backward compatibility. The user could choose to collapse them and accept a Zod-native error message. |
| 2 | Should we adopt Zod for the LLM output parsing in `retrieval-agent.ts` (`JSON.parse` at line 269) as well? | **Out of scope for this spec.** The retrieval agent's JSON parsing does not use hand-rolled type checks (it uses a schema in its tool definition). If the user wants to standardize that too, it should be a separate spec. |
| 3 | Should `MergedMemoriesSchema` be exported from `memory-agent.ts` for use by other modules (e.g., the transport guard tests)? | **Likely no.** The schema is an internal detail of validation. Tests should assert on behavior (thrown error messages) not on the schema itself. |
| 4 | Should the schema enforce `z.string().min(1)` (non-empty) to catch empty strings at validation time instead of filter time? | **Likely no.** The current pipeline uses trim/filter for empty-string handling, which is more flexible (it catches `"   "` → trim → `""` → filter). Adding `.min(1)` to the Zod schema would reject untrimmed empty strings that would become empty after trim, which is semantically correct but changes the error class (throws instead of returns empty). This is a transformation concern, not a validation concern. |

---

## 14. Extensibility

### 14.1 Future Migration to Option A

If the project later relaxes the error-message contract (e.g., the spec is amended to accept Zod-native messages), migrating from Option B to Option A is a one-line change:

```ts
// Option B → Option A: replace safeParse wrapper with .parse()
- const result = MergedMemoriesSchema.safeParse(parsed);
- if (!result.success) { ... throw ... }
- const validatedFacts: string[] = result.data;
+ const validatedFacts = MergedMemoriesSchema.parse(parsed);
```

Until that contract decision is made, Option B preserves existing behavior while adopting the library.

### 14.2 Applying Zod to Other LLM Output Parsers

This spec focuses exclusively on `extractAndStoreMemories`. If the user wants to standardize other LLM output validation sites (e.g., `retrieval-agent.ts` line 269), a separate spec should enumerate them and apply the same Option B (or Option A) pattern consistently.

---

## 15. References

- **Original spec:** `specs/memory-extraction-ask-questions.md` — §11.4 (validation contract), §12.2 (step-by-step flow), §13.2 (error table), §14.4 (return value semantics)
- **Implementation file:** `src/lib/memory-agent.ts` — lines 134–156 (validation pipeline)
- **Test file:** `src/lib/__tests__/memory-agent.test.ts` — AT-10 (line 169), AT-11 (line 199), AT-19 (line 184), AT-15 (line 494), AT-16 (line 511)
- **Zod v4 docs:** `https://zod.dev/` — `z.array()`, `z.string()`, `safeParse()`, `ZodError.issues`
- **Existing Zod patterns in project:**
  - `src/lib/app-file-storage.ts` lines 1, 14–26, 43 (`SafePathSegmentSchema`, `safeParse`, `superRefine`)
  - `src/tools/questions-tool.ts` lines 1–20 (`z.object`, `z.array`, `zodSchema`)
  - `src/lib/agent-diagnostics.ts` lines 1–11 (`z.object`, `z.enum`)
  - `src/tools/search-research-tool.ts` line 9 (`z.array(z.string())`)
- **AGENTS.md** — lines 251, 253–254: "Validate external data with Zod", "Avoid new dependencies unless they clearly reduce code or risk", "Keep types explicit at module boundaries"
