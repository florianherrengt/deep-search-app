# How Memories Work

This document describes how Deep Search should create, store, retrieve, and use long-term user memories alongside research artifacts.

The goal is to make research feel continuous without turning every past conversation into permanent context. The app should remember useful personal facts and preferences when they help answer a future query, but it should ignore transient details, random facts, sensitive information, and memories that are not relevant to the current task.

## Short Version

At the end of each research session, the agent should produce three canonical files in the active research folder:

| File | Purpose | Used For |
| ---- | ------- | -------- |
| `README.md` | Final research report/results | Human review, continuing a research folder, previous-research relevance |
| `summary.md` | Compact search-optimized summary of the research | Fast previous-research matching and relevance evaluation |
| `memories.md` | Durable personal facts/preferences about the user discovered during this session | Future personalization when relevant |

The agent should not write these files by hand with arbitrary `create_file` or `update_file` calls. It should call a dedicated finalization tool that validates the structure, writes all three files, and indexes them.

Filename casing matters. The app currently reads `README.md` exactly when building active-folder context, so the canonical research report should be written as `README.md`, not `readme.md`. The lower-case `summary.md` and `memories.md` filenames should stay lower-case.

Retrieval should happen in two separate tracks:

| Track | Searches | Returns | User Interaction |
| ----- | -------- | ------- | ---------------- |
| Previous research | `README.md`, `summary.md`, and research notes | Matching research folder names | Ask whether to continue or start fresh |
| User memories | `memories.md` only | Specific memory entries | Inject relevant memories silently into context |

Example behavior:

| User Query | Stored Memory | Should Surface? | Why |
| ---------- | ------------- | --------------- | --- |
| `Find dog-friendly hiking trails near me` | `User has a dog.` | Yes | The dog affects trail/lodging/safety constraints |
| `Compare lightweight hiking packs` | `User has a dog.` | Maybe | Relevant only if dog gear/carrying supplies matters |
| `Best IT gadgets for desk setup` | `User has a dog.` | No | The memory does not help answer the query |

## Current App Context

Deep Search already has most of the storage and retrieval primitives needed for memories.

Relevant existing pieces:

| Area | Existing Code | Notes |
| ---- | ------------- | ----- |
| Research folder lifecycle | `src/lib/transport/index.ts`, `src/lib/research-history.ts` | Creates provisional timestamp folders, lets the agent rename them, saves chats under `search-results/<folder>/chats/` |
| File storage | `src/lib/app-file-storage.ts` | Writes files under Tauri `BaseDirectory.AppData` and emits research-library change events |
| Agent file tools | `src/tools/file-tools.ts` | `create_file`, `read_file`, `update_file`, `move_file`, `delete_file`, `list_files` |
| Search index | `src/lib/research-search.ts`, `src-tauri/src/research_search/*` | Indexes saved files into SQLite, FTS5, and sqlite-vec |
| Previous research lookup | `searchResearch()` and `search_research` tool | Searches indexed research files and returns matching folders to the agent |
| Relevance evaluator | `src/lib/research-relevance-evaluator/*` | Uses an LLM to filter noisy previous-research matches |
| Main prompt | `src/lib/system-prompt.md` | Defines the research workflow and tool-use rules |

Important current limitations:

| Limitation | Impact |
| ---------- | ------ |
| Any saved file can be indexed | Working notes and canonical artifacts are mixed in the same retrieval pool |
| The prompt references old tool names in places | The agent may try to call `save_research_file`, `read_research_file`, or `list_research_files`, but real tools are `create_file`, `read_file`, and `list_files` |
| `README.md` is currently initialized as only `# folder-name` | It is not yet the final research report |
| `summary.md` is expected by the relevance evaluator but not guaranteed | Previous-research relevance depends on a file that may not exist |
| There is no memory-specific search path | Personal memories can be confused with research folders unless separated |

## Definitions

### Research Artifact

A research artifact is content about the task being researched.

Examples:

| Artifact | Example |
| -------- | ------- |
| Source notes | `Apple support page says model X supports feature Y.` |
| Search log | `Searched: "best bear canister Yosemite 2026".` |
| Comparison | `Option A is lighter; option B is cheaper.` |
| Final recommendation | `Choose product A if weight matters most.` |

Research artifacts belong in research files like `README.md`, `summary.md`, `notes.md`, `sources.md`, and other working files.

### User Memory

A user memory is a stable, reusable fact or preference about the user that could help future answers.

Examples:

| Good Memory | Why It Is Valid |
| ----------- | --------------- |
| `User has a dog.` | Stable personal context that can affect travel, hiking, products, housing, and pet-related advice |
| `User prefers prices in EUR.` | Persistent output preference |
| `User is based in Berlin.` | Stable location context when location matters |
| `User uses macOS.` | Useful for software, hardware, terminal, and app setup advice |
| `User prefers concise recommendations.` | Useful response-style preference |

