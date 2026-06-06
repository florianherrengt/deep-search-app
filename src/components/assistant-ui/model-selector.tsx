import {
  createContext,
  memo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Select as MantineSelect } from "@mantine/core";
import { useAui } from "@assistant-ui/react";
import { formatContextWindowTokens } from "@/lib/context-window";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  contextWindowTokens?: number;
  icon?: ReactNode;
  disabled?: boolean;
};

type ModelSelectorContextValue = {
  models: ModelOption[];
  value: string | undefined;
};

const ModelSelectorContext =
  createContext<ModelSelectorContextValue | null>(null);

export type ModelSelectorRootProps = {
  models: ModelOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
};

function ModelSelectorRoot({
  models,
  children,
  value,
}: ModelSelectorRootProps) {
  return (
    <ModelSelectorContext.Provider value={{ models, value }}>
      {children}
    </ModelSelectorContext.Provider>
  );
}

export type ModelSelectorProps = {
  models: ModelOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  variant?: string;
  size?: string;
};

const ModelSelectorImpl = ({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  defaultValue,
  models,
  variant,
  size,
}: ModelSelectorProps) => {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(
    () => defaultValue ?? models[0]?.id ?? "",
  );
  const value = isControlled ? controlledValue : internalValue;
  const onValueChange = controlledOnValueChange ?? setInternalValue;
  const api = useAui();

  useEffect(() => {
    const context = { config: { modelName: value } };
    return api.modelContext().register({
      getModelContext: () => context,
    });
  }, [api, value]);

  return (
    <MantineSelect
      value={value}
      onChange={(v) => {
        if (v) onValueChange(v);
      }}
      data={models.map((model) => {
        const contextWindowLabel = formatContextWindowTokens(model.contextWindowTokens);
        const metadata = [model.description, contextWindowLabel].filter(Boolean).join(" - ");
        return {
          value: model.id,
          label: metadata ? `${model.name} — ${metadata}` : model.name,
          disabled: model.disabled,
        };
      })}
      size={size === "sm" ? "xs" : "sm"}
      variant={variant === "ghost" ? "unstyled" : "default"}
      allowDeselect={false}
      maxDropdownHeight={300}
      styles={
        variant === "ghost"
          ? {
              input: {
                backgroundColor: "transparent",
                border: "none",
                fontWeight: 500,
                ":hover": { backgroundColor: "var(--mantine-color-gray-1)" },
              },
            }
          : undefined
      }
    />
  );
};

type ModelSelectorComponent = typeof ModelSelectorImpl & {
  displayName?: string;
  Root: typeof ModelSelectorRoot;
};

const ModelSelector = memo(
  ModelSelectorImpl,
) as unknown as ModelSelectorComponent;

ModelSelector.displayName = "ModelSelector";
ModelSelector.Root = ModelSelectorRoot;

export {
  ModelSelector,
  ModelSelectorRoot,
};
