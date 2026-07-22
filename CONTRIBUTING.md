# Contributing to Deep Search

Deep Search welcomes focused bug fixes, tests, documentation, provider support,
extractors, accessibility improvements, and platform work.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues must be reported privately under [SECURITY.md](SECURITY.md).

## Before starting

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before a large feature, architecture change, new dependency, or
  new external service integration.
- Keep pull requests narrow. Unrelated cleanup makes review and rollback harder.
- Never commit API keys, private research data, provider responses containing
  personal data, or local app data.

Good first contributions are labeled
[`good first issue`](https://github.com/florianherrengt/deep-search-app/labels/good%20first%20issue).
Questions belong in [Support](SUPPORT.md).

## Development setup

Requirements:

- Node.js LTS and npm;
- Rust stable;
- the platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/);
- macOS for the currently supported desktop release path.

```sh
git clone https://github.com/florianherrengt/deep-search-app.git
cd deep-search-app
npm install
npm run tauri dev
```

The frontend is React, TypeScript, Vite, and Mantine. Desktop commands are
implemented with Tauri v2 and Rust. The Chrome DevTools MCP sidecar uses the
host's Node runtime. See [docs/README.md](docs/README.md) for architecture and
feature documentation.

## Make a change

1. Fork the repository and create a descriptive branch.
2. Inspect and reuse existing patterns before adding a new abstraction.
3. Add or update tests for changed behavior.
4. Add or update Storybook stories for new or changed UI states.
5. Update user-facing and technical documentation when behavior changes.
6. Run focused checks while iterating, then the full verification gate.

Useful commands:

| Command                      | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `npm run dev`                | Browser-reachable frontend              |
| `npm run tauri dev`          | Full desktop app                        |
| `npm run lint`               | ESLint checks                           |
| `npm run build`              | Typecheck and production frontend build |
| `npm test`                   | Vitest unit tests                       |
| `npm run test:e2e`           | Playwright end-to-end tests             |
| `npm run storybook`          | Component development                   |
| `npm run verify`             | Complete local verification gate        |
| `cargo test` in `src-tauri/` | Rust tests                              |

Before requesting review, run:

```sh
npm run verify
```

If a check cannot run because of platform requirements or missing credentials,
state exactly what was skipped and why in the pull request.

## Project rules that commonly affect contributions

- Runtime provider configuration belongs in the app settings, not `.env`.
- External data must be validated at module boundaries.
- Provider-specific behavior should stay isolated.
- New external API domains require matching changes to both the Tauri CSP in
  `src-tauri/tauri.conf.json` and HTTP allow lists in
  `src-tauri/capabilities/default.json`.
- Do not replace the local Chrome DevTools MCP sidecar with a hosted service.
- Avoid new dependencies unless they clearly reduce code or risk.
- UI changes should use Mantine and include visual coverage when practical.

## Pull requests

Write a clear summary, explain the user-visible effect, link the issue, and list
the exact checks run. Include screenshots or a short recording for UI changes.
Call out privacy, security, migration, provider-cost, and Tauri-permission
effects explicitly.

Maintainers may ask for a change to be split, simplified, tested more narrowly,
or documented before merge. Submission does not guarantee acceptance.

## License

By contributing, you agree that your contributions are licensed under the
repository's [MIT License](LICENSE).
