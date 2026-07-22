# Privacy

Last updated: July 22, 2026

Deep Search is a local-first, bring-your-own-key desktop application. It has no
Deep Search account system or hosted application backend. This document states
what the app stores and when data leaves your computer.

## Data stored on your Mac

The release build stores application data under:

```text
~/Library/Application Support/com.deep-search-app.app/
```

That data can include:

- `settings.json`, containing preferences, configured service URLs, model
  names, API keys, and service tokens;
- `search-results/`, containing research chats, saved source content,
  summaries, generated files, memories, and sub-agent records;
- local indexes and caches used to search previous research;
- prompt templates and user-defined skills;
- operational logs; and
- local MCP bridge files, including a localhost port and bearer token while the
  bridge is available.

Deleting a research session in the app removes the corresponding app-managed
research data. Uninstalling the app may not remove its Application Support
directory; delete that directory separately if you want to remove all local
Deep Search data.

## API-key storage disclosure

API keys and service tokens entered in Settings are stored **in plaintext** in
`settings.json`. Deep Search does not encrypt that file and does not store
these credentials in macOS Keychain. Their protection depends on your macOS
account, filesystem permissions, device security, and backups.

Use provider keys with the smallest practical permissions and spending limits.
Do not share `settings.json`, your Application Support directory, research
archives containing secrets, or unredacted logs. Remove keys from Settings and
revoke them at the provider if you suspect exposure.

## When data leaves your Mac

Deep Search sends data only as needed for features you invoke or configure:

- **LLM providers** receive your prompts, chat context, tool results, extracted
  source text, and other context needed to plan and synthesize research.
- **Search providers** receive generated search queries and normal request
  metadata.
- **Websites** receive HTTP or browser requests when Deep Search reads pages.
  They may receive your IP address, user agent, cookies, and other normal
  browser request data.
- **Optional extraction services**, such as Scrape.do, receive the URL being
  extracted and the data required by their API.
- **YouTube and Google APIs** receive queries and video requests when YouTube
  research is used.
- **Frankfurter** receives requested currency pairs when currency conversion is
  enabled and needed.
- **Hugging Face** may be contacted to download the local embedding model used
  for research-history search. Embedding inference then runs locally.
- **GitHub** is contacted to check for and download application updates.
- **Self-hosted or local endpoints** receive the same categories of data when
  you configure them instead of a hosted provider.

Each third-party or self-hosted service has its own privacy, retention, and
security terms. Deep Search does not control those services. Provider API keys
are sent only to the provider they configure, but prompts or page content can
contain sensitive information independently of the key.

Running a local OpenAI-compatible model and SearXNG can keep model and search
traffic on your network. Researching public web pages still sends requests to
those websites, and update or model-download features may contact GitHub or
Hugging Face.

## Analytics and telemetry

Deep Search does not include product analytics, advertising trackers, or usage
telemetry. The project maintainer does not automatically receive your prompts,
research library, settings, or logs.

If you submit an issue, support request, or security report, you choose what to
send. Redact API keys, tokens, personal information, and private research
content before attaching screenshots or logs.

## Local browser and MCP behavior

The built-in webview can load researched pages. If you explicitly enable local
Chrome integration, Deep Search can connect to the configured Chrome debugging
session and read or control browser pages for extraction. Use a separate
browser profile without sensitive tabs when possible.

The Deep Search MCP bridge listens on localhost and uses a bearer token stored
in the app data directory. MCP clients can start research using the same saved
history and configured providers as the desktop app. Only configure MCP clients
you trust, and keep the bridge token private.

## Contact

Questions about this disclosure can be sent to
[contact@florianherrengt.com](mailto:contact@florianherrengt.com). Security
issues should follow [SECURITY.md](SECURITY.md).
