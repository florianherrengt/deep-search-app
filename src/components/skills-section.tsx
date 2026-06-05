import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSkills } from "@/hooks/use-skills";
import type { Skill } from "@/lib/skills-store";
import { slugify } from "@/lib/skills-store";
import { cn } from "@/lib/utils";

type EditingState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalSlug: string };

export function SkillsSection() {
  const { skills, addSkill, updateSkill, deleteSkill } = useSkills();

  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const [draftTitle, setDraftTitle] = useState("");
  const [draftWhenToUse, setDraftWhenToUse] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startAdd = useCallback(() => {
    setEditing({ mode: "add" });
    setDraftTitle("");
    setDraftWhenToUse("");
    setDraftContent("");
    setError(null);
  }, []);

  const startEdit = useCallback((skill: Skill) => {
    setEditing({ mode: "edit", originalSlug: skill.slug });
    setDraftTitle(skill.title);
    setDraftWhenToUse(skill.whenToUse);
    setDraftContent(skill.content);
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing({ mode: "idle" });
    setDraftTitle("");
    setDraftWhenToUse("");
    setDraftContent("");
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    const title = draftTitle.trim();
    const whenToUse = draftWhenToUse.trim();
    const content = draftContent.trim();

    if (!title) {
      setError("Title is required");
      return;
    }
    if (!whenToUse) {
      setError("When to use is required");
      return;
    }
    if (!content) {
      setError("Content is required");
      return;
    }

    try {
      if (editing.mode === "add") {
        await addSkill({ title, whenToUse, content });
      } else if (editing.mode === "edit") {
        await updateSkill(editing.originalSlug, { title, whenToUse, content });
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [editing.mode, draftTitle, draftWhenToUse, draftContent, addSkill, updateSkill, cancelEdit]);

  const handleDelete = useCallback(
    async (slug: string) => {
      try {
        await deleteSkill(slug);
        if (editing.mode === "edit" && editing.originalSlug === slug) {
          cancelEdit();
        }
      } catch {
        // store handles cleanup
      }
    },
    [deleteSkill, editing, cancelEdit],
  );

  const previewSlug = slugify(draftTitle);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Skills</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create instruction blocks the AI can load when relevant.
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
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.currentTarget.value);
                  setError(null);
                }}
                placeholder="Skill title"
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
              {previewSlug && (
                <p className="text-xs text-muted-foreground">slug: {previewSlug}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>When to use</Label>
              <Input
                value={draftWhenToUse}
                onChange={(e) => {
                  setDraftWhenToUse(e.currentTarget.value);
                  setError(null);
                }}
                placeholder="When should the AI load this skill?"
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <Label className="shrink-0">Content</Label>
              <textarea
                value={draftContent}
                onChange={(e) => {
                  setDraftContent(e.currentTarget.value);
                  setError(null);
                }}
                placeholder="Skill instructions..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none min-h-[200px]"
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive shrink-0">{error}</p>
            )}
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={() => void handleSave()}>
                <CheckIcon className="size-3.5" />
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={cancelEdit}>
                <XIcon className="size-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : skills.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            {skills.map((skill, index) => (
              <div
                key={skill.slug}
                className={cn(
                  "flex items-start justify-between gap-3 px-4 py-3",
                  index > 0 && "border-t",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {skill.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{skill.slug}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {skill.whenToUse}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Edit ${skill.title}`}
                    title="Edit"
                    onClick={() => startEdit(skill)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Delete ${skill.title}`}
                    title="Delete"
                    onClick={() => void handleDelete(skill.slug)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No skills yet. Click Add to create one.
          </p>
        )}
      </div>
    </div>
  );
}
