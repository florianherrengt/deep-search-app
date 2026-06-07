import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button, TextInput, Textarea, Box, Text, Group, Paper, Stack, ScrollArea, ActionIcon } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useSkills } from "@/hooks/use-skills";
import { slugifySkillTitle, type Skill } from "@/lib/skills-store";

type EditingState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalSlug: string };

interface FormValues {
  title: string;
  whenToUse: string;
  content: string;
}

const EMPTY_FORM: FormValues = { title: "", whenToUse: "", content: "" };

export function SkillsSection() {
  const { skills, addSkill, updateSkill, deleteSkill } = useSkills();

  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    initialValues: EMPTY_FORM,
    validate: {
      title: (v) => (v.trim() ? null : "Title is required"),
      whenToUse: (v) => (v.trim() ? null : "When to use is required"),
      content: (v) => (v.trim() ? null : "Content is required"),
    },
  });

  const startAdd = useCallback(() => {
    setEditing({ mode: "add" });
    form.setValues(EMPTY_FORM);
    setError(null);
  }, [form]);

  const startEdit = useCallback((skill: Skill) => {
    setEditing({ mode: "edit", originalSlug: skill.slug });
    form.setValues({ title: skill.title, whenToUse: skill.whenToUse, content: skill.content });
    setError(null);
  }, [form]);

  const cancelEdit = useCallback(() => {
    setEditing({ mode: "idle" });
    form.reset();
    setError(null);
  }, [form]);

  const handleSubmit = useCallback(async (values: FormValues) => {
    const trimmed = {
      title: values.title.trim(),
      whenToUse: values.whenToUse.trim(),
      content: values.content.trim(),
    };
    try {
      if (editing.mode === "add") {
        await addSkill(trimmed);
      } else if (editing.mode === "edit") {
        await updateSkill(editing.originalSlug, trimmed);
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [editing, addSkill, updateSkill, cancelEdit]);

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

  const previewSlug = slugifySkillTitle(form.values.title);

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
              <form onSubmit={form.onSubmit(handleSubmit)} onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}>
                <Stack gap="sm">
                  <Box>
                    <TextInput
                      label="Title"
                      {...form.getInputProps("title")}
                      placeholder="Skill title"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    {previewSlug && (
                      <Text size="xs" c="dimmed" mt={4}>slug: {previewSlug}</Text>
                    )}
                  </Box>
                  <TextInput
                    label="When to use"
                    {...form.getInputProps("whenToUse")}
                    placeholder="When should the AI load this skill?"
                  />
                  <Box>
                    <Text size="sm" fw={500} mb={4}>Content</Text>
                    <Textarea
                      {...form.getInputProps("content")}
                      placeholder="Skill instructions..."
                      minRows={8}
                      autosize
                    />
                  </Box>
                  {error && (
                    <Text size="sm" c="red">{error}</Text>
                  )}
                  <Group gap="xs">
                    <Button type="submit" size="sm" leftSection={<CheckIcon size={14} />}>
                      Save
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={cancelEdit} leftSection={<XIcon size={14} />}>
                      Cancel
                    </Button>
                  </Group>
                </Stack>
              </form>
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
