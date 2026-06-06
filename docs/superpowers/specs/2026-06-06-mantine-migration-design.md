# Mantine UI Migration

**Date:** 2026-06-06
**Status:** Draft

## Summary

Replace the current shadcn/ui + Tailwind CSS stack with Mantine to get better component coverage, built-in hooks, and a simpler dependency tree. Big-bang migration in a single PR.

## Motivation

- **Better component coverage:** Mantine provides 120+ components out of the box, reducing the need to compose from low-level primitives.
- **Built-in hooks & utilities:** 70+ hooks for forms, state, disclosure, media queries — replaces custom code.
- **Simpler stack:** One cohesive library replaces Tailwind + shadcn/ui + Radix + CVA + clsx + tailwind-merge + tw-animate + tw-shimmer.

## Scope

### In scope

- Remove Tailwind CSS v4 and all Tailwind-related packages
- Remove all 11 shadcn/ui components in `src/components/ui/`
- Remove `cn()` utility, `components.json`, CSS variable theme system
- Install and configure Mantine (core, hooks, PostCSS)
- Add `MantineProvider` to app root with theme configuration
- Migrate all top-level components in `src/components/`
- Migrate all assistant-ui wrapper components in `src/components/assistant-ui/`
- Add proper dark mode toggle via Mantine's color scheme system
- Update all 5 test files

### Out of scope

- Replacing `@assistant-ui/react` — its internal rendering stays as-is
- Changing business logic in `src/lib/` (transport, guards, providers, tools)
- Changing Rust backend code
- Visual redesign — match current look & feel as closely as possible

## Dependencies

### Removed

| Package | Reason |
|---|---|
| `tailwindcss` | Replaced by Mantine's styling |
| `@tailwindcss/vite` | Tailwind Vite plugin |
| `@tailwindcss/typography` | Tailwind prose plugin |
| `tw-animate-css` | Tailwind animation utilities |
| `tw-shimmer` | Tailwind shimmer utility |
| `radix-ui` | Primitive components replaced by Mantine |
| `class-variance-authority` | Variants handled by Mantine props |
| `clsx` | Mantine has its own class utility |
| `tailwind-merge` | No longer needed without Tailwind |

### Added

| Package | Purpose |
|---|---|
| `@mantine/core` | Component library |
| `@mantine/hooks` | Utility hooks |
| `postcss` | PostCSS runtime (required by Mantine) |
| `postcss-preset-mantine` | Mantine PostCSS integration |

### Kept

| Package | Reason |
|---|---|
| `@assistant-ui/react` | Chat thread UI primitives |
| `@assistant-ui/react-ai-sdk` | AI SDK integration |
| `@assistant-ui/react-markdown` | Markdown rendering |
| `@ai-sdk/react` | React hooks for AI SDK |
| `lucide-react` | Icons (used throughout, Mantine-compatible) |
| `remark-gfm` | GFM markdown support |

## Architecture

### Provider hierarchy (main.tsx / App.tsx)

```
<MantineProvider theme={theme}>
  <ColorSchemeScript />          // in <head>
  <SettingsProvider>
    <PromptTemplatesProvider>
      <SkillsProvider>
        <AppInner />
      </SkillsProvider>
    </PromptTemplatesProvider>
  </SettingsProvider>
</MantineProvider>
```

### Theme configuration

Create a Mantine theme via `createTheme()` that matches the current shadcn neutral color scheme as closely as possible. Key theme overrides:

- `primaryColor` set to a neutral/blue that matches current `--primary`
- `defaultRadius` set to `0.625rem` (matches current `--radius`)
- Font family: Inter (current default)
- Light/dark mode via `colorScheme` management

### Layout

Replace the custom `TabPanel` layout with:

- **Mantine `AppShell`** for the overall page structure (navbar + main)
- **Mantine `Tabs`** for switching between Chat, Settings, Prompts, Skills, Tools panels
- **Mantine `ScrollArea`** for scrollable regions (sidebar chat list, settings)

### Component mapping

| Current component | Source | Mantine replacement |
|---|---|---|
| `Button` (xs, sm, md, lg, icon variants) | `ui/button.tsx` | `Button` with `size` prop |
| `AlertDialog` | `ui/alert-dialog.tsx` | `Modal` with `size="auto"` |
| `Dialog` | `ui/dialog.tsx` | `Modal` |
| `Popover` | `ui/popover.tsx` | `Popover` |
| `Tooltip` | `ui/tooltip.tsx` | `Tooltip` |
| `Tabs` | `ui/tabs.tsx` | `Tabs` |
| `ToggleGroup` | `ui/toggle-group.tsx` | `SegmentedControl` or `Button.Group` |
| `Collapsible` | `ui/collapsible.tsx` | `Collapse` |
| `ContextMenu` | `ui/context-menu.tsx` | `Menu` with `trigger="contextmenu"` |
| `Input` | `ui/input.tsx` | `TextInput` |
| `Label` | `ui/label.tsx` | `Input.Label` |
| Custom `Select` (CVA) | `assistant-ui/select.tsx` | `Select` |
| Custom sidebar | `research-sidebar.tsx` | `AppShell.Navbar` |
| Custom tab bar | `tab-panel.tsx` | `AppShell` + `Tabs` |

### @assistant-ui/react integration

The assistant-ui library renders its own component tree. The integration strategy:

1. **Thread container**: Wrap in a Mantine-styled `Paper` or `Box` with appropriate padding/layout
2. **Custom assistant-ui components** (markdown-text, tool-fallback, questions-tool, reasoning, guardrail-card, agent-diagnostic-card): Replace shadcn/Radix parts with Mantine components where they render outside assistant-ui primitives
3. **Styling overrides**: Use assistant-ui's `className` props with Mantine's `Global` or inline styles for visual consistency

