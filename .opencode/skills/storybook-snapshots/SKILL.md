---
name: storybook-snapshots
description: Use to capture Storybook screenshots in bulk — all stories or a filtered subset, in multiple color schemes and viewports. Use before/after UI changes for visual comparison, or to generate a baseline for the vision agent to review.
---

# Storybook Snapshots

Bulk screenshot capture using the project's `scripts/storybook-screenshots.mjs` script. For targeted single-story screenshots via the browser, use the `ui-toolkit` skill instead.

## Quick reference

```bash
# All stories, light desktop (default)
npm run storybook:screenshots

# Filtered subset
npm run storybook:screenshots -- --match "ResearchSidebar"
npm run storybook:screenshots -- --match /error|empty/i

# Dark mode
npm run storybook:screenshots -- --color-scheme dark

# Mobile viewport
npm run storybook:screenshots -- --viewport 390x844

# JPEG (smaller files for quick review)
npm run storybook:screenshots -- --format jpeg --quality 90

# Limit to N stories
npm run storybook:screenshots -- --limit 10

# List matching stories without capturing
npm run storybook:screenshots -- --list --match "Pattern"
```

## All options

| Flag | Default | Description |
|------|---------|-------------|
| `--out <dir>` | `storybook-screenshots/` | Output directory. Use a temp path like `/tmp/snap-light` for validation-only runs. |
| `--match <pattern>` | (all) | Case-insensitive substring match on story ID, title, and name. Wrap in `/regex/flags` for regex. |
| `--viewport <WxH>` | `1440x1000` | Browser viewport size. |
| `--color-scheme <mode>` | `light` | `light`, `dark`, or `no-preference`. |
| `--full-page` | off | Capture full scrollable page instead of viewport. |
| `--format <fmt>` | `png` | `png` or `jpeg`. |
| `--quality <0-100>` | (default) | JPEG quality. Only applies with `--format jpeg`. |
| `--delay <ms>` | `300` | Wait after page load before capturing. |
| `--limit <n>` | (all) | Max stories to capture. |
| `--list` | off | Print matching stories and exit without capturing. |
| `--url <base>` | (static) | Capture from a running Storybook server instead of built static. |
| `--static-dir <dir>` | `storybook-static/` | Path to built Storybook output. |

## Typical workflows

### Before/after comparison

```bash
# Before making changes
npm run storybook:screenshots -- --out /tmp/snap-before --match "ComponentName"

# ... make code changes ...

# After (must rebuild first if using static)
npm run build-storybook
npm run storybook:screenshots -- --out /tmp/snap-after --match "ComponentName"
```

Then use the vision agent with a comparison prompt (see `review-ui` skill).

### Full regression sweep (all stories, light + dark)

```bash
npm run storybook:screenshots -- --out /tmp/snap-light --viewport 1440x1000
npm run storybook:screenshots -- --out /tmp/snap-dark --viewport 1440x1000 --color-scheme dark
```

Then use the `review-ui` skill's vision agent checklist on the output.

### Responsive check

```bash
npm run storybook:screenshots -- --out /tmp/snap-desktop --viewport 1440x1000 --match "ComponentName"
npm run storybook:screenshots -- --out /tmp/snap-mobile --viewport 390x844 --match "ComponentName"
```

### Quick validation (no git artifacts)

Use a temp directory so screenshots don't end up in the repo:

```bash
npm run storybook:screenshots -- --out /tmp/snap-check --match "ComponentName" --format jpeg --quality 80
```

## Output

Each run writes:
- One image per story: `<sanitized-story-id>.<format>` (e.g. `navigation-researchsidebar--with-chats.png`)
- `index.json` manifest with metadata: story IDs, viewport, color scheme, timestamps, and any failures

`storybook-screenshots/` and `storybook-static/` are gitignored. Use `--out /tmp/...` for throwaway runs.

## Skipping stories

Add the Storybook tag `skip-screenshot` to a story or its meta export to exclude it from bulk capture:

```ts
export default {
  title: "MyComponent",
  tags: ["skip-screenshot"],
};
```

## Notes

- `npm run storybook:screenshots` builds Storybook first, then captures. Use `npm run storybook:screenshots:dev` to capture from an already-running server at `http://127.0.0.1:6006` without rebuilding.
- The script disables animations and hides caret cursors for consistent screenshots.
- Fonts are waited on via `document.fonts.ready` before capture.
