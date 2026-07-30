# Security policy

## Supported versions

Deep Search is beta software. Security fixes are made only on the latest beta
release and the current `main` branch.

| Version                      | Supported |
| ---------------------------- | --------- |
| Latest beta                  | Yes       |
| Older alpha or beta releases | No        |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include secrets,
private research, exploit details, or API keys in an issue.

Use [GitHub private vulnerability reporting](https://github.com/florianherrengt/deep-search-app/security/advisories/new).
If that form is unavailable, email
[contact@florianherrengt.com](mailto:contact@florianherrengt.com) with the
subject `Deep Search security report`.

Include, when possible:

- the affected version, operating system, and architecture;
- the vulnerable component or feature;
- reproducible steps or a minimal proof of concept;
- the impact you observed or expect;
- any suggested mitigation; and
- whether the report or your identity may be credited publicly.

You should receive an acknowledgement within seven days. The maintainer will
validate the report, coordinate a fix and release where warranted, and agree on
disclosure timing with the reporter. Complex or disputed reports may take
longer to assess.

## Scope and current security limitations

Security-relevant areas include the Tauri command boundary, filesystem access,
URL validation and request handling, page extraction, local Chrome integration,
the MCP bridge, update delivery, and credential handling.

The current macOS beta is ad-hoc signed and not Apple-notarized. Windows and
macOS builds are beta software, and API keys and service tokens are stored
unencrypted in `settings.json`; see
[PRIVACY.md](PRIVACY.md). These are disclosed limitations, not requests to
publish a report, unless you find a way they behave beyond the documented
boundary or expose data to an unintended party.

## Safe-harbor intent

Good-faith research that avoids privacy violations, service disruption, data
destruction, persistence, social engineering, and access beyond what is needed
to demonstrate the issue is welcome. Stop testing and report immediately if
you encounter user data or credentials. This statement does not authorize
testing of third-party providers or infrastructure.
