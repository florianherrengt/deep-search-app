import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useAsyncResource } from "./use-async-resource";
import {
  skillsStore,
  findUniqueSlug,
  type Skill,
  type SkillsState,
} from "@/lib/skills-store";

interface SkillsContextValue {
  skills: Skill[];
  loading: boolean;
  addSkill: (skill: { title: string; whenToUse: string; content: string }) => Promise<void>;
  updateSkill: (originalSlug: string, skill: { title: string; whenToUse: string; content: string }) => Promise<void>;
  deleteSkill: (slug: string) => Promise<void>;
}

const SkillsContext = createContext<SkillsContextValue | null>(null);

export function SkillsProvider({ children }: { children: ReactNode }) {
  const { data: state, loading, refresh } = useAsyncResource(
    { skills: [] } as SkillsState,
    () => skillsStore.get(),
  );

  const addSkill = useCallback(
    async (input: { title: string; whenToUse: string; content: string }) => {
      const current = await skillsStore.get();
      const slug = findUniqueSlug(
        input.title,
        current.skills.map((s) => s.slug),
      );
      await skillsStore.set("skills", [...current.skills, { ...input, slug }]);
      await refresh();
    },
    [refresh],
  );

  const updateSkill = useCallback(
    async (
      originalSlug: string,
      input: { title: string; whenToUse: string; content: string },
    ) => {
      const current = await skillsStore.get();
      const idx = current.skills.findIndex((s) => s.slug === originalSlug);
      if (idx === -1) throw new Error(`Skill "${originalSlug}" not found`);

      const otherSlugs = current.skills
        .filter((s) => s.slug !== originalSlug)
        .map((s) => s.slug);
      const slug = findUniqueSlug(input.title, otherSlugs);

      const updated = [...current.skills];
      updated[idx] = { ...input, slug };
      await skillsStore.set("skills", updated);
      await refresh();
    },
    [refresh],
  );

  const deleteSkill = useCallback(
    async (slug: string) => {
      const current = await skillsStore.get();
      await skillsStore.set(
        "skills",
        current.skills.filter((s) => s.slug !== slug),
      );
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<SkillsContextValue>(
    () => ({ skills: state.skills, loading, addSkill, updateSkill, deleteSkill }),
    [state.skills, loading, addSkill, updateSkill, deleteSkill],
  );

  return (
    <SkillsContext.Provider value={value}>
      {children}
    </SkillsContext.Provider>
  );
}

export function useSkills(): SkillsContextValue {
  const ctx = useContext(SkillsContext);
  if (!ctx)
    throw new Error("useSkills must be used within SkillsProvider");
  return ctx;
}