Not every user statement should become a memory.

Examples that should not be stored:

| Bad Memory Candidate | Why To Skip It |
| -------------------- | -------------- |
| `User is researching backpacks today.` | Task context, not a durable personal fact |
| `User asked about Garmin watches.` | A past query, not a stable preference |
| `User said thanks.` | Low-value conversational detail |
| `User may like ultralight gear.` | Weak inference unless explicitly stated or repeated |
| `User entered an API key.` | Sensitive information, never store |
| `User has a medical condition.` | Sensitive by default; store only with explicit user instruction |

### Memory Candidate

A memory candidate is a proposed memory extracted by the model before validation. Candidates are not automatically stored.

Each candidate should be checked for:

| Check | Question |
| ----- | -------- |
| Stability | Will this likely remain true beyond the current research session? |
| Personal relevance | Is it about the user, not just the researched topic? |
| Future usefulness | Could it improve future answers? |
| Evidence | Did the user explicitly state it, or is it a weak inference? |
| Sensitivity | Is it private, medical, financial, credential-like, or otherwise risky? |
| Specificity | Is it concrete enough to retrieve and apply correctly later? |

### Relevant Memory

A relevant memory is a stored memory that would materially help answer the current query.

Relevance is not the same as semantic similarity. A memory can be semantically near a query but still useless. For example, `User has a dog` may be semantically close to `best dog GPS collar`, but if the user asks for `IT gadgets for a desk`, the dog memory should not be injected.

## Canonical Files

### `README.md`

`README.md` is the final user-facing research report.

It should answer the research request directly and be useful if opened months later.

Required content:

| Section | Purpose |
| ------- | ------- |
| Title | Human-readable research title |
| Answer / Recommendation | The final conclusion, decision, or ranked result |
| Key Findings | Main researched facts, caveats, and tradeoffs |
| Evidence | Important sources with URLs |
| Confidence | What is high/medium/low confidence and why |
| Open Questions | Anything unresolved or dependent on future changes |
| Last Updated | Date/time the report was finalized |

Rules:

| Rule | Reason |
| ---- | ------ |
| `README.md` should not be the research plan | Existing evaluator wording should be updated to treat it as the final report |
| `README.md` should not contain private API keys or credentials | It is indexed and visible in research history |
| `README.md` should cite source URLs | It is the durable result of the research |
| `README.md` should be concise enough to re-read | Raw source dumps belong in notes files, not the final report |

### `summary.md`

`summary.md` is a compact, search-optimized representation of the research.

It is not a mini version of every source note. It is the indexing and retrieval handoff for future sessions.

Required content:

| Section | Purpose |
| ------- | ------- |
| Research Scope | What the folder researched |
| Final Answer | One compact answer or outcome |
| Search Keywords | Terms, entities, products, locations, and aliases future queries might use |
| Key Decisions | The most important conclusions |
| Source Quality | Primary/secondary/weak evidence summary |
| Reuse Guidance | When future sessions should reuse this folder |

Example:

```md
# Summary

Research scope: Dog-friendly weekend hiking routes near Berlin with public transport access.

Final answer: The best options are X, Y, and Z because they allow dogs, are reachable without a car, and have manageable route length.

Search keywords: Berlin hiking, dog-friendly trails, Brandenburg, public transport, weekend trip, pet-friendly route, S-Bahn, regional train.

Reuse guidance: Reuse this research for dog-friendly hiking, Berlin-area nature trips, and weekend route planning. Do not reuse it for unrelated hiking gear comparisons.
```

Why `summary.md` matters:

| Benefit | Explanation |
| ------- | ----------- |
| Better folder retrieval | Search can match compact scope instead of scattered working notes |
| Lower evaluator cost | Relevance evaluator can read a short summary first |
| Less noise | Raw notes often contain broad exploration that should not define the folder's final scope |

### `memories.md`

`memories.md` stores memory entries learned during this research session.

It should be structured and conservative. Empty is valid.

Recommended format:

```md
# Memories

No durable user memories were identified in this research session.
```

Or, when memories exist:

```md
# Memories

## User Memories

### memory-2026-06-09-001

- Memory: User has a dog.
- Category: personal_context
- Source: explicit_user_statement
- Confidence: high
- Applies when: hiking, travel, pet-friendly planning, outdoor routes, lodging, transport constraints, product recommendations involving pets
- Do not use when: unrelated software research, IT gadgets, general market research, topics where pet ownership does not affect the answer
- Evidence: User said they have a dog while discussing hiking research.
- Created: 2026-06-09
```

Required fields:

| Field | Meaning |
| ----- | ------- |
| `Memory` | Atomic fact or preference in one sentence |
| `Category` | One of the allowed memory categories |
| `Source` | Whether the memory was explicit, inferred, or user-confirmed |
| `Confidence` | `high`, `medium`, or `low` |
| `Applies when` | Topics or tasks where this memory is likely useful |
| `Do not use when` | Topics or tasks where this memory should be ignored |
| `Evidence` | Short provenance phrase, not a raw transcript dump |
| `Created` | Date the memory was written |

