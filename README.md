# Deep Search

A desktop research agent that runs on your machine, with your API keys, storing everything on your disk.

<!-- TODO: Add screenshot here. Something like: -->
<!-- <img src="docs/screenshot.png" alt="Deep Search screenshot" width="800"> -->

## Download

[Get the latest release](https://github.com/example-user/deep-search-app/releases) for your platform.

| Platform              | Format               |
| --------------------- | -------------------- |
| macOS (Apple Silicon) | `.dmg`               |
| macOS (Intel)         | `.dmg`               |
| Windows               | `.msi` / `.exe`      |
| Linux                 | `.deb` / `.AppImage` |

The app auto-updates when new versions come out.

## Getting started

1. Download and install.
2. Open Settings, paste in your LLM provider API key.
3. Add at least one search provider API key.
4. Ask a question.

## You own everything

You pick the LLM provider. You pick the search backends. You hold the API keys. The app talks directly to the services you choose — no middleman, no cloud server routing your questions through someone else's infrastructure.

If you want full privacy, you can run a local LLM and a self-hosted search engine like SearXNG. Everything stays on your machine. No data leaves your network unless you decide it should.

Your research is saved to per-topic folders on your disk, indexed with vector search, so you can search across past projects and pick up where you left off.

Because the app runs from your computer with a real browser webview, websites see a normal browser session. You are less likely to get blocked as a bot compared to cloud-based research tools.

## How it works

The agent searches the web, reads the actual pages, follows leads, cross-references sources, checks for contradictions, and verifies high-risk claims before writing up the answer with citations.

Each step is a separate tool call with guardrails. The agent has to actually fetch and read sources — it can't skip steps or make them up.

## Providers

LLM (pick one or more):

- Anthropic (Claude)
- OpenRouter
- Zhipu

Search (pick one or more):

- Brave Search
- Exa
- Serper
- Tavily
- SearXNG (self-hosted)

API keys are stored locally via Tauri's plugin-store.

## Development

You need Node.js LTS, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm install
npm run tauri dev
```

| Command                        | What it does                    |
| ------------------------------ | ------------------------------- |
| `npm run dev`                  | Frontend only (Vite, port 1420) |
| `npm run build`                | TypeScript check + Vite build   |
| `npm test`                     | Unit tests (Vitest)             |
| `npm run test:e2e`             | E2e tests (WebdriverIO)         |
| `cargo test` (in `src-tauri/`) | Rust backend tests              |

## Architecture

```
src/                          # React frontend (Vite + Tailwind CSS 4)
  lib/
    transport/                # Chat transport, tool registry, guardrails
    system-prompt.md          # Agent system prompt
  tools/                      # AI tool definitions (search, extract, research...)
  components/
    assistant-ui/             # Chat UI (@assistant-ui/react)
    ui/                       # shadcn/ui components
src-tauri/                    # Rust backend (Tauri v2)
  src/
    lib.rs                    # Tauri commands: tabs, fetch, content extraction
    research_search/          # SQLite + sqlite-vec vector search
```

## License

MIT
