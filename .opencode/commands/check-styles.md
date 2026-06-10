---
description: Audit UI files for theme/style consistency (Mantine v7)
---

Audit the UI code for styling and theming consistency. This is a **Mantine v7** project — no Tailwind, no shadcn/ui.

## Styling hierarchy checks

For each component file, verify the correct styling approach was used:

1. **Mantine component props first** — `color`, `variant`, `size`, `radius` should be used whenever possible (not raw CSS)
2. **Style props** (`c`, `mt`, `p`, `fw`, `fz`) limited to 3–4 per component. More than that → should use a CSS module instead
3. **CSS modules** (`*.module.css` co-located with component) for anything beyond simple props. This is Mantine's recommended approach
4. **`style` prop** only for one-off dynamic values, not primary styling
5. **Global `md-*` classes in `src/index.css`** only for animations, pseudo-elements, or styles shared across 3+ unrelated components

## Anti-patterns to flag

- Hardcoded `#hex` colors → must use `var(--mantine-color-*)` or Mantine theme values
- Hardcoded `px` values for spacing/padding → must use `var(--mantine-spacing-*)`
- Hardcoded `font-size: 14px` → must use `var(--mantine-font-size-sm)` or Mantine `fz` prop
- Hardcoded `border-radius` → must use `var(--mantine-radius-*)`
- String concatenation for class names (e.g. `` `${base} ${active && "active"}` ``) → must use `clsx`
- `@media (prefers-color-scheme: dark)` → must use `[data-mantine-color-scheme="dark"]` or `light-dark()`
- BEM modifier classes (`md-component--variant`) → must use `data-*` attributes with `mod` prop
- Using `theme.colorScheme` to branch styles in JS → must use `light-dark()` in CSS or `@mixin light`/`@mixin dark` in CSS modules

## Check for `clsx` dependency

If any file uses `clsx` but it's not in `package.json` dependencies, flag it.

## Report format

For each violation, report:
- File path and line number
- The anti-pattern found
- The specific fix to apply

Files to audit:
- All `src/components/**/*.tsx`
- All `src/tools/**/*.tsx`
- All `src/lib/**/*.tsx`
- `src/index.css`
- `src/lib/theme.ts`