Allowed categories:

| Category | Examples |
| -------- | -------- |
| `personal_context` | Dog ownership, city, household constraints |
| `preference` | Preferred currency, style, brands, formats, dietary preferences |
| `technical_environment` | macOS, shell, editor, framework, hardware platform |
| `ongoing_goal` | Long-running project, career goal, recurring research objective |
| `constraint` | Budget range, accessibility need, travel constraint, time constraint |
| `domain_expertise` | User is advanced in Rust, beginner in React, familiar with finance |

Sensitive categories should not be stored by default:

| Sensitive Area | Default Behavior |
| -------------- | ---------------- |
| Credentials, secrets, API keys | Never store |
| Medical/health information | Do not store unless user explicitly asks to remember it |
| Financial account details | Do not store unless clearly non-sensitive and explicitly requested |
| Legal status, identity documents | Do not store |
| Precise address or private location | Do not store unless explicitly requested |
| Third-party personal data | Do not store unless necessary, non-sensitive, and user-authorized |

## Finalization Flow

The agent should call one dedicated tool when the research is complete.

Proposed tool name:

```ts
finalize_research
```

Purpose:

| Purpose | Description |
| ------- | ----------- |
| Write canonical files | Creates or updates `README.md`, `summary.md`, and `memories.md` |
| Validate memory structure | Rejects vague, overbroad, sensitive, or malformed memories |
| Index canonical files | Calls the existing research indexer after writing each file |
| Make finalization enforceable | Guardrails can require this tool before final answers |

Why a tool instead of prompt-only instructions:

| Prompt-Only Problem | Tool-Based Fix |
| ------------------- | -------------- |
| Agent may forget to write one file | Tool writes all required files in one call |
| Agent may invent arbitrary formats | Tool validates a schema |
| Agent may store sensitive memories | Tool can reject or drop forbidden categories |
| Agent may write final results into random files | Tool makes canonical outputs explicit |
| Guardrails cannot easily inspect file writes | Guardrails can detect `finalize_research` call |

Recommended input schema:

```ts
const MemoryCandidateSchema = z.object({
  memory: z.string().min(1),
  category: z.enum([
    "personal_context",
    "preference",
    "technical_environment",
    "ongoing_goal",
    "constraint",
    "domain_expertise",
  ]),
  source: z.enum([
    "explicit_user_statement",
    "user_confirmed",
    "inferred",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  applies_when: z.array(z.string()).min(1),
  do_not_use_when: z.array(z.string()).min(1),
  evidence: z.string().min(1),
});

const FinalizeResearchInputSchema = z.object({
  readme: z.string().min(1),
  summary: z.string().min(1),
  memories: z.array(MemoryCandidateSchema),
});
```

Recommended execution steps:

| Step | Action |
| ---- | ------ |
| 1 | Resolve the active research folder via `getResearchFolder()` |
| 2 | Validate `readme` and `summary` are non-empty markdown strings |
| 3 | Filter or reject memory candidates using deterministic safety rules |
| 4 | Render `memories.md` from accepted candidates |
| 5 | Write `README.md`, `summary.md`, and `memories.md` with `writeAppFile()` |
| 6 | Index each file with `indexResearchFile()` |
| 7 | Return `{ files: ["README.md", "summary.md", "memories.md"], memoryCount }` |

Recommended behavior for empty memories:

| Scenario | `memories.md` Content |
| -------- | --------------------- |
| No durable user memories found | `# Memories\n\nNo durable user memories were identified in this research session.\n` |
| Only rejected/sensitive candidates found | Same as empty, plus optional non-sensitive note: `No memories stored due memory policy.` |

## Memory Extraction Rules

The memory extractor should be conservative.

Core rule:

```text
Only store stable, reusable information about the user that is likely to improve future answers.
When uncertain, do not store it.
```

### Store

Store a candidate if all are true:

| Requirement | Explanation |
| ----------- | ----------- |
| User-related | It describes the user, their environment, their preferences, or durable constraints |
| Stable | It is likely to remain useful after this session |
| Reusable | It can help future research or recommendations |
| Grounded | It is explicitly stated or strongly confirmed by the conversation |
| Safe | It is not sensitive by default |
| Atomic | It can stand alone as one memory |

Examples:

| User Says | Stored Memory |
| --------- | ------------- |
| `I have a dog, so hikes need to be dog-friendly.` | `User has a dog and prefers dog-friendly hiking options.` |
| `I am on macOS.` | `User uses macOS.` |
| `Please always use EUR for prices.` | `User prefers prices in EUR.` |
| `I am new to Rust.` | `User is a beginner in Rust.` |
| `I usually travel without a car.` | `User prefers car-free travel options.` |

