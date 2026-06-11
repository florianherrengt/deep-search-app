# Research Workflow

Use this file for AI research flows, search providers, extraction, source handling, citations, guardrails, and research-agent behaviour.

## Scope

This workflow applies when changing:

- Research tools
- Search tools
- Extraction tools
- Source ranking
- Citation handling
- Research prompts
- Multi-step research flows
- Provider-specific research behaviour
- Guardrails for assistant/tool steps
- Saved research outputs
- Search backend configuration
- Prompt-to-results flows

## Core Rule

Research quality depends on source quality, not just answer quality.

Do not optimise only for fluent responses. Optimise for:

- Relevant searches
- Good source selection
- Accurate extraction
- Clear citations
- Conflicting-source handling
- Transparent uncertainty
- Repeatable research steps

## Research Stack

Search backends may include:

- Brave
- Exa
- Serper
- Tavily
- SearXNG

All search backends are optional and enabled based on configured API keys.

AI providers are configured at runtime, not through `.env`.

Tool registration is conditional and lives in:

```text id="gcp8ny"
src/lib/transport/tool-registry.ts
```

Guardrails live in:

```text id="3m7lxn"
src/lib/agent-guards.ts
src/lib/transport/guarded-stream.ts
```

Research prompts may be imported as raw Markdown using `?raw`.

## Before Editing

Inspect existing patterns first.

Check:

```text id="3lmi1c"
src/tools/
src/lib/transport/
src/lib/agent-guards.ts
src/lib/transport/tool-registry.ts
src/lib/system-prompt.md
src-tauri/src/research_search/
```

Look for:

- Existing tool schemas
- Existing provider abstractions
- Existing search result types
- Existing citation formats
- Existing extraction behaviour
- Existing guardrail expectations
- Existing tests for research/search tools

Do not invent a second research pipeline if one already exists.

## Research Flow

A good research flow usually follows this shape:

```text id="sidnoj"
1. Understand the user question
2. Ask clarifying questions only when necessary
3. Build search queries
4. Search across enabled providers
5. Deduplicate and rank sources
6. Extract useful page content
7. Cross-check facts
8. Identify uncertainty or disagreement
9. Produce a cited answer
10. Save or display useful research state where relevant
```

For deep research, prefer multiple focused passes instead of one huge search.

Example passes:

```text id="qwnoki"
Pass 1: broad overview
Pass 2: authoritative sources
Pass 3: recent updates
Pass 4: counterexamples or conflicting evidence
Pass 5: final verification of key claims
```

## Query Strategy

Generate specific queries, not vague ones.

Good queries include:

- Core entities
- Synonyms
- Product/project names
- Dates or recency terms when relevant
- Domain-specific terms
- Comparison terms when needed
- Error messages exactly as written
- Source-type terms such as docs, pricing, changelog, GitHub, paper, regulation

Avoid:

- One generic query for the whole task
- Repeating the same query across providers without variation
- Searching only for the user’s exact wording when synonyms matter
- Ignoring recentness when the question is time-sensitive

## Source Selection

Prefer primary sources.

Strong sources include:

- Official documentation
- Official changelogs
- API references
- Standards documents
- Research papers
- Government/regulator pages
- Vendor pricing pages
- GitHub repositories/issues when the question is about code behaviour
- Direct product pages when researching products

Use secondary sources when they add useful context, but do not let low-quality summaries outrank primary sources.

Be careful with:

- SEO pages
- AI-generated content farms
- Old blog posts
- Forum comments without corroboration
- Outdated docs
- Reposted documentation
- Affiliate product pages
- Marketing pages with no technical detail

## Freshness

For time-sensitive topics, check dates.

Time-sensitive areas include:

- Prices
- APIs
- SDKs
- Model capabilities
- Regulations
- Product availability
- Provider limits
- Search backend behaviour
- Security issues
- Compatibility claims
- Current events

Do not assume remembered knowledge is current.

If sources conflict, prefer the newest authoritative source and mention the conflict when it matters.

## Extraction Rules

When extracting page content:

- Keep source URL/title metadata
- Preserve relevant headings
- Preserve tables where useful
- Preserve dates
- Preserve code blocks when relevant
- Preserve product specs and pricing details
- Remove navigation, ads, cookie banners, and unrelated boilerplate
- Avoid summarising too early if details are needed later

For product/vendor pages, preserve:

- Price
- Currency
- Region
- Availability
- Model/version
- Limits
- Compatibility notes
- Footnotes
- Date if visible

For technical docs, preserve:

- Version
- API names
- Parameters
- Return values
- Deprecation notes
- Examples
- Error messages
- Compatibility constraints

## Citation Rules

Every factual claim derived from sources should be traceable.

Citations should support the exact claim being made.

Do not cite a source merely because it is related.

When summarising research, include:

- Source title or domain when useful
- Date or version when relevant
- What the source actually supports
- Uncertainty where the source is incomplete

Avoid:

- Citation dumping
- Citing weak sources for strong claims
- Hiding conflicts between sources
- Overstating what a source proves

## Handling Conflicts

When sources disagree:

1. Identify the exact disagreement.
2. Check source age.
3. Prefer primary sources.
4. Check whether the sources discuss different regions, versions, models, or dates.
5. State the disagreement if it affects the answer.
6. Avoid pretending there is certainty when there is not.

Useful phrasing for final answers:

```text id="1foxzm"
The most reliable source I found says X.
A secondary source says Y, but it appears older / less specific.
I would treat X as the current answer unless the project has unpublished changes.
```

## Guardrails

Research tools should be guarded against:

