import { useState, useCallback } from "react";
import { PencilIcon, TrashIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import { Button, TextInput, Textarea, Box, Text, Group, Paper, Stack, ScrollArea, ActionIcon } from "@mantine/core";
import { useForm } from "@mantine/form";
import { usePromptTemplates } from "@/hooks/use-prompt-templates";

type EditingState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalName: string };

interface FormValues {
  name: string;
  text: string;
}

const EMPTY_FORM: FormValues = { name: "", text: "" };

export function PromptTemplatesSection() {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
  } = usePromptTemplates();

  const [editing, setEditing] = useState<EditingState>({ mode: "idle" });
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    initialValues: EMPTY_FORM,
    validate: {
      name: (v) => (v.trim() ? null : "Name is required"),
      text: (v) => (v.trim() ? null : "Prompt text is required"),
    },
  });

  const startAdd = useCallback(() => {
    setEditing({ mode: "add" });
    form.setValues(EMPTY_FORM);
    setError(null);
  }, [form]);

  const startEdit = useCallback((template: { name: string; text: string }) => {
    setEditing({ mode: "edit", originalName: template.name });
    form.setValues({ name: template.name, text: template.text });
    setError(null);
  }, [form]);

  const cancelEdit = useCallback(() => {
    setEditing({ mode: "idle" });
    form.reset();
    setError(null);
  }, [form]);

  const handleSubmit = useCallback(async (values: FormValues) => {
    const trimmed = {
      name: values.name.trim(),
      text: values.text.trim(),
    };
    try {
      if (editing.mode === "add") {
        await addTemplate(trimmed);
      } else if (editing.mode === "edit") {
        await updateTemplate(editing.originalName, trimmed);
      }
      cancelEdit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [editing, addTemplate, updateTemplate, cancelEdit]);

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
    <Box className="md-flex-col">
      <Box maw={640} mx="auto" w="100%" px="md" py={32} style={{ flexShrink: 0 }}>
        <Group justify="space-between">
          <Box>
            <Text size="lg" fw={600}>Prompt Templates</Text>
            <Text size="sm" c="dimmed" mt={4}>
              Create reusable prompts for quick access from the chat.
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

      <ScrollArea className="md-flex-fill" pb={32}>
        <Box maw={640} mx="auto" w="100%" px="md">
          {editing.mode !== "idle" ? (
            <Paper withBorder p="md" className="md-flex-col">
              <form onSubmit={form.onSubmit(handleSubmit)} onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }} className="md-flex-col">
                <Stack gap="sm" className="md-flex-fill">
                    <TextInput
                      label="Name"
                      {...form.getInputProps("name")}
                      placeholder="Template name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                  <Box className="md-flex-col">
                    <Text size="sm" fw={500} mb={4}>Prompt</Text>
                    <Textarea
                      {...form.getInputProps("text")}
                      placeholder="Enter prompt text..."
                      autosize
                      minRows={6}
                      style={{ flex: 1 }}
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
          ) : templates.length > 0 ? (
            <Paper withBorder>
              {templates.map((template, index) => (
                <Group
                  key={template.name}
                  justify="space-between"
                  px="md"
                  py="sm"
                  style={index > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined}
                >
                  <Box className="md-flex-fill">
                    <Text size="sm" fw={500} truncate>{template.name}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2} mt={2} style={{ whiteSpace: "pre-wrap" }}>
                      {template.text}
                    </Text>
                  </Box>
                  <Group gap={2}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Edit ${template.name}`}
                      title="Edit"
                      onClick={() => startEdit(template)}
                    >
                      <PencilIcon size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Delete ${template.name}`}
                      title="Delete"
                      onClick={() => void handleDelete(template.name)}
                    >
                      <TrashIcon size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              ))}
            </Paper>
          ) : (
            <Paper withBorder p="sm" style={{ borderStyle: "dashed" }}>
              <Text size="sm" c="dimmed">No templates yet. Click Add to create one.</Text>
            </Paper>
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}