### Skip

Skip a candidate if any are true:

| Skip Reason | Example |
| ----------- | ------- |
| It is only about the current task | `User is researching tents today.` |
| It is a weak inference | `User probably likes camping.` |
| It is generic world knowledge | `Dogs need water on hikes.` |
| It is low-value chat | `User said hello.` |
| It is a one-off output request | `User wants a table in this answer.` |
| It is sensitive | `User shared an API key.` |
| It is about a third party without lasting user relevance | `User's friend is shopping for a phone.` |

### Infer Only With Care

Inferred memories are risky. They should be rare.

Allowed inference:

| Evidence | Candidate |
| -------- | --------- |
| User repeatedly asks for commands using `zsh` and references their Mac setup | `User likely uses macOS with zsh.` with `source: inferred`, `confidence: medium` |

Disallowed inference:

| Evidence | Bad Candidate | Why |
| -------- | ------------- | --- |
| User asks about dog-friendly hikes | `User owns a dog.` | They may be researching for someone else unless they said it |
| User asks about medical symptoms | `User has condition X.` | Sensitive and speculative |
| User asks about expensive watches | `User is wealthy.` | Unsupported and inappropriate |

If a memory would be useful but is uncertain, the agent can ask with `ask_questions`:

```text
Do you want me to remember that you usually need dog-friendly hiking options for future travel research?
```

If the user confirms, store it as `source: user_confirmed`.

## Memory Retrieval Flow

Memory retrieval should run before web search, but after the first user query is known.

Recommended flow for a new chat:

```text
User message
  -> create provisional research folder
  -> previous research lookup
  -> memory lookup
  -> relevance filtering
  -> build system prompt additions
  -> agent decides whether to ask about previous research
  -> agent starts/continues research
```

The lookup must keep previous research and personal memories separate.

### Track 1: Previous Research Lookup

Purpose:

```text
Find existing research folders that may answer or materially help the current query.
```

Inputs:

| Input | Source |
| ----- | ------ |
| First user message | Chat messages |
| Plan-derived query variants | Later `search_research` calls |
| Indexed research files | SQLite chunks and embeddings |

Outputs:

```ts
Array<{ folder_name: string }>
```

Behavior:

| Case | Action |
| ---- | ------ |
| Relevant research folders found | Ask user whether to continue one or start fresh |
| No relevant folders found | Continue normal workflow |
| Search fails | Continue normal workflow without surfacing backend errors |

### Track 2: Memory Lookup

Purpose:

```text
Find specific user memories that may help answer the current query.
```

Inputs:

| Input | Source |
| ----- | ------ |
| Current user message | Chat messages |
| Optional plan-derived query | Research plan |
| Indexed `memories.md` chunks | Existing research folders |

Outputs:

```ts
Array<{
  folder_name: string;
  memory: string;
  category: string;
  relevance: "use" | "ignore";
  reason: string;
}>
```

Behavior:

| Case | Action |
| ---- | ------ |
| Relevant memories found | Add a `Relevant user memories` section to the system prompt |
| No relevant memories found | Add nothing |
| Memory search fails | Add nothing and continue |
| Memory conflicts with current user message | Current user message wins |

Important distinction:

```text
A memory match should never trigger the "continue previous research?" question by itself.
```

## How To Search Memories

### Minimal Implementation

Use the existing `searchResearch()` function, then filter raw results by filename.

```ts
const rawResults = await searchResearch(
  embeddingConfig,
  rerankerConfig,
  query,
  { limit: 20, abortSignal },
);

const memoryCandidates = rawResults.filter(
  (result) => result.filename === "memories.md",
);
```

Then pass the candidates to a memory relevance evaluator.

Pros:

| Pro | Explanation |
| --- | ----------- |
| Minimal backend changes | No SQLite schema change required |
| Uses existing embeddings and FTS | Same index pipeline works |
| Fast to implement | Can live in TypeScript first |

Cons:

| Con | Explanation |
| --- | ----------- |
| Backend still searches all files first | It may waste retrieval capacity on non-memory chunks |
| Chunk format matters | `memories.md` entries should be compact and self-contained |
| No memory-level IDs in DB | IDs need to be parsed from markdown or inferred from chunks |

### Better Implementation

Add a `filename` filter to the backend search command.

Proposed API:

```ts
searchResearch(embeddingConfig, rerankerConfig, query, {
  folder,
  filenames: ["memories.md"],
  limit: 20,
  abortSignal,
});
```

Backend changes:

| File | Change |
| ---- | ------ |
| `src/lib/research-search.ts` | Add `filenames?: string[]` to options and invoke payload |
| `src-tauri/src/lib.rs` | Add `filenames: Option<Vec<String>>` to `search_research` command |
| `src-tauri/src/research_search/search.rs` | Filter candidates by filename after KNN/FTS retrieval and before MMR/rerank |

Pros:

