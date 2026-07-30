# Support

## Before asking for help

1. Read the [README](README.md), [documentation index](docs/README.md), and
   [beta limitations](README.md#beta-limitations).
2. Update to [v0.1.0-beta.7](https://github.com/florianherrengt/deep-search-app/releases/tag/0.1.0-beta.7),
   or check the repository's releases for a newer beta.
3. Search [existing issues](https://github.com/florianherrengt/deep-search-app/issues).
4. Confirm that your selected model supports tool calling and that each
   configured provider key is valid and has available quota.

## Installation help

The published beta supports Intel and Apple Silicon Macs running macOS 11 or
later, plus 64-bit Windows. Linux is source-only. The macOS build is not
Apple-notarized. Follow the [documented Finder and Gatekeeper
steps](README.md#first-launch-on-macos); do not disable Gatekeeper or run
quarantine bypass commands.

## Bug reports

Use the [bug report form](https://github.com/florianherrengt/deep-search-app/issues/new/choose)
for reproducible failures. Include the app version, operating system and
architecture, selected providers, steps, expected behavior, and actual
behavior.

Screenshots and short logs are useful, but redact API keys, tokens, personal
information, local paths you consider sensitive, and private research content.
Never attach `settings.json`.

## Feature requests

Use the [feature request form](https://github.com/florianherrengt/deep-search-app/issues/new/choose).
Explain the problem and user outcome before proposing an implementation.

## Security and privacy

Do not report vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).
Credential storage and network behavior are documented in
[PRIVACY.md](PRIVACY.md).

Support is community-maintained and has no guaranteed response time. Provider
billing, account access, quota, and service outages must be handled with the
relevant provider.
