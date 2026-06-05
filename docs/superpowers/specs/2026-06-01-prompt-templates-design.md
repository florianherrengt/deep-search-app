# Prompt Templates

> Date: 2026-06-01

## Overview

Save reusable prompt templates and access them from a split button in the composer. Click the main area to populate and send the last-used template; click the arrow to pick a different one. Manage templates from a dedicated section in the settings dialog.

## Data Model

```
Template {
  name: string   // unique identifier, user-defined
  text: string   // the prompt text
}
```

`name` is the unique key — no separate id field.

### Persistence

New Tauri store file `prompt-templates.json` using the existing `createStore()` factory from `src/lib/store.ts`.

Schema:

```ts
const promptTemplatesSchema = z.object({
  templates: z.array(z.object({
    name: z.string().min(1),
    text: z.string().min(1),
  })),
  lastSelectedTemplate: z.string().nullable(),   // template name or null
});
```

Defaults: `{ templates: [], lastSelectedTemplate: null }`.

### Store file

`src/lib/prompt-templates-store.ts` — same pattern as `settings-store.ts`. Exports `promptTemplatesStore` with `get()`, `set()`, `reset()`.

## Composer: Split Button

A new `PromptTemplateButton` component rendered in `thread.tsx`, positioned between the `ModelSelector` and the Send/Cancel buttons.

### Anatomy

```
┌──────────────────────────┐
│  "Template Name"  │  ▾  │
└──────────────────────────┘
  ↑ main click area   ↑ arrow
```

- **Main area**: Shows the name of the last-selected template (or a generic label like "Template" if none selected). Clicking it:
  1. Reads the last-selected template from the store
  2. Calls `aui.composer().setText(template.text)` to populate the input
  3. Calls `aui.composer().send()` to send immediately
  4. If no template was selected, does nothing (disabled state)

- **Arrow (▾)**: Opens a `Popover` listing all saved templates by name. Clicking one:
  1. Sets `lastSelectedTemplate` in the store
  2. Calls `aui.composer().setText(template.text)` to populate the input (does NOT send — user can edit)
  3. Updates the main area label to the selected template's name

Both areas are hidden/disabled when the thread is running (matching the existing Send/Cancel conditional).

### UI Components

Add shadcn `popover` component (`npx shadcn@latest add popover`). The split button uses two adjacent buttons: a main button and a small arrow button, grouped visually with a shared border/radius.

### Implementation notes

- Uses `useAui()` from `@assistant-ui/react` (already used in `model-selector.tsx`) to call `aui.composer().setText()` and `aui.composer().send()`
- Template data is loaded via a `usePromptTemplates` hook (see below)
- No new shadcn components beyond `popover`

## Settings: Templates Section

A new section at the bottom of the existing settings dialog (`settings-dialog.tsx` / `settings-fields.tsx`), or as a dedicated tab/section within it.

### UI

- Header: "Prompt Templates"
- List of templates showing name + truncated text preview
- Each row has edit and delete buttons
- "Add Template" button at the top of the section
- Adding/editing opens inline form fields (name input + textarea for text) directly in the list, not a separate dialog
- Name must be unique — validation on save

### Data flow

1. `usePromptTemplates()` hook loads templates from `promptTemplatesStore`
2. Add: append to `templates` array, save to store
3. Edit: update entry in `templates` array by name, save to store
4. Delete: remove entry from `templates` array, save to store. If the deleted template was `lastSelectedTemplate`, clear that field too.
5. Reorder: not in v1 — templates display in creation order

## Hook: `usePromptTemplates`

Source: `src/hooks/use-prompt-templates.ts`

Wraps the store with React state. Returns:

```ts
{
  templates: Template[];
  lastSelectedTemplate: string | null;
  loading: boolean;
  addTemplate(template: Template): Promise<void>;
  updateTemplate(oldName: string, template: Template): Promise<void>;
  deleteTemplate(name: string): Promise<void>;
  setLastSelectedTemplate(name: string | null): Promise<void>;
}
```

`addTemplate` rejects if name already exists. `updateTemplate` takes the old name (for lookup) and the new template data (name may have changed).

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/prompt-templates-store.ts` | Create — store definition |
| `src/hooks/use-prompt-templates.ts` | Create — React hook |
| `src/components/assistant-ui/prompt-template-button.tsx` | Create — split button component |
| `src/components/ui/popover.tsx` | Create — via `npx shadcn@latest add popover` |
| `src/components/assistant-ui/thread.tsx` | Modify — add `PromptTemplateButton` to composer |
| `src/components/settings-fields.tsx` | Modify — add templates section |

## Out of Scope

- Drag-and-drop reordering
- Template folders/categories
- Import/export templates
- Per-conversation templates
- Variable interpolation in templates
- Default/starter templates