| Pro | Explanation |
| --- | ----------- |
| Better recall for memories | Top-K retrieval is not crowded by research notes |
| Cleaner separation | Previous research and memories become distinct search modes |
| Reusable | Could also search only `summary.md` later |

### Long-Term Implementation

Add first-class memory tables.

Possible schema:

```sql
CREATE TABLE user_memories (
  id INTEGER PRIMARY KEY,
  memory_key TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  applies_when TEXT NOT NULL,
  do_not_use_when TEXT NOT NULL,
  evidence TEXT NOT NULL,
  source_folder TEXT,
  created_at TEXT DEFAULT (DATETIME('now')),
  updated_at TEXT DEFAULT (DATETIME('now')),
  archived_at TEXT
);

CREATE VIRTUAL TABLE user_memory_embeddings USING vec0(
  embedding float[1024]
);

CREATE VIRTUAL TABLE user_memories_fts USING fts5(
  content,
  applies_when,
  do_not_use_when,
  content='user_memories',
  content_rowid='id',
  tokenize='porter'
);
```

This is more powerful but not necessary for the first version.

## Memory Relevance Evaluation

The memory relevance evaluator decides whether retrieved memories should be injected into the active prompt.

It should answer this question:

```text
Would this memory materially improve the answer to the user's current query?
```

It should not answer:

```text
Is this memory semantically similar to the query?
```

Recommended evaluator prompt:

```text
You decide whether stored user memories are relevant to the user's current research request.

Use a memory only if it would materially affect the answer, constraints, recommendations, search strategy, or output formatting.

Do not include memories merely because they are about a related word.

Current user request:
{{query}}

Candidate memories:
{{memories}}

For each candidate, return:
- memory id
- decision: use or ignore
- short reason

Rules:
- Current user instructions override stored memories.
- Sensitive memories require explicit relevance.
- If relevance is uncertain, ignore the memory.
- Prefer fewer, higher-value memories.
```

Recommended output schema:

```ts
const MemoryRelevanceOutputSchema = z.object({
  decisions: z.array(z.object({
    memory_id: z.string(),
    decision: z.enum(["use", "ignore"]),
    reason: z.string(),
  })),
});
```

Examples:

| Query | Memory | Decision | Reason |
| ----- | ------ | -------- | ------ |
| `Find dog-friendly hiking trails near Berlin` | `User has a dog.` | `use` | Pet access directly affects trail choice |
| `Best backpacking tent for one person` | `User has a dog.` | `ignore` or `use` depending on wording | Use only if dog may sleep in tent or user asks pet-related gear |
| `Compare M3 MacBook docks` | `User has a dog.` | `ignore` | Dog ownership does not affect dock comparison |
| `Set up a Rust project on my machine` | `User uses macOS.` | `use` | OS affects commands and install steps |
| `Explain transformer attention` | `User uses macOS.` | `ignore` | OS does not affect conceptual explanation |

## Prompt Injection Format

Relevant memories should be injected into the system prompt, not returned as a visible search result.

Suggested section:

```md
## Relevant user memories

The following stored memories may help answer this request. Use them only if they remain relevant after reading the user's latest message. Current user instructions override these memories.

- User has a dog. Applies to pet-friendly hiking, travel, lodging, transport, and outdoor safety.
- User prefers prices in EUR. Use EUR for prices unless the user asks otherwise.
```

Rules for prompt injection:

| Rule | Reason |
| ---- | ------ |
| Inject only relevant memories | Avoid polluting unrelated answers |
| Keep the section short | Avoid token bloat and over-personalization |
| Include applicability phrase | Helps the model use memories narrowly |
| Remind that current user instruction wins | Prevent stale memory conflicts |
| Do not include evidence unless needed | Evidence can leak unnecessary conversation details |

Recommended limits:

| Limit | Value |
| ----- | ----- |
| Max memories injected | 5 |
| Max total tokens | Around 300 |
| Default threshold | Use only evaluator `decision: use` |

## Conflict Handling

Memories can become stale or contradictory.

Examples:

| Old Memory | New Statement | Action |
| ---------- | ------------- | ------ |
| `User uses macOS.` | `I switched to Linux.` | New statement wins; update or supersede old memory |
| `User prefers EUR.` | `Show this one in USD.` | Current request wins for this answer; do not necessarily update memory |
| `User has a dog.` | `I no longer have a dog.` | Supersede or archive the old memory |

First version behavior:

| Conflict Type | Behavior |
| ------------- | -------- |
| Current-turn conflict | Current user message wins |
| Same-session conflict | `finalize_research` should write only the latest true version |
| Cross-session conflict | Add a new memory entry and optionally mark the old one as superseded in future global memory implementation |

For per-folder `memories.md`, conflicts across folders are hard to update globally. The relevance evaluator can still avoid stale memories if the current user query contradicts them.

Long-term behavior should move stable memories into a first-class memory store with `archived_at`, `supersedes`, or `status` fields.

