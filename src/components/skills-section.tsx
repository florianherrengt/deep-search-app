import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button, TextInput, Textarea, Box, Text, Group, Paper, Stack, ScrollArea, ActionIcon } from "@mantine/core";
import { useSkills } from "@/hooks/use-skills";
import type { Skill } from "@/lib/skills-store";
import { slugify } from "@/lib/skills-store";

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
    <Box style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box maw={640} mx="auto" w="100%" px="md" py={32} style={{ flexShrink: 0 }}>
        <Group justify="space-between">
          <Box>
            <Text size="lg" fw={600}>Skills</Text>
            <Text size="sm" c="dimmed" mt={4}>
              Create instruction blocks the AI can load when relevant.
            </Text>
          </Box>
          <Button
            variant="outline"
            size="sm"
            onClick={startAdd}
            disabled={editing.mode !== "idle"}
            leftSection={<PlusIcon size={14} />}
          >
            Add
          </Button>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} pb={32}>
        <Box maw={640} mx="auto" w="100%" px="md">
          {editing.mode !== "idle" ? (
            <Paper withBorder p="md">
              <Stack gap="sm">
                <Box>
                  <TextInput
                    label="Title"
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
                    <Text size="xs" c="dimmed" mt={4}>slug: {previewSlug}</Text>
                  )}
                </Box>
                <TextInput
                  label="When to use"
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
                <Box>
                  <Text size="sm" fw={500} mb={4}>Content</Text>
                  <Textarea
                    value={draftContent}
                    onChange={(e) => {
                      setDraftContent(e.currentTarget.value);
                      setError(null);
                    }}
                    placeholder="Skill instructions..."
                    minRows={8}
                    autosize
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                </Box>
                {error && (
                  <Text size="sm" c="red">{error}</Text>
                )}
                <Group gap="xs">
                  <Button size="sm" onClick={() => void handleSave()} leftSection={<CheckIcon size={14} />}>
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelEdit} leftSection={<XIcon size={14} />}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ) : skills.length > 0 ? (
            <Paper withBorder>
              {skills.map((skill, index) => (
                <Group
                  key={skill.slug}
                  justify="space-between"
                  px="md"
                  py="sm"
                  style={index > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined}
                >
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={500} truncate>{skill.title}</Text>
                    <Text size="xs" c="dimmed">{skill.slug}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2} mt={2}>{skill.whenToUse}</Text>
                  </Box>
                  <Group gap={2}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Edit ${skill.title}`}
                      title="Edit"
                      onClick={() => startEdit(skill)}
                    >
                      <PencilIcon size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Delete ${skill.title}`}
                      title="Delete"
                      onClick={() => void handleDelete(skill.slug)}
                    >
                      <TrashIcon size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Paper>
          ) : (
            <Paper withBorder p="sm" style={{ borderStyle: "dashed" }}>
              <Text size="sm" c="dimmed">No skills yet. Click Add to create one.</Text>
            </Paper>
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}
