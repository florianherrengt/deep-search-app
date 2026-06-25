import {
  createContext,
  memo,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Select as MantineSelect } from "@mantine/core";
import { useUncontrolled } from "@mantine/hooks";
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
  onConfigure?: () => void;
  defaultValue?: string;
  variant?: string;
  size?: string;
};

const CONFIGURE_VALUE = "__configure__";

const ModelSelectorImpl = ({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  onConfigure,
  defaultValue,
  models,
  variant,
  size,
}: ModelSelectorProps) => {
  const [value, setValue] = useUncontrolled({
    value: controlledValue,
    defaultValue,
    finalValue: models[0]?.id ?? "",
    onChange: controlledOnValueChange,
  });
  const api = useAui();

  // Memoized: avoid re-running formatContextWindowTokens + string concat for
  // every model on every render. Only recomputes when the models array
  // reference changes (which happens on settings updates, not per token).
  const selectData = useMemo(
    () => [
      ...models.map((model) => {
        const contextWindowLabel = formatContextWindowTokens(model.contextWindowTokens);
        const metadata = [model.description, contextWindowLabel].filter(Boolean).join(" - ");
        return {
          value: model.id,
          label: metadata ? `${model.name} — ${metadata}` : model.name,
          disabled: model.disabled,
        };
      }),
      {
        value: CONFIGURE_VALUE,
        label: "Configure providers...",
        disabled: false,
      },
    ],
    [models],
  );

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
        if (v === CONFIGURE_VALUE) {
          onConfigure?.();
          return;
        }
        if (v) setValue(v);
      }}
      data={selectData}
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
              },
            }
          : undefined
      }
      classNames={
        variant === "ghost"
          ? { input: "md-hover-bg" }
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
