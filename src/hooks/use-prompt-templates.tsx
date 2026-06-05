import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  promptTemplatesStore,
  type Template,
  type PromptTemplatesState,
} from "@/lib/prompt-templates-store";

interface PromptTemplatesContextValue {
  templates: Template[];
  lastSelectedTemplate: string | null;
  loading: boolean;
  addTemplate: (template: Template) => Promise<void>;
  updateTemplate: (oldName: string, template: Template) => Promise<void>;
  deleteTemplate: (name: string) => Promise<void>;
  setLastSelectedTemplate: (name: string | null) => Promise<void>;
}

const PromptTemplatesContext = createContext<PromptTemplatesContextValue | null>(null);

export function PromptTemplatesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromptTemplatesState>({
    templates: [],
    lastSelectedTemplate: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    promptTemplatesStore.get().then((data) => {
      if (!cancelled) {
        setState(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const data = await promptTemplatesStore.get();
    setState(data);
  }, []);

  const addTemplate = useCallback(
    async (template: Template) => {
      const current = await promptTemplatesStore.get();
      if (current.templates.some((t) => t.name === template.name)) {
        throw new Error(`Template "${template.name}" already exists`);
      }
      await promptTemplatesStore.set("templates", [
        ...current.templates,
        template,
      ]);
      await refresh();
    },
    [refresh],
  );

  const updateTemplate = useCallback(
    async (oldName: string, template: Template) => {
      const current = await promptTemplatesStore.get();
      const idx = current.templates.findIndex((t) => t.name === oldName);
      if (idx === -1) throw new Error(`Template "${oldName}" not found`);

      if (
        template.name !== oldName &&
        current.templates.some((t) => t.name === template.name)
      ) {
        throw new Error(`Template "${template.name}" already exists`);
      }

      const updated = [...current.templates];
      updated[idx] = template;
      await promptTemplatesStore.set("templates", updated);

      if (current.lastSelectedTemplate === oldName) {
        await promptTemplatesStore.set("lastSelectedTemplate", template.name);
      }

      await refresh();
    },
    [refresh],
  );

  const deleteTemplate = useCallback(
    async (name: string) => {
      const current = await promptTemplatesStore.get();
      await promptTemplatesStore.set(
        "templates",
        current.templates.filter((t) => t.name !== name),
      );
      if (current.lastSelectedTemplate === name) {
        await promptTemplatesStore.set("lastSelectedTemplate", null);
      }
      await refresh();
    },
    [refresh],
  );

  const setLastSelectedTemplate = useCallback(
    async (name: string | null) => {
      await promptTemplatesStore.set("lastSelectedTemplate", name);
      await refresh();
    },
    [refresh],
  );

  const lastSelected =
    state.lastSelectedTemplate &&
    state.templates.find((t) => t.name === state.lastSelectedTemplate)
      ? state.lastSelectedTemplate
      : null;

  return (
    <PromptTemplatesContext.Provider
      value={{
        templates: state.templates,
        lastSelectedTemplate: lastSelected,
        loading,
        addTemplate,
        updateTemplate,
        deleteTemplate,
        setLastSelectedTemplate,
      }}
    >
      {children}
    </PromptTemplatesContext.Provider>
  );
}

export function usePromptTemplates(): PromptTemplatesContextValue {
  const ctx = useContext(PromptTemplatesContext);
  if (!ctx)
    throw new Error(
      "usePromptTemplates must be used within PromptTemplatesProvider",
    );
  return ctx;
}
