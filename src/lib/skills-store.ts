import { z } from "zod";
import { createStore } from "./store";

const skillSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  whenToUse: z.string().min(1),
  content: z.string().min(1),
});

export type Skill = z.infer<typeof skillSchema>;

export const skillsSchema = z.object({
  skills: z.array(skillSchema),
});

export type SkillsState = z.infer<typeof skillsSchema>;

export const skillsDefaults: SkillsState = {
  skills: [],
};

export const skillsStore = createStore(
  "skills.json",
  skillsSchema,
  skillsDefaults,
);

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findUniqueSlug(title: string, existingSlugs: string[]): string {
  const base = slugify(title);
  if (!existingSlugs.includes(base)) return base;

  let i = 2;
  while (existingSlugs.includes(`${base}-${i}`)) {
    i++;
  }
  return `${base}-${i}`;
}
