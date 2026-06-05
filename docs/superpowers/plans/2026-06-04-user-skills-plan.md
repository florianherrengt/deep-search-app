# User Skills — Implementation Plan

## Step 1: Skills store

Create `src/lib/skills-store.ts`.

- Define `skillSchema` with `title`, `slug`, `whenToUse`, `content` (all `z.string().min(1)`)
- Export `Skill` type
- Define `skillsSchema = z.object({ skills: z.array(skillSchema) })`
- Defaults: `{ skills: [] }`
- Export `skillsStore = createStore("skills.json", skillsSchema, skillsDefaults)`
- Export `slugify(title: string)` helper: lowercase, replace non-alphanumeric with hyphens, trim hyphens
- Export `findUniqueSlug(title: string, existingSlugs: string[])` helper: generate slug, if collision append `-2`, `-3`, etc.

## Step 2: Skills hook/context

Create `src/hooks/use-skills.tsx`.

Follow `use-prompt-templates.tsx` pattern:
- `SkillsProvider` wrapping `createContext`, load from `skillsStore` on mount
- CRUD methods: `addSkill({ title, whenToUse, content })`, `updateSkill(originalSlug, { title, whenToUse, content })`, `deleteSkill(slug)`
- `addSkill` generates slug via `findUniqueSlug`
- `updateSkill` regenerates slug, removes old entry by `originalSlug`, adds new
- Export `useSkills()` hook

## Step 3: Provider wiring

Modify `src/App.tsx`.

- Import `SkillsProvider` from `@/hooks/use-skills`
- Wrap `<AppInner />` with `<SkillsProvider>` inside `PromptTemplatesProvider`

## Step 4: load_skill tool

Create `src/tools/load-skill-tool.ts`.

Follow `sequential-thinking-tool.ts` pattern:
- Input schema: `z.object({ slug: z.string().describe("The slug of the skill to load") })`
- Factory `createLoadSkillTool()`
- `execute`: reads `skillsStore.get()`, finds skill by slug, returns `skill.content`
- If not found: returns error message with available slugs
- No `outputSchema` needed (returns plain text)

## Step 5: Register tool

Modify `src/lib/transport/tool-registry.ts`.

- Import `createLoadSkillTool` from `@/tools/load-skill-tool`
- Add `load_skill: createLoadSkillTool()` to the always-available tools object (alongside `sequential_thinking`, `ask_questions`, etc.)

## Step 6: System prompt injection

Modify `src/lib/transport/guarded-stream.ts`.

- Import `skillsStore` from `@/lib/skills-store`
- In `buildSystemPrompt()`, after existing sections:
  - Read skills from `skillsStore.get()` (await it — make the function async if needed, or read skills at call site)
  - If skills array is non-empty, append section:
    ```
    \n\n## Available skills\n\nLoad a skill with the `load_skill` tool when the user's request matches its description.\n\n
    ```
    Plus one `- slug: whenToUse` line per skill
- Note: `buildSystemPrompt` is called synchronously today. Skills need to be read async. Options:
  a. Pass skills as a parameter to `buildSystemPrompt` (read at call site where async context is available)
  b. Make `buildSystemPrompt` async
  Go with (a) — add `skills?: { slug: string; whenToUse: string }[]` parameter. The caller already has async context.

## Step 7: Skills section UI

Create `src/components/skills-section.tsx`.

Follow `prompt-templates-section.tsx` pattern:
- Uses `useSkills()` hook
- Editing state: `{ mode: "idle" } | { mode: "add" } | { mode: "edit"; originalSlug: string }`
- List view: each row shows title (bold), truncated whenToUse below, slug grayed out, edit/delete buttons
- Inline editor: title input, slug (readonly, auto-generated), whenToUse input, content textarea, Save/Cancel
- Empty state message
- Uses shadcn `Button`, `Input`, `Label` (all already available)

## Step 8: Tab bar + panel wiring

### `src/components/tab-panel.tsx`

- Add `skillsPanel` to `TabPanelProps` (ReactNode)
- Add Skills button in tab bar (between Prompts and Tools)
- Add `<div hidden={activeTabId !== "skills"}>` for the panel content

### `src/App.tsx`

- Import `SkillsSection` from `@/components/skills-section`
- Pass `skillsPanel={<SkillsSection />}` to `<TabPanel>`
- Import `skillsStore` from `@/lib/skills-store`
- In the call site for `buildSystemPrompt`, read skills and pass as parameter:
  ```ts
  const skillsData = await skillsStore.get();
  const effectiveSystemPrompt = buildSystemPrompt(upfrontSearchResults, folderContext, skillsData.skills);
  ```

## File summary

| # | File | Action |
|---|------|--------|
| 1 | `src/lib/skills-store.ts` | Create |
| 2 | `src/hooks/use-skills.tsx` | Create |
| 3 | `src/App.tsx` | Modify (provider + skills panel + skills param) |
| 4 | `src/tools/load-skill-tool.ts` | Create |
| 5 | `src/lib/transport/tool-registry.ts` | Modify |
| 6 | `src/lib/transport/guarded-stream.ts` | Modify |
| 7 | `src/components/skills-section.tsx` | Create |
| 8 | `src/components/tab-panel.tsx` | Modify |

## Build order

Steps 1-2 are independent of everything else. Steps 3-8 depend on 1-2. Steps 4-5 can be done in parallel. Steps 6-8 can be done in parallel after 4-5.

Recommended sequence: 1 → 2 → (4 + 5 + 7 in parallel) → 6 → 8 → 3.