## Deletion and User Control

Users need control over persistent memories.

Minimum viable controls:

| Control | Behavior |
| ------- | -------- |
| `Do not remember that` | The agent should not write the candidate to `memories.md` |
| `Forget that I have a dog` | Future implementation should archive/delete matching memories |
| Delete research folder | Deletes that folder's `memories.md` and index chunks through existing folder deletion |

Better controls later:

| Control | Behavior |
| ------- | -------- |
| Memory review UI | Show all stored memories and allow delete/edit |
| Memory disabled setting | Never write `memories.md` except empty policy note |
| Sensitive memory confirmation | Ask before storing health, financial, legal, or location-sensitive data |
| Export memories | Save all memory entries as markdown/json |

## Safety Rules

### Do Not Store Secrets

Never store:

| Type | Examples |
| ---- | -------- |
| API keys | OpenRouter, Brave, Exa, Tavily, Serper keys |
| Passwords | Any password or passphrase |
| Tokens | OAuth tokens, bearer tokens, session cookies |
| Private keys | SSH keys, signing keys, wallet keys |
| Raw credentials | Username/password combinations |

### Avoid Sensitive Inferences

Do not infer or store sensitive attributes.

Examples:

| Do Not Infer | Why |
| ------------ | --- |
| Health conditions | Sensitive and often speculative |
| Political views | Sensitive and often irrelevant |
| Religion | Sensitive |
| Sexual orientation | Sensitive |
| Financial status | Sensitive and speculative |
| Exact home address | Highly sensitive |

### Store Less Than You Could

The memory system should optimize for precision, not recall.

False memory is worse than missing memory because it pollutes future answers.

Principles:

| Principle | Meaning |
| --------- | ------- |
| Conservative writes | Store only high-value memories |
| Narrow retrieval | Inject only when useful |
| Current turn wins | Never let stale memory override explicit instructions |
| User control | Respect delete/forget/no-memory requests |
| Auditability | Keep memory text readable in `memories.md` |

## Integration Points

### `src/lib/system-prompt.md`

Required prompt updates:

| Change | Reason |
| ------ | ------ |
| Replace old file tool names | Current tools are `create_file`, `read_file`, `update_file`, `list_files` |
| Add finalization requirement | Agent must call `finalize_research` before final answer |
| Define canonical files | Prevent random filenames for final outputs |
| Define memory policy | Prevent over-remembering and sensitive storage |
| Define current-turn precedence | Prevent stale memory mistakes |

### `src/lib/transport/guarded-stream.ts`

Required additions:

| Change | Reason |
| ------ | ------ |
| Run memory lookup beside upfront research lookup | Retrieves relevant user memories before agent work starts |
| Add `Relevant user memories` to `buildSystemPrompt()` | Gives the agent personalized context only when relevant |
| Keep memory matches separate from previous research matches | Avoid asking to continue a folder because of a memory hit |

### `src/lib/transport/tool-registry.ts`

Required addition:

| Tool | Purpose |
| ---- | ------- |
| `finalize_research` | Writes and indexes canonical files |

Optional addition:

| Tool | Purpose |
| ---- | ------- |
| `search_memories` | Lets the agent explicitly search memories later in a session |

### `src/lib/agent-guards.ts`

Required guardrail changes:

| Change | Reason |
| ------ | ------ |
| Add `finalize_research` guard | Ensure canonical files are written before final answer |
| Treat `finalize_research` as a research tool | It counts as research workflow completion |
| Retry instruction should be explicit | Ask model to finalize files, then answer |

Proposed guard behavior:

| Condition | Action |
| --------- | ------ |
| User request is research-like | Require research activity and checkpoint as today |
| Agent has checkpoint and verifier but no finalization | Retry with `toolChoice: finalize_research` |
| Agent called `finalize_research` | Allow final answer if other guardrails pass |

### `src/tools/file-tools.ts`

No direct change required for first version.

Reason:

| Existing Behavior | Impact |
| ----------------- | ------ |
| `create_file` and `update_file` already index files | `finalize_research` can reuse lower-level storage/index helpers directly |

### `src/lib/research-relevance-evaluator/prompt.md`

Required wording update:

| Current Meaning | New Meaning |
| --------------- | ----------- |
| `README.md` is the research plan/overview | `README.md` is the final research report |
| `summary.md` is often enough to understand scope | Keep this behavior |

### `docs/research-search.md`

Required documentation update:

| Current Text | Issue |
| ------------ | ----- |
| `save_research_file` | Real tool is `create_file`/`update_file`, and final artifacts should use `finalize_research` |

## Example End-To-End Flow

### Session 1: Hiking Research

User says:

```text
I have a dog. Find dog-friendly weekend hikes near Berlin that work without a car.
```

Agent flow:

