# AGENTS.md

## Project

Deep Search — a Tauri v2 desktop app for AI-powered research. React/TypeScript frontend, Rust backend. No separate server; LLM calls go directly from the frontend via Vercel AI SDK provider packages.

## Commands

- `npm run dev` — Vite dev server only (port 1420). To run the full desktop app: `npm run tauri dev`
- `npm run build` — runs `tsc && vite build` (typecheck is baked in, no separate typecheck script)
- `npm run storybook` — browser-only Storybook dev server for frontend UI review (does not use Tauri)
- `npm run build-storybook` — static Storybook build
- `npm run storybook:screenshots` — build Storybook and capture one image per story into `storybook-screenshots/`
- `npm run storybook:screenshots:dev` — capture screenshots from an already-running Storybook server at `http://127.0.0.1:6006`
- `npm test` / `npm run test:watch` — Vitest unit tests
- `npm run test:e2e` — WebdriverIO e2e tests in `e2e-tests/` (requires cargo build + running Tauri binary)
- Rust tests: `cargo test` in `src-tauri/`
- No dedicated lint command exists

## Architecture

```
src/                        # React frontend (Vite + Tailwind CSS 4)
  lib/                      # Core logic: providers, transport, guards, settings
    transport/              # Chat transport layer — DirectTransport, tool registry, guardrails
    system-prompt.md        # Loaded as raw text for the AI
  tools/                    # AI tool definitions (search, extract, research, etc.)
  components/
    ui/                     # shadcn/ui components (new-york style)
    assistant-ui/           # Chat UI built on @assistant-ui/react
src-tauri/                  # Rust backend (Tauri v2)
  src/
    lib.rs                  # Tauri commands: tabs, fetch, content extraction
    research_search/        # SQLite + sqlite-vec vector search (chunking, embeddings, indexing)
e2e-tests/                  # WebdriverIO e2e (separate npm package)
```

## Key Facts

- **Path alias**: `@/*` → `./src/*` (in tsconfig, vite.config, vitest.config)
- **AI providers**: Anthropic, OpenRouter, Zhipu — configured at runtime via settings, not env vars
- **Search backends**: Brave, Exa, Serper, Tavily, SearXNG — all optional, enabled per-API-key
- **Tool registration**: `src/lib/transport/tool-registry.ts` — tools are conditionally included based on configured keys
- **Guardrail system**: `src/lib/agent-guards.ts` evaluates assistant steps; applied in `src/lib/transport/guarded-stream.ts`
- **API key storage**: Tauri plugin-store (not `.env` files)

## Adding New API Domains

When adding a new external API endpoint, update **both** files:
1. `src-tauri/tauri.conf.json` → `app.security.csp.connect-src`
2. `src-tauri/capabilities/default.json` → `http:default`, `http:allow-fetch-send`, `http:allow-fetch-read-body` allow lists

## Testing

- Unit test files are co-located in `__tests__/` directories within each module
- Rust tests are inline (`#[cfg(test)]` modules) in `src-tauri/src/lib.rs`
- E2E tests build and launch the actual Tauri app (expensive, not part of normal dev flow)
- **E2E tests MUST always run in a subagent** (using the Task tool with a `general` subagent) — they are expensive to run and produce large amounts of output that would consume too much context in the main conversation. Never run `npm run test:e2e` or `cargo test` directly; always delegate to a subagent.

## Storybook UI Testing

- Use Storybook for normal browser-based visual development and component review; do not launch the Tauri shell just to inspect frontend UI states.
- Stories are colocated as `ComponentName.stories.tsx`. Add or update stories when changing reusable components, panels, empty states, loading states, errors, or responsive layout behavior.
- `storybook-static/` and `storybook-screenshots/` are generated outputs and are ignored by git.
- To exclude a story from screenshot generation, add the Storybook tag `skip-screenshot` to that story or meta export.

### UI skills

These skills provide structured workflows for visual work. Load them when the task matches:

- **`storybook-snapshots`** — Bulk screenshot capture (all stories or filtered, light/dark, desktop/mobile). Use for before/after comparisons and regression sweeps.
- **`review-ui`** — Post-change visual QA pass. Captures screenshots, runs the vision agent with a structured checklist, verifies both color schemes. Run before considering UI work done.
- **`debug-visual-spacing`** — Diagnosing specific spacing/layout/alignment bugs. Inspects computed CSS first, then targeted vision agent analysis.
- **`ui-toolkit`** — Shared reference for Storybook iframe inspection, Mantine gotchas, cropped screenshots, and vision agent prompting rules. Loaded by the other UI skills.

## Conventions

- shadcn/ui components live in `src/components/ui/` — use `npx shadcn@latest add <component>` to add new ones
- `components.json` configures shadcn with `@/` aliases
- Tauri webview children are used for browser tabs (see `use-browser-tabs` hook)
- Markdown prompts are imported via `?raw` suffix (e.g., `system-prompt.md?raw`)
- Zod v4 is used for validation schemas
