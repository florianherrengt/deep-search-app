import { useState, useCallback, useMemo } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button, TextInput, Textarea, Box, Text, Group, Paper, Stack, ActionIcon } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useSkills } from "@/hooks/use-skills";
import { slugifySkillTitle, type Skill } from "@/lib/skills-store";
import { PageHeader, PageLayout } from "@/components/page-layout";

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
        // deletion failed, state unchanged
      }
    },
    [deleteSkill, editing, cancelEdit],
  );

  // Memoized: slugify pulls in a regex-heavy npm package. Without useMemo it
  // runs on every keystroke in the title field (form re-renders per char).
  const previewSlug = useMemo(
    () => slugifySkillTitle(form.values.title),
    [form.values.title],
  );

  return (
    <PageLayout size="sm">
      <Stack gap="xl">
        <PageHeader
          title="Skills"
          description="Create focused instruction blocks the assistant can load when they are relevant."
          action={<Button
            variant="outline"
            size="sm"
            onClick={startAdd}
            disabled={editing.mode !== "idle"}
            leftSection={<PlusIcon size={14} />}
          >
            Add skill
          </Button>}
        />

        <Box>
          {editing.mode !== "idle" ? (
            <Paper withBorder p={{ base: "md", sm: "lg" }}>
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
                  <Textarea
                    label="Content"
                    {...form.getInputProps("content")}
                    placeholder="Skill instructions..."
                    minRows={8}
                    autosize
                  />
                  {error && (
                    <Text role="alert" size="sm" c="red">{error}</Text>
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
                  <Box className="md-flex-fill">
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
            <Paper withBorder p="xl" style={{ textAlign: "center" }}>
              <Text size="sm" fw={500}>No skills yet</Text>
              <Text size="sm" c="dimmed" mt={4}>Add a skill to give the assistant reusable, task-specific guidance.</Text>
            </Paper>
          )}
        </Box>
      </Stack>
    </PageLayout>
  );
}
