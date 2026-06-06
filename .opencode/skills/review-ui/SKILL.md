---
name: review-ui
description: Use after making UI changes to run a visual review pass across affected Storybook stories. Captures cropped screenshots in both light and dark mode, then uses the vision agent to check for spacing, alignment, contrast, and regression issues. Run this before considering UI work done.
---

# Review UI Changes

A structured visual QA pass to run after modifying UI components. Uses Storybook + the vision agent to catch spacing, contrast, alignment, and regression issues across color schemes.

Shared techniques (iframe evaluate pattern, Mantine gotchas, screenshot cropping, vision prompting) are in the `ui-toolkit` skill — refer there for reference snippets.

## When to use

- You've edited a component's JSX, styles, or story files
- You've changed shared CSS (`index.css`), theme tokens, or layout helpers
- You've added new stories or new visual variants
- Before final handoff on any UI task

## Step 1: Identify affected stories

- If you edited `component-name.tsx`, the matching story is `component-name.stories.tsx`
- If you edited shared CSS or theme files, run all stories (broad `--match` pattern)
- If you edited a component used inside other components, include those parent stories too

List the affected story IDs by reading the story file exports. Each named export becomes a story ID like `category-component--story-name`.

## Step 2: Capture screenshots

### Option A: Targeted browser screenshots (for 1–3 stories)

If Storybook is running at `http://127.0.0.1:6006`, capture **both light and dark mode** (see `ui-toolkit` for URL patterns). **Always crop to the component** using `target` selector (see `ui-toolkit`).

### Option B: Bulk screenshots (for broader changes)

Use the `storybook-snapshots` skill for bulk capture with `--match` filtering. Capture both light and dark mode, and optionally both desktop and mobile viewports.

## Step 3: Vision agent review

For each screenshot, run the vision agent with a structured review prompt. **Do not use a generic "looks good?" prompt.**

### Review prompt template

```
Review this screenshot of [COMPONENT_NAME] in [light|dark] mode.

Check for ALL of the following issues:

1. **Text contrast** — Is all text readable against its background? Any gray-on-gray?
2. **Spacing consistency** — Are similar elements spaced the same way? Compare labels, list items, section headers.
3. **Line-height proportionality** — Does each text element's vertical space look proportional to its font size?
4. **Alignment** — Are text labels, icons, and buttons aligned consistently?
5. **Truncation/overflow** — Any text that overflows or gets cut off?
6. **Empty states** — If visible, is the empty/loading/error message centered and readable?
7. **Interactive states** — If visible, do hover/active/focused elements have appropriate feedback?

List every issue you find, or confirm that no issues are visible.
```

### For comparison reviews (before/after)

```
Screenshot 1 (before): /path/to/before.png
Screenshot 2 (after): /path/to/after.png

Compare these two screenshots of [COMPONENT_NAME]. The second is after a change to [DESCRIBE_CHANGE].

1. What visual differences do you see?
2. Are all changes intentional, or do you spot any unintended regressions?
3. Is the spacing in the "after" version better, worse, or the same?
```

### For element-level reviews

```
Focus on the [SECTION_NAME] area. Compare [ELEMENT_A] with [ELEMENT_B]:
- Are they spaced consistently?
- Is the line-height proportional?
- Are font sizes and weights visually harmonious?
```

## Step 4: Fix and re-verify

If the vision agent finds issues:

1. **Inspect computed styles first** — use the iframe evaluate pattern from `ui-toolkit`
2. Fix the code
3. Re-capture screenshots for the affected story + color scheme
4. Re-run the vision agent on the fixed screenshot
5. Do NOT mark UI work as done until both light and dark mode pass review

## Checklist: UI work is done when

- [ ] Affected stories render without console errors
- [ ] Screenshots captured in both light and dark mode
- [ ] Vision agent review passes for both modes with no issues found
- [ ] No broken CSS custom properties in rendered elements (spot-check via `browser_evaluate`)
- [ ] `npm run build` passes (typecheck included)
- [ ] `npm test` passes
- [ ] If the change affects shared layout/theme, all stories reviewed (not just the directly edited one)
