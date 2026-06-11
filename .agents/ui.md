# UI Workflow

Use this file for frontend UI work: Mantine components, layout, styling, Storybook stories, screenshots, and visual regression checks.

## Scope

This workflow applies when changing:

- React components
- Mantine styling or theme usage
- Layout, spacing, sizing, alignment, or responsive behaviour
- Empty, loading, error, disabled, hover, active, or selected states
- Storybook stories
- Screenshots or visual QA
- Assistant/chat UI surfaces

Do not use the Tauri shell for normal UI inspection unless the task depends on native window behaviour, Tauri webviews, filesystem access, or sidecar/runtime integration.

Prefer Storybook for isolated UI development and review.

## UI Stack

- React
- TypeScript
- Mantine
- Vite
- Storybook
- Tailwind may still exist in older areas; do not introduce new Tailwind patterns unless the file already uses them heavily

## Core Rule

Before editing UI, inspect the existing component patterns nearby.

Do not invent a new visual system. Reuse existing Mantine components, theme tokens, spacing conventions, and local component abstractions.

## Storybook First

For reusable UI changes, add or update stories before considering the work complete.

Add or update stories for:

- New reusable components
- Panels and major sections
- Empty states
- Loading states
- Error states
- Disabled states
- Long-content states
- Responsive layout states
- Important interaction states
- Dark/light mode differences

Stories should be colocated:

```text
ComponentName.stories.tsx
```

Use Storybook for visual review:

```bash
npm run storybook
```

Build Storybook when needed:

```bash
npm run build-storybook
```

Capture screenshots:

```bash
npm run storybook:screenshots
```

Capture screenshots from an already-running Storybook server:

```bash
npm run storybook:screenshots:dev
```

Generated outputs are ignored by git:

```text
storybook-static/
storybook-screenshots/
```

To exclude a story from screenshot generation:

```ts
tags: ["skip-screenshot"];
```

Only skip screenshots when the story is unstable, external-data-dependent, animated in a way that causes noise, or not visually meaningful.

## Mantine Guidelines

Prefer Mantine primitives before custom CSS:

- `Stack`
- `Group`
- `Box`
- `Paper`
- `Card`
- `Container`
- `Grid`
- `SimpleGrid`
- `Text`
- `Title`
- `Button`
- `ActionIcon`
- `ThemeIcon`
- `Tooltip`
- `Menu`
- `Modal`
- `Drawer`
- `ScrollArea`
- `Tabs`
- `Accordion`
- `Alert`
- `Skeleton`

Use Mantine theme tokens for spacing, radius, color, shadows, and typography.

Avoid hardcoded magic values unless there is a specific layout reason.

Prefer:

```tsx
<Stack gap="md">
```

over:

```tsx
<div style={{ marginBottom: 17 }}>
```

Use `rem()` for fixed CSS sizes when needed.

Prefer component props over CSS overrides where Mantine supports them.

## Styling Rules

Use the least powerful styling option that solves the problem:

1. Mantine props
2. Existing local component props
3. CSS modules or existing stylesheet pattern
4. Inline style only for dynamic computed values
5. Global CSS only when unavoidable

Avoid:

- One-off CSS hacks
- Deep selectors into Mantine internals unless there is no clean alternative
- Duplicating spacing and colour constants
- Mixing Tailwind and Mantine in new components
- Adding new UI dependencies for simple layout or styling
- Styling by DOM structure when a Mantine prop or class is available

## Layout Rules

Check these explicitly:

- Empty state does not collapse awkwardly
- Long text wraps correctly
- Buttons do not overflow
- Scroll containers have sensible height constraints
- Modals and drawers work on small screens
- Panels remain usable at narrow widths
- Loading states preserve layout enough to avoid jarring jumps
- Error states are visible and actionable
- Focus states remain visible
- Keyboard navigation is not broken

For app-shell or split-pane work, verify:

- Very narrow width
- Normal desktop width
- Large desktop width
- Overflow content
- Empty content
- Long labels or titles

## Dark and Light Mode

UI work must be checked in both colour schemes unless the component is clearly colour-scheme neutral.

Do not hardcode colours that break dark mode.

Prefer Mantine theme-aware values.

If custom colours are required, verify contrast in both schemes.

## Visual QA

For UI work, perform a visual pass before declaring completion.

Minimum visual QA:

