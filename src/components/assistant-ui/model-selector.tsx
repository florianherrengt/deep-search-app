import {
  createContext,
  memo,
  useContext,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Select as SelectPrimitive } from "radix-ui";
import type { VariantProps } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import { useAui } from "@assistant-ui/react";

import { cn } from "@/lib/utils";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  type selectTriggerVariants,
} from "@/components/assistant-ui/select";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type ModelSelectorContextValue = {
  models: ModelOption[];
  value: string | undefined;
};

const ModelSelectorContext =
  createContext<ModelSelectorContextValue | null>(null);

function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);
  if (!context) {
    throw new Error(
      "ModelSelector sub-components must be used within ModelSelector.Root",
    );
  }
  return context;
}

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
  defaultValue: defaultValueProp,
  children,
  value,
  ...selectProps
}: ModelSelectorRootProps) {
  const defaultValue = defaultValueProp ?? models[0]?.id;

  return (
    <ModelSelectorContext.Provider value={{ models, value }}>
      <SelectRoot
        {...(defaultValue !== undefined ? { defaultValue } : undefined)}
        {...(value !== undefined ? { value } : undefined)}
        {...selectProps}
      >
        {children}
      </SelectRoot>
    </ModelSelectorContext.Provider>
  );
}

export type ModelSelectorTriggerProps = ComponentPropsWithoutRef<
  typeof SelectTrigger
>;

function ModelSelectorTrigger({
  className,
  variant,
  size,
  children,
  ...props
}: ModelSelectorTriggerProps) {
  return (
    <SelectTrigger
      data-slot="model-selector-trigger"
      variant={variant}
      size={size}
      className={cn("aui-model-selector-trigger max-w-full", className)}
      {...props}
    >
      {children ?? <ModelSelectorValue />}
    </SelectTrigger>
  );
}

function ModelSelectorValue() {
  const { models, value } = useModelSelectorContext();
  const selectedModel =
    value != null ? models.find((model) => model.id === value) : undefined;

  if (!selectedModel) {
    return <SelectPrimitive.Value />;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {selectedModel.icon && (
        <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          {selectedModel.icon}
        </span>
      )}
      <span className="truncate font-medium">{selectedModel.name}</span>
    </span>
  );
}

export type ModelSelectorContentProps = ComponentPropsWithoutRef<
  typeof SelectContent
>;

function ModelSelectorContent({
  className,
  children,
  ...props
}: ModelSelectorContentProps) {
  const { models } = useModelSelectorContext();

  return (
    <SelectContent
      data-slot="model-selector-content"
      className={cn("min-w-[240px]", className)}
      {...props}
    >
      {children ??
        models.map((model) => (
          <ModelSelectorItem
            key={model.id}
            model={model}
            {...(model.disabled ? { disabled: true } : undefined)}
          />
        ))}
    </SelectContent>
  );
}

export type ModelSelectorItemProps = Omit<
  ComponentPropsWithoutRef<typeof SelectItem>,
  "value" | "children"
> & {
  model: ModelOption;
};

function ModelSelectorItem({ model, className, ...props }: ModelSelectorItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="model-selector-item"
      value={model.id}
      textValue={model.name}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-md py-2 ps-3 pe-9 text-sm outline-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute end-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            {model.icon && (
              <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                {model.icon}
              </span>
            )}
            <span className="truncate font-medium">{model.name}</span>
          </span>
          {model.description && (
            <span className="truncate text-xs text-muted-foreground">
              {model.description}
            </span>
          )}
        </span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export type ModelSelectorProps = Omit<ModelSelectorRootProps, "children"> &
  VariantProps<typeof selectTriggerVariants> & {
    contentClassName?: string;
  };

const ModelSelectorImpl = ({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  defaultValue,
  models,
  variant,
  size,
  contentClassName,
  ...forwardedProps
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
    <ModelSelectorRoot
      models={models}
      value={value}
      onValueChange={onValueChange}
      {...forwardedProps}
    >
      <ModelSelectorTrigger variant={variant} size={size} />
      <ModelSelectorContent className={contentClassName} />
    </ModelSelectorRoot>
  );
};

type ModelSelectorComponent = typeof ModelSelectorImpl & {
  displayName?: string;
  Root: typeof ModelSelectorRoot;
  Trigger: typeof ModelSelectorTrigger;
  Content: typeof ModelSelectorContent;
  Item: typeof ModelSelectorItem;
  Value: typeof ModelSelectorValue;
};

const ModelSelector = memo(
  ModelSelectorImpl,
) as unknown as ModelSelectorComponent;

ModelSelector.displayName = "ModelSelector";
ModelSelector.Root = ModelSelectorRoot;
ModelSelector.Trigger = ModelSelectorTrigger;
ModelSelector.Content = ModelSelectorContent;
ModelSelector.Item = ModelSelectorItem;
ModelSelector.Value = ModelSelectorValue;

export {
  ModelSelector,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorValue,
};
