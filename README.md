# Deep Search

[![CI](https://github.com/florianherrengt/deep-search-app/actions/workflows/ci.yml/badge.svg)](https://github.com/florianherrengt/deep-search-app/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/florianherrengt/deep-search-app?include_prereleases&label=beta)](https://github.com/florianherrengt/deep-search-app/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Deep research that reads the sources, keeps the evidence, and runs locally on
your Mac or Windows PC.**

Deep Search is a local-first desktop research agent. Give it a difficult
question and it searches the web, opens the actual pages, cross-checks claims,
and produces a cited answer. Your research library stays on disk, and the same
workflow is available to coding agents over MCP.

**[Download v0.1.0-beta.7](https://github.com/florianherrengt/deep-search-app/releases/tag/0.1.0-beta.7)**
· **[Watch the demo](https://www.youtube.com/watch?v=bN8V7AK_ByE)**
· **[Connect over MCP](docs/research-mcp.md)**
· **[Read the docs](docs/README.md)**

[![Deep Search demo](https://img.youtube.com/vi/bN8V7AK_ByE/maxresdefault.jpg)](https://www.youtube.com/watch?v=bN8V7AK_ByE)

## Why Deep Search

- **It has to read sources.** Guardrails require search and page extraction
  before the agent can present research as complete.
- **Bring your own providers.** Choose the model, search engines, and optional
  extraction services. There is no hosted Deep Search backend.
- **Keep a research library.** Chats, source material, summaries, and memories
  are saved in per-topic folders on your Mac and can be searched later.
- **Research from your coding agent.** The local MCP bridge works with Codex,
  Claude Desktop, and other MCP clients while preserving the app's history and
  guardrails.
- **Inspect and change it.** The desktop app and its research core are open
  source under MIT.

## Install the beta

The published beta currently includes:

- **macOS 11 or later** on Apple Silicon (M1 or newer) and Intel;
- **64-bit Windows**; and
- Linux source builds only. No prebuilt Linux bundle is published.

[Open the v0.1.0-beta.7 release](https://github.com/florianherrengt/deep-search-app/releases/tag/0.1.0-beta.7)
and choose the installer for your platform:

- Apple Silicon Mac: the `.dmg` ending in `_aarch64.dmg`;
- Intel Mac: the `.dmg` ending in `_x64.dmg`; or
- Windows: the installer ending in `_x64-setup.exe`.

### First launch on macOS

1. Open the downloaded `.dmg` and drag Deep Search to Applications.
2. In Finder, open Applications, Control-click Deep Search, choose **Open**,
   then confirm **Open**.
3. If macOS still blocks it, go to **System Settings → Privacy & Security** and
   choose **Open Anyway** for Deep Search.

The macOS beta is ad-hoc signed and not notarized because the project does not
use a paid Apple Developer membership. macOS therefore cannot verify the
developer on first launch. Do not disable Gatekeeper or run terminal commands
to bypass it; the Finder flow above preserves macOS's normal warning and
confirmation. You can inspect the source or [build it yourself](#development).

### Build on Linux

Linux users should build from source rather than looking for a published
installer. Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
then follow the [development setup](#development) and run `npm run tauri build`.

## Five-minute setup

The simplest first setup is **OpenRouter + Brave Search**: create one API key
for each service, then add them in Settings. Pick a tool-capable model on
OpenRouter; paid models are generally more reliable for long, multi-step
research than free models.

1. Open Settings and add an LLM provider.
2. Add at least one search provider. More providers improve coverage but can
   increase third-party API usage.
3. Start with a question that gives the agent a clear decision and evidence
   standard, for example:

> Compare the three best local-first note-taking apps for a software team in 2026. Read primary documentation and recent independent reviews, verify
> pricing and offline limitations, surface contradictions, and recommend one
> with citations.

Deep Search calls provider APIs directly with your keys. Provider charges and
rate limits are controlled by those providers, not this project.

## How it works

```text
Your question
  → research plan
  → searches across configured providers
  → reads and saves relevant pages
  → follows leads and checks contradictions
  → writes a cited answer
  → indexes the research locally for reuse
```

Search, extraction, and final synthesis are separate guarded steps. The agent
cannot satisfy a source-reading requirement merely by listing search snippets.
See [the research-agent design](docs/research_agent.md), [search and
extraction](docs/search_and_extract.md), and [research search](docs/research-search.md)
for the implementation details.

### Why not configure a generic browsing agent?

You can reproduce parts of this workflow with agent instructions and plugins.
Deep Search is for cases where instructions alone are too easy to skip: source
reading is enforced as tool behavior, research is persisted and indexed across
sessions, and providers, extraction fallbacks, and MCP access are managed from
one desktop UI. If you only need occasional web browsing, a general-purpose
agent is probably simpler.

## Use it from an MCP client

Deep Search writes a local stdio MCP proxy that forwards research requests to
the running desktop app.

1. Keep Deep Search running and configure its model and search providers.
2. In Settings, find **Deep Search MCP** and copy the displayed proxy path.
3. Use that path as the server command in your MCP client:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "/Users/you/Library/Application Support/com.deep-search-app.app/deep-search-mcp.mjs"
    }
  }
}
```

The MCP exposes `deep_search` for starting, polling, and continuing research,
plus `deep_search_cancel`. The desktop app must remain open. See the [complete
MCP guide and copy-paste agent skill](docs/research-mcp.md).

## Providers

LLM providers:

- OpenRouter
- Anthropic
- DeepSeek
- Zhipu
- OpenCode Zen
- Local or self-hosted OpenAI-compatible endpoints

Search providers:

- Brave Search
- Exa
- Serper
- Tavily
- SearXNG (self-hosted)
- YouTube Data API v3

Page extraction uses direct HTTP and the built-in Tauri webview. Scrape.do,
local Chrome through Chrome DevTools MCP, and local `yt-dlp` subtitle fallback
are optional. Detailed provider and extraction behavior is documented in
[Search and extraction](docs/search_and_extract.md).

## Local data and privacy

Research data is stored under:

```text
~/Library/Application Support/com.deep-search-app.app/
```

Important: API keys and service tokens entered in Settings are stored **in
plaintext** in `settings.json` inside that directory. They are not encrypted by
Deep Search or placed in macOS Keychain. They are protected only by your macOS
account and filesystem permissions. Do not use keys with broader permissions
or spending limits than necessary, and do not share that file.

There is no Deep Search account, hosted relay, product analytics, or telemetry.
Data does leave your Mac when you use configured services: model providers
receive prompts and relevant research context; search providers receive search
queries; websites and extraction services receive page requests; and the local
embedding model may be downloaded from Hugging Face on first use. Read the
[full privacy disclosure](PRIVACY.md) before adding credentials.

## Beta limitations

- macOS 11+ on Intel or Apple Silicon, plus a 64-bit Windows build; Linux is
  source-only.
- The app is not Apple-notarized; first launch requires the Gatekeeper steps
  above.
- API credentials are stored in plaintext in the app data directory.
- Research quality and cost depend on the model and services you configure.
- Websites can block, rate-limit, or change in ways that break extraction.
- Local OpenAI-compatible models vary widely in tool-calling reliability.
- MCP research requires the desktop app to be running.
- Beta releases are installer-only. Download the latest installer from the
  GitHub release page when a new version is published; Linux source builds
  require pulling newer source and rebuilding.

Please [report reproducible bugs](https://github.com/florianherrengt/deep-search-app/issues/new/choose)
and avoid putting API keys or private research content in issues or logs.

## Documentation

- [Documentation index](docs/README.md)
- [Deep Search MCP](docs/research-mcp.md)
- [Research agent](docs/research_agent.md)
- [Search and extraction](docs/search_and_extract.md)
- [Research library search](docs/research-search.md)
- [How memories work](docs/how-memories-work.md)
- [Keyboard shortcuts](docs/shortcuts.md)
- [Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Support](SUPPORT.md)

## Development

You need Node.js LTS, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/florianherrengt/deep-search-app.git
cd deep-search-app
npm install
npm run tauri dev
```

Useful commands:

| Command             | Purpose                      |
| ------------------- | ---------------------------- |
| `npm run dev`       | Frontend-only Vite server    |
| `npm run tauri dev` | Full desktop app             |
| `npm run verify`    | Full local verification gate |
| `npm test`          | Vitest unit tests            |
| `npm run storybook` | Component development        |

Architecture and contribution expectations are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

If Deep Search is useful, **[star the repository](https://github.com/florianherrengt/deep-search-app)**
so more people can find it. Bug reports, focused pull requests, provider
integrations, extraction fixes, docs, and platform work are welcome. Start with
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[open issues](https://github.com/florianherrengt/deep-search-app/issues).

## License

[MIT](LICENSE)
