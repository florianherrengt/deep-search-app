# Invariants

## Research lifecycle

- Research must not start unless a valid folder name exists.
- A failed folder-name generation must stop the flow.
- A research run must never show success if artifact writing failed.
- Sub-agent malformed output must be rejected with diagnostics.
- Main-agent tool calls must not be rendered as sub-agent results in the sidebar.
- LM-backed sub-agent output must stream incrementally while work is running; buffering all output until completion is a regression.
- Expanded main-chat tool cards must show matching sub-agent progress as raw text while the sub-agent is running or streaming, then render markdown only after terminal status.