| Step | Action |
| ---- | ------ |
| 1 | Creates provisional research folder |
| 2 | Searches previous research |
| 3 | Finds no matching previous folder |
| 4 | Asks clarifying questions if needed |
| 5 | Renames folder to `dog-friendly-berlin-hikes` |
| 6 | Creates research plan |
| 7 | Searches web and reads sources |
| 8 | Writes working notes throughout research |
| 9 | Calls `research_checkpoint` |
| 10 | Calls `verified_research_is_good` |
| 11 | Calls `finalize_research` |
| 12 | Final answer is shown to user |

Final files:

| File | Content |
| ---- | ------- |
| `README.md` | Final hiking recommendations and evidence |
| `summary.md` | Compact scope and keywords for future search |
| `memories.md` | `User has a dog.` and `User prefers car-free travel options.` |

### Session 2: More Hiking Research

User says:

```text
Find a good autumn hiking weekend.
```

Lookup behavior:

| Lookup | Result |
| ------ | ------ |
| Previous research | May find `dog-friendly-berlin-hikes` |
| Memory search | Finds `User has a dog.` and `User prefers car-free travel options.` |

Prompt addition:

```md
## Relevant user memories

- User has a dog. Applies to pet-friendly hiking, travel, lodging, transport constraints, and outdoor safety.
- User prefers car-free travel options. Applies to routes reachable by public transport.
```

Agent behavior:

| Behavior | Explanation |
| -------- | ----------- |
| Ask about previous folder | If the old hiking folder is relevant, ask whether to continue it |
| Use memories | Even if starting fresh, account for dog-friendly and car-free constraints |

### Session 3: IT Gadgets

User says:

```text
Compare the best USB-C docks for a MacBook.
```

Lookup behavior:

| Lookup | Result |
| ------ | ------ |
| Previous research | No hiking folder should be considered relevant |
| Memory search | `User has a dog` may be recalled by vector search but should be filtered out |
| Memory search | `User uses macOS` should be used if stored |

Prompt addition:

```md
## Relevant user memories

- User uses macOS. Applies to software/hardware compatibility and setup steps.
```

The dog memory is not injected.

## Suggested File Rendering

### `README.md` Template

```md
# {{Research Title}}

Last updated: {{ISO date}}

## Answer

{{Direct final answer or recommendation.}}

## Key Findings

{{Bulleted findings with concise evidence.}}

## Recommendation

{{Decision guidance, ranked options, or next action.}}

## Evidence

| Source | What it supports | URL |
| ------ | ---------------- | --- |
| {{source}} | {{claim}} | {{url}} |

## Confidence

{{High/medium/low confidence notes.}}

## Open Questions

{{Remaining uncertainty or future checks.}}
```

### `summary.md` Template

```md
# Summary

Research scope: {{one paragraph}}

Final answer: {{one paragraph}}

Search keywords: {{comma-separated terms, aliases, product names, locations}}

Key decisions:
- {{decision}}

Source quality: {{primary/secondary/weak source summary}}

Reuse guidance: {{when future research should reuse this folder and when it should not}}
```

### `memories.md` Template

```md
# Memories

## User Memories

### {{memory-id}}

- Memory: {{atomic memory}}
- Category: {{category}}
- Source: {{source}}
- Confidence: {{confidence}}
- Applies when: {{topics/tasks}}
- Do not use when: {{topics/tasks}}
- Evidence: {{short provenance}}
- Created: {{date}}
```

## Implementation Phases

### Phase 1: Canonical Finalization

Scope:

| Task | Details |
| ---- | ------- |
| Add `finalize_research` tool | Writes `README.md`, `summary.md`, `memories.md` |
| Update system prompt | Require finalization before final answer |
| Add guardrail | Enforce `finalize_research` for research-like answers |
| Update docs | Fix old tool names in `docs/research-search.md` |
| Add tests | Tool write/index tests and guardrail tests |

Expected result:

```text
Every completed research folder has the three canonical files.
```

### Phase 2: Memory Retrieval

Scope:

| Task | Details |
| ---- | ------- |
| Add internal memory lookup | Search raw `SearchResult[]`, filter `filename === "memories.md"` |
| Add memory relevance evaluator | LLM or structured output evaluator returns `use`/`ignore` |
| Inject relevant memories | Add prompt section in `buildSystemPrompt()` |
| Keep matches separate | Memory matches do not trigger previous-research continuation prompt |
| Add tests | Dog/hiking positive, dog/gadgets negative, macOS/dock positive |

Expected result:

```text
Relevant memories personalize future research without polluting unrelated tasks.
```

### Phase 3: Better Search Filters

Scope:

| Task | Details |
| ---- | ------- |
| Add filename filters to backend search | Support `filenames: ["memories.md"]` and `filenames: ["summary.md", "README.md"]` |
| Tune memory retrieval limits | Increase memory recall without mixing research notes |
| Update relevance evaluator | Prefer `summary.md`, then `README.md`, then selected notes |

Expected result:

