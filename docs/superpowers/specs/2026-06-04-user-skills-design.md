# User Skills

> Date: 2026-06-04

## Overview

Let users create skills — reusable instruction blocks that the AI can load on demand. Each skill has a title, a short "when to use" trigger description, and a long content body. The AI sees the list of available skills (slug + whenToUse) in the system prompt, decides when one is relevant, and calls a `load_skill` tool to get the full instructions.

## Data Model

```
Skill {
  title: string      // display name, user-defined
  slug: string       // auto-generated from title (lowercase, hyphens, stripped specials)
  whenToUse: string  // short AI-facing trigger description (1-2 sentences)
  content: string    // full skill instructions
}
```

`slug` is the unique key — auto-generated from the title on creation. If the title changes during edit, the slug regenerates (and the tool call argument changes accordingly).

Slug generation: `title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")`. If a collision occurs on save, append `-2`, `-3`, etc.

### Persistence

New Tauri store file `skills.json` using the existing `createStore()` factory from `src/lib/store.ts`.

```ts
const skillSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  whenToUse: z.string().min(1),
  content: z.string().min(1),
});

const skillsSchema = z.object({
  skills: z.array(skillSchema),
});
```

Defaults: `{ skills: [] }`.

### Store file

`src/lib/skills-store.ts` — same pattern as `prompt-templates-store.ts`. Exports `skillsStore` with `get()`, `set()`, `reset()` plus a `slugify(title)` helper and a `findUniqueSlug(title, existingSlugs)` helper that handles collisions.

## UI: Skills Tab

New "Skills" tab in the top tab bar (between Prompts and Tools). The `SkillsSection` component mirrors `PromptTemplatesSection`:

- Header: "Skills" with an "Add" button
- List of skills showing title + truncated whenToUse per row
- Each row has edit and delete buttons
- Inline editor (not a dialog) with three fields: title (input), when to use (short input), content (textarea)
- Slug is auto-generated from title and shown as a readonly/grayed field so the user can see the identifier
- Empty state: "No skills yet. Click Add to create one."

### Editing state machine

```
{ mode: "idle" }
| { mode: "add" }
| { mode: "edit"; originalSlug: string }
```

Save validates: title, whenToUse, and content are required. On save, slug is regenerated from title. If editing and the slug changes, the original slug is replaced.

### Data flow

1. `useSkills()` hook loads skills from `skillsStore`
2. Add: compute slug, append to `skills` array, save
3. Edit: find by originalSlug, replace entry, save
4. Delete: remove by slug, save

## Hook: `useSkills`

Source: `src/hooks/use-skills.tsx`

```ts
{
  skills: Skill[];
  loading: boolean;
  addSkill(skill: { title: string; whenToUse: string; content: string }): Promise<void>;
  updateSkill(originalSlug: string, skill: { title: string; whenToUse: string; content: string }): Promise<void>;
  deleteSkill(slug: string): Promise<void>;
}
```

Wraps the store with React context. `PromptTemplatesProvider` pattern — hydrate on mount, refresh after mutation. `addSkill` and `updateSkill` auto-generate the slug internally.

Provider wired into `App()` wrapping `AppInner`, next to `PromptTemplatesProvider`.

## System Prompt Injection

`buildSystemPrompt()` in `guarded-stream.ts` appends a section listing all skills:

```
## Available skills

Load a skill with the `load_skill` tool when the user's request matches its description.

- expert-presenter: Use when the user needs help preparing a presentation or speech
- data-analyst: Use when the user needs to analyze data or interpret statistics
```

Only slug + whenToUse are included — not the full content. This keeps the system prompt lean regardless of how many skills exist or how long their content is.

If no skills are defined, this section is omitted entirely.

## `load_skill` Tool

A new tool always available (no API key needed). Registered in `tool-registry.ts` alongside the existing tools.

### Parameters

```ts
z.object({
  slug: z.string().describe("The slug of the skill to load"),
})
```

### Behavior

1. Read skills from `skillsStore`
2. Find the skill with matching slug
3. Return `skill.content` as the tool result
4. If slug not found, return: `Skill "${slug}" not found. Available skills: ${availableSlugs.join(", ")}`

### Tool file

`src/tools/load-skill-tool.ts` — follows the pattern of other tool files. Uses `skillsStore.get()` to read skills at call time (not at tool creation time) so newly added skills are picked up mid-session.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/lib/skills-store.ts` | Create — store definition + slugify helper |
| `src/hooks/use-skills.tsx` | Create — React context/hook |
| `src/components/skills-section.tsx` | Create — Skills tab panel |
| `src/tools/load-skill-tool.ts` | Create — load_skill tool definition |
| `src/lib/transport/tool-registry.ts` | Modify — add `load_skill` to tools |
| `src/lib/transport/guarded-stream.ts` | Modify — append skills list to `buildSystemPrompt()` |
| `src/components/tab-panel.tsx` | Modify — add Skills tab button |
| `src/App.tsx` | Modify — add `SkillsProvider`, wire `SkillsSection` to tab panel |

## Out of Scope

- Per-folder or per-session skills (global only)
- Skill import/export
- Skill categories/folders
- Default/starter skills
- Manual skill activation by the user (AI auto-detects)
- Skill versioning
