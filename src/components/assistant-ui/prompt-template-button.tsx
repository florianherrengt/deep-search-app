import { useState } from "react";
import { useAui } from "@assistant-ui/react";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import { cn } from "@/lib/utils";

const SPLIT_BASE =
  "inline-flex items-center rounded-xl text-sm h-[36px] border border-zinc-300 dark:border-zinc-600 overflow-hidden";
const SPLIT_MAIN =
  "px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:pointer-events-none";
const SPLIT_ARROW =
  "px-1.5 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-l border-zinc-300 dark:border-zinc-600 transition-colors disabled:opacity-50 disabled:pointer-events-none";
const ITEM_CLASS =
  "w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors truncate";

export function PromptTemplateButton() {
  const [open, setOpen] = useState(false);
  const aui = useAui();
  const {
    templates,
    lastSelectedTemplate,
    setLastSelectedTemplate,
  } = usePromptTemplates();

  const lastTemplate = templates.find(
    (t) => t.name === lastSelectedTemplate,
  );

  function handleSendTemplate() {
    if (!lastTemplate) return;
    aui.composer().setText(lastTemplate.text);
    aui.composer().send();
  }

  function handleSelectTemplate(name: string) {
    const template = templates.find((t) => t.name === name);
    if (!template) return;
    void setLastSelectedTemplate(name);
    aui.composer().setText(template.text);
    setOpen(false);
  }

  return (
    <div className={SPLIT_BASE}>
      <button
        type="button"
        className={cn(SPLIT_MAIN, (!lastTemplate || templates.length === 0) && "opacity-50")}
        disabled={!lastTemplate || templates.length === 0}
        onClick={handleSendTemplate}
        title={
          templates.length === 0
            ? "No templates — add some in Settings → Prompts"
            : lastTemplate
              ? `Send "${lastTemplate.name}"`
              : "Select a template first"
        }
      >
        <span className="flex items-center gap-1.5">
          <FileTextIcon className="size-3.5 shrink-0" />
          <span className="max-w-[120px] truncate">
            {lastTemplate?.name ?? "Template"}
          </span>
        </span>
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={SPLIT_ARROW}
            disabled={templates.length === 0}
            aria-label="Select template"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 p-1"
        >
          <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {templates.map((template) => (
              <button
                key={template.name}
                type="button"
                className={cn(
                  ITEM_CLASS,
                  template.name === lastSelectedTemplate &&
                    "bg-accent font-medium",
                )}
                onClick={() => handleSelectTemplate(template.name)}
                title={template.text}
              >
                {template.name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
