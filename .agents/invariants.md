# Invariants

## Research lifecycle

- Research must not start unless a valid folder name exists.
- A failed folder-name generation must stop the flow.
- A research run must never show success if artifact writing failed.
- Sub-agent malformed output must be rejected with diagnostics.
- Main-agent tool calls must not be rendered as sub-agent results in the sidebar.
