import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";
import type { Template } from "@/lib/prompt-templates-store";
import { cn } from "@/lib/utils";

type EditingState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalName: string };

export function PromptTemplatesSection() {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  } = usePromptTemplates();

  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startAdd = useCallback(() => {
    setEditing({ mode: "add" });
    setDraftName("");
    setDraftText("");
    setError(null);
  }, []);

  const startEdit = useCallback((template: Template) => {
    setEditing({ mode: "edit", originalName: template.name });
    setDraftName(template.name);
    setDraftText(template.text);
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing({ mode: "idle" });
    setDraftName("");
    setDraftText("");
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const name = draftName.trim();
    const text = draftText.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    if (!text) {
      setError("Prompt text is required");
      return;
    }

    try {
      if (editing.mode === "add") {
        await addTemplate({ name, text });
      } else if (editing.mode === "edit") {
        await updateTemplate(editing.originalName, { name, text });
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [editing.mode, draftName, draftText, addTemplate, updateTemplate, cancelEdit]);

  const handleDelete = useCallback(
    async (name: string) => {
      try {
        await deleteTemplate(name);
        if (editing.mode === "edit" && editing.originalName === name) {
          cancelEdit();
        }
      } catch {
        // store handles cleanup
      }
    },
    [deleteTemplate, editing, cancelEdit],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Prompt Templates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create reusable prompts for quick access from the chat.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={startAdd}
            disabled={editing.mode !== "idle"}
          >
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 flex-1 min-h-0 overflow-y-auto pb-8">
        {editing.mode !== "idle" ? (
          <div className="flex flex-col gap-3 rounded-md border p-4 h-full">
            <div className="space-y-1.5 shrink-0">
              <Label>Name</Label>
              <Input
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.currentTarget.value);
                  setError(null);
                }}
                placeholder="Template name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  } else if (e.key === "Escape") {
                    cancelEdit();
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <Label className="shrink-0">Prompt</Label>
              <textarea
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.currentTarget.value);
                  setError(null);
                }}
                placeholder="Enter prompt text..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none flex-1 min-h-0"
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive shrink-0">{error}</p>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => void handleSave()}
              >
                <CheckIcon className="size-3.5" />
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit}>
                <XIcon className="size-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : templates.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            {templates.map((template, index) => (
              <div
                key={template.name}
                className={cn(
                  "flex items-start justify-between gap-3 px-4 py-3",
                  index > 0 && "border-t",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {template.name}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground whitespace-pre-wrap">
                    {template.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${template.name}`}
                    title="Edit"
                    onClick={() => startEdit(template)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${template.name}`}
                    title="Delete"
                    onClick={() => void handleDelete(template.name)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No templates yet. Click Add to create one.
          </p>
        )}
      </div>
    </div>
  );
}
