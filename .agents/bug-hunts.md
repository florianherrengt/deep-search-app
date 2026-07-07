# Bug Hunt Memory

## Current status

- Last run: 2026-07-07 (run 18)
- Last inspected commit: 7fbb686 (+ uncommitted fixes)
- Suggested next focus: Tools panel parity gaps (ask_questions/load_skill/currency_conversion/chrome-mcp descriptors missing from `getAvailableTools`); originalQuestion prompt-only enforcement (no schema check); TOCTOU in indexing; interleaved async folder selection race; hype_embeddings orphan cleanup

## Recent runs

### Run 18 — 2026-07-07 (commit 7fbb686, uncommitted fixes)

**Focus areas:**
- Stop cancellation + auto-continuation (`chat.tsx` suppression flag, `sendAutomaticallyWhen`)
- Currency conversion toggle (`getCurrencyConversionTarget`, settings flow)
- Research checkpoint retry framing (`agent-guards.ts`, `guarded-stream.ts`)
- Shared core refactor fallout (`execute-tool.ts`, `tool-registry.ts`, `folder-namer.ts`)

**Bugs fixed (2):**

1. **`getLatestUserText` returned empty when latest user message had no text** — `agent-guards.ts:245`. Bypassed research-checkpoint guard (`isResearchLikeRequest("")` → false → accept). Walks backwards to most recent text-bearing user message; also defensively skips synthetic `Internal guardrail retry` messages.
2. **`switch_research_folder` Tools panel silently no-op'd on success** — `execute-tool.ts:273`. `() => {}` callback returned `{researchFolder}` success without switching. Now throws explicit error.

**Tests added:** 3 (text-less latest user walk-back; injected retry ignored; switch_research_folder panel throws).

**Verification:** 965/965 unit pass; 107/107 storybook pass; lint clean; build clean.

**Investigated but NOT bugs (verified):**
- Suppression flag "dead code" after stop — FALSE: transport converts abort to graceful `{type:"abort"}` chunk (`transport/index.ts:344-353`), so `sendAutomaticallyWhen` IS reached (ai `index.mjs:13426`); suppression works.
- Cross-session ref leak — FALSE: sessions are keyed siblings (`App.tsx:261`), separate `Chat` instances.
- `getCurrencyConversionTarget` "no normalization" — NOT a live bug: zod union `currencyConversionSettingSchema` + store-level parse/fallback guarantees only `Currency | "disabled"` reaches it. Type-safe.
- `rate-limit.ts` deletion — NOT a regression: zero importers at deletion; rate limiting preserved in core.
- `research-checkpoint-tool.ts` deletion — NO dangling imports; tool now from core.
- Folder naming failure handling — correct (throws loudly, stops flow).

### Run 17 — 2026-06-14
Focus: HIGH priority risks, sub-agent persistence, error-handling sweep. Bugs fixed: 9.

### Run 16 — 2026-06-13
Focus: Sub-agent emitter routing, research-history rollback. Bugs fixed: 4.

## Recurring patterns

- `.catch(() => {})` silently hides failures — always log (fixed 10+ instances)
- Read-modify-write without serialization loses data under concurrency
- Index writes must ALL go through the serialization queue
- `as unknown as` casts bypass TypeScript — add runtime validation or defensive defaults
- Exhaustive switches need default cases for untrusted input
- Mantine Select defaults to `allowDeselect: true` — set `allowDeselect={false}` for required fields
- `let _ =` in Rust silently swallows errors — always handle or propagate
- Zod schemas need constraints (`.int()`, `.positive()`, `.min()`) not just type checks
- **NEW**: Tools panel descriptors (`execute-tool.ts`) drift out of sync with runtime registry (`tool-registry.ts`); verify parity when adding tools
- **NEW**: Guard logic keyed on "latest user message" must skip text-less messages (attachments) and synthetic app-injected messages
- **NEW**: Verify scout claims about framework internals before acting — subagents misread ai SDK abort flow (`return null` claim was wrong)

## Recently inspected areas

- **Stop/auto-continue suppression:** run 18, HIGH confidence — verified against ai@6.0.185 internals
- **Currency conversion toggle:** run 18, HIGH confidence — type-safe end to end
- **Research checkpoint retry framing:** run 18, HIGH confidence — terminates (max 2 retries), not shown as user turn
- **Shared core refactor (folder-namer, artifact storage, url-validation):** run 18, HIGH confidence
- **Sub-agent persistence + event handling:** run 17, HIGH confidence
- **Index write serialization:** run 17, HIGH confidence
- **JSON.parse safety:** run 17, HIGH confidence — all guarded

## Open risks

### HIGH priority

- **Tools panel missing descriptors** — `src/lib/execute-tool.ts:188-295`
  - `ask_questions`, `load_skill`, `currency_conversion`, chrome-devtools-mcp tools are registered at runtime (`tool-registry.ts:157,191,149-154`) but absent from the manual Tools panel. Display-only gap; runtime unaffected.
- **extract-page-content-tool content un-indexable** — `src/tools/extract-page-content-tool.ts` (raw/{domain}/ subdir not scanned by reindex_folder)
- **memory-agent never indexes memories.md** — `src/lib/memory-agent.ts:135-150`
- **Interleaved async folder selection race** — `src/App.tsx:457-506` (no abort mechanism)
- **hype_embeddings orphaned after chunk deletion** — `src-tauri/src/research_search/schema.rs:51-63` (no cascade)

### MEDIUM priority

- **originalQuestion prompt-only enforcement** — `agent-guards.ts` retry framing relies on model obeying natural-language guidance; no schema check that `originalQuestion` != retry instruction. Weak models may copy retry text.
- **Swallowed DELETE_embedding errors** — `src-tauri/src/research_search/indexing.rs` (6 locations)
- **FTS5 phrase query with internal double-quotes** — `src-tauri/src/research_search/search.rs:643-645`
- **Global sub-agent emitter singleton race** — `src/lib/sub-agent-emitter.ts:11-14`
- **TOCTOU in indexing read/write phases** — `src-tauri/src/research_search/indexing.rs:126-228`
- **DNS resolution has no timeout** — `src-tauri/src/lib.rs:211-221`
- **`switch_tab` failure silently proceeds** — `src/tools/extract-page-content-tool.ts:142`

### LOW priority

- **`getCurrencyConversionTarget` hardening** — no trim/uppercase/empty handling; safe today via store validation but risky if reused outside store path
- **`parseServiceUrl` weaker than core validator** — `src/lib/url-validation.ts:10-26` (no private-IP/loopback block; runtime SearXNG path validated in core, latent only)
- **`processedMemoryMessageIds` Set grows unboundedly** — `src/lib/transport/index.ts:42`
- **cosine_similarity truncates on mismatched dimensions** — `src-tauri/src/research_search/search.rs:1005-1018`