- Unsupported claims
- Fabricated citations
- Tool loops
- Repeated searches with no new information
- Low-quality source overuse
- Ignoring user constraints
- Stale information presented as current
- Overconfident answers from weak evidence
- Asking unnecessary clarification questions
- Producing final answers before extraction/verification is complete

When changing guardrails, add or update tests.

## Asking Clarifying Questions

Ask clarifying questions only when the missing detail would materially change the research plan.

Do not ask when a reasonable first pass can proceed.

Prefer starting research with assumptions and stating them when:

- The user’s intent is clear enough
- The ambiguity can be resolved by searching
- Multiple interpretations can be researched in parallel
- The cost of a wrong assumption is low

Ask when:

- The target entity is ambiguous
- The region/jurisdiction is essential
- The user asks for a recommendation with strong personal constraints missing
- The search would be mostly wasted without clarification

## Parallel Research

Use subagents for broad or multi-angle research.

Good parallel splits:

- One subagent searches official docs
- One subagent checks GitHub/issues/changelogs
- One subagent checks pricing/product pages
- One subagent checks recent news or announcements
- One subagent checks alternatives/competitors
- One subagent verifies citations and source quality

Subagent report format:

```text id="xkc805"
Scope checked:
Queries used:
Sources found:
Key findings:
Conflicts/uncertainty:
Recommended next step:
```

The main agent owns final synthesis and final answer.

Do not let subagents make the final recommendation without review.

## Tool Design Rules

Research tools should have clear schemas.

Prefer explicit inputs:

```text id="eaqkt9"
query
maxResults
provider
recency
includeDomains
excludeDomains
searchType
```

Avoid ambiguous inputs like:

```text id="4tr3so"
data
options
config
payload
```

Tool outputs should include enough metadata for ranking and citation:

```text id="4lgtop"
title
url
snippet
provider
publishedDate
retrievedAt
score
sourceType
```

Extraction outputs should include:

```text id="3y4n8p"
url
title
content
headings
metadata
extractedAt
```

Errors should be structured:

```ts id="zla2ol"
type ResearchToolError = {
  code: string;
  message: string;
  provider?: string;
  retryable?: boolean;
  details?: unknown;
};
```

## Provider Behaviour

Search providers differ.

Do not assume all providers support the same options.

When changing provider integrations, check:

- API key handling
- Rate limits
- Query syntax
- Recency/date filters
- Domain filters
- Result shape
- Error shape
- Empty result behaviour
- Timeout behaviour
- Retry behaviour
- Provider-specific ranking quirks

If a provider fails, the app should degrade gracefully when other providers are available.

## API Keys and Settings

API keys are runtime settings.

Do not add `.env`-based provider configuration unless explicitly requested.

When changing provider settings, check:

- Key storage
- Missing key state
- Invalid key state
- Tool registration
- UI settings state
- Error message shown to the user
- Whether the provider should be hidden, disabled, or shown as unavailable

## Search Result Ranking

Ranking should consider:

- Source authority
- Relevance to query
- Freshness
- Specificity
- Content availability
- Duplicate/near-duplicate detection
- Whether extraction succeeded
- Whether the source directly supports the user’s question

Do not rank sources only by provider score.

A lower-ranked official page may be more useful than a higher-ranked SEO summary.

## Local Research Index

For code touching local/vector research search, inspect:

```text id="n40iw1"
src-tauri/src/research_search/
```

Check:

- Chunking strategy
- Embedding model/provider assumptions
- SQLite schema
- sqlite-vec usage
- Index creation/migration
- Deduplication
- Query ranking
- Metadata storage
- Deletion/update behaviour
- Error handling

For schema or indexing changes, use `.agents/testing.md` and consider Rust tests.

## Saved Outputs

When changing saved research outputs, preserve:

- Original user question
- Search queries used
- Sources searched
- Sources cited
- Extracted notes
- Final answer
- Timestamp
- Provider/tool metadata where useful
- Any uncertainty or unresolved conflicts

Saved output should be useful for later review, not just pretty.

## Sidecar Interaction

Use `.agents/sidecar.md` when research work touches:

- Local runtime jobs
- Node sidecar execution
- Long-running research tasks
- Local file writes
- Process lifecycle
- Streaming output
- Cancellation
- Runtime packaging

Do not bury sidecar assumptions inside research tools.

## Testing

Use `.agents/testing.md` for detailed testing strategy.

For research changes, usually check:

- Tool unit tests
- Provider adapter tests
- Search result ranking tests
- Extraction tests
- Guardrail tests
- Settings/tool registration tests
- Empty/error result tests
- Cancellation/timeout tests

Add regression tests for:

- Fabricated citations
- Missing citations
- Wrong provider registration
- Invalid API key behaviour
- Empty search results
- Extraction failures
- Conflicting source handling
- Stale-source ranking bugs

Use targeted E2E only when the full prompt-to-results flow is affected.

E2E must be delegated to a subagent.

## Common Change Checklist

Before finishing research-related work, check:

- Are source metadata and citations preserved?
- Are provider errors handled gracefully?
- Are empty results handled clearly?
- Are stale sources treated carefully?
- Are primary sources preferred?
- Are conflicting sources represented honestly?
- Are API keys still runtime-configured?
- Are tool schemas typed and validated?
- Are guardrails updated if behaviour changed?
- Are tests added or updated?
- Is E2E needed for prompt-to-results behaviour?

## Done Criteria

Research work is done when:

- The changed research behaviour is implemented
- Search/extraction/source handling remains traceable
- Citations can be tied back to sources
- Empty/error states are handled
- Provider availability and API key states are respected
- Guardrails still prevent unsupported final answers
- Relevant tests pass
- Prompt-to-results E2E was delegated if needed
- The final summary says what changed, what was verified, and what risk remains
