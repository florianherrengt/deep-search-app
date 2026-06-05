import { tool, zodSchema } from "ai";
import { z } from "zod";
import { skillsStore } from "@/lib/skills-store";

const loadSkillInputSchema = z.object({
  slug: z.string().describe("The slug of the skill to load"),
});

export function createLoadSkillTool() {
  return tool({
    description:
      "Load a skill by its slug. Skills provide specialized instructions for specific tasks. " +
      "Use this tool when the user's request matches one of the available skills described in the system prompt.",
    strict: true,
    inputSchema: zodSchema(loadSkillInputSchema),
    execute: async ({ slug }) => {
      const { skills } = await skillsStore.get();
      const skill = skills.find((s) => s.slug === slug);

      if (!skill) {
        const available = skills.map((s) => s.slug).join(", ");
        return `Skill "${slug}" not found. Available skills: ${available || "(none)"}`;
      }

      return skill.content;
    },
  });
}