```text
Memory retrieval is more accurate and less noisy.
```

### Phase 4: First-Class Memory Store

Scope:

| Task | Details |
| ---- | ------- |
| Add `user_memories` DB table | Store atomic memories with metadata |
| Add memory update/delete commands | Let UI and agent manage memories |
| Add review UI | User can inspect, edit, delete, or disable memories |
| Add conflict resolution | Archive superseded memories |

Expected result:

```text
Memories become user-level state, not only research-folder artifacts.
```

## Test Plan

### Unit Tests

| Test | Expected Result |
| ---- | --------------- |
| `finalize_research` writes all canonical files | `writeAppFile` called for `README.md`, `summary.md`, `memories.md` |
| `finalize_research` indexes files | `indexResearchFile` called for all canonical files |
| Empty memories render explicit empty file | `memories.md` says no durable memories found |
| Sensitive memory rejected | API key or password candidate is not written |
| Low-confidence inferred memory rejected | Weak inference does not appear in `memories.md` |
| Guard retries if final answer lacks finalization | `evaluateAssistantStep` returns retry for `finalize_research` |
| Guard accepts after finalization | Final answer passes when checkpoint and finalization exist |

### Memory Retrieval Tests

| Stored Memory | Query | Expected |
| ------------- | ----- | -------- |
| `User has a dog.` | `Find dog-friendly hikes` | Inject memory |
| `User has a dog.` | `Compare USB-C docks` | Do not inject |
| `User uses macOS.` | `Set up this tool locally` | Inject memory |
| `User prefers EUR.` | `Compare prices` | Inject memory |
| `User prefers EUR.` | `Explain attention mechanism` | Do not inject unless prices appear |

### Integration Tests

| Scenario | Expected |
| -------- | -------- |
| Complete research session | Folder contains all canonical files |
| Continue old folder | Existing `README.md` and `summary.md` are visible in context |
| Memory-only match | No continue-folder question unless previous research also matches |
| Delete research folder | Memory chunks from that folder disappear from search index |

## Failure Modes

| Failure | Impact | Mitigation |
| ------- | ------ | ---------- |
| Agent over-stores memories | Future answers become creepy or wrong | Conservative prompt, schema validation, guardrails, user review UI |
| Agent stores sensitive data | Privacy risk | Deterministic rejection rules in `finalize_research` |
| Relevant memory not retrieved | Missed personalization | Acceptable early tradeoff; tune retrieval later |
| Irrelevant memory injected | Bad personalization | LLM relevance evaluator and strict thresholds |
| Stale memory conflicts with user | Wrong answer | Current user message always wins |
| `summary.md` missing in old folders | Previous research search less accurate | Evaluator falls back to `README.md` and other files |
| Structured output fails | Finalization blocked | Tool schema can accept plain strings and structured memories; retry with guardrail |

## Why This Design

This design uses the current app's strengths:

| Current Strength | How The Design Uses It |
| ---------------- | ---------------------- |
| Research folders already exist | Memories can start as `memories.md` inside folders |
| File writes already index content | Canonical files become searchable immediately |
| Backend already supports hybrid search | Memory lookup can reuse vector + FTS + rerank |
| Relevance evaluator pattern already exists | Memory relevance can use a similar sub-agent |
| Guardrails already retry missing workflow steps | Finalization can be enforced like research checkpoints |

This design avoids early overengineering:

| Avoided Change | Why It Can Wait |
| -------------- | --------------- |
| Global memory DB | Per-folder `memories.md` is enough to validate behavior first |
| Memory management UI | Useful later, not needed for first working pipeline |
| Graph memory | Not necessary until many memories conflict or require multi-hop reasoning |
| Provider-specific memory services | The app already has local storage and search |

## External References

These references informed the design:

| Topic | Source |
| ----- | ------ |
| AI SDK structured output with `generateText` and `Output.object` | https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data |
| AI SDK 6 migration from `generateObject` to `generateText` structured output | https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0 |
| AI SDK reranking API | https://ai-sdk.dev/docs/ai-sdk-core/reranking |
| Memory extraction should be selective and avoid low-value writes | https://www.arxiv.org/pdf/2604.07877 |
| Memory retrieval differs from normal RAG and must be moment-relevant | https://mem0.ai/blog/rag-vs-ai-memory |
| Structured memory facts plus summaries reduce noisy transcript retrieval | https://www.arxiv.org/pdf/2603.19935 |

## Final Recommendation

Build this in two passes.

First, add `finalize_research` and enforce canonical file creation. This fixes the immediate problem that the agent writes many random files but does not reliably leave behind the files that matter.

Second, add memory lookup and relevance-gated injection. This makes `memories.md` useful without confusing personal memories with previous research folders.

Do not start with a global memory database. Use per-folder `memories.md` to prove the extraction policy, relevance gate, and user experience first. Move to a first-class memory store only after the behavior is validated.