The `@assistant-ui/react` package does not use Tailwind internally, so removing Tailwind won't break its rendering. Its default styles are CSS-in-JS.

### Dark mode

Mantine provides a complete dark mode system:

- `ColorSchemeScript` in `<head>` for SSR-safe initial paint (prevents flash)
- `useMantineColorScheme()` hook for toggle (light/dark/auto)
- Persists to localStorage automatically
- Respects `prefers-color-scheme` in auto mode
- All Mantine components adapt automatically

Add a toggle button in the app header/navbar.

### Form handling

Mantine has built-in form management via `useForm` hook from `@mantine/hooks`. Use it in:

- `settings-fields.tsx` — provider API key inputs, model settings
- `skills-section.tsx` — skill CRUD forms
- `prompt-templates-section.tsx` — template CRUD forms

This replaces manual controlled inputs with validation, error display, and reset built in.

## Files changed

### Deleted

- `src/components/ui/` — entire directory (11 files)
- `src/lib/utils.ts` — `cn()` helper
- `components.json` — shadcn config

### Created

- `postcss.config.cjs` — Mantine PostCSS config
- `src/lib/theme.ts` — Mantine theme configuration

### Modified

- `package.json` — dependency changes
- `vite.config.ts` — remove `@tailwindcss/vite` plugin
- `src/index.css` — replace with Mantine imports + minimal global styles
- `src/main.tsx` — add `MantineProvider` + `ColorSchemeScript`
- `src/App.tsx` — remove Tailwind classes, use Mantine components
- `src/components/tab-panel.tsx` — rewrite with Mantine `AppShell` + `Tabs`
- `src/components/research-sidebar.tsx` — rewrite with Mantine components
- `src/components/settings-dialog.tsx` — rewrite with Mantine `Modal`
- `src/components/settings-panel.tsx` — rewrite with Mantine components
- `src/components/settings-fields.tsx` — rewrite with Mantine `TextInput`, `Select`, etc.
- `src/components/tools-panel.tsx` — rewrite with Mantine components
- `src/components/chat.tsx` — update wrapper styling
- `src/components/app-update-button.tsx` — Mantine `Button`/`Badge`
- `src/components/skills-section.tsx` — Mantine components + `useForm`
- `src/components/prompt-templates-section.tsx` — Mantine components + `useForm`
- `src/components/assistant-ui/thread.tsx` — update styling wrappers
- `src/components/assistant-ui/model-selector.tsx` — Mantine `Select`
- `src/components/assistant-ui/select.tsx` — replace with Mantine `Select`
- `src/components/assistant-ui/markdown-text.tsx` — update code block styling
- `src/components/assistant-ui/tool-fallback.tsx` — Mantine `Collapse`/`Paper`
- `src/components/assistant-ui/questions-tool.tsx` — Mantine form components
- `src/components/assistant-ui/reasoning.tsx` — Mantine `Collapse`
- `src/components/assistant-ui/guardrail-card.tsx` — Mantine `Paper`/`Badge`
- `src/components/assistant-ui/agent-diagnostic-card.tsx` — Mantine `Paper`
- `src/components/assistant-ui/prompt-template-button.tsx` — Mantine `Button`/`Menu`
- `src/components/__tests__/research-sidebar.test.tsx` — Mantine provider wrapper
- `src/components/__tests__/tab-panel.test.tsx` — Mantine provider wrapper
- `src/components/__tests__/settings-panel.test.tsx` — Mantine provider wrapper
- `src/components/assistant-ui/__tests__/agent-diagnostic-card.test.tsx` — Mantine provider wrapper
- `src/components/assistant-ui/__tests__/guardrail-card.test.tsx` — Mantine provider wrapper

## Migration order

1. **Infrastructure**: Install Mantine, configure PostCSS, remove Tailwind packages, update vite.config.ts
2. **Theme setup**: Create `src/lib/theme.ts`, update `src/index.css`, add `MantineProvider` to root
3. **UI primitives**: Delete `src/components/ui/`, replace all imports with Mantine equivalents
4. **Layout components**: Rewrite `tab-panel.tsx` (AppShell) and `research-sidebar.tsx` (AppShell navbar)
5. **Panel components**: Rewrite settings, tools, skills, prompts panels
6. **Assistant-ui wrappers**: Update all 10 components in `src/components/assistant-ui/`
7. **App root**: Update `App.tsx` styling
8. **Tests**: Add Mantine provider wrappers to all 5 test files
9. **Cleanup**: Remove `cn()`, `components.json`, unused imports, verify no Tailwind references remain

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Visual regressions from different default styles | Match current theme colors/sizes in `createTheme()`; manual visual review of each component |
| @assistant-ui styling conflicts with Mantine | Test thoroughly; use CSS specificity or `!important` in theme overrides if needed |
| Tailwind utility class muscle memory | Mantine's `style` prop + `styles` API covers most cases; `Box` component for layout |
| Test breakage from removed CSS classes | Update test assertions to check Mantine classes/attributes; use `screen.getByRole` patterns |
| Bundle size increase from Mantine | Mantine supports tree-shaking; only imported components are bundled |

## Success criteria

- All existing functionality preserved (chat, search, settings, tools, skills, prompts, browser tabs)
- Dark mode toggle works (light/dark/system)
- No Tailwind or shadcn dependencies remain in package.json
- All 5 test suites pass
- `npm run build` succeeds with no type errors
- Visual appearance closely matches current design (neutral colors, Inter font, rounded corners)
