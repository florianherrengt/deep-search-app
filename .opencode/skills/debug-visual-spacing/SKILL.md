---
name: debug-visual-spacing
description: Use when debugging visual spacing, layout, or alignment issues in UI components. Inspects computed CSS via browser_evaluate, then uses targeted vision agent analysis to diagnose line-height, padding, and broken custom property bugs.
---

# Debug Visual Spacing Issues

A structured workflow for diagnosing CSS spacing/layout bugs in Mantine + React components rendered in Storybook.

Shared techniques (iframe evaluate pattern, Mantine gotchas, screenshot cropping, vision prompting) are in the `ui-toolkit` skill — refer there for reference snippets.

## Step 1: Inspect computed styles FIRST

Before changing any code or asking the vision agent, use `browser_evaluate` to get the actual rendered CSS on the problematic element. The accessibility snapshot and screenshots do NOT show CSS.

Use the **Storybook iframe evaluate pattern** from `ui-toolkit` to inspect:
- `fontSize`, `lineHeight`, `paddingTop/Bottom`, `height`, `rawStyle`
- Check the `fontSize` vs `lineHeight` ratio
- Check `rawStyle` for broken CSS custom properties (see Mantine gotchas in `ui-toolkit`)

## Step 2: Use the vision agent with targeted prompts

If step 1 doesn't reveal the issue, use the vision agent:

1. **Crop the screenshot** to just the component (see `ui-toolkit`)
2. **Prompt with comparison** — name the elements to compare, ask about specific properties (see vision prompting rules in `ui-toolkit`)

## Step 3: Fix and verify

After making a code change:

1. Re-navigate to the story (`browser_navigate`)
2. Re-run `browser_evaluate` on the same element to confirm computed values are correct
3. Take another cropped screenshot
4. Re-run the vision agent with the same comparison prompt to confirm the fix
5. Run both light and dark mode — dark mode is where most contrast bugs hide