1. Open or add Storybook stories for the changed components.
2. Capture or inspect the relevant stories.
3. Check layout, spacing, alignment, overflow, and colour scheme behaviour.
4. Fix visual issues.
5. Re-check the changed stories.

Use screenshots for substantial layout changes.

Use targeted screenshots for small changes.

Use bulk screenshots when a shared component affects many stories.

## Subagent Usage

Use subagents for visual discovery and broad checks.

Delegate these when available:

- Finding all stories affected by a component
- Checking whether a component already has Storybook coverage
- Capturing screenshot sets
- Comparing before/after screenshots
- Inspecting visual regressions across many stories
- Searching for similar Mantine usage patterns
- Checking responsive variants
- Checking light/dark variants

The main agent owns final UI judgment and implementation.

A UI subagent should report:

```text
Scope checked:
Stories inspected:
Screenshots reviewed:
Findings:
Risks:
Recommended next step:
```

## UI Skills

Load the relevant skill when the task matches:

- `storybook-snapshots`
  - Bulk screenshot capture
  - Filtered story screenshots
  - Before/after comparisons
  - Light/dark checks
  - Desktop/mobile sweeps

- `review-ui`
  - Post-change visual QA
  - Screenshot review
  - Vision-agent checklist
  - Light/dark verification

- `debug-visual-spacing`
  - Specific spacing, alignment, sizing, or layout bugs
  - Inspect computed CSS first
  - Then use targeted screenshots and visual analysis

- `ui-toolkit`
  - Storybook iframe inspection
  - Screenshot rules
  - Cropped screenshots
  - Vision prompting conventions

Do not load every skill by default. Load only the one relevant to the current UI task.

## Accessibility Checks

For changed interactive UI, verify:

- Buttons and controls have accessible names
- Icon-only actions have labels or tooltips where appropriate
- Focus states are visible
- Disabled states are clear
- Form errors are associated with the relevant fields
- Keyboard interaction still works
- Colour is not the only way to understand state

Prefer native Mantine accessibility behaviour before custom ARIA.

Do not add ARIA attributes that duplicate or conflict with native semantics.

## Component Rules

When creating or changing reusable components:

- Keep props small and explicit
- Avoid boolean prop explosions
- Use discriminated unions for variant-heavy APIs
- Keep styling variants predictable
- Do not bake in page-specific copy or data
- Keep side effects out of presentational components
- Add stories for meaningful variants
- Add tests only when behaviour is non-trivial

When changing page-level UI:

- Keep layout components separate from data/provider logic where practical
- Do not push runtime concerns into visual components
- Keep loading/error/empty states close to the data boundary

## Assistant UI Surfaces

For chat and assistant UI changes, check:

- Streaming state
- Tool-call state
- Error state
- Empty conversation state
- Long assistant messages
- Long user messages
- Code blocks
- Markdown lists and tables
- Interrupted or partial generations
- Provider/model unavailable state

Prefer realistic stories using representative research/chat content.

## Screenshot Discipline

Screenshots should be useful, not noisy.

Before screenshot capture:

- Ensure Storybook is rendering deterministic content
- Avoid live external data
- Avoid unstable timestamps where possible
- Disable or skip animation-heavy stories when they create noise
- Use `skip-screenshot` only with a clear reason

When reviewing screenshots, look for:

- Broken alignment
- Unexpected overflow
- Cropped text
- Poor spacing rhythm
- Bad contrast
- Inconsistent radius/shadow
- Broken dark mode
- Layout jumps between states
- Components that look correct alone but wrong in composition

## Verification

Use the narrowest relevant verification first.

For UI-only changes, typical checks are:

```bash
npm test
npm run build-storybook
npm run storybook:screenshots
```

For broader frontend changes:

```bash
npm test
npm run build
```

Do not run expensive integration or Tauri-level checks directly in the main agent context. Delegate those to a subagent.

## Done Criteria

UI work is done when:

- The changed UI is implemented
- Existing patterns were followed or a better pattern was clearly justified
- Relevant stories were added or updated
- Important states are represented
- Light and dark mode were checked where relevant
- Responsive behaviour was checked where relevant
- Screenshots were captured or manually inspected through Storybook
- Tests/builds relevant to the change passed, or failures are documented
- Any skipped visual coverage has a clear reason
- The final summary mentions what UI was changed and how it was verified
