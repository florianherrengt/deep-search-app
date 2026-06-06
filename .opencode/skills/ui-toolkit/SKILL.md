---
name: ui-toolkit
description: Shared reference for Storybook-based UI inspection and vision agent analysis. Loaded by debug-visual-spacing and review-ui — do not trigger directly.
---

# UI Toolkit

Shared techniques for inspecting and visually reviewing Mantine + React components in Storybook.

## Storybook iframe evaluate pattern

Storybook renders stories inside an iframe. To inspect computed styles, target the iframe:

```js
() => {
  const iframe = document.getElementById('storybook-preview-iframe');
  if (!iframe) return 'no iframe';
  const doc = iframe.contentDocument;
  const el = doc.querySelector('YOUR_SELECTOR');
  if (!el) return 'not found';
  const cs = getComputedStyle(el);
  return {
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    marginTop: cs.marginTop,
    marginBottom: cs.marginBottom,
    height: cs.height,
    width: cs.width,
    rawStyle: el.getAttribute('style'),
  };
}
```

### What to check in computed styles

- **`lineHeight`** — Should be ~1.2–1.6x the `fontSize`. A value like `17px` on an `11px` font with no explicit `lh` prop means a broken CSS custom property.
- **`rawStyle`** — Check for CSS custom properties with suspicious values. Example: `--text-lh: 11` (unitless = 11x multiplier, not 11px).
- **`fontSize` vs `lineHeight` ratio** — If lineHeight > 2x fontSize without an explicit `lh` prop, something is wrong.

## Mantine gotchas

| Prop | Bug | Effect | Fix |
|------|-----|--------|-----|
| `<Text size="11">` | Sets `--text-lh: 11` (unitless) | 11x line-height multiplier | Use `size="xs" fz={11}` |
| `<Text size="9">` | Sets `--text-lh: 9` (unitless) | 9x line-height multiplier | Use `size="xs" fz={9}` |
| Any `size={number}` | Not a valid Mantine token | `--text-fz` and `--text-lh` get raw numbers | Use a named size + `fz` override |

**Rule**: Mantine `size` only accepts predefined tokens: `"xs"`, `"sm"`, `"md"`, `"lg"`, `"xl"`. For custom font sizes, use a valid token and override with `fz`.

## Cropped screenshots

Always crop to the component using the `target` selector. Full-viewport screenshots make the vision agent less effective.

```
browser_take_screenshot:
  target: "YOUR_SELECTOR"  // e.g. "aside", "[data-testid='foo']"
  type: "png"
  filename: "name.png"
```

For Storybook, navigate with color scheme:
```
Light: http://localhost:6006/?path=/story/ID&globals=colorScheme:light
Dark:  http://localhost:6006/?path=/story/ID&globals=colorScheme:dark
```

## Vision agent prompting rules

The vision agent cannot see CSS values — it only sees pixels. Prompt it correctly:

**Bad**: "Check the spacing looks OK"
**Bad**: "Does this look good?"

**Good** — name elements, compare, ask about specific properties:
> "Compare the 'PREVIOUS CHATS' label with the 'PREVIOUS SEARCHES' label. Does one have an excessively tall line-height compared to its font size?"

Three rules for vision prompts:
1. **Name the elements** — give specific text content or selectors to compare
2. **Ask about specific properties** — "line-height", "contrast", "proportional to font size"
3. **Use comparison** — "compare X with Y" rather than "does X look OK"

## Anti-patterns

- **Don't use full-viewport screenshots for component-level reviews** — crop to the element
- **Don't trust the vision agent for CSS values** — it cannot see `line-height`, `--custom-properties`, or computed styles. It only sees the visual result.
- **Don't review only light mode** — dark mode is where most contrast and spacing bugs hide
- **Don't use `size={number}` on Mantine components** — only use predefined size tokens
- **Don't tweak padding/margin values blindly** — always inspect computed styles first
